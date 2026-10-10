import type { CalendarDate } from "../life/types.js";
import type { Point2D } from "../multiplayer/types.js";

export type NPCActivityType = 
  | "sleeping"
  | "preparing_for_day"
  | "commuting"
  | "working"
  | "studying"
  | "shopping"
  | "socializing"
  | "eating"
  | "relaxing"
  | "entertainment"
  | "household_chores"
  | "childcare"
  | "traveling"
  | "idle"
  | "unemployed_seeking_work";

export type NPCNeedType = 
  | "hunger"
  | "rest"
  | "social"
  | "safety"
  | "income_satisfaction"
  | "housing_satisfaction"
  | "health";

export type NPCGoalType =
  | "find_employment"
  | "save_money"
  | "improve_education"
  | "start_business"
  | "find_housing"
  | "maintain_health"
  | "build_relationships"
  | "support_family"
  | "retire_comfortably";

export type NPCPersonalityTrait = 
  | "sociable"
  | "introverted"
  | "ambitious"
  | "conservative"
  | "adventurous"
  | "hardworking"
  | "leisure_oriented"
  | "frugal"
  | "spendthrift";

export type NPCSimulationStatus = "active" | "inactive" | "distant" | "suspended";

export interface NPCProfile {
  npc_id: string;
  person_id: string; // Links to FamilyPersonRecord
  name: string;
  age: number;
  life_stage_id: string;
  household_id: string;
  home_location_id: string;
  current_location_id: string;
  current_position: Point2D | null;
  occupation: string | null;
  employer_id: string | null;
  employment_status: "employed" | "unemployed" | "student" | "retired" | "seeking_work";
  education_level: string;
  personality_traits: NPCPersonalityTrait[];
  current_activity: NPCActivityType;
  activity_started_at: string;
  needs: Record<NPCNeedType, number>;
  goals: NPCGoal[];
  simulation_status: NPCSimulationStatus;
  last_simulation_time: string;
  last_decision_time: string;
  created_at: string;
  updated_at: string;
}

export interface NPCGoal {
  goal_id: string;
  goal_type: NPCGoalType;
  priority: number;
  progress: number;
  target_value?: number;
  current_value?: number;
  started_at: string;
  target_deadline?: string;
  completed_at: string | null;
  active: boolean;
}

export interface NPCRoutine {
  routine_id: string;
  npc_id: string;
  name: string;
  description: string;
  schedule: NPCScheduleEntry[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NPCScheduleEntry {
  entry_id: string;
  routine_id: string;
  day_of_week: number | null; // null = every day
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  activity: NPCActivityType;
  target_location_id: string | null;
  priority: number;
  conditions: NPCScheduleCondition[];
}

export interface NPCScheduleCondition {
  condition_type: "weather" | "health" | "employment" | "season" | "event";
  condition_value: string;
  operator: "equals" | "not_equals" | "greater_than" | "less_than";
}

export interface NPCActivityRecord {
  activity_id: string;
  npc_id: string;
  activity_type: NPCActivityType;
  started_at: string;
  ended_at: string | null;
  location_id: string;
  duration_minutes: number | null;
  outcome: string | null;
  notes: string | null;
}

export interface NPCNeedsState {
  npc_id: string;
  hunger: number; // 0-100
  rest: number; // 0-100
  social: number; // 0-100
  safety: number; // 0-100
  income_satisfaction: number; // 0-100
  housing_satisfaction: number; // 0-100
  health: number; // 0-100
  last_updated: string;
}

export interface NPCMovementRecord {
  movement_id: string;
  npc_id: string;
  from_location_id: string;
  to_location_id: string;
  transport_mode: string | null;
  vehicle_id: string | null;
  started_at: string;
  expected_arrival: string;
  actual_arrival: string | null;
  distance_km: number | null;
  status: "planned" | "in_progress" | "completed" | "cancelled";
}

export interface NPCSocialInteraction {
  interaction_id: string;
  npc_id: string;
  interaction_type: "conversation" | "transaction" | "relationship_event";
  with_npc_id: string | null;
  with_player_id: string | null;
  location_id: string;
  started_at: string;
  duration_minutes: number | null;
  outcome: string | null;
  relationship_change: number | null;
}

export interface NPCPopulationConfig {
  population_id: string;
  name: string;
  target_location_id: string;
  household_count: number;
  persons_per_household_min: number;
  persons_per_household_max: number;
  age_distribution: {
    child_percentage: number;
    young_adult_percentage: number;
    adult_percentage: number;
    elderly_percentage: number;
  };
  employment_rate: number;
  seed?: number;
  created_at: string;
}

export interface NPCDecisionLog {
  decision_id: string;
  npc_id: string;
  decision_time: string;
  decision_type: string;
  context: Record<string, unknown>;
  chosen_action: string;
  alternatives_considered: string[];
  reasoning: string;
  outcome: string | null;
}

export interface NPCEventReaction {
  reaction_id: string;
  npc_id: string;
  event_type: string;
  event_id: string;
  reaction_time: string;
  reaction_type: string;
  impact_on_needs: Partial<Record<NPCNeedType, number>>;
  behavior_change: string | null;
  processed: boolean;
}

export interface NPCSimulationState {
  last_tick_time: string;
  last_tick_game_time: CalendarDate;
  total_ticks_processed: number;
  active_npcs_count: number;
  inactive_npcs_count: number;
  distant_npcs_count: number;
  last_population_generation: string | null;
  configuration: {
    tick_interval_minutes: number;
    max_active_npcs_per_region: number;
    distant_npc_update_interval_minutes: number;
    needs_decay_rate_per_hour: Record<NPCNeedType, number>;
    decision_interval_minutes: number;
  };
}

export interface PersistentNPCMaps {
  npcProfiles: Record<string, NPCProfile>;
  npcRoutines: Record<string, NPCRoutine>;
  npcActivityRecords: Record<string, NPCActivityRecord>;
  npcNeeds: Record<string, NPCNeedsState>;
  npcMovements: Record<string, NPCMovementRecord>;
  npcSocialInteractions: Record<string, NPCSocialInteraction>;
  npcPopulationConfigs: Record<string, NPCPopulationConfig>;
  npcDecisionLogs: Record<string, NPCDecisionLog>;
  npcEventReactions: Record<string, NPCEventReaction>;
  npcSimulationState: NPCSimulationState | null;
}
