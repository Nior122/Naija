export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export type LifeStatus = "alive" | "retired" | "deceased";
export type DeathCauseCategory =
  | "old_age"
  | "illness"
  | "accident"
  | "violence"
  | "poisoning_or_exposure"
  | "other";

export type LifeEventType =
  | "character_created"
  | "family_created"
  | "birthday"
  | "life_stage_changed"
  | "friendship_started"
  | "relationship_stage_changed"
  | "marriage"
  | "childbirth"
  | "retirement"
  | "death"
  | "inheritance_hook_created";

export type RelationshipType =
  | "parent_of"
  | "guardian_of"
  | "sibling_of"
  | "friendship"
  | "romantic"
  | "spouse";

export type RomanticStage =
  | "meet"
  | "get_to_know"
  | "dating"
  | "commitment"
  | "marriage";

export interface LifeStageDefinition {
  readonly id: string;
  readonly label: string;
  readonly min_age_years: number;
  readonly max_age_years: number;
  readonly adult_relationships_allowed: boolean;
}

export interface LifeCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly calendar: {
    readonly id: string;
    readonly epoch_world_date: CalendarDate;
    readonly starting_world_day: number;
    readonly starting_minute_of_day: number;
    readonly real_milliseconds_per_game_minute: number;
    readonly week_starts_on: string;
    readonly month_names: readonly string[];
    readonly weekday_names: readonly string[];
    readonly february_29_birthday_observance: string;
  };
  readonly starting_character_ages: readonly number[];
  readonly life_stages: readonly LifeStageDefinition[];
  readonly relationship_rules: {
    readonly minimum_adult_age_years: number;
    readonly minor_friendship_max_age_gap_years: number;
    readonly romantic_progression: readonly RomanticStage[];
    readonly require_mutual_confirmation: boolean;
  };
  readonly old_age: {
    readonly retirement_minimum_age_years: number;
    readonly review_minimum_age_years: number;
    readonly automatic_death_enabled: boolean;
    readonly note: string;
  };
  readonly family_generation: {
    readonly starting_parent_age_min_years: number;
    readonly starting_parent_age_max_years: number;
    readonly starting_sibling_age_min_years: number;
    readonly starting_sibling_age_max_years: number;
    readonly starter_household_profiles: readonly {
      readonly id: string;
      readonly caregiver_roles: readonly ("parent" | "guardian")[];
      readonly sibling_count: number;
    }[];
    readonly max_family_tree_nodes_in_profile: number;
    readonly max_history_entries_in_profile: number;
  };
}

export interface CharacterLifeFields {
  date_of_birth: CalendarDate;
  life_stage_id: string;
  life_status: LifeStatus;
  household_id: string;
  family_ids: string[];
  life_event_ids: string[];
  relationship_ids: string[];
  last_life_processed_date: CalendarDate;
  inheritance_event_ids: string[];
  death_cause?: DeathCauseCategory;
  death_date?: CalendarDate;
  age_at_death?: number;
  retirement_date?: CalendarDate;
}

export interface FamilyPersonRecord extends CharacterLifeFields {
  person_id: string;
  name: string;
  age: number;
  family_role: "parent" | "guardian" | "sibling" | "child" | "relative";
  home_id: string;
  current_location: string;
  education_level: string;
  created_at: string;
  updated_at: string;
}

export interface HouseholdRecord {
  household_id: string;
  home_id: string;
  home_type: string;
  neighborhood_id: string;
  family_ids: string[];
  member_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface FamilyRecord {
  family_id: string;
  family_name: string;
  member_ids: string[];
  household_ids: string[];
  parent_family_ids: string[];
  life_event_ids: string[];
  created_at: string;
}

export interface RelationshipRecord {
  relationship_id: string;
  type: RelationshipType;
  participants: [string, string];
  status: "pending" | "active" | "ended" | "bereaved";
  created_world_date: CalendarDate;
  updated_world_date: CalendarDate;
  event_ids: string[];
  stage?: RomanticStage | "friendship";
  pending_stage?: RomanticStage | "friendship";
  pending_by?: string;
  marriage_id?: string;
}

export interface LifeEventRecord {
  event_id: string;
  event_type: LifeEventType;
  world_date: CalendarDate;
  world_day: number;
  minute_of_day: number;
  participant_ids: string[];
  summary: string;
  family_id?: string;
  household_id?: string;
  data: Record<string, string | number | boolean | null>;
}

export interface MarriageRecord {
  marriage_id: string;
  spouse_ids: [string, string];
  world_date: CalendarDate;
  household_id: string;
  family_id: string;
  life_event_id: string;
  status: "active" | "ended_by_death";
}

export interface InheritanceEventRecord {
  inheritance_event_id: string;
  deceased_person_id: string;
  world_date: CalendarDate;
  heir_person_ids: string[];
  asset_reference_ids: string[];
  status: "pending_review";
  life_event_id: string;
}

export interface LifeProfilePerson {
  person_id: string;
  name: string;
  age: number;
  date_of_birth: CalendarDate;
  life_stage_id: string;
  life_status: LifeStatus;
  family_role: string;
  current_location: string;
}

export interface LifeProfileRelationship {
  relationship_id: string;
  type: RelationshipType;
  status: RelationshipRecord["status"];
  stage: string | null;
  participants: [string, string];
  participant_names: [string, string];
}

export interface LifeProfileSnapshot {
  age: number;
  date_of_birth: CalendarDate;
  life_stage_id: string;
  life_stage_label: string;
  life_status: LifeStatus;
  household_id: string;
  family_ids: string[];
  family_members: LifeProfilePerson[];
  family_tree: {
    people: LifeProfilePerson[];
    relationships: LifeProfileRelationship[];
  };
  relationships: LifeProfileRelationship[];
  history: LifeEventRecord[];
  education: {
    level: string;
    school_id: string;
  };
  inheritance_event_ids: string[];
}
