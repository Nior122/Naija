import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NPCActivityType, NPCNeedType, NPCPersonalityTrait } from "./types.js";

interface NPCRules {
  population: {
    max_npcs_per_region: number;
    default_household_size_min: number;
    default_household_size_max: number;
    age_distribution: {
      child_percentage: number;
      young_adult_percentage: number;
      adult_percentage: number;
      elderly_percentage: number;
    };
    employment_rate: number;
    student_rate: number;
  };
  simulation: {
    tick_interval_minutes: number;
    distant_npc_update_interval_minutes: number;
    decision_interval_minutes: number;
    max_active_npcs_per_tick: number;
    needs_decay_rate_per_hour: Record<NPCNeedType, number>;
  };
  needs: {
    thresholds: {
      critical: number;
      low: number;
      moderate: number;
      high: number;
    };
    satisfaction_rates: {
      hunger_per_meal: number;
      rest_per_night: number;
      social_per_interaction: number;
      health_per_medical_visit: number;
    };
  };
  activities: {
    default_durations_minutes: Record<string, number>;
    need_satisfaction: Record<string, Record<NPCNeedType, number>>;
  };
  movement: {
    walking_speed_kmh: number;
    max_commuting_distance_km: number;
    preferred_transport_modes: string[];
    transport_cost_tolerance: number;
  };
  personality: {
    trait_count_per_npc: number;
    influence_on_decisions: number;
  };
  economy: {
    starting_money_range_ngn: {
      min: number;
      max: number;
    };
    daily_expense_rate_ngn: number;
    savings_rate_percentage: number;
  };
}

interface NPCOccupation {
  id: string;
  label: string;
  category: string;
  typical_hours: string;
  required_education: string;
  salary_range_ngn: [number, number];
}

interface NPCLocationType {
  id: string;
  label: string;
  activities_allowed: string[];
  need_modifiers: Partial<Record<NPCNeedType, number>>;
}

interface NPCRoutineTemplate {
  id: string;
  name: string;
  description: string;
  schedule: Array<{
    start_hour: number;
    start_minute: number;
    end_hour: number;
    end_minute: number;
    activity: NPCActivityType;
  }>;
}

export interface NPCCatalog {
  schema_version: 1;
  world_id: "nigeria-main";
  notice: string;
  rules: NPCRules;
  occupations: NPCOccupation[];
  location_types: NPCLocationType[];
  routine_templates: NPCRoutineTemplate[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOG_FILE = "game/data/npc/catalog.json";

function repositoryRoot(): string {
  return join(__dirname, "../../../..");
}

let cached: NPCCatalog | null = null;

export function loadNPCCatalog(): NPCCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as NPCCatalog;
  cached = parsed;
  return parsed;
}

export class NPCCatalogService {
  private catalog: NPCCatalog;

  constructor() {
    this.catalog = loadNPCCatalog();
  }

  getRules(): NPCRules {
    return this.catalog.rules;
  }

  getOccupations(): NPCOccupation[] {
    return this.catalog.occupations;
  }

  getOccupation(id: string): NPCOccupation | undefined {
    return this.catalog.occupations.find((occ) => occ.id === id);
  }

  getLocationTypes(): NPCLocationType[] {
    return this.catalog.location_types;
  }

  getLocationType(id: string): NPCLocationType | undefined {
    return this.catalog.location_types.find((loc) => loc.id === id);
  }

  getRoutineTemplates(): NPCRoutineTemplate[] {
    return this.catalog.routine_templates;
  }

  getRoutineTemplate(id: string): NPCRoutineTemplate | undefined {
    return this.catalog.routine_templates.find((template) => template.id === id);
  }

  getNeedThreshold(level: "critical" | "low" | "moderate" | "high"): number {
    return this.catalog.rules.needs.thresholds[level];
  }

  getActivityDuration(activity: NPCActivityType): number {
    return this.catalog.rules.activities.default_durations_minutes[activity] ?? 60;
  }

  getNeedSatisfaction(activity: NPCActivityType): Partial<Record<NPCNeedType, number>> {
    return this.catalog.rules.activities.need_satisfaction[activity] ?? {};
  }
}
