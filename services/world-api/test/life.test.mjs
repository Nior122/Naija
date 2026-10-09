import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { loadEducationCatalog } from "../dist/education/catalog.js";
import { createStudentEducationRecord, syncLegacyEducation } from "../dist/education/service.js";
import { createApiServer } from "../dist/app.js";
import {
  addDays,
  ageForNewCharacter,
  ageOnDate,
  birthdayDateForYear,
  dateForWorldDay,
  isAdultAge,
  lifeStageForAge,
  loadLifeCatalog,
  normalizeWorldClock,
  weekdayForDate,
  weekForWorldDay,
  worldClockSnapshot,
  worldDayForDate,
} from "../dist/life/calendar.js";
import {
  advanceWorldLife,
  buildLifeProfile,
  canTakeActiveAction,
  createChildForMarriage,
  createStarterFamily,
  initializeCharacterLife,
  proposeRelationship,
  recordDeath,
  recordRetirement,
} from "../dist/life/service.js";

const activeServers = new Set();
const activeDirectories = new Set();
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
          reject(new Error("Timed out waiting for a WebSocket event."));
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

async function openPeer(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return new TestPeer(socket);
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

async function createOnlineCharacter(peer, name, age = 16) {
  const creationKey = randomBytes(32).toString("hex");
  peer.send({
    type: "identity.create",
    creationKey,
    profile: {
      name,
      age,
      character_type: "androgynous",
      appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" },
    },
  });
  const identity = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: identity.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { ...identity, ready, creationKey };
}

async function testWorld(run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "naija-life-test-"));
  activeDirectories.add(directory);
  const { beforeStart, ...serverOptions } = options;
  const stateFile = join(directory, "world-state.json");
  if (beforeStart) await beforeStart(stateFile);
  const running = await startServer(stateFile, serverOptions);
  try { await run({ ...running, stateFile }); }
  finally { await stopServer(running.server); }
}

afterEach(async () => {
  for (const server of [...activeServers]) await stopServer(server);
  for (const directory of activeDirectories) await rm(directory, { recursive: true, force: true });
  activeDirectories.clear();
});

function makeLifeWorld(date = { year: 2025, month: 1, day: 1 }) {
  const day = worldDayForDate(date);
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    worldId: "nigeria-main",
    worldClock: normalizeWorldClock({ day, minute_of_day: 470, millisecond_of_minute: 0, updated_at: now }, Date.now()),
    players: {},
    people: {},
    households: {},
    families: {},
    relationships: {},
    lifeEvents: {},
    marriages: {},
    inheritanceEvents: {},
  };
}

function addPlayer(state, name, characterId = `character-${randomBytes(8).toString("hex")}`) {
  const playerId = `player-${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();
  const character = {
    player_id: playerId,
    character_id: characterId,
    name,
    age: 16,
    character_type: "androgynous",
    appearance: {},
    money: 5000,
    health: 100,
    energy: 90,
    hunger: 82,
    education_level: "Secondary school · JSS 3",
    school_id: "idera_community_secondary_school",
    home_id: "",
    current_location: "home",
    position: { x: 720, y: 540 },
    direction: { x: 0, y: 1 },
    inventory: [],
    academic_scores: {},
    attendance: [],
    education_record: {},
    reputation: 0,
    household: {},
    geographic_location: null,
    created_at: now,
    updated_at: now,
    date_of_birth: { ...state.worldClock.world_date },
    life_stage_id: "secondary-school-youth",
    life_status: "alive",
    household_id: "",
    family_ids: [],
    life_event_ids: [],
    relationship_ids: [],
    last_life_processed_date: { ...state.worldClock.world_date },
    inheritance_event_ids: [],
  };
  initializeCharacterLife(character, state.worldClock.world_date, 16);
  const player = {
    playerId,
    tokenHash: randomBytes(32).toString("hex"),
    creationKeyHash: randomBytes(32).toString("hex"),
    recentRequestIds: [],
    createdAt: now,
    lastSeen: now,
    character,
  };
  state.players[playerId] = player;
  createStarterFamily(state, playerId, character, Date.now());
  return player;
}

function setAge(person, age, date) {
  const dob = { year: date.year - age, month: date.month, day: date.day };
  person.date_of_birth = dob;
  person.age = ageOnDate(dob, date);
  person.life_stage_id = lifeStageForAge(person.age).id;
  person.last_life_processed_date = { ...date };
  person.life_status = "alive";
}

function confirmRelationshipStage(state, firstId, secondId, stage) {
  const proposal = proposeRelationship(state, firstId, secondId, stage);
  assert.equal(proposal.status, "pending");
  const confirmed = proposeRelationship(state, secondId, firstId, stage);
  assert.equal(confirmed.status, "confirmed");
  return confirmed;
}

function progressToMarriage(state, firstId, secondId) {
  let result;
  for (const stage of loadLifeCatalog().relationship_rules.romantic_progression) {
    result = confirmRelationshipStage(state, firstId, secondId, stage);
  }
  return result;
}

test("Gregorian calendar covers seconds, minutes, dates, continuous weeks, month/year boundaries and configurable start ages", () => {
  const catalog = loadLifeCatalog();
  assert.equal(catalog.calendar.real_milliseconds_per_game_minute, 650);
  assert.deepEqual(dateForWorldDay(1), { year: 2025, month: 1, day: 1 });
  assert.deepEqual(dateForWorldDay(365), { year: 2025, month: 12, day: 31 });
  assert.deepEqual(dateForWorldDay(366), { year: 2026, month: 1, day: 1 });
  assert.equal(worldDayForDate({ year: 2025, month: 12, day: 31 }), 365);
  assert.equal(weekdayForDate({ year: 2025, month: 1, day: 1 }), "Wednesday");
  assert.equal(weekForWorldDay(1), 1);
  assert.equal(weekForWorldDay(6), 2, "configured Monday starts the second calendar week");
  assert.equal(weekForWorldDay(8), 2);
  assert.deepEqual(addDays({ year: 1, month: 1, day: 1 }, 365), { year: 2, month: 1, day: 1 });
  assert.deepEqual(addDays({ year: 2024, month: 2, day: 28 }, 1), { year: 2024, month: 2, day: 29 });
  assert.deepEqual(birthdayDateForYear({ year: 2008, month: 2, day: 29 }, 2025), { year: 2025, month: 2, day: 28 });
  assert.equal(ageOnDate({ year: 2009, month: 3, day: 1 }, { year: 2025, month: 2, day: 28 }), 15);
  assert.equal(ageOnDate({ year: 2009, month: 3, day: 1 }, { year: 2025, month: 3, day: 1 }), 16);
  for (const age of [15, 16]) {
    const dob = ageForNewCharacter({ year: 2025, month: 6, day: 15 }, age, `seed-${age}`);
    assert.equal(ageOnDate(dob, { year: 2025, month: 6, day: 15 }), age);
  }
  assert.equal(lifeStageForAge(17).id, "secondary-school-youth");
  assert.equal(lifeStageForAge(18).id, "young-adult");
  assert.equal(lifeStageForAge(45).id, "middle-age");
  assert.equal(lifeStageForAge(75).id, "elderly");
  assert.equal(isAdultAge(17), false);
  assert.equal(isAdultAge(18), true);
  const normalized = normalizeWorldClock({
    day: 1, minute_of_day: 479, millisecond_of_minute: 59_000, updated_at: new Date().toISOString(),
  }, Date.now());
  const snapshot = worldClockSnapshot(normalized);
  assert.equal(snapshot.hour, 7);
  assert.equal(snapshot.minute, 59);
  assert.equal(snapshot.second, 59);
  assert.equal(snapshot.time_label, "07:59:59");
  assert.equal(snapshot.week, 1);
});

test("life calendar catches up offline birthdays once and advances NPC ages and configured life stages", () => {
  const state = makeLifeWorld();
  const player = addPlayer(state, "Ayo");
  player.character.date_of_birth = { year: 2009, month: 1, day: 1 };
  player.character.age = 16;
  player.character.life_stage_id = "secondary-school-youth";
  player.character.last_life_processed_date = { year: 2025, month: 1, day: 1 };
  const guardianIds = Object.values(state.people).filter((person) => person.family_role === "parent" || person.family_role === "guardian").map((person) => person.person_id);
  const offlineDate = { year: 2028, month: 1, day: 1 };
  state.worldClock.day = worldDayForDate(offlineDate);
  state.worldClock.world_date = offlineDate;
  advanceWorldLife(state);
  const birthdayEvents = player.character.life_event_ids
    .map((id) => state.lifeEvents[id])
    .filter((event) => event?.event_type === "birthday");
  assert.deepEqual(birthdayEvents.map((event) => event.world_date), [
    { year: 2026, month: 1, day: 1 },
    { year: 2027, month: 1, day: 1 },
    { year: 2028, month: 1, day: 1 },
  ]);
  assert.equal(player.character.age, 19);
  assert.equal(player.character.life_stage_id, "young-adult");
  const historyCount = Object.keys(state.lifeEvents).length;
  advanceWorldLife(state);
  assert.equal(Object.keys(state.lifeEvents).length, historyCount, "processing the same world date is idempotent");
  assert.equal(player.character.life_event_ids.filter((id) => id.startsWith(`birthday:${player.character.character_id}:`)).length, 3);
  for (const guardianId of guardianIds) {
    const guardian = state.people[guardianId];
    assert.ok(guardian.age > 39 && guardian.last_life_processed_date.year === 2028);
  }
});

test("starter families persist configurable caregivers, siblings and generic family-tree links", () => {
  const state = makeLifeWorld();
  const players = Array.from({ length: 14 }, (_, index) =>
    addPlayer(state, `Family ${index}`, `character-family-profile-${index}`));
  const [first, second] = players;
  assert.ok(first && second);
  assert.notEqual(first.character.household_id, second.character.household_id);
  assert.notDeepEqual(first.character.family_ids, second.character.family_ids);
  const configuredProfiles = loadLifeCatalog().family_generation.starter_household_profiles;
  assert.ok(new Set(configuredProfiles.map((profile) => profile.caregiver_roles.length)).size > 1);
  assert.ok(new Set(configuredProfiles.map((profile) => profile.sibling_count)).size > 1);
  const observedCaregiverCounts = new Set();
  const observedSiblingCounts = new Set();
  for (const player of players) {
    const profile = buildLifeProfile(state, player.character);
    const relatives = profile.family_members.filter((person) => person.person_id !== player.character.character_id);
    const caregivers = relatives.filter((person) => ["parent", "guardian"].includes(person.family_role));
    const siblings = relatives.filter((person) => person.family_role === "sibling");
    observedCaregiverCounts.add(caregivers.length);
    observedSiblingCounts.add(siblings.length);
    assert.ok(relatives.length >= 2 && relatives.length <= 4);
    assert.ok(caregivers.length >= 1);
    assert.ok(siblings.length >= 1);
    assert.ok(profile.family_tree.people.some((person) => ["parent", "guardian"].includes(person.family_role)));
    assert.ok(profile.family_tree.people.some((person) => person.family_role === "sibling"));
    assert.ok(profile.family_tree.relationships.some((relation) =>
      relation.type === "parent_of" || relation.type === "guardian_of"));
    assert.ok(profile.family_tree.relationships.some((relation) => relation.type === "sibling_of"));
    for (const sibling of siblings) {
      for (const caregiverRelation of Object.values(state.relationships).filter((relation) =>
        (relation.type === "parent_of" || relation.type === "guardian_of") &&
        relation.participants.includes(sibling.person_id))) {
        assert.ok(state.people[sibling.person_id].relationship_ids.includes(caregiverRelation.relationship_id));
      }
    }
    assert.ok(profile.history.some((event) => event.event_type === "family_created"));
    assert.deepEqual(profile.date_of_birth, player.character.date_of_birth);
  }
  assert.ok(observedCaregiverCounts.size > 1, "families do not use one universal caregiver pair");
  assert.ok(observedSiblingCounts.size > 1, "starter profiles vary sibling group size");
  const allPersonIds = new Set([
    ...Object.values(state.players).map((entry) => entry.character.character_id),
    ...Object.keys(state.people),
  ]);
  assert.equal(allPersonIds.size, players.length + Object.keys(state.people).length);
});

test("friendship is mutual and age-appropriate; every romantic stage rejects minors", () => {
  const state = makeLifeWorld();
  const minorA = addPlayer(state, "Mina");
  const minorB = addPlayer(state, "Tobi");
  const adult = addPlayer(state, "Dara");
  setAge(adult.character, 25, state.worldClock.world_date);
  const closeSibling = Object.values(state.people).find((person) =>
    person.family_role === "sibling" && person.household_id === adult.character.household_id);
  assert.ok(closeSibling);
  setAge(closeSibling, 25, state.worldClock.world_date);
  assert.throws(
    () => proposeRelationship(state, adult.character.character_id, closeSibling.person_id, "meet"),
    /relationship_close_family_restricted/,
  );
  assert.throws(
    () => proposeRelationship(state, minorA.character.character_id, minorB.character.character_id, "meet"),
    /relationship_age_restricted/,
  );
  assert.throws(
    () => proposeRelationship(state, minorA.character.character_id, adult.character.character_id, "friendship"),
    /minor_friendship_age_gap/,
  );
  const first = proposeRelationship(state, minorA.character.character_id, minorB.character.character_id, "friendship");
  assert.equal(first.status, "pending");
  assert.throws(
    () => proposeRelationship(state, minorA.character.character_id, minorB.character.character_id, "friendship"),
    /relationship_waiting_for_partner/,
  );
  const accepted = proposeRelationship(state, minorB.character.character_id, minorA.character.character_id, "friendship");
  assert.equal(accepted.relationship.status, "active");
  assert.equal(accepted.relationship.stage, "friendship");
  assert.ok(minorA.character.life_event_ids.some((id) => state.lifeEvents[id]?.event_type === "friendship_started"));
});

test("adult relationship progression records marriage, household links, children and multiple generations", () => {
  const state = makeLifeWorld();
  const first = addPlayer(state, "Ayo");
  const second = addPlayer(state, "Bola");
  const third = addPlayer(state, "Kemi");
  setAge(first.character, 25, state.worldClock.world_date);
  setAge(second.character, 26, state.worldClock.world_date);
  const firstMarriageResult = progressToMarriage(state, first.character.character_id, second.character.character_id);
  const firstMarriage = firstMarriageResult.marriage;
  assert.ok(firstMarriage);
  assert.equal(Object.keys(state.marriages).length, 1);
  assert.equal(first.character.household_id, second.character.household_id);
  assert.equal(first.character.home_id, second.character.home_id);
  assert.ok(state.relationships[firstMarriageResult.relationship.relationship_id]);
  assert.ok(Object.values(state.relationships).some((relation) => relation.type === "spouse" && relation.status === "active"));
  assert.ok(first.character.life_event_ids.some((id) => state.lifeEvents[id]?.event_type === "marriage"));

  assert.throws(
    () => createChildForMarriage(state, "no-active-marriage", "Seyi", Date.now()),
    /marriage_not_active/,
  );
  const child = createChildForMarriage(state, firstMarriage.marriage_id, "Seyi", Date.now());
  assert.equal(child.age, 0);
  assert.deepEqual(child.date_of_birth, state.worldClock.world_date);
  assert.equal(child.life_stage_id, "child");
  assert.equal(child.life_status, "alive");
  assert.equal(child.home_id, state.households[firstMarriage.household_id].home_id);
  assert.ok(state.households[firstMarriage.household_id].member_ids.includes(child.person_id));
  assert.ok(state.families[firstMarriage.family_id].member_ids.includes(child.person_id));
  assert.equal(Object.values(state.players).some((entry) => entry.character.character_id === child.person_id), false);
  assert.equal(Object.values(state.relationships).filter((relation) => relation.type === "parent_of" && relation.participants[1] === child.person_id).length, 2);
  assert.ok(first.character.life_event_ids.some((id) => state.lifeEvents[id]?.event_type === "childbirth"));

  const future = { year: 2043, month: 1, day: 2 };
  state.worldClock.day = worldDayForDate(future);
  state.worldClock.world_date = future;
  advanceWorldLife(state);
  assert.equal(child.age, 18);
  const adultNpcPartner = Object.values(state.people).find((person) =>
    person.family_role === "sibling" && person.family_ids.includes(third.character.family_ids[0]));
  assert.ok(adultNpcPartner);
  setAge(adultNpcPartner, 20, future);
  const secondMarriageResult = progressToMarriage(state, child.person_id, adultNpcPartner.person_id);
  assert.ok(secondMarriageResult.marriage, "non-player adult characters can be linked generically");
  const grandchild = createChildForMarriage(state, secondMarriageResult.marriage.marriage_id, "Amara", Date.now());
  assert.equal(grandchild.family_role, "child");
  const profile = buildLifeProfile(state, first.character);
  assert.ok(profile.family_tree.people.some((person) => person.person_id === grandchild.person_id));
  assert.ok(profile.family_tree.relationships.some((relation) => relation.type === "parent_of"));
  assert.ok(profile.history.some((event) => event.event_type === "marriage"));
  assert.ok(profile.history.some((event) => event.event_type === "childbirth"));
});

test("death is centralized, idempotent, preserves family history and records inheritance hooks without transfers", () => {
  const state = makeLifeWorld();
  const player = addPlayer(state, "Nneka");
  const caregiver = Object.values(state.people).find((person) =>
    person.family_role === "parent" || person.family_role === "guardian");
  assert.ok(caregiver);
  assert.throws(() => recordDeath(state, caregiver.person_id, "old_age"), /old_age_pathway_ineligible/);
  const result = recordDeath(state, caregiver.person_id, "illness");
  assert.equal(result.alreadyDeceased, false);
  assert.equal(caregiver.life_status, "deceased");
  assert.equal(canTakeActiveAction(caregiver), false);
  assert.equal(result.event.event_type, "death");
  assert.equal(result.event.data.cause_category, "illness");
  assert.ok(result.inheritanceEvent);
  assert.deepEqual(result.inheritanceEvent.asset_reference_ids, []);
  assert.equal(result.inheritanceEvent.status, "pending_review");
  const isPlayerAChild = Object.values(state.relationships).some((relation) =>
    relation.type === "parent_of" && relation.participants[0] === caregiver.person_id &&
    relation.participants[1] === player.character.character_id);
  assert.equal(
    result.inheritanceEvent.heir_person_ids.includes(player.character.character_id),
    isPlayerAChild,
  );
  assert.ok(Object.values(state.relationships).some((relation) => relation.participants.includes(caregiver.person_id)));
  const repeated = recordDeath(state, caregiver.person_id, "illness");
  assert.equal(repeated.alreadyDeceased, true);
  assert.equal(repeated.event.event_id, result.event.event_id);
  assert.equal(Object.values(state.lifeEvents).filter((event) => event.event_id === result.event.event_id).length, 1);

  const older = addPlayer(state, "Sade");
  setAge(older.character, 60, state.worldClock.world_date);
  const retirement = recordRetirement(state, older.character.character_id);
  assert.equal(older.character.life_status, "retired");
  assert.equal(retirement.event_type, "retirement");
  assert.equal(canTakeActiveAction(older.character), true, "retirement is a living state, not death");
  const elderly = addPlayer(state, "Baba");
  setAge(elderly.character, 81, state.worldClock.world_date);
  const oldAgeDeath = recordDeath(state, elderly.character.character_id, "old_age");
  assert.equal(oldAgeDeath.event.data.cause_category, "old_age");
  assert.equal(oldAgeDeath.event.data.age_at_death, 81);
});

test("online creation exposes persistent DOB/family/history, shared calendar and multiplayer records", async () => {
  await testWorld(async ({ websocketUrl, stateFile }) => {
    const first = await openPeer(websocketUrl);
    const second = await openPeer(websocketUrl);
    try {
      const [a, b] = await Promise.all([
        createOnlineCharacter(first, "Ayo"),
        createOnlineCharacter(second, "Dara"),
      ]);
      assert.equal(a.ready.character.age, 16);
      assert.deepEqual(a.ready.character.life_profile.date_of_birth, a.ready.character.date_of_birth);
      assert.equal(a.ready.character.life_profile.life_stage_id, "secondary-school-youth");
      assert.ok(a.ready.character.life_profile.family_members.length >= 3);
      assert.ok(a.ready.character.life_profile.family_members.length <= 5);
      assert.ok(a.ready.character.life_profile.history.some((event) => event.event_type === "family_created"));
      assert.notEqual(a.ready.character.household_id, b.ready.character.household_id);
      assert.equal(a.ready.world.id, "nigeria-main");
      assert.equal(a.ready.world.clock.world_date.year, 2025);
      assert.equal(typeof a.ready.world.clock.second, "number");
      const saved = JSON.parse(await readFile(stateFile, "utf8"));
      assert.equal(saved.schemaVersion, 8);
      assert.equal(
        Object.keys(saved.people).length,
        a.ready.character.life_profile.family_members.length +
          b.ready.character.life_profile.family_members.length - 2,
      );
      assert.equal(Object.keys(saved.households).length, 2);
      assert.equal(Object.keys(saved.families).length, 2);
      assert.ok(Object.values(saved.relationships).some((relation) =>
        relation.type === "parent_of" || relation.type === "guardian_of"));
      assert.ok(b.ready.character.life_profile.family_tree.people.some((person) => person.family_role === "sibling"));
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  }, { gameMinuteMs: 100, broadcastIntervalMs: 20, tickIntervalMs: 10 });
});

test("online social actions require adult ages for romance, support mutual minor friendship, and preserve death records", async () => {
  await testWorld(async ({ websocketUrl, server }) => {
    const first = await openPeer(websocketUrl);
    const second = await openPeer(websocketUrl);
    try {
      const [a, b] = await Promise.all([
        createOnlineCharacter(first, "Tobi"),
        createOnlineCharacter(second, "Mina"),
      ]);
      const romanticDenied = first.waitFor((message) => message.type === "error" && message.code === "relationship_age_restricted");
      first.send({
        type: "relationship.progress", targetCharacterId: b.ready.character.character_id,
        stage: "meet", requestId: "minor-romance-001",
      });
      assert.equal((await romanticDenied).code, "relationship_age_restricted");

      const pending = first.waitFor((message) => message.type === "relationship.progress" && message.status === "pending");
      first.send({
        type: "relationship.progress", targetCharacterId: b.ready.character.character_id,
        stage: "friendship", requestId: "minor-friendship-001",
      });
      assert.equal((await pending).stage, "friendship");
      const confirmed = second.waitFor((message) => message.type === "relationship.progress" && message.status === "confirmed");
      second.send({
        type: "relationship.progress", targetCharacterId: a.ready.character.character_id,
        stage: "friendship", requestId: "minor-friendship-002",
      });
      assert.equal((await confirmed).stage, "friendship");

      const death = await server.recordDeathEvent(a.ready.character.character_id, "accident");
      assert.equal(death.event.data.cause_category, "accident");
      assert.ok(death.inheritanceEvent);
      const deadSnapshot = await first.waitFor((message) =>
        message.type === "character.snapshot" && message.character.life_status === "deceased");
      assert.equal(deadSnapshot.character.life_profile.life_status, "deceased");
      const deniedAction = first.waitFor((message) => message.type === "error" && message.code === "character_deceased");
      first.send({ type: "character.rest", requestId: "dead-action-001" });
      assert.equal((await deniedAction).code, "character_deceased");
      const deadMovement = first.waitFor((message) => message.type === "error" && message.code === "character_deceased");
      first.send({ type: "movement.input", sequence: 1, direction: { x: 1, y: 0 }, running: false });
      assert.equal((await deadMovement).code, "character_deceased");
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  }, { gameMinuteMs: 10_000, broadcastIntervalMs: 20, tickIntervalMs: 10 });
});

test("online adult relationship progression, retirement, and retry-safe childbirth persist linked life records", async () => {
  let sessionTokens = [];
  let retirementCharacterId = "";
  await testWorld(async ({ websocketUrl, stateFile, server }) => {
    const first = await openPeer(websocketUrl);
    const second = await openPeer(websocketUrl);
    try {
      const readyFor = async (peer, token) => {
        peer.send({ type: "session.resume", sessionToken: token });
        return peer.waitForType("session.ready");
      };
      await Promise.all([
        readyFor(first, sessionTokens[0]),
        readyFor(second, sessionTokens[1]),
      ]);
      const retirementEvent = await server.recordRetirementEvent(retirementCharacterId);
      assert.equal(retirementEvent.event_type, "retirement");
      const retirementReplay = await server.recordRetirementEvent(retirementCharacterId);
      assert.equal(retirementReplay.event_id, retirementEvent.event_id, "retirement retries reuse the recorded event");
      for (const [index, stage] of loadLifeCatalog().relationship_rules.romantic_progression.entries()) {
        const pendingA = first.waitFor((message) => message.type === "relationship.progress" && message.status === "pending");
        const pendingB = second.waitFor((message) => message.type === "relationship.progress" && message.status === "pending");
        first.send({
          type: "relationship.progress",
          targetCharacterId: "character-online-partner-b",
          stage,
          requestId: `adult-stage-${index}-proposal`,
        });
        await Promise.all([pendingA, pendingB]);
        const confirmedA = first.waitFor((message) => message.type === "relationship.progress" && message.status === "confirmed");
        const confirmedB = second.waitFor((message) => message.type === "relationship.progress" && message.status === "confirmed");
        second.send({
          type: "relationship.progress",
          targetCharacterId: "character-online-partner-a",
          stage,
          requestId: `adult-stage-${index}-confirmation`,
        });
        await Promise.all([confirmedA, confirmedB]);
      }
      const bornA = first.waitFor((message) => message.type === "family.childborn");
      const bornB = second.waitFor((message) => message.type === "family.childborn");
      first.send({ type: "family.childbirth", requestId: "birth-request-0001", name: "Kene" });
      const [birthForFirst, birthForSecond] = await Promise.all([bornA, bornB]);
      assert.equal(birthForFirst.child.person_id, birthForSecond.child.person_id);
      assert.equal(birthForFirst.child.age, 0);

      const duplicate = first.waitFor((message) => message.type === "command.duplicate");
      first.send({ type: "family.childbirth", requestId: "birth-request-0001", name: "Kene" });
      await duplicate;
      await delay(50);
      const saved = JSON.parse(await readFile(stateFile, "utf8"));
      const children = Object.values(saved.people).filter((person) => person.family_role === "child");
      assert.equal(children.length, 1, "retrying the same request ID does not create a second child");
      assert.equal(children[0].person_id, birthForFirst.child.person_id);
      assert.equal(children[0].life_status, "alive");
      assert.equal(children[0].current_location, "home");
      assert.ok(children[0].relationship_ids.length >= 2);
      assert.ok(Object.values(saved.lifeEvents).some((event) =>
        event.event_type === "childbirth" && event.participant_ids.includes(children[0].person_id)));
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  }, {
    beforeStart: async (stateFile) => {
      const state = makeLifeWorld();
      const educationCatalog = loadEducationCatalog();
      sessionTokens = [];
      for (const [index, [name, age]] of [["Ayo", 24], ["Bola", 25]].entries()) {
        const player = addPlayer(state, name, `character-online-partner-${index === 0 ? "a" : "b"}`);
        player.character.education_record = createStudentEducationRecord(
          player.character.character_id,
          age,
          state.worldClock.day,
          educationCatalog,
        );
        setAge(player.character, age, state.worldClock.world_date);
        syncLegacyEducation(player.character, educationCatalog);
        const token = randomBytes(32).toString("base64url");
        player.tokenHash = createHash("sha256").update(token).digest("hex");
        sessionTokens.push(token);
      }
      const retiree = addPlayer(state, "Sade", "character-online-retirement-hook");
      retiree.character.education_record = createStudentEducationRecord(
        retiree.character.character_id,
        61,
        state.worldClock.day,
        educationCatalog,
      );
      setAge(retiree.character, 61, state.worldClock.world_date);
      syncLegacyEducation(retiree.character, educationCatalog);
      retirementCharacterId = retiree.character.character_id;
      await writeFile(stateFile, JSON.stringify(state));
    },
    gameMinuteMs: 10_000,
    broadcastIntervalMs: 20,
    tickIntervalMs: 10,
  });
});

test("offline players and NPC households catch up birthdays on persisted-world reload and reconnect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-life-reconnect-test-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const firstRun = await startServer(stateFile, { gameMinuteMs: 10_000, tickIntervalMs: 10 });
  let peer = await openPeer(firstRun.websocketUrl);
  const identity = await createOnlineCharacter(peer, "Chika");
  const firstLifeDate = identity.ready.world.clock.world_date;
  const dob = identity.ready.character.date_of_birth;
  await peer.close();
  await stopServer(firstRun.server);

  const futureDate = { year: firstLifeDate.year + 3, month: firstLifeDate.month, day: firstLifeDate.day };
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  saved.worldClock.day = worldDayForDate(futureDate);
  saved.worldClock.minute_of_day = 470;
  saved.worldClock.millisecond_of_minute = 0;
  saved.worldClock.updated_at = new Date().toISOString();
  await writeFile(stateFile, JSON.stringify(saved));

  const secondRun = await startServer(stateFile, { gameMinuteMs: 10_000, tickIntervalMs: 10 });
  peer = await openPeer(secondRun.websocketUrl);
  try {
    peer.send({ type: "session.resume", sessionToken: identity.sessionToken });
    const resumed = await peer.waitForType("session.ready");
    assert.equal(resumed.character.age, ageOnDate(dob, futureDate));
    const birthdays = resumed.character.life_profile.history.filter((event) => event.event_type === "birthday");
    assert.ok(birthdays.length >= 2);
    assert.ok(birthdays.every((event) => event.world_date.year <= futureDate.year));
    assert.ok(resumed.character.life_profile.history.some((event) => event.event_type === "life_stage_changed"));
    await delay(50);
    const stateAfterResume = JSON.parse(await readFile(stateFile, "utf8"));
    assert.ok(Object.values(stateAfterResume.people).every((person) => person.last_life_processed_date.year === futureDate.year));
    assert.equal(stateAfterResume.worldId, "nigeria-main");
  } finally {
    await peer.close();
    await stopServer(secondRun.server);
  }
});
