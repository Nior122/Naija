/**
 * Data Classification and Consistency
 * 
 * Categorizes persistent data by consistency requirements and access patterns.
 * Ensures appropriate synchronization strategies for each data type.
 */

export type DataCategory = "global" | "player" | "financial" | "regional" | "transient";

export type ConsistencyLevel = "strong" | "eventual" | "best_effort";

export interface DataClassification {
  readonly category: DataCategory;
  readonly consistencyLevel: ConsistencyLevel;
  readonly description: string;
  readonly examples: string[];
  readonly synchronizationStrategy: SynchronizationStrategy;
  readonly persistenceRequirement: PersistenceRequirement;
}

export type SynchronizationStrategy = 
  | "immediate_broadcast"
  | "regional_broadcast"
  | "interest_based"
  | "on_demand"
  | "batched";

export type PersistenceRequirement = 
  | "immediate_durable"
  | "durable_with_buffer"
  | "periodic_snapshot"
  | "memory_only";

/**
 * Data classification definitions for all major data types.
 */
export const DATA_CLASSIFICATIONS: Record<string, DataClassification> = {
  // Global authoritative data - Strong consistency required
  world_identity: {
    category: "global",
    consistencyLevel: "strong",
    description: "World identity and configuration",
    examples: ["worldId", "worldVersion", "topology"],
    synchronizationStrategy: "immediate_broadcast",
    persistenceRequirement: "immediate_durable",
  },
  national_government: {
    category: "global",
    consistencyLevel: "strong",
    description: "National government leadership and structure",
    examples: ["president", "ministers", "federal_offices"],
    synchronizationStrategy: "immediate_broadcast",
    persistenceRequirement: "immediate_durable",
  },
  election_results: {
    category: "global",
    consistencyLevel: "strong",
    description: "Election outcomes and certified results",
    examples: ["election_results", "certified_winners", "vote_counts"],
    synchronizationStrategy: "immediate_broadcast",
    persistenceRequirement: "immediate_durable",
  },
  currency_rules: {
    category: "global",
    consistencyLevel: "strong",
    description: "National currency and monetary rules",
    examples: ["currency_code", "inflation_rate", "interest_rates"],
    synchronizationStrategy: "immediate_broadcast",
    persistenceRequirement: "immediate_durable",
  },
  national_events: {
    category: "global",
    consistencyLevel: "strong",
    description: "Major national events affecting all players",
    examples: ["national_holidays", "major_announcements", "country_wide_events"],
    synchronizationStrategy: "immediate_broadcast",
    persistenceRequirement: "immediate_durable",
  },

  // Player-owned data - Strong consistency for important state
  character: {
    category: "player",
    consistencyLevel: "strong",
    description: "Player character identity and progression",
    examples: ["character_id", "name", "age", "appearance", "skills"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },
  inventory: {
    category: "player",
    consistencyLevel: "strong",
    description: "Player inventory and valuable items",
    examples: ["items", "equipment", "consumables"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },
  education: {
    category: "player",
    consistencyLevel: "strong",
    description: "Education records and qualifications",
    examples: ["school_enrollment", "grades", "qualifications"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },
  employment: {
    category: "player",
    consistencyLevel: "strong",
    description: "Employment history and current job",
    examples: ["employer", "position", "salary", "work_history"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },
  family: {
    category: "player",
    consistencyLevel: "strong",
    description: "Family relationships and household",
    examples: ["family_members", "household", "relationships"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },

  // Financial and ownership data - Strong consistency with idempotency
  accounts: {
    category: "financial",
    consistencyLevel: "strong",
    description: "Bank accounts and balances",
    examples: ["account_balance", "account_type", "account_status"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },
  transactions: {
    category: "financial",
    consistencyLevel: "strong",
    description: "Financial transactions with idempotency",
    examples: ["transaction_id", "amount", "type", "idempotency_key"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },
  businesses: {
    category: "financial",
    consistencyLevel: "strong",
    description: "Business ownership and operations",
    examples: ["business_id", "ownership", "revenue", "expenses"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },
  properties: {
    category: "financial",
    consistencyLevel: "strong",
    description: "Property ownership and rentals",
    examples: ["property_id", "ownership", "rental_agreements"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },
  loans: {
    category: "financial",
    consistencyLevel: "strong",
    description: "Loans and credit",
    examples: ["loan_id", "principal", "interest", "payments"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "immediate_durable",
  },

  // Regional simulation data - Eventual consistency within region
  npc_state: {
    category: "regional",
    consistencyLevel: "eventual",
    description: "NPC state and behavior",
    examples: ["npc_position", "npc_activity", "npc_needs"],
    synchronizationStrategy: "regional_broadcast",
    persistenceRequirement: "periodic_snapshot",
  },
  local_environment: {
    category: "regional",
    consistencyLevel: "eventual",
    description: "Local environment and weather",
    examples: ["weather", "time_of_day", "local_events"],
    synchronizationStrategy: "regional_broadcast",
    persistenceRequirement: "periodic_snapshot",
  },
  nearby_players: {
    category: "regional",
    consistencyLevel: "eventual",
    description: "Players in the same region",
    examples: ["player_position", "player_presence", "player_activity"],
    synchronizationStrategy: "interest_based",
    persistenceRequirement: "memory_only",
  },
  regional_simulation: {
    category: "regional",
    consistencyLevel: "eventual",
    description: "Regional simulation tasks and population activity",
    examples: ["simulation_tasks", "population_density", "regional_economy"],
    synchronizationStrategy: "regional_broadcast",
    persistenceRequirement: "periodic_snapshot",
  },

  // Transient data - Best effort, no durability required
  movement_updates: {
    category: "transient",
    consistencyLevel: "best_effort",
    description: "Frequent movement updates",
    examples: ["position", "velocity", "animation_state"],
    synchronizationStrategy: "interest_based",
    persistenceRequirement: "memory_only",
  },
  presence: {
    category: "transient",
    consistencyLevel: "best_effort",
    description: "Player presence and online status",
    examples: ["online_status", "current_region", "last_seen"],
    synchronizationStrategy: "interest_based",
    persistenceRequirement: "memory_only",
  },
  session_state: {
    category: "transient",
    consistencyLevel: "best_effort",
    description: "Session and connection state",
    examples: ["session_id", "connection_id", "heartbeat"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "memory_only",
  },
  temporary_interaction: {
    category: "transient",
    consistencyLevel: "best_effort",
    description: "Temporary interaction state",
    examples: ["dialogue_state", "minigame_state", "trade_offer"],
    synchronizationStrategy: "on_demand",
    persistenceRequirement: "memory_only",
  },
};

/**
 * Gets the classification for a data type.
 */
export function getDataClassification(dataType: string): DataClassification {
  const classification = DATA_CLASSIFICATIONS[dataType];
  if (!classification) {
    // Default to regional/eventual for unknown types
    return {
      category: "regional",
      consistencyLevel: "eventual",
      description: `Unknown data type: ${dataType}`,
      examples: [],
      synchronizationStrategy: "regional_broadcast",
      persistenceRequirement: "periodic_snapshot",
    };
  }
  return classification;
}

/**
 * Determines if a data type requires immediate durable persistence.
 */
export function requiresImmediatePersistence(dataType: string): boolean {
  const classification = getDataClassification(dataType);
  return classification.persistenceRequirement === "immediate_durable";
}

/**
 * Determines if a data type requires strong consistency.
 */
export function requiresStrongConsistency(dataType: string): boolean {
  const classification = getDataClassification(dataType);
  return classification.consistencyLevel === "strong";
}

/**
 * Gets all data types in a specific category.
 */
export function getDataTypesInCategory(category: DataCategory): string[] {
  return Object.entries(DATA_CLASSIFICATIONS)
    .filter(([_, classification]) => classification.category === category)
    .map(([dataType, _]) => dataType);
}

/**
 * Gets the appropriate synchronization strategy for a data type.
 */
export function getSynchronizationStrategy(dataType: string): SynchronizationStrategy {
  return getDataClassification(dataType).synchronizationStrategy;
}

/**
 * Data category metadata for documentation and monitoring.
 */
export const DATA_CATEGORY_METADATA = {
  global: {
    name: "Global Authoritative Data",
    description: "Data that must be consistent across all servers and regions",
    estimatedSize: "small",
    updateFrequency: "rare",
    criticality: "critical",
  },
  player: {
    name: "Player-Owned Data",
    description: "Data owned by individual players",
    estimatedSize: "medium",
    updateFrequency: "moderate",
    criticality: "high",
  },
  financial: {
    name: "Financial and Ownership Data",
    description: "Money, property, and business records",
    estimatedSize: "large",
    updateFrequency: "frequent",
    criticality: "critical",
  },
  regional: {
    name: "Regional Simulation Data",
    description: "Data specific to a geographic region",
    estimatedSize: "large",
    updateFrequency: "very_frequent",
    criticality: "medium",
  },
  transient: {
    name: "Transient Data",
    description: "Temporary data that can be lost without impact",
    estimatedSize: "variable",
    updateFrequency: "continuous",
    criticality: "low",
  },
} as const;
