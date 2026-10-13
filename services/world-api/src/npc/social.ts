import type { CharacterRecord, PersistentWorldState } from "../multiplayer/types.js";
import type { FamilyPersonRecord, HouseholdRecord } from "../life/types.js";
import { ageOnDate, dateOfBirthForAge, isAdultAge, isValidDate, lifeStageForAge } from "../life/calendar.js";
import {
  activityStateFor,
  NPC_SOCIAL_ACTIONS,
  NPC_SOCIAL_ACTIVITIES,
  type NPCSocialCatalog,
} from "./social-catalog.js";
import type {
  NPCSocialAction,
  NPCSocialActivity,
  NPCSocialActivityRecord,
  NPCSocialBondRecord,
  NPCSocialEvent,
  NPCSocialProfile,
} from "./types.js";

/**
 * Stage 42: NPC activity and player-to-NPC social bonds.
 *
 * Identity: the NPC is the existing life/ person record (`state.people`). Residents are seeded once with fixed
 * `npc-nb-` IDs, so reconnects, map reloads, and restarts never regenerate them.
 * Activity: derived from `state.worldClock` (the in-game clock) and recorded only at transitions.
 * Bonds: stored on the NPC's person record, keyed by character_id. Only the server writes them. A client never
 * supplies an affinity, a cooldown, or a history entry.
 */

export const MAX_VISIBLE_NPCS = 24;
const MINUTES_PER_DAY = 1440;
const HOME_LOCATION = "home";

export class NPCSocialError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly dialogue?: string,
  ) {
    super(message);
    this.name = "NPCSocialError";
  }
}

const NPC_MESSAGES: Readonly<Record<string, string>> = {
  npc_action_unknown: "Choose a supported social action.",
  npc_id_invalid: "Choose a person to speak to first.",
  npc_not_found: "No one by that name is nearby to speak to.",
  npc_not_here: "They are not here right now.",
  npc_asleep: "They are asleep and cannot talk right now.",
  npc_turned_away: "They turn away and will not talk to you right now.",
  npc_already_acquainted: "You already know each other.",
  npc_no_contact_yet: "Greet or talk to them first.",
  npc_not_warm_enough: "They do not know you well enough to be acquainted yet.",
  npc_already_hostile: "They are already angry with you.",
  npc_not_hostile: "There is nothing to apologise for right now.",
  character_not_found: "Your character could not be found.",
};

export function npcSocialMessage(code: string): string {
  return NPC_MESSAGES[code] ?? "That social action is not available. Nothing was changed.";
}

const RELATION_LABELS: Readonly<Record<string, string>> = {
  parent: "Parent",
  guardian: "Guardian",
  sibling: "Sibling",
  child: "Child",
  relative: "Relative",
  neighbour: "Neighbour",
};

type Tier = "hostile" | "stranger" | "acquaintance" | "friend";

const TIER_LABELS: Readonly<Record<Tier, string>> = {
  hostile: "Hostile",
  stranger: "Stranger",
  acquaintance: "Acquaintance",
  friend: "Friend",
};

export interface SocialClock {
  readonly day: number;
  readonly minute_of_day: number;
}

function absoluteMinute(clock: SocialClock): number {
  return clock.day * MINUTES_PER_DAY + clock.minute_of_day;
}

function clampAffinity(value: number, catalog: NPCSocialCatalog): number {
  return Math.min(catalog.bonds.affinity_max, Math.max(catalog.bonds.affinity_min, value));
}

// ─── Residents ───────────────────────────────────────────────────────────────────────────────

/**
 * Seeds the neighbourhood residents from the catalog. A resident whose ID already exists is left as it is, so this
 * never regenerates a persisted identity. Returns the number of residents created.
 */
export function seedNeighbourResidents(state: PersistentWorldState, catalog: NPCSocialCatalog, now: number): number {
  const date = state.worldClock.world_date;
  if (!isValidDate(date)) throw new Error("invalid_world_date");
  const nowIso = new Date(now).toISOString();
  let created = 0;
  for (const resident of catalog.residents) {
    if (state.people[resident.person_id] !== undefined) continue;
    const householdId = `household-nb-${resident.household_key}`;
    const homeId = `home-nb-${resident.household_key}`;
    const household: HouseholdRecord = state.households[householdId] ?? {
      household_id: householdId,
      home_id: homeId,
      home_type: resident.home_type,
      neighborhood_id: catalog.neighbourhood_id,
      family_ids: [],
      member_ids: [],
      created_at: nowIso,
      updated_at: nowIso,
    };
    state.households[householdId] = household;
    const dob = dateOfBirthForAge(date, resident.age, resident.person_id);
    const age = ageOnDate(dob, date);
    const person: FamilyPersonRecord = {
      person_id: resident.person_id,
      name: resident.name,
      age,
      date_of_birth: dob,
      life_stage_id: lifeStageForAge(age).id,
      life_status: "alive",
      household_id: household.household_id,
      family_ids: [],
      life_event_ids: [],
      relationship_ids: [],
      last_life_processed_date: { ...date },
      inheritance_event_ids: [],
      family_role: "neighbour",
      home_id: household.home_id,
      current_location: HOME_LOCATION,
      education_level: age < 18 ? "Secondary education (NPC record)" : "Not recorded (NPC)",
      created_at: nowIso,
      updated_at: nowIso,
    };
    state.people[resident.person_id] = person;
    if (!household.member_ids.includes(person.person_id)) household.member_ids.push(person.person_id);
    created += 1;
  }
  return created;
}

// ─── Activity ───────────────────────────────────────────────────────────────────────────────

/** The activity a person should have at this clock time. Pure: it reads the catalog and clock only. */
export function derivedActivity(
  person: Pick<FamilyPersonRecord, "age">,
  clock: SocialClock,
  schoolDays: readonly number[],
  catalog: NPCSocialCatalog,
): { activity: NPCSocialActivity; location_id: string } {
  const hours = catalog.activity;
  const minute = clock.minute_of_day;
  const sleepStart = hours.sleep_start_hour * 60;
  const sleepEnd = hours.sleep_end_hour * 60;
  const asleep = sleepStart > sleepEnd
    ? minute >= sleepStart || minute < sleepEnd
    : minute >= sleepStart && minute < sleepEnd;
  if (asleep) return { activity: "sleeping", location_id: activityStateFor(catalog, "sleeping").location_id };
  // The same school-day rule the education system uses: (day - 1) % 7 indexes weekday_labels.
  const schoolDay = schoolDays.includes((clock.day - 1) % 7);
  if (schoolDay && person.age >= hours.school_age_min && person.age <= hours.school_age_max &&
    minute >= hours.school_start_hour * 60 && minute < hours.school_end_hour * 60) {
    return { activity: "studying", location_id: activityStateFor(catalog, "studying").location_id };
  }
  if (isAdultAge(person.age) && minute >= hours.socialising_start_hour * 60 && minute < hours.socialising_end_hour * 60) {
    return { activity: "socializing", location_id: activityStateFor(catalog, "socializing").location_id };
  }
  return { activity: "relaxing", location_id: activityStateFor(catalog, "relaxing").location_id };
}

/**
 * Brings every NPC's recorded activity up to date with the clock. A record is written only when the activity or
 * location changed, so the work per call is one comparison per NPC. Returns the number of records changed.
 */
export function syncNPCActivities(state: PersistentWorldState, catalog: NPCSocialCatalog, schoolDays: readonly number[]): number {
  let changed = 0;
  const clock = state.worldClock;
  for (const person of Object.values(state.people)) {
    if (person.life_status === "deceased") {
      if (person.npc_activity !== undefined) {
        delete person.npc_activity;
        changed += 1;
      }
      continue;
    }
    const next = derivedActivity(person, clock, schoolDays, catalog);
    const current = person.npc_activity;
    if (current !== undefined && current.activity === next.activity && current.location_id === next.location_id) continue;
    const record: NPCSocialActivityRecord = {
      activity: next.activity,
      location_id: next.location_id,
      since_day: clock.day,
      since_minute_of_day: clock.minute_of_day,
    };
    person.npc_activity = record;
    changed += 1;
  }
  return changed;
}

// ─── Presence and visibility ───────────────────────────────────────────────────────────────

interface Presence {
  readonly household: boolean;
  readonly here: boolean;
  readonly asleep: boolean;
  readonly visible: boolean;
  readonly activity: NPCSocialActivity;
  readonly location_id: string;
}

function isLiving(person: FamilyPersonRecord): boolean {
  return person.life_status !== "deceased" && person.npc_activity !== undefined;
}

/** Whether this character can see this NPC (same household, or the NPC is at the character's location). */
function presenceOf(person: FamilyPersonRecord, character: CharacterRecord): Presence | null {
  if (!isLiving(person)) return null;
  const activity = person.npc_activity!;
  const household = character.household_id !== "" && person.household_id === character.household_id;
  const here = activity.location_id === HOME_LOCATION
    ? household && character.current_location === HOME_LOCATION
    : character.current_location === activity.location_id;
  return {
    household,
    here,
    asleep: activity.activity === "sleeping",
    visible: household || here,
    activity: activity.activity,
    location_id: activity.location_id,
  };
}

// ─── Bonds ───────────────────────────────────────────────────────────────────────────────────

function newBond(character: CharacterRecord, person: FamilyPersonRecord, household: boolean, catalog: NPCSocialCatalog, now: number): NPCSocialBondRecord {
  const iso = new Date(now).toISOString();
  return {
    character_id: character.character_id,
    npc_id: person.person_id,
    affinity: household ? catalog.bonds.start_affinity_household : catalog.bonds.start_affinity_neighbour,
    acquainted: household,
    greeting_count: 0,
    talk_count: 0,
    interaction_count: 0,
    cooldowns: {},
    last_interaction_day: null,
    last_interaction_minute: null,
    history: [],
    next_event_seq: 1,
    created_at: iso,
    updated_at: iso,
  };
}

function storedBond(person: FamilyPersonRecord, characterId: string): NPCSocialBondRecord | undefined {
  return person.npc_social?.bonds[characterId];
}

function tierOf(bond: NPCSocialBondRecord, catalog: NPCSocialCatalog): Tier {
  if (bond.affinity <= catalog.bonds.hostile_at_or_below) return "hostile";
  if (bond.acquainted && bond.affinity >= catalog.bonds.friend_at_or_above && bond.talk_count >= catalog.bonds.friend_min_talks) {
    return "friend";
  }
  if (bond.acquainted) return "acquaintance";
  return "stranger";
}

function fill(line: string, playerName: string, npcName: string): string {
  return line.split("{player}").join(playerName).split("{name}").join(npcName);
}

function dialogueContextFor(action: NPCSocialAction, bond: NPCSocialBondRecord, household: boolean, tier: Tier): string {
  if (action === "greet") {
    if (tier === "hostile") return "hostile";
    if (tier === "friend") return "friend";
    if (household) return "family";
    return bond.interaction_count > 0 ? "returning" : "first_meeting";
  }
  if (action === "talk") {
    if (tier === "hostile") return "hostile";
    if (tier === "friend") return "friend";
    if (household) return "family";
    return tier === "acquaintance" ? "acquaintance" : "stranger";
  }
  return "success";
}

function pickLine(catalog: NPCSocialCatalog, action: NPCSocialAction, context: string, index: number): string {
  const lines = catalog.dialogue[action][context] ?? [];
  return lines[index % Math.max(1, lines.length)] ?? "";
}

/**
 * Returns the reason an action cannot be taken now, or null when it can. The check order is fixed: visibility, presence,
 * sleep, cooldown, then the action's own relationship rule.
 */
function refusalFor(
  action: NPCSocialAction,
  presence: Presence | null,
  bond: NPCSocialBondRecord,
  tier: Tier,
  nowMinute: number,
  catalog: NPCSocialCatalog,
): string | null {
  if (presence === null || !presence.visible) return "npc_not_found";
  if (!presence.here) return "npc_not_here";
  if (presence.asleep) return "npc_asleep";
  const last = bond.cooldowns[action];
  if (last !== undefined && nowMinute - last < catalog.actions[action].cooldown_minutes) return "npc_cooldown_active";
  switch (action) {
    case "greet":
    case "talk":
      return tier === "hostile" ? "npc_turned_away" : null;
    case "acquaint":
      if (tier === "hostile") return "npc_turned_away";
      if (bond.acquainted) return "npc_already_acquainted";
      if (bond.greeting_count + bond.talk_count === 0) return "npc_no_contact_yet";
      if (bond.affinity < catalog.bonds.acquaint_min_affinity) return "npc_not_warm_enough";
      return null;
    case "argue":
      return tier === "hostile" ? "npc_already_hostile" : null;
    case "apologise":
      return tier === "hostile" ? null : "npc_not_hostile";
    default:
      return "npc_action_unknown";
  }
}

/** The sentence for a cooldown refusal. Shared by the refusal and the action rows, so both say the same thing. */
function cooldownSentence(minutes: number): string {
  return `You spoke with them too recently. Try again in ${minutes} game minute${minutes === 1 ? "" : "s"}.`;
}

function cooldownMinutesLeft(bond: NPCSocialBondRecord, action: NPCSocialAction, nowMinute: number, catalog: NPCSocialCatalog): number {
  const last = bond.cooldowns[action];
  if (last === undefined) return 0;
  return Math.max(0, catalog.actions[action].cooldown_minutes - (nowMinute - last));
}

// ─── Profiles ───────────────────────────────────────────────────────────────────────────────

function profileFor(
  person: FamilyPersonRecord,
  character: CharacterRecord,
  presence: Presence,
  catalog: NPCSocialCatalog,
  clock: SocialClock,
): NPCSocialProfile {
  const bond = storedBond(person, character.character_id) ?? newBond(character, person, presence.household, catalog, 0);
  const tier = tierOf(bond, catalog);
  const nowMinute = absoluteMinute(clock);
  const state = activityStateFor(catalog, presence.activity);
  return {
    npc_id: person.person_id,
    name: person.name,
    age: person.age,
    family_role: person.family_role,
    relation_label: RELATION_LABELS[person.family_role] ?? "Relative",
    household_member: presence.household,
    activity: presence.activity,
    activity_label: state.label,
    location_id: presence.location_id,
    location_label: state.location_label,
    here: presence.here,
    asleep: presence.asleep,
    bond: {
      tier,
      tier_label: TIER_LABELS[tier],
      affinity: bond.affinity,
      acquainted: bond.acquainted,
      greeting_count: bond.greeting_count,
      talk_count: bond.talk_count,
      recognised: bond.interaction_count > 0,
      last_interaction_day: bond.last_interaction_day,
      last_interaction_minute: bond.last_interaction_minute,
    },
    actions: NPC_SOCIAL_ACTIONS.map((action) => {
      const reason = refusalFor(action, presence, bond, tier, nowMinute, catalog);
      const cooldownLeft = reason === "npc_cooldown_active" ? cooldownMinutesLeft(bond, action, nowMinute, catalog) : 0;
      return {
        action,
        label: catalog.actions[action].label,
        available: reason === null,
        reason_code: reason,
        reason_message: reason === null ? null : reason === "npc_cooldown_active" ? cooldownSentence(cooldownLeft) : npcSocialMessage(reason),
        cooldown_minutes_left: cooldownLeft,
      };
    }),
  };
}

function sortedPeople(state: PersistentWorldState): FamilyPersonRecord[] {
  return Object.values(state.people).sort((a, b) => a.person_id.localeCompare(b.person_id));
}

/** The NPCs this character can see right now, in a stable order. Bounded by MAX_VISIBLE_NPCS. */
export function visibleNPCProfiles(
  state: PersistentWorldState,
  character: CharacterRecord,
  catalog: NPCSocialCatalog,
  schoolDays: readonly number[],
): NPCSocialProfile[] {
  syncNPCActivities(state, catalog, schoolDays);
  const profiles: NPCSocialProfile[] = [];
  for (const person of sortedPeople(state)) {
    const presence = presenceOf(person, character);
    if (presence === null || !presence.visible) continue;
    profiles.push(profileFor(person, character, presence, catalog, state.worldClock));
  }
  profiles.sort((a, b) => Number(b.household_member) - Number(a.household_member) || a.npc_id.localeCompare(b.npc_id));
  return profiles.slice(0, MAX_VISIBLE_NPCS);
}

/** The summary and bounded history of one visible NPC for one character. Throws npc_not_found when not visible. */
export function npcBondView(
  state: PersistentWorldState,
  character: CharacterRecord,
  npcId: string,
  catalog: NPCSocialCatalog,
  schoolDays: readonly number[],
): { profile: NPCSocialProfile; history: NPCSocialEvent[] } {
  syncNPCActivities(state, catalog, schoolDays);
  const person = state.people[npcId];
  const presence = person === undefined ? null : presenceOf(person, character);
  if (person === undefined || presence === null || !presence.visible) throw new NPCSocialError("npc_not_found", npcSocialMessage("npc_not_found"));
  const bond = storedBond(person, character.character_id);
  return {
    profile: profileFor(person, character, presence, catalog, state.worldClock),
    history: bond ? [...bond.history].reverse() : [],
  };
}

// ─── Actions ───────────────────────────────────────────────────────────────────────────────

export interface NPCSocialOutcome {
  readonly action: NPCSocialAction;
  readonly npc_id: string;
  readonly npc_name: string;
  readonly dialogue: string;
  readonly message: string;
  readonly affinity_change: number;
  readonly profile: NPCSocialProfile;
  readonly event: NPCSocialEvent | null;
}

const SUCCESS_MESSAGES: Readonly<Record<NPCSocialAction, (name: string) => string>> = {
  greet: (name) => `You greet ${name}.`,
  talk: (name) => `You talk with ${name}.`,
  acquaint: (name) => `You and ${name} are now acquainted.`,
  argue: (name) => `You argue with ${name}. Their opinion of you falls.`,
  apologise: (name) => `You apologise to ${name}.`,
};

/**
 * Validates and applies one social action. Every check runs before anything is written. A refusal throws
 * NPCSocialError and leaves the state unchanged. The caller saves the state and replies only after the save succeeds.
 */
export function applyNPCSocialAction(
  state: PersistentWorldState,
  input: { character: CharacterRecord; npcId: string; action: string; now: number },
  catalog: NPCSocialCatalog,
  schoolDays: readonly number[],
): NPCSocialOutcome {
  const action = NPC_SOCIAL_ACTIONS.find((name) => name === input.action);
  if (action === undefined) throw new NPCSocialError("npc_action_unknown", npcSocialMessage("npc_action_unknown"));
  const character = input.character;
  syncNPCActivities(state, catalog, schoolDays);
  const person = state.people[input.npcId];
  if (person === undefined) throw new NPCSocialError("npc_not_found", npcSocialMessage("npc_not_found"));
  const presence = presenceOf(person, character);
  if (presence === null || !presence.visible) throw new NPCSocialError("npc_not_found", npcSocialMessage("npc_not_found"));
  const household = presence.household;
  const existing = storedBond(person, character.character_id);
  const bond = existing ?? newBond(character, person, household, catalog, input.now);
  const tierBefore = tierOf(bond, catalog);
  const nowMinute = absoluteMinute(state.worldClock);
  const reason = refusalFor(action, presence, bond, tierBefore, nowMinute, catalog);
  if (reason !== null) {
    if (reason === "npc_cooldown_active") {
      const minutes = cooldownMinutesLeft(bond, action, nowMinute, catalog);
      throw new NPCSocialError(reason, cooldownSentence(minutes));
    }
    const dialogue = reason === "npc_turned_away"
      ? fill(pickLine(catalog, action, dialogueContextFor(action, bond, household, tierBefore), bond.interaction_count), character.name, person.name)
      : undefined;
    throw new NPCSocialError(reason, npcSocialMessage(reason), dialogue);
  }

  // All checks have passed. From here on the bond is changed, so build the new record first and assign it last.
  const context = dialogueContextFor(action, bond, household, tierBefore);
  const line = fill(pickLine(catalog, action, context, bond.interaction_count), character.name, person.name);
  const affinityChange = catalog.actions[action].affinity_change;
  const affinity = clampAffinity(bond.affinity + affinityChange, catalog);
  const next: NPCSocialBondRecord = {
    ...bond,
    affinity,
    acquainted: bond.acquainted || action === "acquaint",
    greeting_count: bond.greeting_count + (action === "greet" ? 1 : 0),
    talk_count: bond.talk_count + (action === "talk" ? 1 : 0),
    interaction_count: bond.interaction_count + 1,
    cooldowns: { ...bond.cooldowns, [action]: nowMinute },
    last_interaction_day: state.worldClock.day,
    last_interaction_minute: state.worldClock.minute_of_day,
    history: [...bond.history],
    next_event_seq: bond.next_event_seq,
    updated_at: new Date(input.now).toISOString(),
  };
  const tierAfter = tierOf(next, catalog);
  const events: NPCSocialEvent["kind"][] = [];
  if (action === "greet" && bond.greeting_count + bond.talk_count === 0) events.push("first_met");
  if (action === "acquaint") events.push("acquainted");
  if (action === "argue") events.push("argued");
  if (action === "apologise") events.push("apologised");
  if (tierBefore !== "hostile" && tierAfter === "hostile") events.push("became_hostile");
  if (tierBefore === "hostile" && tierAfter !== "hostile") events.push("no_longer_hostile");
  if (tierBefore !== "friend" && tierAfter === "friend") events.push("became_friend");
  let lastEvent: NPCSocialEvent | null = null;
  const eventSummaries: Readonly<Record<NPCSocialEvent["kind"], string>> = {
    first_met: `You first met ${person.name}.`,
    acquainted: `You became acquainted with ${person.name}.`,
    argued: `You argued with ${person.name}.`,
    apologised: `You apologised to ${person.name}.`,
    became_hostile: `${person.name} became hostile toward you.`,
    no_longer_hostile: `${person.name} is no longer hostile toward you.`,
    became_friend: `${person.name} became your friend.`,
  };
  for (const kind of events) {
    lastEvent = {
      event_id: `${character.character_id}-${person.person_id}-${next.next_event_seq}`,
      seq: next.next_event_seq,
      kind,
      summary: eventSummaries[kind],
      affinity_after: affinity,
      world_day: state.worldClock.day,
      minute_of_day: state.worldClock.minute_of_day,
    };
    next.history.push(lastEvent);
    next.next_event_seq += 1;
  }
  while (next.history.length > catalog.bonds.history_limit) next.history.shift();

  const bonds = person.npc_social ?? { bonds: {} };
  bonds.bonds[character.character_id] = next;
  person.npc_social = bonds;
  const after = profileFor(person, character, presence, catalog, state.worldClock);
  return {
    action,
    npc_id: person.person_id,
    npc_name: person.name,
    dialogue: line,
    message: SUCCESS_MESSAGES[action](person.name),
    affinity_change: affinityChange,
    profile: after,
    event: lastEvent,
  };
}

// ─── Record validation ───────────────────────────────────────────────────────────────────────

const EVENT_KINDS: ReadonlySet<string> = new Set([
  "first_met", "acquainted", "argued", "apologised", "became_hostile", "no_longer_hostile", "became_friend",
]);

/**
 * Checks the Stage 42 fields of loaded records. Returns one message per problem (empty when valid). A missing optional
 * field is valid. An invalid field refuses the load, so bad data is never used silently.
 */
export function validateNPCSocialRecords(state: PersistentWorldState, catalog: NPCSocialCatalog): string[] {
  const problems: string[] = [];
  const characterIds = new Set(Object.values(state.players).map((player) => player.character.character_id));
  const actions: ReadonlySet<string> = new Set(NPC_SOCIAL_ACTIONS);
  const activities: ReadonlySet<string> = new Set(NPC_SOCIAL_ACTIVITIES);
  const isInt = (value: unknown): value is number => Number.isSafeInteger(value);
  for (const [id, person] of Object.entries(state.people)) {
    const activity = person.npc_activity as unknown;
    if (activity !== undefined) {
      const a = activity as Record<string, unknown>;
      if (typeof a !== "object" || a === null || !activities.has(a.activity as string) || typeof a.location_id !== "string" ||
        !isInt(a.since_day) || (a.since_day as number) < 1 || !isInt(a.since_minute_of_day) ||
        (a.since_minute_of_day as number) < 0 || (a.since_minute_of_day as number) >= MINUTES_PER_DAY) {
        problems.push(`npc ${id}: npc_activity is invalid`);
      }
    }
    const social = person.npc_social as unknown;
    if (social === undefined) continue;
    const bonds = typeof social === "object" && social !== null ? (social as { bonds?: unknown }).bonds : undefined;
    if (typeof bonds !== "object" || bonds === null || Array.isArray(bonds)) {
      problems.push(`npc ${id}: npc_social.bonds must be an object`);
      continue;
    }
    for (const [characterId, raw] of Object.entries(bonds as Record<string, unknown>)) {
      const b = raw as Record<string, unknown>;
      const history = Array.isArray(b?.history) ? b.history : null;
      const cooldowns = typeof b?.cooldowns === "object" && b.cooldowns !== null ? b.cooldowns as Record<string, unknown> : null;
      const ok = typeof b === "object" && b !== null && b.character_id === characterId && b.npc_id === id &&
        isInt(b.affinity) && (b.affinity as number) >= catalog.bonds.affinity_min && (b.affinity as number) <= catalog.bonds.affinity_max &&
        typeof b.acquainted === "boolean" && isInt(b.greeting_count) && (b.greeting_count as number) >= 0 &&
        isInt(b.talk_count) && (b.talk_count as number) >= 0 && isInt(b.interaction_count) && (b.interaction_count as number) >= 0 &&
        cooldowns !== null && Object.entries(cooldowns).every(([k, v]) => actions.has(k) && isInt(v) && (v as number) >= 0) &&
        history !== null && history.length <= catalog.bonds.history_limit &&
        history.every((e) => typeof e === "object" && e !== null && EVENT_KINDS.has((e as Record<string, unknown>).kind as string) &&
          isInt((e as Record<string, unknown>).seq) && typeof (e as Record<string, unknown>).summary === "string") &&
        isInt(b.next_event_seq) && (b.next_event_seq as number) >= 1 &&
        typeof b.created_at === "string" && typeof b.updated_at === "string";
      if (!ok) problems.push(`npc ${id}: bond for ${characterId} is invalid`);
      else if (!characterIds.has(characterId)) problems.push(`npc ${id}: bond refers to an unknown character`);
    }
  }
  return problems;
}
