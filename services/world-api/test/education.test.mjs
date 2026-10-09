import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { loadEducationCatalog } from "../dist/education/catalog.js";
import {
  applyEducationAction,
  beginTertiaryCoursePayload,
  closeCurrentTerm,
  createStudentEducationRecord,
  educationCatalogSummary,
  isEducationStudentRecord,
  legacyAttendanceSummary,
  markMissedSchoolPeriods,
  nextFinalExamQuestion,
  normalizeEducationRecord,
  recordFinalExamAnswer,
  recordSchoolAttendance,
  recordTertiaryCourseAnswer,
  resolveSecondaryProgression,
  scheduleForStudent,
  validateStudentSubjectChoices,
} from "../dist/education/service.js";
import { createApiServer } from "../dist/app.js";

const catalog = loadEducationCatalog();
const createdServers = new Set();
const tempDirectories = new Set();
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createStudent(name = "Test student", age = 16, day = 1) {
  const characterId = `character-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const education_record = createStudentEducationRecord(characterId, age, day, catalog);
  return {
    player_id: `player-${characterId}`,
    character_id: characterId,
    name,
    age,
    character_type: "androgynous",
    appearance: {},
    money: 5000,
    health: 100,
    energy: 90,
    hunger: 80,
    education_level: "Secondary school · JSS 1",
    school_id: education_record.school_id,
    home_id: "home-test",
    current_location: "home",
    position: { x: 720, y: 540 },
    direction: { x: 0, y: 1 },
    geographic_location: null,
    inventory: [],
    academic_scores: {},
    attendance: [],
    education_record,
    reputation: 0,
    household: { guardians: [{ id: "guardian-1", name: "Amina", role: "parent" }] },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

function context(character, day = 1, currentLocation = "home", minuteOfDay = 500) {
  return {
    day,
    minuteOfDay,
    age: character.age,
    money: character.money,
    household: character.household,
    currentLocation,
  };
}

function execute(character, action, payload = {}, day = 1, location = "home", options = {}) {
  return applyEducationAction(character, action, payload, context(character, day, location), options, catalog);
}

function setSecondaryExamEligible(character) {
  const record = character.education_record;
  record.current_class_id = "SS3";
  record.enrollment_status = "enrolled";
  record.progression_status = "final_exam_eligible";
  record.subject_ids = ["mathematics", "english_language", "civic_education", "biology", "computer_studies"];
}

function completeFinalExam(character, registrationDay = 10) {
  setSecondaryExamEligible(character);
  const registrationResult = execute(
    character,
    "register_final_exam",
    { subject_ids: [...character.education_record.subject_ids] },
    registrationDay,
  );
  assert.equal(registrationResult.ok, true, registrationResult.message);
  const registration = registrationResult.payload.registration;
  assert.equal(nextFinalExamQuestion(character.education_record, registrationDay, catalog), null);
  let lastResult;
  let day = registrationDay + catalog.final_examination.exam_days_after_registration;
  while (true) {
    const next = nextFinalExamQuestion(character.education_record, day, catalog);
    if (!next) break;
    lastResult = recordFinalExamAnswer(
      character.education_record,
      registration.registration_id,
      next.subject_id,
      next.question.id,
      next.question.correct_choice_index,
      day,
      catalog,
    );
  }
  assert.ok(lastResult);
  assert.equal(lastResult.certificate_eligible, true);
  assert.equal(character.education_record.progression_status, "secondary_complete");
  assert.ok(character.education_record.qualifications.some((entry) => entry.id === "qualification:secondary-school-certificate"));
  return registration;
}

function applyAndAcceptProgram(character, programId, day = 20, options = {}) {
  const application = execute(character, "apply_program", { program_id: programId }, day, "home", options);
  assert.equal(application.ok, true, application.message);
  assert.equal(application.payload.application.status, "offered");
  const accepted = execute(character, "respond_application", {
    application_id: application.payload.application.application_id,
    accept: true,
  }, day, "home", options);
  assert.equal(accepted.ok, true, accepted.message);
  assert.equal(character.education_record.tertiary_enrollment.program_id, programId);
  return character.education_record.tertiary_enrollment;
}

function completeTertiarySemester(character, day) {
  const record = character.education_record;
  let pending = beginTertiaryCoursePayload(record, catalog);
  while (pending) {
    const question = catalog.questions.find((entry) => entry.id === pending.question_id);
    assert.ok(question, `course question ${pending.question_id} exists`);
    recordTertiaryCourseAnswer(
      character,
      pending,
      question.correct_choice_index,
      day,
      catalog,
    );
    pending = beginTertiaryCoursePayload(record, catalog);
  }
  const result = execute(character, "close_tertiary_semester", {}, day + catalog.tertiary_calendar.term_length_game_days, "campus");
  assert.equal(result.ok, true, result.message);
  return result;
}

class Peer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index < 0) this.messages.push(message);
      else {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    });
  }

  send(message) { this.socket.send(JSON.stringify(message)); }

  waitFor(predicate, timeoutMs = 4000) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
          reject(new Error("Timed out waiting for a multiplayer education event."));
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

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { websocketUrl: `ws://127.0.0.1:${address.port}/ws` };
}

async function startServer(stateFile, options = {}) {
  const server = createApiServer({ stateFile, ...options });
  const urls = await listen(server);
  createdServers.add(server);
  return { server, ...urls };
}

async function stopServer(server) {
  await server.shutdown();
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
  createdServers.delete(server);
}

async function connectPeer(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return new Peer(socket);
}

async function moveToWorldPoint(peer, playerId, initialPosition, targetPosition) {
  let position = { ...initialPosition };
  const deadline = Date.now() + 10_000;
  while (Math.hypot(targetPosition.x - position.x, targetPosition.y - position.y) > 60) {
    assert.ok(Date.now() < deadline, "player should reach the school entrance before the movement timeout");
    const dx = targetPosition.x - position.x;
    const dy = targetPosition.y - position.y;
    const magnitude = Math.hypot(dx, dy);
    peer.movementSequence = (peer.movementSequence ?? 0) + 1;
    peer.send({
      type: "movement.input",
      sequence: peer.movementSequence,
      direction: { x: dx / magnitude, y: dy / magnitude },
      running: true,
    });
    await delay(60);
    const snapshotIndex = peer.messages.findLastIndex((message) => message.type === "world.snapshot");
    if (snapshotIndex >= 0) {
      const snapshot = peer.messages[snapshotIndex];
      const self = snapshot.players.find((entry) => entry.playerId === playerId);
      if (self) position = { x: self.position.x, y: self.position.y };
      peer.messages.splice(0, snapshotIndex + 1);
    }
  }
  peer.movementSequence = (peer.movementSequence ?? 0) + 1;
  peer.send({ type: "movement.input", sequence: peer.movementSequence, direction: { x: 0, y: 0 }, running: false });
  await delay(70);
  return position;
}

async function travelTo(peer, exitId, destination) {
  const result = peer.waitFor((message) =>
    (message.type === "character.snapshot" && message.character.current_location === destination) ||
    message.type === "error");
  peer.send({ type: "world.travel", exitId, requestId: `travel-${exitId}-${Date.now()}` });
  const message = await result;
  assert.equal(message.type, "character.snapshot", message.description ?? message.code);
  return message.character;
}

async function createOnlineCharacter(peer, name) {
  const creationKey = Buffer.from(`${name}-${Date.now()}-${Math.random()}`).toString("hex").padEnd(64, "0").slice(0, 64);
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
  const created = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: created.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { ...created, ready };
}

async function withTestServer(run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "naija-education-test-"));
  tempDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const running = await startServer(stateFile, options);
  try {
    await run({ ...running, stateFile });
  } finally {
    await stopServer(running.server);
  }
}

afterEach(async () => {
  for (const server of [...createdServers]) await stopServer(server);
  for (const directory of tempDirectories) await rm(directory, { recursive: true, force: true });
  tempDirectories.clear();
});

test("education catalog is data-driven, fictional, geographically anchored and covers every secondary year", () => {
  const summary = educationCatalogSummary(catalog);
  assert.equal(catalog.world_id, "nigeria-main");
  assert.equal(summary.classes.length, 6);
  assert.deepEqual(summary.classes.map((entry) => entry.id), ["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"]);
  assert.ok(catalog.institutions.every((institution) => institution.fictional));
  assert.ok(catalog.institutions.every((institution) => institution.geographic_location.world_id === "nigeria-main"));
  assert.ok(catalog.subjects.some((subject) => subject.id === "english_language"));
  assert.ok(catalog.timetable.length > 0);
  assert.ok(catalog.programs.some((program) => program.kind === "university"));
  assert.ok(catalog.programs.some((program) => program.kind === "polytechnic"));
  assert.ok(catalog.training_programs.length >= 6);
  assert.ok(catalog.questions.every((question) => question.original_game_content));
  assert.match(catalog.final_examination.notice, /not affiliated/i);
});

test("student enrollment, elective subjects, timetable attendance, missed periods, grades and class progression persist", () => {
  const student = createStudent("Aisha", 15);
  const record = student.education_record;
  assert.equal(isEducationStudentRecord(record), true);
  assert.equal(record.current_class_id, "JSS1");
  assert.equal(record.enrollment_status, "enrolled");
  assert.equal(record.subject_ids.includes("mathematics"), true);
  const originalSubjectCount = record.subject_ids.length;

  const invalid = validateStudentSubjectChoices(record, ["mathematics"], catalog);
  assert.equal(invalid.ok, false, "compulsory subjects and configured elective groups must be retained");
  const elective = execute(student, "choose_elective", { subject_id: "chemistry" }, 1);
  assert.equal(elective.ok, true, elective.message);
  assert.ok(record.subject_ids.includes("chemistry"));
  assert.ok(record.subject_ids.length >= originalSubjectCount);
  record.term = catalog.calendar.terms_per_academic_year;
  record.term_start_day = 1;

  for (const subjectId of record.subject_ids) {
    record.assessment_records.push({
      assessment_id: `assessment-${subjectId}`,
      academic_year: record.academic_year,
      term: record.term,
      day: 1,
      subject_id: subjectId,
      assessment_type: "examination",
      score: 95,
      maximum_score: 100,
      question_id: "starter-diagnostic",
      source: "teacher_entry",
    });
  }
  for (let day = 1; day <= 5; day += 1) {
    for (const entry of scheduleForStudent(record, day, catalog)) {
      if (entry.kind !== "break") recordSchoolAttendance(record, entry, day, entry.start_minute + 2, undefined, catalog);
    }
  }
  const existingAttendanceCount = record.attendance_records.length;
  const firstLesson = scheduleForStudent(record, 1, catalog).find((entry) => entry.kind === "lesson");
  assert.ok(firstLesson);
  recordSchoolAttendance(record, firstLesson, 1, firstLesson.start_minute + 2, undefined, catalog);
  assert.equal(record.attendance_records.length, existingAttendanceCount, "attendance writes are idempotent per scheduled period and day");
  assert.equal(markMissedSchoolPeriods(record, 1, 1439, catalog), 0);
  const attendanceSummary = legacyAttendanceSummary(record);
  assert.equal(attendanceSummary.percent, 100);

  record.term = catalog.calendar.terms_per_academic_year;
  record.term_start_day = 1;
  const result = closeCurrentTerm(record, 6, catalog);
  assert.equal(result.academic_year, 1);
  assert.equal(result.term, catalog.calendar.terms_per_academic_year);
  assert.equal(result.attendance_percent, 100);
  assert.ok(result.overall_average >= 80);
  assert.equal(result.promotion_eligible, true);
  assert.equal(record.progression_status, "eligible_to_promote");
  assert.ok(record.education_events.some((event) => event.type === "term_result_published"));
  const progressionMessage = resolveSecondaryProgression(record, "promote", 6, catalog);
  assert.match(progressionMessage, /JSS 2/i);
  assert.equal(record.current_class_id, "JSS2");
  assert.equal(record.academic_year, 2);
  assert.equal(record.term, 1);
  assert.equal(record.progression_status, "active");

  for (const classId of ["JSS2", "JSS3", "SS1", "SS2", "SS3"]) {
    record.current_class_id = classId;
    record.term = catalog.calendar.terms_per_academic_year;
    record.progression_status = "eligible_to_promote";
    resolveSecondaryProgression(record, "promote", 12, catalog);
  }
  assert.equal(record.current_class_id, "SS3");
  assert.equal(record.progression_status, "final_exam_eligible");
  assert.equal(record.education_events.filter((event) => event.type === "class_promoted").length, 5);
});

test("final secondary exam eligibility, original questions, credit outcomes and qualification history are saved", () => {
  const student = createStudent("Bola");
  setSecondaryExamEligible(student);
  const notReady = execute(student, "begin_final_exam", {}, 10);
  assert.equal(notReady.ok, false, "papers do not open before the configured exam window");
  const registrationResult = execute(student, "register_final_exam", { subject_ids: student.education_record.subject_ids }, 10);
  assert.equal(registrationResult.ok, true, registrationResult.message);
  const registration = registrationResult.payload.registration;
  assert.equal(student.money, 5000 - catalog.final_examination.registration_fee_ngn);
  assert.equal(nextFinalExamQuestion(student.education_record, 10, catalog), null);

  let finalResult = null;
  const openDay = 10 + catalog.final_examination.exam_days_after_registration;
  while (true) {
    const next = nextFinalExamQuestion(student.education_record, openDay, catalog);
    if (!next) break;
    finalResult = recordFinalExamAnswer(
      student.education_record,
      registration.registration_id,
      next.subject_id,
      next.question.id,
      next.question.correct_choice_index,
      openDay,
      catalog,
    );
  }
  assert.equal(finalResult.certificate_eligible, true);
  const completedRegistration = student.education_record.final_exam_registrations.find((entry) => entry.registration_id === registration.registration_id);
  assert.equal(completedRegistration.status, "results_published");
  assert.equal(completedRegistration.certificate_eligible, true);
  assert.equal(student.education_record.progression_status, "secondary_complete");
  assert.equal(student.education_record.enrollment_status, "completed");
  assert.ok(student.education_record.final_exam_attempts.every((attempt) => attempt.credit));
  assert.equal(student.education_record.qualifications.at(-1).id, "qualification:secondary-school-certificate");

  const saved = JSON.parse(JSON.stringify(student.education_record));
  const loaded = normalizeEducationRecord(saved, student.character_id, student.age, student.school_id, {}, [], openDay, catalog);
  assert.deepEqual(loaded, student.education_record, "structured exams, results, awards and history survive JSON save/load normalization");

  const unsuccessful = createStudent("Kemi");
  setSecondaryExamEligible(unsuccessful);
  const failedRegistrationResult = execute(unsuccessful, "register_final_exam", { subject_ids: unsuccessful.education_record.subject_ids }, 10);
  assert.equal(failedRegistrationResult.ok, true);
  const failedRegistration = failedRegistrationResult.payload.registration;
  let finalFailure = null;
  while (true) {
    const next = nextFinalExamQuestion(unsuccessful.education_record, openDay, catalog);
    if (!next) break;
    const wrongAnswer = next.question.correct_choice_index === 0 ? 1 : 0;
    finalFailure = recordFinalExamAnswer(unsuccessful.education_record, failedRegistration.registration_id, next.subject_id, next.question.id, wrongAnswer, openDay, catalog);
  }
  assert.equal(finalFailure.certificate_eligible, null, "interim paper outcomes do not publish a certificate");
  const failedOutcome = unsuccessful.education_record.final_exam_registrations.find((entry) => entry.registration_id === failedRegistration.registration_id);
  assert.equal(failedOutcome.status, "results_published");
  assert.equal(failedOutcome.certificate_eligible, false);
  assert.equal(unsuccessful.education_record.progression_status, "final_exam_eligible", "a failed fictional attempt does not erase the student's secondary record");
});

test("university BSc enrollment, course assessments, semester fees and graduation create career-eligibility history", () => {
  const student = createStudent("Chika");
  student.money = 100_000;
  completeFinalExam(student, 5);
  const enrollment = applyAndAcceptProgram(student, "imu-computer-science-bsc", 15);
  assert.equal(enrollment.program_kind, "university");
  assert.equal(enrollment.award, "BSc");
  assert.equal(enrollment.semester, 1);
  assert.equal(student.education_record.progression_status, "tertiary_active");

  for (let semester = 1; semester <= enrollment.duration_semesters; semester += 1) {
    const result = completeTertiarySemester(student, enrollment.semester_start_day);
    if (semester < enrollment.duration_semesters) assert.equal(result.code, "education_semester_advanced");
    else assert.equal(result.code, "education_program_completed");
  }
  assert.equal(enrollment.status, "completed");
  assert.equal(student.education_record.progression_status, "tertiary_complete");
  assert.ok(student.education_record.qualifications.some((entry) => entry.id === "qualification:imu-computer-science-bsc"));
  assert.ok(student.education_record.qualifications.some((qualification) => qualification.career_links.includes("future:software-development")));
  assert.ok(student.education_record.education_events.some((event) => event.type === "tertiary_qualification_awarded"));
});

test("polytechnic ND and HND are separate prerequisite-based programs", () => {
  const student = createStudent("Dayo");
  student.money = 100_000;
  completeFinalExam(student, 5);
  const prematureHnd = execute(student, "apply_program", { program_id: "itp-computer-engineering-hnd" }, 14);
  assert.equal(prematureHnd.ok, true);
  assert.equal(prematureHnd.payload.application.status, "rejected");
  assert.match(prematureHnd.payload.application.decision_reason, /prerequisite/i);

  const ndEnrollment = applyAndAcceptProgram(student, "itp-computer-engineering-nd", 15);
  assert.equal(ndEnrollment.program_kind, "polytechnic");
  assert.equal(ndEnrollment.award, "ND");
  for (let semester = 1; semester <= ndEnrollment.duration_semesters; semester += 1) {
    const result = completeTertiarySemester(student, ndEnrollment.semester_start_day);
    if (semester < ndEnrollment.duration_semesters) assert.equal(result.code, "education_semester_advanced");
    else assert.equal(result.code, "education_program_completed");
  }
  assert.ok(student.education_record.qualifications.some((entry) => entry.id === "qualification:itp-computer-engineering-nd"));

  const hndEnrollment = applyAndAcceptProgram(student, "itp-computer-engineering-hnd", 80);
  assert.equal(hndEnrollment.award, "HND");
  assert.equal(hndEnrollment.program_id, "itp-computer-engineering-hnd");
  assert.equal(student.education_record.education_events.filter((event) => event.type === "tertiary_enrollment_started").length, 2);
});

test("vocational courses and apprenticeships build skill levels, certificates and education history", () => {
  const student = createStudent("Efe");
  const enrollment = execute(student, "enroll_training", { training_program_id: "trade-tailoring" }, 1);
  assert.equal(enrollment.ok, true, enrollment.message);
  assert.equal(student.education_record.progression_status, "vocational_active");
  for (let index = 0; index < 6; index += 1) {
    const session = execute(student, "practice_training", {}, index + 1, "training_center");
    assert.equal(session.ok, true, session.message);
  }
  assert.equal(student.education_record.vocational_enrollments[0].status, "completed");
  assert.ok(student.education_record.qualifications.some((entry) => entry.id === "qualification:trade-tailoring"));
  assert.ok(student.education_record.skills.some((skill) => skill.skill_id === "skill:tailoring" && skill.level >= 1));
  assert.ok(student.education_record.education_events.some((event) => event.type === "training_completed"));

  const apprenticeship = execute(student, "enroll_apprenticeship", { training_program_id: "trade-welding" }, 10);
  assert.equal(apprenticeship.ok, true, apprenticeship.message);
  assert.equal(student.education_record.apprenticeships[0].master_teacher_id, "master-ade");
  for (let index = 0; index < 8; index += 1) {
    const session = execute(student, "practice_training", {}, 10 + index, "training_center");
    assert.equal(session.ok, true, session.message);
  }
  assert.equal(student.education_record.apprenticeships[0].status, "completed");
  assert.equal(student.education_record.apprenticeships[0].skill_level, 1);
  assert.ok(student.education_record.qualifications.some((entry) => entry.id === "qualification:trade-welding"));
});

test("scholarship and family support fund configured school and tertiary fees with term limits", () => {
  const student = createStudent("Feyi");
  for (const subjectId of student.education_record.subject_ids) {
    student.education_record.assessment_records.push({
      assessment_id: `scholarship-${subjectId}`,
      academic_year: student.education_record.academic_year,
      term: student.education_record.term,
      day: 1,
      subject_id: subjectId,
      assessment_type: "examination",
      score: 95,
      maximum_score: 100,
      question_id: "starter-diagnostic",
      source: "teacher_entry",
    });
  }
  student.education_record.attendance_records.push({
    attendance_id: "scholarship-attendance",
    academic_year: student.education_record.academic_year,
    term: student.education_record.term,
    day: 1,
    schedule_id: "scholarship-attendance",
    class_id: student.education_record.current_class_id,
    subject_id: null,
    status: "present",
    minutes_late: 0,
    recorded_at_minute: 500,
  });
  const merit = execute(student, "apply_scholarship", { scholarship_id: "merit-learning-award" }, 1);
  assert.equal(merit.ok, true, merit.message);
  const bursary = execute(student, "apply_scholarship", { scholarship_id: "community-access-bursary" }, 1);
  assert.equal(bursary.ok, true, bursary.message);
  assert.equal(student.money, 5000, "awards are separate from cash and are spent only on education costs");
  const balanceBefore = student.education_record.scholarships[0].funding_balance_ngn;
  const fee = execute(student, "pay_school_fees", {}, 1);
  assert.equal(fee.ok, true, fee.message);
  assert.equal(student.money, 5000);
  assert.equal(student.education_record.scholarships[0].funding_balance_ngn, balanceBefore - 3450);
  assert.equal(execute(student, "pay_school_fees", {}, 1).ok, false, "duplicate term fees are rejected");

  student.education_record.term = 3;
  student.education_record.term_start_day = 1;
  student.education_record.scholarships[0].remaining_terms = 1;
  student.education_record.scholarships[1].remaining_terms = 1;
  closeCurrentTerm(student.education_record, 6, catalog);
  assert.ok(student.education_record.scholarships.every((award) => award.status === "expired"));
  assert.ok(student.education_record.education_events.some((event) => event.type === "scholarship_period_expired"));

  const familyStudent = createStudent("Gani");
  const support = execute(familyStudent, "family_support", {}, 1, "home");
  assert.equal(support.ok, true, support.message);
  assert.equal(familyStudent.money, 6200);
  assert.equal(execute(familyStudent, "family_support", {}, 1, "home").ok, false);
});

test("shared multiplayer education co-presence, action replication and persisted save/load remain intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-education-world-"));
  tempDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  let running = await startServer(stateFile, { gameMinuteMs: 60_000, broadcastIntervalMs: 25, tickIntervalMs: 10 });
  const first = await connectPeer(running.websocketUrl);
  const second = await connectPeer(running.websocketUrl);
  let firstIdentity;
  let secondIdentity;
  try {
    firstIdentity = await createOnlineCharacter(first, "Hauwa");
    secondIdentity = await createOnlineCharacter(second, "Ifeoma");
    assert.equal(firstIdentity.ready.world.id, "nigeria-main");
    assert.equal(firstIdentity.ready.character.education_record.current_class_id, "SS1");
    assert.equal(secondIdentity.ready.character.education_record.student_id, `student-${secondIdentity.ready.character.character_id}`);

    let firstPosition = firstIdentity.ready.character.position;
    await moveToWorldPoint(first, firstIdentity.playerId, firstPosition, { x: 220, y: 600 });
    const firstTown = await travelTo(first, "home-front-door", "town");
    firstPosition = firstTown.position;
    await moveToWorldPoint(first, firstIdentity.playerId, firstPosition, { x: 920, y: 455 });
    const firstSchool = await travelTo(first, "school-gate", "schoolyard");
    assert.equal(firstSchool.current_location, "schoolyard");
    firstPosition = firstSchool.position;

    const secondMovedToSchool = first.waitFor((message) =>
      message.type === "presence.moved" && message.player.playerId === secondIdentity.playerId && message.player.worldLocation === "schoolyard");
    const bothStudentsPresent = second.waitFor((message) =>
      message.type === "world.snapshot" && message.players.some((presence) => presence.playerId === firstIdentity.playerId && presence.worldLocation === "schoolyard") &&
      message.players.some((presence) => presence.playerId === secondIdentity.playerId && presence.worldLocation === "schoolyard"));
    let secondPosition = secondIdentity.ready.character.position;
    await moveToWorldPoint(second, secondIdentity.playerId, secondPosition, { x: 220, y: 600 });
    const secondTown = await travelTo(second, "home-front-door", "town");
    secondPosition = secondTown.position;
    await moveToWorldPoint(second, secondIdentity.playerId, secondPosition, { x: 920, y: 455 });
    const secondSchool = await travelTo(second, "school-gate", "schoolyard");
    assert.equal(secondSchool.current_location, "schoolyard");
    assert.equal((await secondMovedToSchool).player.worldLocation, "schoolyard");
    const schoolyardPresence = await bothStudentsPresent;
    assert.equal(schoolyardPresence.players.filter((presence) => presence.worldLocation === "schoolyard").length >= 2, true,
      "both multiplayer students are visibly co-present in the same schoolyard of nigeria-main");

    await moveToWorldPoint(first, firstIdentity.playerId, firstPosition, { x: 1120, y: 500 });
    const firstClassroom = await travelTo(first, "classroom-door", "classroom");
    assert.equal(firstClassroom.current_location, "classroom");
    await moveToWorldPoint(first, firstIdentity.playerId, firstClassroom.position, { x: 820, y: 560 });
    const classQuizPromise = first.waitForType("school.quiz");
    first.send({ type: "school.begin", requestId: "education-school-attendance-start-1" });
    const classQuiz = await classQuizPromise;
    assert.equal(classQuiz.mode, "school");
    const classResultPromise = first.waitForType("school.result");
    const classSnapshotPromise = first.waitFor((message) =>
      message.type === "character.snapshot" && message.character.education_record.attendance_records.some((entry) =>
        entry.schedule_id === classQuiz.schedule_id && entry.class_id === "SS1"));
    first.send({
      type: "school.answer",
      requestId: "education-school-attendance-answer-1",
      quizId: classQuiz.quizId,
      answerIndex: 0,
    });
    const [classResult, classSnapshot] = await Promise.all([classResultPromise, classSnapshotPromise]);
    assert.equal(classResult.mode, "school");
    assert.ok(classSnapshot.character.education_record.attendance_records.some((entry) =>
      entry.schedule_id === classQuiz.schedule_id && entry.class_id === "SS1" && ["present", "late"].includes(entry.status)));

    const educationResult = first.waitFor((message) => message.type === "education.result" && message.code === "education_subjects_updated");
    first.send({
      type: "education.action",
      requestId: "education-elective-roundtrip-1",
      action: "choose_elective",
      payload: { subject_id: "chemistry" },
    });
    const [result, snapshot] = await Promise.all([
      educationResult,
      first.waitFor((message) => message.type === "character.snapshot" && message.character.education_record.subject_ids.includes("chemistry")),
    ]);
    assert.equal(result.ok, true);
    assert.ok(snapshot.character.education_record.education_events.some((event) => event.type === "elective_subject_selected"));
    assert.ok(snapshot.character.education_record.subject_ids.includes("chemistry"));
    await Promise.all([first.close(), second.close()]);
    await stopServer(running.server);

    running = await startServer(stateFile, { gameMinuteMs: 60_000, broadcastIntervalMs: 25, tickIntervalMs: 10 });
    const resumed = await connectPeer(running.websocketUrl);
    try {
      resumed.send({ type: "session.resume", sessionToken: firstIdentity.sessionToken });
      const ready = await resumed.waitForType("session.ready");
      assert.equal(ready.character.education_record.subject_ids.includes("chemistry"), true);
      assert.ok(ready.character.education_record.education_events.some((event) => event.type === "elective_subject_selected"));
      assert.equal(ready.world.id, "nigeria-main");
    } finally {
      await resumed.close();
    }
  } finally {
    if (first.socket.readyState !== WebSocket.CLOSED) await first.close();
    if (second.socket.readyState !== WebSocket.CLOSED) await second.close();
    await stopServer(running.server);
  }
});
