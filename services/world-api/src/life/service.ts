import { createHash, randomUUID } from "node:crypto";
import type { CharacterRecord, PersistentPlayer, PersistentWorldState } from "../multiplayer/types.js";
import {
  ageForNewCharacter,
  ageOnDate,
  addDays,
  birthdayDateForYear,
  calendarDateLabel,
  compareDates,
  dateOfBirthForAge,
  worldDayForDate,
  isAdultAge,
  isValidDate,
  lifeStageForAge,
  loadLifeCatalog,
  type WorldClockState,
} from "./calendar.js";
import type {
  CalendarDate,
  CharacterLifeFields,
  DeathCauseCategory,
  FamilyPersonRecord,
  FamilyRecord,
  HouseholdRecord,
  InheritanceEventRecord,
  LifeEventRecord,
  LifeProfilePerson,
  LifeProfileRelationship,
  LifeProfileSnapshot,
  LifeCatalog,
  LifeStageDefinition,
  LifeStatus,
  MarriageRecord,
  RelationshipRecord,
  RelationshipType,
  RomanticStage,
} from "./types.js";

const FAMILY_NAMES = ["Adeyemi", "Bello", "Eze", "Ibrahim", "Okafor", "Olawale", "Yusuf"];
const GIVEN_NAMES = ["Amina", "Bisi", "Chinwe", "Hauwa", "Ifeoma", "Kemi", "Ngozi", "Sadiya", "Tola", "Zainab"];
const CHILD_NAMES = ["Ayo", "Tobi", "Nneka", "Amara", "Femi", "Chidi", "Zainab", "Kene"];
const DEATH_CAUSES: readonly DeathCauseCategory[] = [
  "old_age", "illness", "accident", "violence", "poisoning_or_exposure", "other",
];

export type LifeTrackable = (CharacterRecord | FamilyPersonRecord) & CharacterLifeFields & {
  age: number;
  name?: string;
  person_id?: string;
  character_id?: string;
  created_at?: string;
  updated_at?: string;
  family_role?: string;
  current_location?: string;
  home_id?: string;
  education_level?: string;
};

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function stableRelationshipId(type: RelationshipType, participants: readonly string[]): string {
  const normalized = type === "parent_of" || type === "guardian_of"
    ? participants.join(":")
    : [...participants].sort().join(":");
  const digest = createHash("sha256").update(`${type}:${normalized}`).digest("hex").slice(0, 24);
  return `relationship-${digest}`;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function validStatus(value: unknown): value is LifeStatus {
  return value === "alive" || value === "retired" || value === "deceased";
}

function characterIdOf(person: LifeTrackable): string {
  return person.character_id ?? person.person_id ?? "";
}

function personFor(state: PersistentWorldState, personId: string): LifeTrackable | undefined {
  for (const player of Object.values(state.players)) {
    if (player.character.character_id === personId) return player.character;
  }
  return state.people[personId];
}

function playerForCharacter(state: PersistentWorldState, characterId: string): PersistentPlayer | undefined {
  return Object.values(state.players).find((player) => player.character.character_id === characterId);
}

function currentDate(state: PersistentWorldState): CalendarDate {
  return state.worldClock.world_date;
}

function relationshipParticipants(
  type: RelationshipType,
  firstId: string,
  secondId: string,
): [string, string] {
  if (type === "parent_of" || type === "guardian_of") return [firstId, secondId];
  return firstId < secondId ? [firstId, secondId] : [secondId, firstId];
}

function addRelationship(
  state: PersistentWorldState,
  type: RelationshipType,
  firstId: string,
  secondId: string,
  createdDate: CalendarDate = currentDate(state),
): RelationshipRecord {
  const participants = relationshipParticipants(type, firstId, secondId);
  const relationshipId = stableRelationshipId(type, participants);
  let relationship = state.relationships[relationshipId];
  if (!relationship) {
    relationship = {
      relationship_id: relationshipId,
      type,
      participants,
      status: "active",
      created_world_date: { ...createdDate },
      updated_world_date: { ...createdDate },
      event_ids: [],
    };
    state.relationships[relationshipId] = relationship;
  }
  for (const participantId of participants) {
    const person = personFor(state, participantId);
    if (person) addUnique(person.relationship_ids, relationshipId);
  }
  return relationship;
}

function eventOptionsFor(
  person: LifeTrackable,
  eventId?: string,
): { eventId?: string; familyId?: string; householdId?: string } {
  const options: { eventId?: string; familyId?: string; householdId?: string } = {};
  if (eventId !== undefined) options.eventId = eventId;
  const familyId = person.family_ids[0];
  if (familyId !== undefined) options.familyId = familyId;
  if (person.household_id) options.householdId = person.household_id;
  return options;
}

function recordEvent(
  state: PersistentWorldState,
  eventType: LifeEventRecord["event_type"],
  participantIds: readonly string[],
  summary: string,
  data: LifeEventRecord["data"] = {},
  options: {
    eventId?: string;
    familyId?: string;
    householdId?: string;
    worldDate?: CalendarDate;
    worldDay?: number;
    minuteOfDay?: number;
  } = {},
): LifeEventRecord {
  const eventId = options.eventId ?? `life-event-${randomUUID()}`;
  const existing = state.lifeEvents[eventId];
  if (existing) return existing;
  const clock = state.worldClock;
  const eventDate = options.worldDate ?? clock.world_date;
  const event: LifeEventRecord = {
    event_id: eventId,
    event_type: eventType,
    world_date: { ...eventDate },
    world_day: options.worldDay ?? worldDayForDate(eventDate),
    minute_of_day: options.minuteOfDay ?? clock.minute_of_day,
    participant_ids: [...new Set(participantIds)],
    summary,
    data: { ...data },
  };
  if (options.familyId !== undefined) event.family_id = options.familyId;
  if (options.householdId !== undefined) event.household_id = options.householdId;
  state.lifeEvents[eventId] = event;
  for (const participantId of event.participant_ids) {
    const person = personFor(state, participantId);
    if (person) addUnique(person.life_event_ids, eventId);
  }
  if (options.familyId) {
    const family = state.families[options.familyId];
    if (family) addUnique(family.life_event_ids, eventId);
  }
  return event;
}

function ageAtCreation(date: CalendarDate, age: number, seed: string): CalendarDate {
  return ageForNewCharacter(date, age, seed, loadLifeCatalog());
}

function starterFamilyProfile(
  characterId: string,
  catalog: LifeCatalog,
): LifeCatalog["family_generation"]["starter_household_profiles"][number] {
  const profiles = catalog.family_generation.starter_household_profiles;
  const index = createHash("sha256").update(characterId).digest().readUInt32BE(0) % profiles.length;
  return profiles[index]!;
}

function createPerson(
  state: PersistentWorldState,
  personId: string,
  name: string,
  age: number,
  familyRole: FamilyPersonRecord["family_role"],
  household: HouseholdRecord,
  familyId: string,
  now: number,
): FamilyPersonRecord {
  const date = currentDate(state);
  const dob = dateOfBirthForAge(date, age, personId);
  const person: FamilyPersonRecord = {
    person_id: personId,
    name,
    age: ageOnDate(dob, date),
    date_of_birth: dob,
    life_stage_id: lifeStageForAge(age).id,
    life_status: "alive",
    household_id: household.household_id,
    family_ids: [familyId],
    life_event_ids: [],
    relationship_ids: [],
    last_life_processed_date: { ...date },
    inheritance_event_ids: [],
    family_role: familyRole,
    home_id: household.home_id,
    current_location: "home",
    education_level: age < 18 ? "Secondary education (NPC record)" : "Not recorded (NPC)",
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  state.people[personId] = person;
  return person;
}

function householdMemberView(person: LifeTrackable, role: string): Record<string, unknown> {
  const personId = characterIdOf(person);
  return {
    id: personId,
    name: person.name ?? "Family member",
    role,
    age: person.age,
    date_of_birth: { ...person.date_of_birth },
    life_stage_id: person.life_stage_id,
    life_status: person.life_status,
    household_id: person.household_id,
    current_location: person.current_location ?? "home",
  };
}

export function initializeCharacterLife(
  character: CharacterRecord,
  worldDate: CalendarDate,
  requestedAge: number,
): void {
  if (!loadLifeCatalog().starting_character_ages.includes(requestedAge) || !isValidDate(worldDate)) {
    throw new Error("invalid_starting_age");
  }
  character.date_of_birth = ageAtCreation(worldDate, requestedAge, character.character_id);
  character.age = ageOnDate(character.date_of_birth, worldDate);
  character.life_stage_id = lifeStageForAge(character.age).id;
  character.life_status = "alive";
  character.household_id = "";
  character.family_ids = [];
  character.life_event_ids = [];
  character.relationship_ids = [];
  character.last_life_processed_date = { ...worldDate };
  character.inheritance_event_ids = [];
}

export function createStarterFamily(
  state: PersistentWorldState,
  playerId: string,
  character: CharacterRecord,
  now: number,
  legacyHousehold?: Record<string, unknown>,
): void {
  const catalog = loadLifeCatalog();
  const familyId = newId("family");
  const legacyId = typeof legacyHousehold?.id === "string" ? legacyHousehold.id : "";
  const householdId = legacyId.startsWith("household-") ? legacyId : newId("household");
  const legacyHomeId = typeof legacyHousehold?.home_id === "string" ? legacyHousehold.home_id : "";
  const household: HouseholdRecord = {
    household_id: householdId,
    home_id: legacyHomeId.startsWith("home-") ? legacyHomeId : `home-${householdId}`,
    home_type: typeof legacyHousehold?.home_type === "string" ? legacyHousehold.home_type : "Family compound home",
    neighborhood_id: typeof legacyHousehold?.neighborhood_id === "string"
      ? legacyHousehold.neighborhood_id : "idera-quarter",
    family_ids: [familyId],
    member_ids: [character.character_id],
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  const familyName = FAMILY_NAMES[(Math.random() * FAMILY_NAMES.length) | 0] ?? "Adeyemi";
  const familyProfile = starterFamilyProfile(character.character_id, catalog);
  const legacyGuardians = Array.isArray(legacyHousehold?.guardians)
    ? legacyHousehold.guardians.filter((entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
  const caregiverRoles = legacyGuardians.length > 0
    ? legacyGuardians.map((old, index) => {
      const legacyRole = old.role ?? old.family_role;
      if (legacyRole === "parent" || legacyRole === "guardian") return legacyRole;
      return familyProfile.caregiver_roles[index % familyProfile.caregiver_roles.length] ?? "guardian";
    })
    : [...familyProfile.caregiver_roles];
  const caregiverSpecs = caregiverRoles.map((role, index) => {
    const old = legacyGuardians[index];
    const legacyPersonId = old?.id ?? old?.person_id;
    const id = typeof legacyPersonId === "string" && legacyPersonId.startsWith("npc-")
      ? legacyPersonId : newId("npc");
    const fallbackName = `${GIVEN_NAMES[(Math.random() * GIVEN_NAMES.length) | 0] ?? "Amina"} ${familyName}`;
    const name = typeof old?.name === "string" && old.name.trim() ? old.name.trim() : fallbackName;
    const configuredAgeRange = catalog.family_generation.starting_parent_age_max_years -
      catalog.family_generation.starting_parent_age_min_years + 1;
    const age = catalog.family_generation.starting_parent_age_min_years +
      (createHash("sha256").update(id).digest().readUInt16BE(0) % Math.max(1, configuredAgeRange));
    return { id, name, role, age };
  });
  const siblingAgeRange = catalog.family_generation.starting_sibling_age_max_years -
    catalog.family_generation.starting_sibling_age_min_years + 1;
  const siblingSpecs = Array.from({ length: familyProfile.sibling_count }, () => {
    const id = newId("npc");
    const age = catalog.family_generation.starting_sibling_age_min_years +
      (createHash("sha256").update(id).digest().readUInt16BE(0) % Math.max(1, siblingAgeRange));
    const name = `${GIVEN_NAMES[(Math.random() * GIVEN_NAMES.length) | 0] ?? "Tola"} ${familyName}`;
    return { id, name, age };
  });

  state.households[householdId] = household;
  const family: FamilyRecord = {
    family_id: familyId,
    family_name: familyName,
    member_ids: [character.character_id],
    household_ids: [householdId],
    parent_family_ids: [],
    life_event_ids: [],
    created_at: new Date(now).toISOString(),
  };
  state.families[familyId] = family;
  character.household_id = householdId;
  character.family_ids = [familyId];
  character.home_id = household.home_id;
  character.household = {
    id: householdId,
    home_id: household.home_id,
    neighborhood_id: household.neighborhood_id,
    home_type: household.home_type,
    rooms: Array.isArray(legacyHousehold?.rooms)
      ? [...legacyHousehold.rooms] : ["Living area", "Bedroom", "Kitchen"],
    created_at: household.created_at,
  };

  const caregivers: FamilyPersonRecord[] = [];
  const guardians: Array<Record<string, unknown>> = [];
  for (const spec of caregiverSpecs) {
    const caregiver = createPerson(state, spec.id, spec.name, spec.age, spec.role, household, familyId, now);
    caregivers.push(caregiver);
    family.member_ids.push(caregiver.person_id);
    household.member_ids.push(caregiver.person_id);
    guardians.push({ ...householdMemberView(caregiver, spec.role), id: caregiver.person_id });
  }
  const siblings = siblingSpecs.map((spec) =>
    createPerson(state, spec.id, spec.name, spec.age, "sibling", household, familyId, now));
  const familyChildren = [character.character_id, ...siblings.map((sibling) => sibling.person_id)];
  for (const sibling of siblings) {
    family.member_ids.push(sibling.person_id);
    household.member_ids.push(sibling.person_id);
  }
  for (const caregiver of caregivers) {
    const relationType = caregiver.family_role === "parent" ? "parent_of" : "guardian_of";
    for (const childId of familyChildren) {
      addRelationship(state, relationType, caregiver.person_id, childId);
    }
  }
  for (let leftIndex = 0; leftIndex < familyChildren.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < familyChildren.length; rightIndex += 1) {
      const leftId = familyChildren[leftIndex];
      const rightId = familyChildren[rightIndex];
      if (leftId && rightId) addRelationship(state, "sibling_of", leftId, rightId);
    }
  }
  const siblingViews = siblings.map((sibling) => householdMemberView(sibling, "sibling"));
  character.household["guardians"] = guardians;
  character.household["siblings"] = siblingViews;
  character.household["members"] = [
    householdMemberView(character, "player_character"),
    ...guardians,
    ...siblingViews,
  ];
  character.updated_at = new Date(now).toISOString();
  const familyEvent = recordEvent(
    state,
    "family_created",
    [
      character.character_id,
      ...caregiverSpecs.map((spec) => spec.id),
      ...siblingSpecs.map((spec) => spec.id),
    ],
    "A persistent household and family relationships were recorded.",
    { member_count: 1 + caregivers.length + siblings.length },
    { familyId, householdId },
  );
  const familyParticipantIds = new Set([
    character.character_id,
    ...caregivers.map((caregiver) => caregiver.person_id),
    ...siblings.map((sibling) => sibling.person_id),
  ]);
  for (const relationship of Object.values(state.relationships)) {
    if (relationship.participants.some((participantId) => familyParticipantIds.has(participantId))) {
      addUnique(relationship.event_ids, familyEvent.event_id);
    }
  }
  recordEvent(
    state,
    "character_created",
    [character.character_id],
    "A new character record entered the shared world.",
    { starting_age: character.age, starting_stage: character.life_stage_id, player_id: playerId },
    { familyId, householdId },
  );
}

function normalizePersonLife(person: LifeTrackable, date: CalendarDate, fallbackSeed: string): void {
  if (!isValidDate(person.date_of_birth)) {
    const legacyAge = Number.isSafeInteger(person.age) ? Math.max(0, Math.min(9998, person.age)) : 15;
    person.date_of_birth = dateOfBirthForAge(date, legacyAge, fallbackSeed);
  }
  if (compareDates(person.date_of_birth, date) > 0) throw new Error("invalid_date_of_birth");
  person.age = ageOnDate(person.date_of_birth, date);
  person.life_stage_id = lifeStageForAge(person.age).id;
  if (!validStatus(person.life_status)) person.life_status = "alive";
  if (!Array.isArray(person.family_ids)) person.family_ids = [];
  if (!Array.isArray(person.life_event_ids)) person.life_event_ids = [];
  if (!Array.isArray(person.relationship_ids)) person.relationship_ids = [];
  if (!Array.isArray(person.inheritance_event_ids)) person.inheritance_event_ids = [];
  if (!isValidDate(person.last_life_processed_date)) person.last_life_processed_date = { ...date };
  if (typeof person.household_id !== "string") person.household_id = "";
}

function migrationFamilyForLegacyCharacter(
  state: PersistentWorldState,
  player: PersistentPlayer,
  now: number,
): void {
  const character = player.character;
  const needsHousehold = !character.household_id || !state.households[character.household_id];
  const hasFamily = character.family_ids.some((familyId) => state.families[familyId] !== undefined);
  if (needsHousehold || !hasFamily) {
    createStarterFamily(state, player.playerId, character, now, character.household);
  }
}

export function normalizeLifeWorldState(state: PersistentWorldState, now: number): void {
  const date = currentDate(state);
  for (const player of Object.values(state.players)) {
    normalizePersonLife(player.character, date, player.character.character_id);
    migrationFamilyForLegacyCharacter(state, player, now);
  }
  for (const person of Object.values(state.people)) normalizePersonLife(person, date, person.person_id);
  for (const [id, household] of Object.entries(state.households)) {
    if (household.household_id !== id || !Array.isArray(household.member_ids) || !Array.isArray(household.family_ids)) {
      throw new Error(`invalid_household_record_${id}`);
    }
  }
  for (const [id, family] of Object.entries(state.families)) {
    if (family.family_id !== id || !Array.isArray(family.member_ids) || !Array.isArray(family.parent_family_ids)) {
      throw new Error(`invalid_family_record_${id}`);
    }
  }
  advanceWorldLife(state, date);
}

function appendBirthdayEvent(
  state: PersistentWorldState,
  person: LifeTrackable,
  personId: string,
  anniversary: CalendarDate,
  age: number,
  stage: LifeStageDefinition,
): void {
  const eventId = `birthday:${personId}:${anniversary.year}`;
  const event = recordEvent(
    state,
    "birthday",
    [personId],
    `Birthday recorded: age ${age}.`,
    { age },
    {
      ...eventOptionsFor(person, eventId),
      worldDate: anniversary,
      worldDay: worldDayForDate(anniversary),
      minuteOfDay: 0,
    },
  );
  const previousAge = ageOnDate(person.date_of_birth, addDays(anniversary, -1));
  const previousStage = lifeStageForAge(previousAge);
  if (previousStage.id !== stage.id) {
    recordEvent(
      state,
      "life_stage_changed",
      [personId],
      `Life stage changed to ${stage.label}.`,
      { from_stage: previousStage.id, to_stage: stage.id, age },
      {
        ...eventOptionsFor(person, `life-stage:${personId}:${anniversary.year}:${stage.id}`),
        worldDate: anniversary,
        worldDay: worldDayForDate(anniversary),
        minuteOfDay: 0,
      },
    );
  }
  addUnique(person.life_event_ids, event.event_id);
}

function advancePersonToDate(state: PersistentWorldState, person: LifeTrackable, date: CalendarDate): void {
  const personId = characterIdOf(person);
  if (!personId) return;
  normalizePersonLife(person, date, personId);
  let throughDate = date;
  if (person.life_status === "deceased" && isValidDate(person.death_date) && compareDates(person.death_date, throughDate) < 0) {
    throughDate = person.death_date;
  }
  const previousDate = person.last_life_processed_date;
  if (compareDates(previousDate, throughDate) < 0 && person.life_status !== "deceased") {
    for (let year = Math.max(person.date_of_birth.year, previousDate.year); year <= throughDate.year; year += 1) {
      const anniversary = birthdayDateForYear(person.date_of_birth, year);
      if (compareDates(anniversary, previousDate) <= 0 || compareDates(anniversary, throughDate) > 0) continue;
      const age = ageOnDate(person.date_of_birth, anniversary);
      appendBirthdayEvent(state, person, personId, anniversary, age, lifeStageForAge(age));
    }
  }
  person.age = ageOnDate(person.date_of_birth, throughDate);
  person.life_stage_id = lifeStageForAge(person.age).id;
  if (compareDates(person.last_life_processed_date, throughDate) < 0) {
    person.last_life_processed_date = { ...throughDate };
  }
}

export function advanceWorldLife(state: PersistentWorldState, date: CalendarDate = currentDate(state)): number {
  let processed = 0;
  for (const player of Object.values(state.players)) {
    const beforeAge = player.character.age;
    const beforeDate = player.character.last_life_processed_date;
    advancePersonToDate(state, player.character, date);
    if (player.character.age !== beforeAge || compareDates(player.character.last_life_processed_date, beforeDate) !== 0) {
      processed += 1;
    }
  }
  for (const person of Object.values(state.people)) {
    const beforeAge = person.age;
    const beforeDate = person.last_life_processed_date;
    advancePersonToDate(state, person, date);
    if (person.age !== beforeAge || compareDates(person.last_life_processed_date, beforeDate) !== 0) processed += 1;
  }
  return processed;
}

export function catchUpCharacterLife(state: PersistentWorldState, characterId: string): void {
  const character = personFor(state, characterId);
  if (!character) throw new Error("character_not_found");
  advancePersonToDate(state, character, currentDate(state));
  const household = state.households[character.household_id];
  for (const memberId of household?.member_ids ?? []) {
    const member = personFor(state, memberId);
    if (member) advancePersonToDate(state, member, currentDate(state));
  }
}

function asProfilePerson(person: LifeTrackable, role: string): LifeProfilePerson {
  return {
    person_id: characterIdOf(person),
    name: person.name ?? "Family member",
    age: person.age,
    date_of_birth: { ...person.date_of_birth },
    life_stage_id: person.life_stage_id,
    life_status: person.life_status,
    family_role: role || person.family_role || "relative",
    current_location: person.current_location ?? "home",
  };
}

function relationshipProfile(state: PersistentWorldState, relation: RelationshipRecord): LifeProfileRelationship {
  const first = personFor(state, relation.participants[0]);
  const second = personFor(state, relation.participants[1]);
  return {
    relationship_id: relation.relationship_id,
    type: relation.type,
    status: relation.status,
    stage: relation.stage ?? relation.pending_stage ?? null,
    participants: [...relation.participants],
    participant_names: [first?.name ?? "Unknown person", second?.name ?? "Unknown person"],
  };
}

export function buildLifeProfile(state: PersistentWorldState, character: CharacterRecord): LifeProfileSnapshot {
  const date = currentDate(state);
  const age = ageOnDate(character.date_of_birth, date);
  const stage = lifeStageForAge(age);
  const household = state.households[character.household_id];
  const directRelationshipIds = new Set(character.relationship_ids);
  for (const relation of Object.values(state.relationships)) {
    if (relation.participants.includes(character.character_id)) directRelationshipIds.add(relation.relationship_id);
  }
  const relationships = [...directRelationshipIds]
    .map((id) => state.relationships[id])
    .filter((entry): entry is RelationshipRecord => entry !== undefined)
    .map((entry) => relationshipProfile(state, entry));

  const familyIds = new Set<string>();
  const queue = [...character.family_ids];
  const maxNodes = loadLifeCatalog().family_generation.max_family_tree_nodes_in_profile;
  while (queue.length > 0 && familyIds.size < maxNodes) {
    const familyId = queue.shift();
    if (!familyId || familyIds.has(familyId)) continue;
    const family = state.families[familyId];
    if (!family) continue;
    familyIds.add(familyId);
    for (const parentFamilyId of family.parent_family_ids) if (!familyIds.has(parentFamilyId)) queue.push(parentFamilyId);
    for (const memberId of family.member_ids) {
      const member = personFor(state, memberId);
      for (const otherFamilyId of member?.family_ids ?? []) {
        if (!familyIds.has(otherFamilyId)) queue.push(otherFamilyId);
      }
    }
  }
  const personRoles = new Map<string, string>();
  for (const familyId of familyIds) {
    const family = state.families[familyId];
    for (const personId of family?.member_ids ?? []) {
      const person = personFor(state, personId);
      if (!person) continue;
      const relation = Object.values(state.relationships).find((edge) =>
        edge.participants.includes(character.character_id) && edge.participants.includes(personId));
      const role = relation?.type === "parent_of" ? "parent" : relation?.type === "guardian_of" ? "guardian" :
        relation?.type === "sibling_of" ? "sibling" : person.family_role ?? "family member";
      personRoles.set(personId, role);
    }
  }
  personRoles.set(character.character_id, "player_character");
  const familyPeople = [...personRoles.entries()]
    .map(([id, role]) => {
      const person = personFor(state, id);
      return person ? asProfilePerson(person, role) : null;
    })
    .filter((person): person is LifeProfilePerson => person !== null)
    .slice(0, maxNodes);
  const treeIds = new Set(familyPeople.map((person) => person.person_id));
  const treeRelationships = Object.values(state.relationships)
    .filter((relation) => relation.participants.every((id) => treeIds.has(id)))
    .map((relation) => relationshipProfile(state, relation));
  const householdPeople = (household?.member_ids ?? [character.character_id])
    .map((id) => personFor(state, id))
    .filter((person): person is LifeTrackable => person !== undefined)
    .map((person) => asProfilePerson(person, person.character_id === character.character_id ? "player_character" : person.family_role ?? "family member"));
  const historyLimit = loadLifeCatalog().family_generation.max_history_entries_in_profile;
  const history = character.life_event_ids
    .map((id) => state.lifeEvents[id])
    .filter((event): event is LifeEventRecord => event !== undefined)
    .sort((left, right) => left.world_day - right.world_day || left.minute_of_day - right.minute_of_day || left.event_id.localeCompare(right.event_id))
    .slice(-historyLimit);

  return {
    age,
    date_of_birth: { ...character.date_of_birth },
    life_stage_id: stage.id,
    life_stage_label: stage.label,
    life_status: character.life_status,
    household_id: character.household_id,
    family_ids: [...character.family_ids],
    family_members: householdPeople,
    family_tree: { people: familyPeople, relationships: treeRelationships },
    relationships,
    history,
    education: { level: character.education_level, school_id: character.school_id },
    inheritance_event_ids: [...character.inheritance_event_ids],
  };
}

function isCloseFamilyRelation(state: PersistentWorldState, firstId: string, secondId: string): boolean {
  return Object.values(state.relationships).some((relation) =>
    (relation.type === "parent_of" || relation.type === "guardian_of" || relation.type === "sibling_of") &&
    relation.participants.includes(firstId) && relation.participants.includes(secondId));
}

function recordRelationshipProposal(
  state: PersistentWorldState,
  actorId: string,
  targetId: string,
  stage: RomanticStage | "friendship",
): { status: "pending" | "confirmed"; relationship: RelationshipRecord; marriage?: MarriageRecord } {
  if (actorId === targetId) throw new Error("relationship_self_target");
  const actor = personFor(state, actorId);
  const target = personFor(state, targetId);
  if (!actor || !target) throw new Error("relationship_partner_unavailable");
  if (actor.life_status === "deceased" || target.life_status === "deceased") throw new Error("relationship_person_deceased");
  const date = currentDate(state);
  const actorAge = ageOnDate(actor.date_of_birth, date);
  const targetAge = ageOnDate(target.date_of_birth, date);
  const friendship = stage === "friendship";
  if (friendship) {
    const maxGap = loadLifeCatalog().relationship_rules.minor_friendship_max_age_gap_years;
    if ((!isAdultAge(actorAge) || !isAdultAge(targetAge)) && Math.abs(actorAge - targetAge) > maxGap) {
      throw new Error("minor_friendship_age_gap");
    }
  } else {
    if (!isAdultAge(actorAge) || !isAdultAge(targetAge)) throw new Error("relationship_age_restricted");
    if (isCloseFamilyRelation(state, actorId, targetId)) throw new Error("relationship_close_family_restricted");
  }

  const type: RelationshipType = friendship ? "friendship" : "romantic";
  const participants = relationshipParticipants(type, actorId, targetId);
  const relationshipId = stableRelationshipId(type, participants);
  let relationship = state.relationships[relationshipId];
  if (relationship?.status === "active" && friendship) throw new Error("relationship_already_active");
  if (relationship?.status === "ended" || relationship?.status === "bereaved") throw new Error("relationship_cannot_resume");

  if (!friendship) {
    const progression = loadLifeCatalog().relationship_rules.romantic_progression;
    const currentIndex = relationship?.stage ? progression.indexOf(relationship.stage as RomanticStage) : -1;
    const expectedStage = progression[currentIndex + 1];
    if (stage !== expectedStage) throw new Error("relationship_stage_order");
  } else if (relationship && relationship.pending_stage !== "friendship") {
    throw new Error("relationship_stage_order");
  }

  if (!relationship) {
    relationship = {
      relationship_id: relationshipId,
      type,
      participants,
      status: "pending",
      created_world_date: { ...date },
      updated_world_date: { ...date },
      event_ids: [],
      pending_stage: stage,
      pending_by: actorId,
    };
    state.relationships[relationshipId] = relationship;
    addUnique(actor.relationship_ids, relationshipId);
    addUnique(target.relationship_ids, relationshipId);
    return { status: "pending", relationship };
  }
  if (relationship.status === "active") {
    relationship.status = "pending";
    relationship.pending_stage = stage;
    relationship.pending_by = actorId;
    relationship.updated_world_date = { ...date };
    return { status: "pending", relationship };
  }
  if (relationship.pending_stage !== stage) throw new Error("relationship_stage_pending");
  if (relationship.pending_by === actorId) throw new Error("relationship_waiting_for_partner");

  relationship.status = "active";
  relationship.stage = stage;
  relationship.updated_world_date = { ...date };
  delete relationship.pending_stage;
  delete relationship.pending_by;
  const event = recordEvent(
    state,
    friendship ? "friendship_started" : "relationship_stage_changed",
    participants,
    friendship ? "A friendship was recorded by mutual confirmation." :
      `Adult relationship progression reached ${stage.replaceAll("_", " ")}.`,
    { relationship_id: relationshipId, stage },
  );
  addUnique(relationship.event_ids, event.event_id);
  let marriage: MarriageRecord | undefined;
  if (stage === "marriage") marriage = createMarriage(state, relationship, actor, target);
  return marriage ? { status: "confirmed", relationship, marriage } : { status: "confirmed", relationship };
}

function createMarriage(
  state: PersistentWorldState,
  relationship: RelationshipRecord,
  first: LifeTrackable,
  second: LifeTrackable,
): MarriageRecord {
  const firstId = characterIdOf(first);
  const secondId = characterIdOf(second);
  const date = currentDate(state);
  const householdId = newId("household");
  const familyId = newId("family");
  const marriageId = newId("marriage");
  const homeId = `home-${householdId}`;
  const originalFamilyIds = [...new Set([...first.family_ids, ...second.family_ids])];
  const familyName = `${first.name ?? "Family"}-${second.name ?? "Family"}`.slice(0, 64);
  const household: HouseholdRecord = {
    household_id: householdId,
    home_id: homeId,
    home_type: "Shared family household",
    neighborhood_id: "idera-quarter",
    family_ids: [familyId],
    member_ids: [firstId, secondId],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const family: FamilyRecord = {
    family_id: familyId,
    family_name: familyName,
    member_ids: [firstId, secondId],
    household_ids: [householdId],
    parent_family_ids: originalFamilyIds,
    life_event_ids: [],
    created_at: new Date().toISOString(),
  };
  state.households[householdId] = household;
  state.families[familyId] = family;
  for (const person of [first, second]) {
    person.household_id = householdId;
    person.family_ids = [...new Set([...person.family_ids, familyId])];
    person.home_id = homeId;
    const player = playerForCharacter(state, characterIdOf(person));
    if (player) {
      player.character.household_id = householdId;
      player.character.family_ids = [...new Set([...player.character.family_ids, familyId])];
      player.character.home_id = homeId;
      player.character.household = {
        id: householdId,
        home_id: homeId,
        neighborhood_id: household.neighborhood_id,
        home_type: household.home_type,
        rooms: ["Living area", "Bedroom", "Kitchen"],
        members: [
          householdMemberView(first, "spouse"),
          householdMemberView(second, "spouse"),
        ],
      };
      player.character.updated_at = new Date().toISOString();
      addUnique(player.character.relationship_ids, relationship.relationship_id);
    }
  }
  const spouseRelationship = addRelationship(state, "spouse", firstId, secondId, date);
  relationship.marriage_id = marriageId;
  const event = recordEvent(
    state,
    "marriage",
    [firstId, secondId],
    "A marriage was recorded with linked spouse, household and family records.",
    { marriage_id: marriageId, household_id: householdId, family_id: familyId },
    { familyId, householdId },
  );
  addUnique(relationship.event_ids, event.event_id);
  addUnique(spouseRelationship.event_ids, event.event_id);
  const marriage: MarriageRecord = {
    marriage_id: marriageId,
    spouse_ids: relationship.participants,
    world_date: { ...date },
    household_id: householdId,
    family_id: familyId,
    life_event_id: event.event_id,
    status: "active",
  };
  state.marriages[marriageId] = marriage;
  return marriage;
}

export function proposeRelationship(
  state: PersistentWorldState,
  actorId: string,
  targetId: string,
  stage: unknown,
): { status: "pending" | "confirmed"; relationship: RelationshipRecord; marriage?: MarriageRecord } {
  if (stage !== "friendship" && !loadLifeCatalog().relationship_rules.romantic_progression.includes(stage as RomanticStage)) {
    throw new Error("relationship_stage_invalid");
  }
  return recordRelationshipProposal(state, actorId, targetId, stage as RomanticStage | "friendship");
}

function livingHeirs(state: PersistentWorldState, deceasedId: string): string[] {
  const heirs = new Set<string>();
  for (const relation of Object.values(state.relationships)) {
    if (!relation.participants.includes(deceasedId)) continue;
    if (relation.type === "spouse") {
      const spouseId = relation.participants.find((id) => id !== deceasedId);
      const spouse = spouseId ? personFor(state, spouseId) : undefined;
      if (spouse && spouse.life_status !== "deceased") heirs.add(spouseId!);
    }
    if (relation.type === "parent_of" && relation.participants[0] === deceasedId) {
      const childId = relation.participants[1];
      const child = personFor(state, childId);
      if (child && child.life_status !== "deceased") heirs.add(childId);
    }
  }
  return [...heirs];
}

export function recordDeath(
  state: PersistentWorldState,
  personId: string,
  cause: unknown,
): { event: LifeEventRecord; inheritanceEvent: InheritanceEventRecord | null; alreadyDeceased: boolean } {
  if (!DEATH_CAUSES.includes(cause as DeathCauseCategory)) throw new Error("death_cause_invalid");
  const person = personFor(state, personId);
  if (!person) throw new Error("character_not_found");
  if (person.life_status === "deceased") {
    const prior = person.life_event_ids.map((id) => state.lifeEvents[id]).find((event) => event?.event_type === "death");
    if (!prior) throw new Error("deceased_record_missing_death_event");
    const inheritanceEvent = Object.values(state.inheritanceEvents).find((event) => event.deceased_person_id === personId) ?? null;
    return { event: prior, inheritanceEvent, alreadyDeceased: true };
  }
  const date = currentDate(state);
  const age = ageOnDate(person.date_of_birth, date);
  if (cause === "old_age" && age < loadLifeCatalog().old_age.review_minimum_age_years) {
    throw new Error("old_age_pathway_ineligible");
  }
  person.life_status = "deceased";
  person.death_cause = cause as DeathCauseCategory;
  person.death_date = { ...date };
  person.age_at_death = age;
  person.age = age;
  const heirs = livingHeirs(state, personId);
  const death = recordEvent(
    state,
    "death",
    [personId, ...heirs],
    "A life ended; the character record and relationships were preserved.",
    { cause_category: cause as DeathCauseCategory, age_at_death: age },
    eventOptionsFor(person, `death:${personId}`),
  );
  for (const relation of Object.values(state.relationships)) {
    if (relation.type === "spouse" && relation.participants.includes(personId) && relation.status === "active") {
      relation.status = "bereaved";
      const spouseId = relation.participants.find((id) => id !== personId);
      const spouse = spouseId ? personFor(state, spouseId) : undefined;
      if (spouse && spouseId) {
        const marriage = Object.values(state.marriages).find((entry) =>
          entry.spouse_ids.includes(personId) && entry.spouse_ids.includes(spouseId));
        if (marriage) marriage.status = "ended_by_death";
      }
    }
  }
  const hookEvent = recordEvent(
    state,
    "inheritance_hook_created",
    [personId, ...heirs],
    "An inheritance review hook was recorded; no assets were transferred.",
    { asset_reference_count: 0, transfer_performed: false },
    eventOptionsFor(person),
  );
  const inheritanceEvent: InheritanceEventRecord = {
    inheritance_event_id: newId("inheritance-event"),
    deceased_person_id: personId,
    world_date: { ...date },
    heir_person_ids: heirs,
    asset_reference_ids: [],
    status: "pending_review",
    life_event_id: hookEvent.event_id,
  };
  state.inheritanceEvents[inheritanceEvent.inheritance_event_id] = inheritanceEvent;
  addUnique(person.inheritance_event_ids, inheritanceEvent.inheritance_event_id);
  for (const heirId of heirs) {
    const heir = personFor(state, heirId);
    if (heir) addUnique(heir.inheritance_event_ids, inheritanceEvent.inheritance_event_id);
  }
  void death;
  return { event: death, inheritanceEvent, alreadyDeceased: false };
}

export function recordRetirement(
  state: PersistentWorldState,
  personId: string,
): LifeEventRecord {
  const person = personFor(state, personId);
  if (!person) throw new Error("character_not_found");
  if (person.life_status === "deceased") throw new Error("character_deceased");
  if (person.life_status === "retired") {
    const existing = person.life_event_ids.map((id) => state.lifeEvents[id]).find((event) => event?.event_type === "retirement");
    if (existing) return existing;
  }
  const date = currentDate(state);
  const age = ageOnDate(person.date_of_birth, date);
  if (age < loadLifeCatalog().old_age.retirement_minimum_age_years) throw new Error("retirement_age_ineligible");
  person.life_status = "retired";
  person.retirement_date = { ...date };
  return recordEvent(
    state,
    "retirement",
    [personId],
    "Retirement status was recorded for future employment-system integration.",
    { age },
    eventOptionsFor(person, `retirement:${personId}`),
  );
}

export function createChildForMarriage(
  state: PersistentWorldState,
  marriageId: string,
  requestedName: string | undefined,
  now: number,
): FamilyPersonRecord {
  const marriage = state.marriages[marriageId];
  if (!marriage || marriage.status !== "active") throw new Error("marriage_not_active");
  const parents = marriage.spouse_ids.map((id) => personFor(state, id));
  if (parents.some((parent) => !parent || parent.life_status === "deceased" || !isAdultAge(ageOnDate(parent.date_of_birth, currentDate(state))))) {
    throw new Error("childbirth_parent_unavailable");
  }
  const household = state.households[marriage.household_id];
  const family = state.families[marriage.family_id];
  if (!household || !family) throw new Error("marriage_family_records_missing");
  const personId = newId("npc");
  const childName = requestedName?.trim() || CHILD_NAMES[(Math.random() * CHILD_NAMES.length) | 0] || "Ayo";
  const date = currentDate(state);
  const child: FamilyPersonRecord = {
    person_id: personId,
    name: childName,
    age: 0,
    date_of_birth: { ...date },
    life_stage_id: lifeStageForAge(0).id,
    life_status: "alive",
    household_id: household.household_id,
    family_ids: [...new Set([...family.parent_family_ids, family.family_id])],
    life_event_ids: [],
    relationship_ids: [],
    last_life_processed_date: { ...date },
    inheritance_event_ids: [],
    family_role: "child",
    home_id: household.home_id,
    current_location: "home",
    education_level: "Not enrolled (NPC child)",
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  state.people[personId] = child;
  addUnique(household.member_ids, personId);
  addUnique(family.member_ids, personId);
  for (const parentId of marriage.spouse_ids) addUnique(state.families[family.family_id]!.member_ids, parentId);
  for (const parentId of marriage.spouse_ids) addRelationship(state, "parent_of", parentId, personId, date);
  const existingChildren = Object.values(state.relationships)
    .filter((relation) => relation.type === "parent_of" && marriage.spouse_ids.includes(relation.participants[0]))
    .map((relation) => relation.participants[1])
    .filter((id) => id !== personId);
  for (const siblingId of new Set(existingChildren)) {
    if (personFor(state, siblingId)) addRelationship(state, "sibling_of", personId, siblingId, date);
  }
  const event = recordEvent(
    state,
    "childbirth",
    [...marriage.spouse_ids, personId],
    "A child character was added to the family tree and shared household.",
    { child_id: personId, household_id: household.household_id, family_id: family.family_id },
    { familyId: family.family_id, householdId: household.household_id },
  );
  for (const parentId of marriage.spouse_ids) {
    const parent = personFor(state, parentId);
    if (parent) parent.updated_at = new Date(now).toISOString();
  }
  void event;
  return child;
}

export function canTakeActiveAction(person: Pick<CharacterLifeFields, "life_status">): boolean {
  return person.life_status !== "deceased";
}

export function isDeathCauseCategory(value: unknown): value is DeathCauseCategory {
  return typeof value === "string" && DEATH_CAUSES.includes(value as DeathCauseCategory);
}

export function worldClockForLife(
  day: number,
  minuteOfDay: number,
  millisecondOfMinute: number,
  worldDate: CalendarDate,
  updatedAt: string,
): WorldClockState {
  return { day, minute_of_day: minuteOfDay, millisecond_of_minute: millisecondOfMinute, world_date: worldDate, updated_at: updatedAt };
}

export function lifeStatusLabel(status: LifeStatus): string {
  return status === "deceased" ? "Deceased" : status === "retired" ? "Retired" : "Alive";
}

export function lifeEventDateLabel(event: LifeEventRecord): string {
  return calendarDateLabel(event.world_date);
}
