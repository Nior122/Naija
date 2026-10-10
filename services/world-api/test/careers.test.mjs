import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { loadCareerCatalog, validateCareerCatalogForTest } from "../dist/careers/catalog.js";
import {
  buildCareerProfile,
  careerEligibility,
  completeCareerWorkSession,
  endCareerAtDeath,
  initializeCareerWorldState,
  issueCareerLicenseServerSide,
  processCareerWorldDate,
  processPendingCareerApplications,
  prototypeSalaryAccountPort,
  requestCareerLeave,
  requestCareerPromotion,
  requestCareerRetirement,
  resignCareerEmployment,
  terminateCareerEmploymentAsEmployer,
  searchCareerJobsForCharacter,
  startCareerWorkSession,
  submitCareerApplication,
} from "../dist/careers/service.js";
import { loadLifeCatalog, normalizeWorldClock, worldDayForDate } from "../dist/life/calendar.js";
import { createStarterFamily, recordRetirement } from "../dist/life/service.js";
import { WorldStore } from "../dist/multiplayer/persistence.js";

const activeServers = new Set();
const activeDirectories = new Set();
const CAREER_MAPS = [
  "careerEmployers", "careerVacancies", "careerApplications", "employments", "workSessions", "careerSkills",
  "careerLicenses", "careerReviews", "careerLeaveRequests", "careerEvents", "salaryPayments", "npcCareers",
];
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class TestPeer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else this.messages.push(message);
    });
  }

  send(message) { this.socket.send(JSON.stringify(message)); }

  waitFor(predicate, timeoutMs = 3000) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((entry) => entry !== waiter);
          reject(new Error("Timed out waiting for a career WebSocket result."));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  waitForType(type, timeoutMs) { return this.waitFor((message) => message.type === type, timeoutMs); }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => { this.socket.terminate(); resolve(); }, 1000);
      this.socket.once("close", () => { clearTimeout(timer); resolve(); });
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
      else this.socket.terminate();
    });
  }
}

function emptyCareerMaps() {
  return Object.fromEntries(CAREER_MAPS.map((key) => [key, {}]));
}

function makeWorld(date = { year: 2025, month: 1, day: 4 }) {
  const now = Date.UTC(2025, 0, 4, 10, 0, 0);
  const lifeCatalog = loadLifeCatalog();
  const day = worldDayForDate(date, lifeCatalog);
  const state = {
    schemaVersion: 13,
    worldId: "nigeria-main",
    worldClock: normalizeWorldClock({
      day,
      minute_of_day: 600,
      millisecond_of_minute: 0,
      updated_at: new Date(now).toISOString(),
    }, now, lifeCatalog),
    players: {},
    people: {},
    households: {},
    families: {},
    relationships: {},
    lifeEvents: {},
    marriages: {},
    inheritanceEvents: {},
    ...emptyCareerMaps(),
  };
  return { state, now, date: { ...state.worldClock.world_date } };
}

function addPlayer(state, characterId, options = {}) {
  const date = state.worldClock.world_date;
  const age = options.age ?? 18;
  const playerId = `player-${characterId}`;
  const timestamp = new Date(Date.UTC(2025, 0, 4, 10, 0, 0)).toISOString();
  const character = {
    player_id: playerId,
    character_id: characterId,
    name: options.name ?? characterId,
    age,
    date_of_birth: { year: date.year - age, month: date.month, day: date.day },
    life_stage_id: "adult-working-age",
    life_status: options.life_status ?? "alive",
    age_at_death: null,
    death_cause: "",
    death_date: null,
    retirement_date: null,
    household_id: "",
    family_ids: [],
    life_event_ids: [],
    relationship_ids: [],
    last_life_processed_date: { ...date },
    inheritance_event_ids: [],
    character_type: "androgynous",
    appearance: {},
    money: options.money ?? 5000,
    health: 100,
    energy: 90,
    hunger: 82,
    education_level: "Secondary school · SS 3",
    school_id: "idera_community_secondary_school",
    home_id: "",
    current_location: options.current_location ?? "home",
    position: { x: 720, y: 540 },
    direction: { x: 0, y: 1 },
    inventory: [],
    academic_scores: {},
    attendance: [],
    education_record: {
      qualifications: options.qualifications ?? [],
      skills: options.education_skills ?? [],
    },
    reputation: 0,
    household: {},
    geographic_location: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const player = {
    playerId,
    tokenHash: randomBytes(32).toString("hex"),
    creationKeyHash: randomBytes(32).toString("hex"),
    recentRequestIds: [],
    createdAt: timestamp,
    lastSeen: timestamp,
    character,
  };
  state.players[playerId] = player;
  return player;
}

function addNpc(state, personId, age, lifeStatus = "alive") {
  const date = state.worldClock.world_date;
  state.people[personId] = {
    person_id: personId,
    name: personId,
    date_of_birth: { year: date.year - age, month: date.month, day: date.day },
    age,
    life_stage_id: age < 18 ? "secondary-school-youth" : "adult-working-age",
    life_status: lifeStatus,
    household_id: "",
    family_ids: [],
    updated_at: new Date().toISOString(),
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `ws://127.0.0.1:${address.port}/ws`;
}

async function startServer(stateFile, options = {}) {
  const server = createApiServer({ stateFile, ...options });
  const websocketUrl = await listen(server);
  activeServers.add(server);
  return { server, websocketUrl };
}

async function stopServer(server) {
  await server.shutdown();
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
  activeServers.delete(server);
}

async function openPeer(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return new TestPeer(socket);
}

async function createCharacter(peer, name) {
  const creationKey = randomBytes(32).toString("hex");
  peer.send({
    type: "identity.create",
    creationKey,
    profile: {
      name,
      age: 16,
      character_type: "androgynous",
      appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" },
    },
  });
  const identity = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: identity.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { ...identity, ready };
}

async function makeServerTest(run) {
  const directory = await mkdtemp(join(tmpdir(), "naija-careers-test-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const running = await startServer(stateFile);
  try { await run({ ...running, stateFile }); }
  finally { await stopServer(running.server); }
}

async function waitForPersistedApplication(stateFile, applicationId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let persisted;
  do {
    persisted = JSON.parse(await readFile(stateFile, "utf8"));
    if (persisted.careerApplications?.[applicationId]) return persisted;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error(`Career application ${applicationId} was not persisted within ${timeoutMs} ms.`);
}

afterEach(async () => {
  for (const server of [...activeServers]) await stopServer(server);
  for (const directory of activeDirectories) await rm(directory, { recursive: true, force: true });
  activeDirectories.clear();
});

test("career catalog validates cross-links, schedules, prototype employers and vacancy salary bounds", () => {
  const catalog = loadCareerCatalog();
  assert.equal(catalog.jobs.length, 63);
  assert.equal(catalog.employers.length, 12);
  assert.equal(catalog.vacancies.length, 10);
  assert.equal(validateCareerCatalogForTest(structuredClone(catalog)).jobs.length, 63);

  const broken = structuredClone(catalog);
  broken.jobs.find((job) => job.id === "community-market-sales-assistant").schedule_id = "missing-schedule";
  assert.throws(() => validateCareerCatalogForTest(broken), /invalid age, hours, eligibility, schedule, salary/);

  const invalidVacancy = structuredClone(catalog);
  invalidVacancy.vacancies[0].monthly_salary_ngn = 1;
  assert.throws(() => validateCareerCatalogForTest(invalidVacancy), /invalid job\/employer\/pay data/);
});

test("eligibility reuses Stage 4 qualifications and skills and requires server-recorded licenses for regulated roles", () => {
  const { state, date, now } = makeWorld();
  initializeCareerWorldState(state, now);
  const player = addPlayer(state, "credential-check", { age: 22 });
  const catalog = loadCareerCatalog();
  const nurse = catalog.jobs.find((job) => job.id === "registered-nurse");
  const missing = careerEligibility(state, player.character, nurse, date);
  assert.equal(missing.eligible, false);
  assert.ok(missing.missing.some((item) => item.includes("qualification:prototype-nursing-degree")));
  assert.ok(missing.missing.some((item) => item.includes("professional registration")));

  player.character.education_record.qualifications = [{ id: "qualification:prototype-nursing-degree" }];
  issueCareerLicenseServerSide(state, player.character.character_id, "license:prototype-nursing-registration", "Prototype credentialing fixture", date, now);
  const eligible = careerEligibility(state, player.character, nurse, date);
  assert.equal(eligible.eligible, true);

  const junior = addPlayer(state, "junior-check", { age: 15 });
  const marketRole = catalog.jobs.find((job) => job.id === "community-market-sales-assistant");
  assert.equal(careerEligibility(state, junior.character, marketRole, date).eligible, false);
  junior.character.date_of_birth = { year: date.year - 16, month: date.month, day: date.day };
  assert.equal(careerEligibility(state, junior.character, marketRole, date).eligible, true);
});

test("applications are server-reviewed, globally ordered, and cannot create concurrent employments", () => {
  const { state, date, now } = makeWorld();
  initializeCareerWorldState(state, now);
  const first = addPlayer(state, "applicant-one", { age: 18 });
  const second = addPlayer(state, "applicant-two", { age: 18 });
  const firstApplication = submitCareerApplication(state, first.character.character_id, "vacancy-market-sales-assistant", date, now);
  const secondApplication = submitCareerApplication(state, second.character.character_id, "vacancy-market-sales-assistant", date, now + 1);
  assert.equal(firstApplication.status, "under_review");
  assert.equal(secondApplication.status, "under_review");

  firstApplication.eligibility_score = 45;
  secondApplication.eligibility_score = 98;
  const decisions = processPendingCareerApplications(state, { year: 2025, month: 1, day: 5 }, now + 2);
  assert.deepEqual(decisions.map((decision) => decision.status), ["accepted", "accepted"]);
  const vacancy = state.careerVacancies["vacancy-market-sales-assistant"];
  assert.equal(vacancy.openings_remaining, 0);
  assert.equal(vacancy.status, "filled");
  assert.equal(Object.values(state.employments).filter((employment) => employment.status === "active").length, 2);
  assert.equal(new Set(state.careerEmployers["idera-community-market"].employee_character_ids).size, 2);

  const extra = addPlayer(state, "applicant-three", { age: 18 });
  assert.throws(() => submitCareerApplication(state, extra.character.character_id, "vacancy-market-sales-assistant", date, now + 3), /career_application_ineligible/);
});

test("work shifts earn a stable amount, payroll credits the existing balance once, and resignation reconciles final work", () => {
  const { state, date, now } = makeWorld();
  initializeCareerWorldState(state, now);
  const player = addPlayer(state, "worker-1", { age: 18 });
  const application = submitCareerApplication(state, player.character.character_id, "vacancy-market-sales-assistant", date, now);
  processPendingCareerApplications(state, { year: 2025, month: 1, day: 5 }, now + 1);
  const employmentId = application.employment_id;
  assert.ok(employmentId);
  const employment = state.employments[employmentId];
  state.workSessions["other-role-history"] = {
    employment_id: "employment-other-role",
    character_id: player.character.character_id,
    status: "completed",
    performance_score: 50,
    updated_at: new Date(now).toISOString(),
  };
  const shiftDate = { year: 2025, month: 1, day: 11 };
  player.character.current_location = "market";
  const started = startCareerWorkSession(state, player.character.character_id, shiftDate, 600, "market", now + 2);
  assert.equal(started.status, "in_progress");
  const completed = completeCareerWorkSession(state, player.character.character_id, shiftDate, 900, "market", now + 3);
  assert.equal(completed.status, "completed");
  assert.ok(completed.gross_earned_ngn > 0);
  assert.ok(completed.skill_experience_awarded > 0);
  assert.equal(employment.performance_score, completed.performance_score);
  assert.equal(employment.performance_score, 100, "prior work at a different employer must not alter this role's performance");
  assert.equal(player.character.money, 5000);

  const dueDate = { ...employment.next_payment_date };
  const port = prototypeSalaryAccountPort(state);
  processCareerWorldDate(state, dueDate, now + 4, undefined, port);
  const balanceAfterFirst = player.character.money;
  assert.equal(balanceAfterFirst, 5000 + completed.gross_earned_ngn);
  assert.equal(Object.keys(state.salaryPayments).length, 1);
  assert.equal(completed.payroll_payment_id, Object.keys(state.salaryPayments)[0]);
  processCareerWorldDate(state, dueDate, now + 5, undefined, port);
  assert.equal(player.character.money, balanceAfterFirst);
  assert.equal(Object.keys(state.salaryPayments).length, 1);

  const nextShift = { year: 2025, month: 2, day: 8 };
  startCareerWorkSession(state, player.character.character_id, nextShift, 600, "market", now + 6);
  const secondSession = completeCareerWorkSession(state, player.character.character_id, nextShift, 900, "market", now + 7);
  const beforeResign = player.character.money;
  resignCareerEmployment(state, player.character.character_id, employmentId, nextShift, 900, now + 8, port);
  assert.equal(employment.status, "resigned");
  assert.equal(player.character.money, beforeResign + secondSession.gross_earned_ngn);
  assert.equal(state.careerVacancies["vacancy-market-sales-assistant"].openings_remaining, 2);
  const paymentCountAfterResign = Object.keys(state.salaryPayments).length;
  resignCareerEmployment(state, player.character.character_id, employmentId, nextShift, 900, now + 9, port);
  assert.equal(Object.keys(state.salaryPayments).length, paymentCountAfterResign);
});

test("employer termination is server-authorized, records a reason and releases the vacancy", () => {
  const { state, date, now } = makeWorld();
  initializeCareerWorldState(state, now);
  const player = addPlayer(state, "worker-terminated", { age: 24 });
  const application = submitCareerApplication(state, player.character.character_id, "vacancy-market-sales-assistant", date, now);
  processPendingCareerApplications(state, { year: 2025, month: 1, day: 5 }, now + 1);
  const employment = state.employments[application.employment_id];
  const employerId = employment.employer_id;

  assert.throws(() => terminateCareerEmploymentAsEmployer(
    state, { kind: "employer", employer_id: "idera-community-clinic" }, employment.employment_id, "Review",
    date, 600, now + 2,
  ), /career_employer_unauthorized/);
  assert.throws(() => terminateCareerEmploymentAsEmployer(
    state, { kind: "employer", employer_id: employerId }, employment.employment_id, "  ", date, 600, now + 3,
  ), /career_termination_reason_required/);

  const terminated = terminateCareerEmploymentAsEmployer(
    state, { kind: "employer", employer_id: employerId }, employment.employment_id, "Workplace\nreview",
    date, 600, now + 4,
  );
  assert.equal(terminated.status, "terminated");
  assert.equal(terminated.end_reason, "Workplace review");
  assert.equal(state.careerVacancies["vacancy-market-sales-assistant"].openings_remaining, 2);
  assert.ok(Object.values(state.careerEvents).some((event) => event.type === "employment_terminated"));
});

test("unpaid leave blocks clock-in for its dates, while completed leave returns active employment", () => {
  const { state, date, now } = makeWorld();
  initializeCareerWorldState(state, now);
  const player = addPlayer(state, "worker-leave", { age: 18 });
  const application = submitCareerApplication(state, player.character.character_id, "vacancy-market-sales-assistant", date, now);
  processPendingCareerApplications(state, { year: 2025, month: 1, day: 5 }, now + 1);
  const employment = state.employments[application.employment_id];
  const leaveStart = { year: 2025, month: 1, day: 11 };
  const leave = requestCareerLeave(state, player.character.character_id, employment.employment_id,
    "vacation", leaveStart, 2, { year: 2025, month: 1, day: 8 }, now + 2);
  assert.equal(leave.status, "approved");
  assert.throws(() => startCareerWorkSession(state, player.character.character_id, leaveStart, 600, "market", now + 3), /career_leave_active/);

  processCareerWorldDate(state, leaveStart, now + 4);
  assert.equal(employment.status, "on_leave");
  processCareerWorldDate(state, { year: 2025, month: 1, day: 13 }, now + 5);
  assert.equal(leave.status, "completed");
  assert.equal(employment.status, "active");
});

test("retirement uses the Stage 5 age threshold and closes active employment only after life status is retired", () => {
  const { state, date, now } = makeWorld();
  initializeCareerWorldState(state, now);
  const notYetRetired = addPlayer(state, "retirement-underage", { age: 59 });
  assert.throws(() => recordRetirement(state, notYetRetired.character.character_id), /retirement_age_ineligible/);

  const player = addPlayer(state, "retirement-eligible", { age: 60 });
  const application = submitCareerApplication(state, player.character.character_id, "vacancy-market-sales-assistant", date, now);
  processPendingCareerApplications(state, { year: 2025, month: 1, day: 5 }, now + 1);
  const employment = state.employments[application.employment_id];
  assert.throws(() => requestCareerRetirement(state, player.character.character_id, date, 600, now + 2),
    /retirement_age_ineligible/);

  const event = recordRetirement(state, player.character.character_id);
  assert.equal(event.event_type, "retirement");
  assert.equal(requestCareerRetirement(state, player.character.character_id, date, 600, now + 3), 1);
  assert.equal(employment.status, "retired");
  assert.equal(requestCareerRetirement(state, player.character.character_id, date, 600, now + 4), 0);
});

test("promotion checks experience, current role performance, next-role skills and an open same-employer position", () => {
  const { state, date, now } = makeWorld();
  initializeCareerWorldState(state, now);
  const player = addPlayer(state, "tailor-promote", {
    age: 24,
    qualifications: [{ id: "qualification:trade-tailoring" }],
  });
  const employment = {
    employment_id: "employment-tailor-promote",
    character_id: player.character.character_id,
    application_id: "application-tailor-promote",
    vacancy_id: "vacancy-tailoring-assistant",
    employer_id: "idera-community-skills-centre",
    employer_name_at_start: "Idera Community Skills Centre",
    job_id: "tailoring-assistant",
    employment_type: "full_time",
    status: "active",
    salary_ngn_monthly: 115000,
    pay_frequency: "biweekly",
    work_schedule_id: "office-day",
    start_date: { ...date },
    pay_period_start_date: { ...date },
    next_payment_date: { year: 2025, month: 1, day: 18 },
    completed_sessions: 8,
    performance_score: 80,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  state.employments[employment.employment_id] = employment;
  state.careerVacancies["vacancy-tailoring-assistant"].openings_remaining = 0;
  state.careerVacancies["vacancy-tailoring-assistant"].status = "filled";
  state.careerEmployers["idera-community-skills-centre"].employee_character_ids.push(player.character.character_id);
  const key = createHash("sha256").update(`${player.character.character_id}::career::skill:tailoring`).digest("hex");
  state.careerSkills[key] = {
    skill_record_id: `career-skill-${key}`,
    character_id: player.character.character_id,
    skill_id: "skill:tailoring",
    level: 2,
    experience: 250,
    sources: ["career-work-session"],
    last_updated_at: new Date(now).toISOString(),
    last_updated_world_date: { ...date },
  };
  for (let index = 0; index < 8; index += 1) {
    const sessionId = `promotion-session-${index}`;
    state.workSessions[sessionId] = {
      session_id: sessionId,
      employment_id: employment.employment_id,
      character_id: player.character.character_id,
      job_id: "tailoring-assistant",
      world_date: { year: 2025, month: 1, day: 1 + index },
      schedule_id: "office-day",
      workplace_location_id: "training_center",
      scheduled_start_minute: 540,
      scheduled_end_minute: 1020,
      started_at_minute: 540,
      completed_at_minute: 960,
      status: "completed",
      worked_minutes: 420,
      gross_earned_ngn: 5000,
      performance_score: 80,
      skill_id: "skill:tailoring",
      skill_experience_awarded: 25,
      started_at: new Date(now).toISOString(),
      updated_at: new Date(now + index).toISOString(),
    };
  }

  const profileBefore = buildCareerProfile(state, player.character);
  assert.equal(profileBefore.current_employment.job_title, "Tailoring Assistant");
  assert.equal(careerEligibility(state, player.character, loadCareerCatalog().jobs.find((job) => job.id === "tailor-technician"), date,
    { checkCurrentEmployment: false, checkVacancy: state.careerVacancies["vacancy-tailor-technician"] }).eligible, true);
  const promoted = requestCareerPromotion(state, player.character.character_id, employment.employment_id, date, now + 10);
  assert.equal(promoted.job_id, "tailor-technician");
  assert.equal(promoted.salary_ngn_monthly, 160000);
  assert.equal(promoted.vacancy_id, "vacancy-tailor-technician");
  assert.equal(state.careerVacancies["vacancy-tailor-technician"].openings_remaining, 0);
  assert.equal(state.careerVacancies["vacancy-tailoring-assistant"].status, "open");

  const projected = buildCareerProfile(state, player.character);
  assert.equal(projected.current_employment.job_title, "Tailor Technician");
  assert.equal(projected.current_employment.work_location_id, "training_center");
});

test("deceased employment is closed without future salary, and household NPC occupations are deterministic foundations", () => {
  const { state, date, now } = makeWorld();
  addNpc(state, "person-adult", 34);
  addNpc(state, "person-child", 12);
  addNpc(state, "person-deceased", 54, "deceased");
  initializeCareerWorldState(state, now);
  const adultCareer = state.npcCareers["person-adult"];
  assert.ok(adultCareer);
  assert.equal(adultCareer.prototype_fixture, true);
  assert.equal(adultCareer.profile_source, "deterministic_household_fixture");
  assert.ok(["employed", "unemployed"].includes(adultCareer.status));
  assert.equal(state.npcCareers["person-child"].status, "student");
  assert.equal(state.npcCareers["person-deceased"].status, "deceased");

  const player = addPlayer(state, "worker-death", { age: 23, current_location: "market" });
  const application = submitCareerApplication(state, player.character.character_id, "vacancy-market-sales-assistant", date, now);
  processPendingCareerApplications(state, { year: 2025, month: 1, day: 5 }, now + 1);
  const employment = state.employments[application.employment_id];
  const shiftDate = { year: 2025, month: 1, day: 11 };
  startCareerWorkSession(state, player.character.character_id, shiftDate, 600, "market", now + 2);
  completeCareerWorkSession(state, player.character.character_id, shiftDate, 900, "market", now + 3);
  const activeShiftDate = { year: 2025, month: 1, day: 18 };
  const activeSession = startCareerWorkSession(
    state, player.character.character_id, activeShiftDate, 600, "market", now + 4,
  );
  const balanceAtDeath = player.character.money;
  player.character.life_status = "deceased";
  endCareerAtDeath(state, player.character.character_id, activeShiftDate, 600, now + 5);
  assert.equal(employment.status, "deceased");
  assert.equal(employment.end_date.day, activeShiftDate.day);
  assert.equal(activeSession.status, "invalidated");
  processCareerWorldDate(state, { year: 2025, month: 2, day: 5 }, now + 6);
  assert.equal(player.character.money, balanceAtDeath);
  assert.equal(Object.keys(state.salaryPayments).length, 0);
  assert.equal(employment.current_work_session_id, undefined);
});

test("Stage 5 schema version 2 migrates to Stage 6 version 3 without dropping lifecycle records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-career-migration-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const original = new WorldStore(stateFile, Date.UTC(2025, 0, 1));
  const legacyPlayer = addPlayer(original.state, "legacy-character", { age: 45, name: "Preserved Person" });
  createStarterFamily(original.state, legacyPlayer.playerId, legacyPlayer.character, Date.UTC(2025, 0, 1));
  delete original.state.players[legacyPlayer.playerId];
  const preservedPersonId = Object.keys(original.state.people)[0];
  const preservedPersonName = original.state.people[preservedPersonId].name;
  await original.flush();
  const legacy = JSON.parse(await readFile(stateFile, "utf8"));
  legacy.schemaVersion = 2;
  for (const name of CAREER_MAPS) delete legacy[name];
  await writeFile(stateFile, JSON.stringify(legacy), "utf8");

  const migrated = new WorldStore(stateFile, Date.UTC(2025, 0, 2));
  assert.equal(migrated.state.schemaVersion, 13);
  assert.equal(migrated.state.people[preservedPersonId].name, preservedPersonName);
  assert.ok(Object.keys(migrated.state.careerEmployers).length >= 12);
  assert.ok(Object.keys(migrated.state.careerVacancies).length >= 10);
  assert.ok(migrated.state.npcCareers[preservedPersonId]);
  assert.ok(typeof migrated.state.economyAccounts === "object");
  assert.ok(typeof migrated.state.economyTransactions === "object");
  assert.ok(typeof migrated.state.economyLoans === "object");
  await migrated.flush();
});

test("authenticated career actions use the caller identity, return private profiles and keep public presence private", async () => {
  await makeServerTest(async ({ websocketUrl, stateFile }) => {
    const first = await openPeer(websocketUrl);
    const second = await openPeer(websocketUrl);
    try {
      const firstIdentity = await createCharacter(first, "Ayo");
      const secondIdentity = await createCharacter(second, "Dara");
      assert.equal(firstIdentity.ready.character.career_profile.character_id, firstIdentity.ready.character.character_id);

      const search = first.waitFor((message) => message.type === "career.result" && message.action === "search_jobs");
      first.send({ type: "career.action", action: "search_jobs", payload: { text: "market" }, requestId: "career-search-001" });
      const searchResult = await search;
      const marketVacancy = searchResult.data.jobs.find((entry) => entry.vacancy_id === "vacancy-market-sales-assistant");
      assert.ok(marketVacancy);
      assert.equal(marketVacancy.eligible, true);
      assert.equal(searchResult.data.career_profile.character_id, firstIdentity.ready.character.character_id);
      assert.ok(searchResult.data.career_profile.skills);

      const applied = first.waitFor((message) => message.type === "career.result" && message.action === "apply");
      first.send({
        type: "career.action",
        action: "apply",
        payload: { vacancy_id: marketVacancy.vacancy_id, character_id: secondIdentity.ready.character.character_id },
        requestId: "career-apply-001",
      });
      const applicationResult = await applied;
      const application = applicationResult.data.application;
      assert.equal(application.character_id, firstIdentity.ready.character.character_id);
      assert.equal(application.status, "under_review");

      const duplicate = first.waitForType("command.duplicate");
      first.send({
        type: "career.action", action: "apply", payload: { vacancy_id: marketVacancy.vacancy_id },
        requestId: "career-apply-001",
      });
      await duplicate;

      const unauthorized = second.waitFor((message) => message.type === "career.error" && message.action === "withdraw_application");
      second.send({
        type: "career.action", action: "withdraw_application", payload: { application_id: application.application_id },
        requestId: "career-cross-character-001",
      });
      assert.equal((await unauthorized).code, "career_application_not_found");

      const privateSearch = second.waitFor((message) => message.type === "career.result" && message.action === "search_jobs");
      second.send({
        type: "career.action", action: "search_jobs",
        payload: { character_id: firstIdentity.ready.character.character_id }, requestId: "career-search-002",
      });
      const secondResult = await privateSearch;
      assert.equal(secondResult.data.career_profile.character_id, secondIdentity.ready.character.character_id);

      const publicSnapshot = second.waitForType("world.snapshot");
      const snapshot = await publicSnapshot;
      for (const presence of snapshot.players) {
        assert.equal("career_profile" in presence, false);
        assert.equal("salary_payments" in presence, false);
      }

      const persisted = await waitForPersistedApplication(stateFile, application.application_id);
      assert.equal(Object.keys(persisted.careerApplications).length, 1);
      assert.equal(persisted.careerApplications[application.application_id].character_id, firstIdentity.ready.character.character_id);
      assert.equal(persisted.careerApplications[application.application_id].status, "under_review");
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
