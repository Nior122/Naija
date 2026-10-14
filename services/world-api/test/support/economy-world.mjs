// Shared world builders for the economy tests that build a state directly (Stage 46). These are the same helpers
// as `economy.test.mjs` (makeWorld and addPlayer), copied unchanged so the new tests do not depend on that file.
import { createHash, randomBytes } from "node:crypto";
import { initializeEconomyWorldState } from "../../dist/economy/service.js";
import { loadLifeCatalog, normalizeWorldClock, worldDayForDate } from "../../dist/life/calendar.js";

function makeWorld(date = { year: 2025, month: 1, day: 4 }) {
  const now = Date.UTC(2025, 0, 4, 10, 0, 0);
  const lifeCatalog = loadLifeCatalog();
  const day = worldDayForDate(date, lifeCatalog);
  const state = {
    schemaVersion: 4,
    worldId: "nigeria-main",
    worldClock: normalizeWorldClock({
      day,
      minute_of_day: 480,
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
    careerEmployers: {},
    careerVacancies: {},
    careerApplications: {},
    employments: {},
    workSessions: {},
    careerSkills: {},
    careerLicenses: {},
    careerReviews: {},
    careerLeaveRequests: {},
    careerEvents: {},
    salaryPayments: {},
    npcCareers: {},
    economyAccounts: {},
    economyTransactions: {},
    economyLoans: {},
    economyCreditScores: {},
    economyEvents: {},
  };
  initializeEconomyWorldState(state, now);
  return { state, now, date };
}

function addPlayer(world, name, overrides = {}) {
  const playerId = `player-${randomBytes(8).toString("hex")}`;
  const characterId = `character-${randomBytes(8).toString("hex")}`;
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const creationKey = randomBytes(32).toString("hex");
  const creationKeyHash = createHash("sha256").update(creationKey).digest("hex");
  const timestamp = new Date(world.now).toISOString();
  const age = overrides.age ?? 18;
  const character = {
    player_id: playerId,
    character_id: characterId,
    name,
    age,
    date_of_birth: { year: 2025 - age, month: 6, day: 15 },
    life_stage_id: age >= 25 ? "young-adult" : "secondary-school-youth",
    life_status: "alive",
    household_id: "",
    family_ids: [],
    life_event_ids: [],
    relationship_ids: [],
    last_life_processed_date: { ...world.date },
    inheritance_event_ids: [],
    character_type: "androgynous",
    appearance: { skin_tone: "#9b654d", hairstyle: "Short curls", clothing_color: "#27734a" },
    money: overrides.money ?? 5000,
    health: 100,
    energy: 100,
    hunger: 100,
    education_level: "SS3",
    school_id: "school:prototype-day-secondary",
    home_id: "home:generated",
    current_location: "town",
    position: { x: 720, y: 540 },
    direction: { x: 0, y: 1 },
    inventory: [],
    academic_scores: {},
    attendance: [],
    education_record: {
      schema_version: 1,
      student_id: characterId,
      current_school_id: "school:prototype-day-secondary",
      current_class_id: "class:jss1",
      enrollment_date: { year: 2024, month: 9, day: 1 },
      status: "active",
      attendance: { total_school_days: 0, days_present: 0, days_absent: 0, days_late: 0, marked_sessions: 0, present_sessions: 0, late_sessions: 0 },
      results: [],
      assessments: [],
      skills: [],
      qualifications: [],
      school_history: [],
      final_exam_record: null,
      tertiary_enrollment: null,
      admission_applications: [],
      scholarship_awards: [],
      generated_exam_content: [],
      final_exam_content_nonce: "",
    },
    reputation: 0,
    household: {},
    geographic_location: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const player = {
    playerId,
    tokenHash,
    creationKeyHash,
    recentRequestIds: [],
    createdAt: timestamp,
    lastSeen: timestamp,
    character,
  };
  world.state.players[playerId] = player;
  initializeEconomyWorldState(world.state, world.now);
  return { playerId, characterId, token, creationKey, player };
}

export { addPlayer, makeWorld };
