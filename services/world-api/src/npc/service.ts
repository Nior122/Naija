import type { CalendarDate } from "../life/types.js";
import type { Point2D } from "../multiplayer/types.js";
import type {
  PersistentNPCMaps,
  NPCProfile,
  NPCRoutine,
  NPCActivityRecord,
  NPCNeedsState,
  NPCMovementRecord,
  NPCSocialInteraction,
  NPCPopulationConfig,
  NPCDecisionLog,
  NPCEventReaction,
  NPCSimulationState,
  NPCActivityType,
  NPCNeedType,
  NPCGoalType,
  NPCGoal,
  NPCPersonalityTrait,
  NPCSimulationStatus,
} from "./types.js";
import { NPCCatalogService } from "./catalog.js";

const uid = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const npcUid = (prefix: string): string => `${prefix}_${uid()}_${Date.now().toString(36)}`;

export function emptyNPCMaps(): PersistentNPCMaps {
  return {
    npcProfiles: {},
    npcRoutines: {},
    npcActivityRecords: {},
    npcNeeds: {},
    npcMovements: {},
    npcSocialInteractions: {},
    npcPopulationConfigs: {},
    npcDecisionLogs: {},
    npcEventReactions: {},
    npcSimulationState: null,
  };
}

export function initializeNPCWorldState(
  maps: PersistentNPCMaps,
  worldDate: CalendarDate,
): void {
  const now = new Date().toISOString();
  
  if (!maps.npcSimulationState) {
    maps.npcSimulationState = {
      last_tick_time: now,
      last_tick_game_time: { ...worldDate },
      total_ticks_processed: 0,
      active_npcs_count: 0,
      inactive_npcs_count: 0,
      distant_npcs_count: 0,
      last_population_generation: null,
      configuration: {
        tick_interval_minutes: 15,
        max_active_npcs_per_region: 1000,
        distant_npc_update_interval_minutes: 60,
        needs_decay_rate_per_hour: {
          hunger: 5.0,
          rest: 3.0,
          social: 2.0,
          safety: 0.5,
          income_satisfaction: 1.0,
          housing_satisfaction: 0.5,
          health: 0.2,
        },
        decision_interval_minutes: 30,
      },
    };
  }
}

export class NPCService {
  private readonly catalog: NPCCatalogService;
  private maps: PersistentNPCMaps;

  constructor(maps: PersistentNPCMaps, catalog?: NPCCatalogService) {
    this.maps = maps;
    this.catalog = catalog ?? new NPCCatalogService();
  }

  // NPC Profile Management
  createNPC(params: {
    person_id: string;
    name: string;
    age: number;
    life_stage_id: string;
    household_id: string;
    home_location_id: string;
    current_location_id: string;
    current_position?: Point2D;
    occupation?: string;
    employer_id?: string;
    employment_status?: "employed" | "unemployed" | "student" | "retired" | "seeking_work";
    education_level: string;
    personality_traits?: NPCPersonalityTrait[];
  }, worldDate: CalendarDate): NPCProfile {
    const npcId = npcUid("npc");
    const now = new Date().toISOString();
    
    const profile: NPCProfile = {
      npc_id: npcId,
      person_id: params.person_id,
      name: params.name,
      age: params.age,
      life_stage_id: params.life_stage_id,
      household_id: params.household_id,
      home_location_id: params.home_location_id,
      current_location_id: params.current_location_id,
      current_position: params.current_position ?? null,
      occupation: params.occupation ?? null,
      employer_id: params.employer_id ?? null,
      employment_status: params.employment_status ?? "unemployed",
      education_level: params.education_level,
      personality_traits: params.personality_traits ?? this.generateRandomPersonality(),
      current_activity: "idle",
      activity_started_at: now,
      needs: this.initializeNeeds(),
      goals: [],
      simulation_status: "inactive",
      last_simulation_time: now,
      last_decision_time: now,
      created_at: now,
      updated_at: now,
    };

    this.maps.npcProfiles[npcId] = profile;
    
    // Initialize needs state
    this.maps.npcNeeds[npcId] = {
      npc_id: npcId,
      hunger: 80,
      rest: 80,
      social: 70,
      safety: 85,
      income_satisfaction: params.occupation ? 75 : 30,
      housing_satisfaction: 75,
      health: 90,
      last_updated: now,
    };

    return profile;
  }

  private generateRandomPersonality(): NPCPersonalityTrait[] {
    const allTraits: NPCPersonalityTrait[] = [
      "sociable", "introverted", "ambitious", "conservative", 
      "adventurous", "hardworking", "leisure_oriented", "frugal", "spendthrift"
    ];
    
    const traits: NPCPersonalityTrait[] = [];
    const traitCount = 2;
    const available = [...allTraits];
    
    for (let i = 0; i < traitCount && available.length > 0; i++) {
      const index = Math.floor(Math.random() * available.length);
      const trait = available[index];
      if (trait) {
        traits.push(trait);
      }
      available.splice(index, 1);
    }
    
    return traits;
  }

  private initializeNeeds(): Record<NPCNeedType, number> {
    return {
      hunger: 80,
      rest: 80,
      social: 70,
      safety: 85,
      income_satisfaction: 75,
      housing_satisfaction: 75,
      health: 90,
    };
  }

  getNPC(npcId: string): NPCProfile | undefined {
    return this.maps.npcProfiles[npcId];
  }

  getNPCsByHousehold(householdId: string): NPCProfile[] {
    return Object.values(this.maps.npcProfiles).filter(
      (npc) => npc.household_id === householdId
    );
  }

  getNPCsByLocation(locationId: string): NPCProfile[] {
    return Object.values(this.maps.npcProfiles).filter(
      (npc) => npc.current_location_id === locationId
    );
  }

  getActiveNPCs(): NPCProfile[] {
    return Object.values(this.maps.npcProfiles).filter(
      (npc) => npc.simulation_status === "active"
    );
  }

  // Activity Management
  updateNPCActivity(params: {
    npc_id: string;
    activity_type: NPCActivityType;
    location_id?: string;
  }): void {
    const npc = this.maps.npcProfiles[params.npc_id];
    if (!npc) throw new Error("npc_not_found");

    const now = new Date().toISOString();
    
    // Log the activity
    const activityRecord: NPCActivityRecord = {
      activity_id: npcUid("activity"),
      npc_id: params.npc_id,
      activity_type: npc.current_activity,
      started_at: npc.activity_started_at,
      ended_at: now,
      location_id: npc.current_location_id,
      duration_minutes: Math.round(
        (new Date(now).getTime() - new Date(npc.activity_started_at).getTime()) / 60000
      ),
      outcome: null,
      notes: null,
    };

    this.maps.npcActivityRecords[activityRecord.activity_id] = activityRecord;

    // Update current activity
    this.maps.npcProfiles[params.npc_id] = {
      ...npc,
      current_activity: params.activity_type,
      current_location_id: params.location_id ?? npc.current_location_id,
      activity_started_at: now,
      updated_at: now,
    };
  }

  getActivityHistory(npcId: string, limit: number = 10): NPCActivityRecord[] {
    return Object.values(this.maps.npcActivityRecords)
      .filter((record) => record.npc_id === npcId)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
      .slice(0, limit);
  }

  // Needs Management
  updateNeeds(npcId: string, elapsedHours: number): void {
    const npc = this.maps.npcProfiles[npcId];
    const needs = this.maps.npcNeeds[npcId];
    if (!npc || !needs) return;

    const rules = this.catalog.getRules();
    const decayRates = rules.simulation.needs_decay_rate_per_hour;

    const now = new Date().toISOString();
    const updatedNeeds: NPCNeedsState = {
      ...needs,
      hunger: Math.max(0, needs.hunger - decayRates.hunger * elapsedHours),
      rest: Math.max(0, needs.rest - decayRates.rest * elapsedHours),
      social: Math.max(0, needs.social - decayRates.social * elapsedHours),
      safety: Math.max(0, needs.safety - decayRates.safety * elapsedHours),
      income_satisfaction: Math.max(0, needs.income_satisfaction - decayRates.income_satisfaction * elapsedHours),
      housing_satisfaction: Math.max(0, needs.housing_satisfaction - decayRates.housing_satisfaction * elapsedHours),
      health: Math.max(0, needs.health - decayRates.health * elapsedHours),
      last_updated: now,
    };

    this.maps.npcNeeds[npcId] = updatedNeeds;
  }

  satisfyNeed(npcId: string, needType: NPCNeedType, amount: number): void {
    const needs = this.maps.npcNeeds[npcId];
    if (!needs) return;

    const now = new Date().toISOString();
    const currentValue = needs[this.mapNeedTypeToKey(needType)];
    const newValue = Math.min(100, currentValue + amount);

    this.maps.npcNeeds[npcId] = {
      ...needs,
      [this.mapNeedTypeToKey(needType)]: newValue,
      last_updated: now,
    };
  }

  private mapNeedTypeToKey(needType: NPCNeedType): keyof Omit<NPCNeedsState, "npc_id" | "last_updated"> {
    const mapping: Record<NPCNeedType, keyof Omit<NPCNeedsState, "npc_id" | "last_updated">> = {
      hunger: "hunger",
      rest: "rest",
      social: "social",
      safety: "safety",
      income_satisfaction: "income_satisfaction",
      housing_satisfaction: "housing_satisfaction",
      health: "health",
    };
    return mapping[needType];
  }

  getNeeds(npcId: string): NPCNeedsState | undefined {
    return this.maps.npcNeeds[npcId];
  }

  // Routine Management
  createRoutine(params: {
    npc_id: string;
    name: string;
    description: string;
    schedule: Omit<NPCRoutine["schedule"][0], "entry_id" | "routine_id">[];
  }): NPCRoutine {
    const routineId = npcUid("routine");
    const now = new Date().toISOString();

    const routine: NPCRoutine = {
      routine_id: routineId,
      npc_id: params.npc_id,
      name: params.name,
      description: params.description,
      schedule: params.schedule.map((entry) => ({
        ...entry,
        entry_id: npcUid("entry"),
        routine_id: routineId,
      })),
      active: true,
      created_at: now,
      updated_at: now,
    };

    this.maps.npcRoutines[routineId] = routine;
    return routine;
  }

  getRoutine(routineId: string): NPCRoutine | undefined {
    return this.maps.npcRoutines[routineId];
  }

  getNPCRoutine(npcId: string): NPCRoutine | undefined {
    return Object.values(this.maps.npcRoutines).find(
      (routine) => routine.npc_id === npcId && routine.active
    );
  }

  // Simulation
  processNPCTick(npcId: string, gameTime: CalendarDate): void {
    const npc = this.maps.npcProfiles[npcId];
    if (!npc) return;

    const now = new Date().toISOString();
    const elapsedMinutes = Math.round(
      (new Date(now).getTime() - new Date(npc.last_simulation_time).getTime()) / 60000
    );
    const elapsedHours = elapsedMinutes / 60;

    // Update needs
    this.updateNeeds(npcId, elapsedHours);

    // Make decision based on current state
    this.makeNPCDecision(npcId, gameTime);

    // Update simulation time
    this.maps.npcProfiles[npcId] = {
      ...npc,
      last_simulation_time: now,
      updated_at: now,
    };
  }

  private makeNPCDecision(npcId: string, gameTime: CalendarDate): void {
    const npc = this.maps.npcProfiles[npcId];
    const needs = this.maps.npcNeeds[npcId];
    if (!npc || !needs) return;

    const now = new Date().toISOString();
    const decisions: string[] = [];

    // Check critical needs first
    if (needs.hunger < 30) {
      decisions.push("eat");
    }
    if (needs.rest < 30) {
      decisions.push("rest");
    }
    if (needs.social < 30) {
      decisions.push("socialize");
    }

    // Check routine
    const routine = this.getNPCRoutine(npcId);
    if (routine) {
      const currentHour = 12; // Simplified - would use actual game time
      const currentEntry = routine.schedule.find((entry) => {
        const entryStartMinutes = entry.start_hour * 60 + entry.start_minute;
        const entryEndMinutes = entry.end_hour * 60 + entry.end_minute;
        const currentMinutes = currentHour * 60;
        return currentMinutes >= entryStartMinutes && currentMinutes < entryEndMinutes;
      });

      if (currentEntry) {
        decisions.unshift(currentEntry.activity); // Priority to routine
      }
    }

    // Log decision
    const decisionLog: NPCDecisionLog = {
      decision_id: npcUid("decision"),
      npc_id: npcId,
      decision_time: now,
      decision_type: "activity_selection",
      context: {
        needs,
        current_activity: npc.current_activity,
        location: npc.current_location_id,
      },
      chosen_action: decisions[0] ?? "idle",
      alternatives_considered: decisions.slice(1),
      reasoning: decisions.length > 0 ? "Priority-based selection" : "No urgent needs",
      outcome: null,
    };

    this.maps.npcDecisionLogs[decisionLog.decision_id] = decisionLog;

    // Update last decision time
    this.maps.npcProfiles[npcId] = {
      ...npc,
      last_decision_time: now,
      updated_at: now,
    };
  }

  // Simulation State
  getSimulationState(): NPCSimulationState | null {
    return this.maps.npcSimulationState;
  }

  updateSimulationState(updates: Partial<NPCSimulationState>): void {
    if (!this.maps.npcSimulationState) return;

    this.maps.npcSimulationState = {
      ...this.maps.npcSimulationState,
      ...updates,
    };
  }

  processSimulationTick(gameTime: CalendarDate): void {
    if (!this.maps.npcSimulationState) return;

    const now = new Date().toISOString();
    const activeNPCs = this.getActiveNPCs();

    // Process each active NPC
    for (const npc of activeNPCs) {
      this.processNPCTick(npc.npc_id, gameTime);
    }

    // Update simulation state
    this.maps.npcSimulationState = {
      ...this.maps.npcSimulationState,
      last_tick_time: now,
      last_tick_game_time: { ...gameTime },
      total_ticks_processed: this.maps.npcSimulationState.total_ticks_processed + 1,
      active_npcs_count: activeNPCs.length,
      inactive_npcs_count: Object.values(this.maps.npcProfiles).filter(
        (npc) => npc.simulation_status === "inactive"
      ).length,
      distant_npcs_count: Object.values(this.maps.npcProfiles).filter(
        (npc) => npc.simulation_status === "distant"
      ).length,
    };
  }

  // Population Management
  createPopulationConfig(params: {
    name: string;
    target_location_id: string;
    household_count: number;
    persons_per_household_min: number;
    persons_per_household_max: number;
    age_distribution?: {
      child_percentage: number;
      young_adult_percentage: number;
      adult_percentage: number;
      elderly_percentage: number;
    };
    employment_rate?: number;
    seed?: number;
  }): NPCPopulationConfig {
    const configId = npcUid("popconfig");
    const now = new Date().toISOString();

    const config: NPCPopulationConfig = {
      population_id: configId,
      name: params.name,
      target_location_id: params.target_location_id,
      household_count: params.household_count,
      persons_per_household_min: params.persons_per_household_min,
      persons_per_household_max: params.persons_per_household_max,
      age_distribution: params.age_distribution ?? {
        child_percentage: 0.30,
        young_adult_percentage: 0.25,
        adult_percentage: 0.35,
        elderly_percentage: 0.10,
      },
      employment_rate: params.employment_rate ?? 0.65,
      created_at: now,
    };

    if (params.seed !== undefined) {
      config.seed = params.seed;
    }

    this.maps.npcPopulationConfigs[configId] = config;
    return config;
  }

  // Utility methods
  getCatalog(): NPCCatalogService {
    return this.catalog;
  }

  getAllNPCs(): NPCProfile[] {
    return Object.values(this.maps.npcProfiles);
  }

  setSimulationStatus(npcId: string, status: NPCSimulationStatus): void {
    const npc = this.maps.npcProfiles[npcId];
    if (!npc) throw new Error("npc_not_found");

    this.maps.npcProfiles[npcId] = {
      ...npc,
      simulation_status: status,
      updated_at: new Date().toISOString(),
    };
  }

  static errorMessage(errorCode: string): string {
    const messages: Record<string, string> = {
      npc_not_found: "NPC not found",
      npc_already_exists: "NPC already exists",
      invalid_activity: "Invalid activity type",
      invalid_need: "Invalid need type",
      routine_not_found: "Routine not found",
    };
    return messages[errorCode] ?? errorCode;
  }
}
