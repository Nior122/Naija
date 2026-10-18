import type { CalendarDate } from "../life/types.js";
import type { Point2D } from "../multiplayer/types.js";

/**
 * Stage 21: Dynamic Nigerian World System - World Event Types
 */

export type WorldEventCategory =
  | "government"
  | "economy"
  | "business"
  | "infrastructure"
  | "transport"
  | "election"
  | "social"
  | "npc"
  | "culture"
  | "entertainment"
  | "crime"
  | "justice"
  | "emergency"
  | "environment";

export type WorldEventType =
  // Government events
  | "policy_enacted"
  | "policy_amended"
  | "policy_repealed"
  | "budget_approved"
  | "budget_amended"
  | "public_project_started"
  | "public_project_completed"
  | "public_project_cancelled"
  | "office_appointment"
  | "office_termination"
  
  // Economy events
  | "tax_rate_changed"
  | "price_index_changed"
  | "inflation_reported"
  | "interest_rate_changed"
  | "currency_fluctuation"
  | "market_disruption"
  
  // Business events
  | "business_opened"
  | "business_closed"
  | "business_expanded"
  | "business_contracted"
  | "business_hiring"
  | "business_layoffs"
  | "business_bankruptcy"
  | "product_shortage"
  | "product_surplus"
  
  // Infrastructure events
  | "infrastructure_project_started"
  | "infrastructure_project_completed"
  | "infrastructure_damaged"
  | "infrastructure_repaired"
  | "facility_opened"
  | "facility_closed"
  | "facility_expanded"
  
  // Transport events
  | "road_closed"
  | "road_reopened"
  | "road_restricted"
  | "bridge_closed"
  | "bridge_reopened"
  | "public_transport_disrupted"
  | "public_transport_restored"
  | "traffic_incident"
  
  // Election events
  | "election_scheduled"
  | "election_postponed"
  | "election_cancelled"
  | "campaign_started"
  | "campaign_ended"
  | "debate_scheduled"
  | "debate_completed"
  | "polling_opened"
  | "polling_closed"
  | "election_results_finalized"
  | "government_transition_started"
  | "government_transition_completed"
  
  // Social events
  | "public_announcement"
  | "protest_scheduled"
  | "protest_occurred"
  | "community_event_scheduled"
  | "community_event_occurred"
  | "cultural_festival"
  | "religious_event"
  
  // NPC events
  | "npc_migration"
  | "npc_employment_change"
  | "npc_business_opened"
  | "npc_business_closed"
  | "npc_household_formed"
  | "npc_household_dissolved"
  
  // Culture events
  | "cultural_event_announced"
  | "cultural_event_started"
  | "cultural_event_ended"
  | "community_project_started"
  | "community_project_completed"
  
  // Entertainment events
  | "media_published"
  | "entertainment_event_scheduled"
  | "entertainment_event_occurred"
  | "celebrity_announcement"
  
  // Crime events
  | "crime_incident_reported"
  | "crime_incident_resolved"
  | "crime_wave_reported"
  | "security_threat_detected"
  
  // Justice events
  | "court_case_filed"
  | "court_case_decided"
  | "law_enacted"
  | "law_amended"
  | "law_repealed"
  
  // Emergency events
  | "emergency_declared"
  | "emergency_resolved"
  | "natural_disaster"
  | "health_emergency"
  | "security_emergency"
  
  // Environment events
  | "weather_warning"
  | "weather_event"
  | "environmental_hazard"
  | "resource_discovered"
  | "resource_depleted";

export type GeographicScopeType =
  | "building"
  | "street"
  | "neighborhood"
  | "ward"
  | "lga"
  | "city"
  | "state"
  | "fct"
  | "national"
  | "regional";

export type WorldEventStatus =
  | "proposed"
  | "validated"
  | "active"
  | "processing"
  | "completed"
  | "resolved"
  | "archived"
  | "cancelled"
  | "failed";

export type WorldEventPriority = "low" | "normal" | "high" | "critical";

export type WorldEventVisibility =
  | "public"
  | "restricted"
  | "internal"
  | "admin_only";

export interface GeographicScope {
  readonly type: GeographicScopeType;
  readonly location_id?: string;
  readonly lga_id?: string;
  readonly state_id?: string;
  readonly coordinates?: {
    readonly center: Point2D;
    readonly radius_meters: number;
  };
  readonly affected_areas?: readonly string[];
}

export interface WorldEventPayload {
  readonly [key: string]: unknown;
}

export interface WorldEvent {
  readonly event_id: string;
  readonly event_type: WorldEventType;
  readonly category: WorldEventCategory;
  readonly schema_version: number;
  
  // Source information
  readonly source_system: string;
  readonly source_record_id?: string;
  readonly source_actor_id?: string;
  readonly source_actor_type?: "player" | "npc" | "system" | "government";
  
  // Timestamps
  readonly created_at: string;
  readonly effective_at: string;
  readonly expires_at?: string;
  
  // Geographic scope
  readonly geographic_scope: GeographicScope;
  
  // Event data
  readonly payload: WorldEventPayload;
  readonly description?: string;
  readonly title?: string;
  
  // Processing
  readonly status: WorldEventStatus;
  readonly priority: WorldEventPriority;
  readonly visibility: WorldEventVisibility;
  
  // Causal chain tracking
  readonly parent_event_id?: string;
  readonly correlation_id?: string;
  readonly causation_chain?: readonly string[];
  
  // Idempotency
  readonly idempotency_key: string;
  
  // Metadata
  readonly tags?: readonly string[];
  readonly metadata?: Record<string, unknown>;
  
  // Processing history
  readonly processing_attempts: number;
  readonly last_processed_at?: string;
  readonly processing_errors?: readonly string[];
}

export interface WorldEventDelivery {
  readonly delivery_id: string;
  readonly event_id: string;
  readonly consumer_system: string;
  readonly consumer_id?: string;
  readonly delivered_at: string;
  readonly processed_at?: string;
  readonly status: "pending" | "processing" | "completed" | "failed" | "skipped";
  readonly processing_result?: string;
  readonly error_message?: string;
  readonly retry_count: number;
  readonly next_retry_at?: string;
}

export interface WorldEventEffect {
  readonly effect_id: string;
  readonly event_id: string;
  readonly target_system: string;
  readonly target_record_id?: string;
  readonly effect_type: string;
  readonly effect_data: Record<string, unknown>;
  readonly applied_at: string;
  readonly rolled_back_at?: string;
  readonly status: "applied" | "rolled_back" | "pending";
}

export interface WorldEventConsumer {
  readonly consumer_id: string;
  readonly consumer_name: string;
  readonly consumer_system: string;
  readonly subscribed_categories: readonly WorldEventCategory[];
  readonly subscribed_types?: readonly WorldEventType[];
  readonly geographic_filter?: readonly GeographicScopeType[];
  readonly priority_filter?: readonly WorldEventPriority[];
  readonly enabled: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface WorldEventProcessingConfig {
  readonly max_retry_attempts: number;
  readonly retry_backoff_seconds: number;
  readonly retry_max_backoff_seconds: number;
  readonly batch_size: number;
  readonly processing_timeout_seconds: number;
  readonly dead_letter_queue_enabled: boolean;
}

export interface WorldStateSnapshot {
  readonly snapshot_id: string;
  readonly created_at: string;
  readonly game_date: CalendarDate;
  readonly schema_version: number;
  readonly active_events_count: number;
  readonly pending_deliveries_count: number;
  readonly failed_deliveries_count: number;
  readonly state_hash: string;
}

export interface WorldEventHistoryQuery {
  readonly event_id?: string;
  readonly event_type?: WorldEventType;
  readonly category?: WorldEventCategory;
  readonly source_system?: string;
  readonly geographic_scope?: GeographicScope;
  readonly status?: WorldEventStatus;
  readonly start_date?: string;
  readonly end_date?: string;
  readonly correlation_id?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CausalChainNode {
  readonly event_id: string;
  readonly event_type: WorldEventType;
  readonly created_at: string;
  readonly source_system: string;
  readonly effects: readonly WorldEventEffect[];
  readonly child_events: readonly string[];
}

export interface CausalChain {
  readonly root_event_id: string;
  readonly nodes: readonly CausalChainNode[];
  readonly total_effects: number;
  readonly total_events: number;
  readonly chain_depth: number;
}

export interface PersistentWorldEventMaps {
  worldEvents: Record<string, WorldEvent>;
  worldEventDeliveries: Record<string, WorldEventDelivery>;
  worldEventEffects: Record<string, WorldEventEffect>;
  worldEventConsumers: Record<string, WorldEventConsumer>;
  worldEventProcessingConfig: WorldEventProcessingConfig | null;
  worldStateSnapshots: Record<string, WorldStateSnapshot>;
}
