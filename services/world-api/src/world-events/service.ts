import type { CalendarDate } from "../life/types.js";
import type { Point2D } from "../multiplayer/types.js";
import type {
  WorldEvent,
  WorldEventType,
  WorldEventCategory,
  WorldEventPayload,
  WorldEventStatus,
  WorldEventPriority,
  WorldEventVisibility,
  GeographicScope,
  WorldEventDelivery,
  WorldEventEffect,
  WorldEventConsumer,
  WorldEventProcessingConfig,
  WorldStateSnapshot,
  PersistentWorldEventMaps,
  WorldEventHistoryQuery,
  CausalChain,
  CausalChainNode,
} from "./types.js";
import { WorldEventCatalogService } from "./catalog.js";

const uid = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const worldEventUid = (prefix: string): string =>
  `${prefix}_${uid()}_${Date.now().toString(36)}`;

export function emptyWorldEventMaps(): PersistentWorldEventMaps {
  return {
    worldEvents: {},
    worldEventDeliveries: {},
    worldEventEffects: {},
    worldEventConsumers: {},
    worldEventProcessingConfig: null,
    worldStateSnapshots: {},
  };
}

export function initializeWorldEventState(
  maps: PersistentWorldEventMaps,
  catalog: WorldEventCatalogService,
): void {
  if (!maps.worldEventProcessingConfig) {
    maps.worldEventProcessingConfig = catalog.getDefaultProcessingConfig();
  }

  // Register default consumers
  const defaultConsumers = catalog.getDefaultConsumers();
  for (const consumer of defaultConsumers) {
    if (!maps.worldEventConsumers[consumer.consumer_id]) {
      maps.worldEventConsumers[consumer.consumer_id] = consumer;
    }
  }
}

export interface CreateWorldEventParams {
  event_type: WorldEventType;
  category: WorldEventCategory;
  source_system: string;
  source_record_id?: string;
  source_actor_id?: string;
  source_actor_type?: "player" | "npc" | "system" | "government";
  geographic_scope: GeographicScope;
  payload: WorldEventPayload;
  title?: string;
  description?: string;
  priority?: WorldEventPriority;
  visibility?: WorldEventVisibility;
  parent_event_id?: string;
  correlation_id?: string;
  causation_chain?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export class WorldEventService {
  private readonly catalog: WorldEventCatalogService;
  private maps: PersistentWorldEventMaps;

  constructor(maps: PersistentWorldEventMaps, catalog?: WorldEventCatalogService) {
    this.maps = maps;
    this.catalog = catalog ?? new WorldEventCatalogService();
  }

  createEvent(params: CreateWorldEventParams, gameDate: CalendarDate): WorldEvent {
    // Validate category
    if (!this.catalog.isValidCategory(params.category)) {
      throw new Error("world_event_invalid_category");
    }

    // Validate source type authorization
    if (params.source_actor_type && !this.catalog.isSourceTypeAllowed(params.category, params.source_actor_type)) {
      throw new Error("world_event_unauthorized_source");
    }

    // Check idempotency
    const idempotencyKey = this.generateIdempotencyKey(params);
    const existingEvent = this.findEventByIdempotencyKey(idempotencyKey);
    if (existingEvent) {
      return existingEvent;
    }

    const now = new Date().toISOString();
    const effectiveAt = now;
    const priority = params.priority ?? "normal";
    const visibility = (params.visibility ?? this.catalog.getDefaultVisibility(params.category)) as WorldEventVisibility;

    const event: WorldEvent = {
      event_id: worldEventUid("evt"),
      event_type: params.event_type,
      category: params.category,
      schema_version: 1,
      source_system: params.source_system,
      ...(params.source_record_id && { source_record_id: params.source_record_id }),
      ...(params.source_actor_id && { source_actor_id: params.source_actor_id }),
      ...(params.source_actor_type && { source_actor_type: params.source_actor_type }),
      created_at: now,
      effective_at: effectiveAt,
      geographic_scope: params.geographic_scope,
      payload: params.payload,
      ...(params.title && { title: params.title }),
      ...(params.description && { description: params.description }),
      status: "active",
      priority,
      visibility,
      ...(params.parent_event_id && { parent_event_id: params.parent_event_id }),
      ...(params.correlation_id && { correlation_id: params.correlation_id }),
      ...(params.causation_chain && { causation_chain: params.causation_chain }),
      idempotency_key: idempotencyKey,
      ...(params.tags && { tags: params.tags }),
      ...(params.metadata && { metadata: params.metadata }),
      processing_attempts: 0,
    };

    this.maps.worldEvents[event.event_id] = event;

    // Create deliveries for relevant consumers
    this.createDeliveriesForEvent(event);

    return event;
  }

  private generateIdempotencyKey(params: CreateWorldEventParams): string {
    const keyParts = [
      params.event_type,
      params.source_system,
      params.source_record_id ?? "",
      JSON.stringify(params.payload),
    ];
    const keyString = keyParts.join("|");
    // Simple hash for idempotency
    let hash = 0;
    for (let i = 0; i < keyString.length; i++) {
      const char = keyString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `idem_${Math.abs(hash).toString(36)}`;
  }

  private findEventByIdempotencyKey(key: string): WorldEvent | undefined {
    return Object.values(this.maps.worldEvents).find(
      (e) => e.idempotency_key === key
    );
  }

  private createDeliveriesForEvent(event: WorldEvent): void {
    const consumers = Object.values(this.maps.worldEventConsumers).filter(
      (c) => c.enabled && this.consumerMatchesEvent(c, event)
    );

    const now = new Date().toISOString();

    for (const consumer of consumers) {
      const delivery: WorldEventDelivery = {
        delivery_id: worldEventUid("del"),
        event_id: event.event_id,
        consumer_system: consumer.consumer_system,
        consumer_id: consumer.consumer_id,
        delivered_at: now,
        status: "pending",
        retry_count: 0,
      };

      this.maps.worldEventDeliveries[delivery.delivery_id] = delivery;
    }
  }

  private consumerMatchesEvent(consumer: WorldEventConsumer, event: WorldEvent): boolean {
    // Check category subscription
    if (!consumer.subscribed_categories.includes(event.category)) {
      return false;
    }

    // Check specific type subscription (if defined)
    if (consumer.subscribed_types && consumer.subscribed_types.length > 0) {
      if (!consumer.subscribed_types.includes(event.event_type)) {
        return false;
      }
    }

    // Check geographic filter (if defined)
    if (consumer.geographic_filter && consumer.geographic_filter.length > 0) {
      if (!consumer.geographic_filter.includes(event.geographic_scope.type)) {
        return false;
      }
    }

    // Check priority filter (if defined)
    if (consumer.priority_filter && consumer.priority_filter.length > 0) {
      if (!consumer.priority_filter.includes(event.priority)) {
        return false;
      }
    }

    return true;
  }

  getEvent(eventId: string): WorldEvent | undefined {
    return this.maps.worldEvents[eventId];
  }

  queryEvents(query: WorldEventHistoryQuery): WorldEvent[] {
    let events = Object.values(this.maps.worldEvents);

    if (query.event_id) {
      events = events.filter((e) => e.event_id === query.event_id);
    }

    if (query.event_type) {
      events = events.filter((e) => e.event_type === query.event_type);
    }

    if (query.category) {
      events = events.filter((e) => e.category === query.category);
    }

    if (query.source_system) {
      events = events.filter((e) => e.source_system === query.source_system);
    }

    if (query.status) {
      events = events.filter((e) => e.status === query.status);
    }

    if (query.correlation_id) {
      events = events.filter((e) => e.correlation_id === query.correlation_id);
    }

    if (query.start_date) {
      events = events.filter((e) => e.created_at >= query.start_date!);
    }

    if (query.end_date) {
      events = events.filter((e) => e.created_at <= query.end_date!);
    }

    // Sort by creation date (newest first)
    events.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // Apply pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    events = events.slice(offset, offset + limit);

    return events;
  }

  updateEventStatus(eventId: string, status: WorldEventStatus): WorldEvent {
    const event = this.maps.worldEvents[eventId];
    if (!event) {
      throw new Error("world_event_not_found");
    }

    const updated: WorldEvent = {
      ...event,
      status,
    };

    this.maps.worldEvents[eventId] = updated;
    return updated;
  }

  recordEventEffect(effect: Omit<WorldEventEffect, "effect_id">): WorldEventEffect {
    const fullEffect: WorldEventEffect = {
      ...effect,
      effect_id: worldEventUid("eff"),
    };

    this.maps.worldEventEffects[fullEffect.effect_id] = fullEffect;
    return fullEffect;
  }

  getEventEffects(eventId: string): WorldEventEffect[] {
    return Object.values(this.maps.worldEventEffects).filter(
      (e) => e.event_id === eventId
    );
  }

  getEventDeliveries(eventId: string): WorldEventDelivery[] {
    return Object.values(this.maps.worldEventDeliveries).filter(
      (d) => d.event_id === eventId
    );
  }

  updateDeliveryStatus(
    deliveryId: string,
    status: WorldEventDelivery["status"],
    result?: string,
    error?: string,
  ): WorldEventDelivery {
    const delivery = this.maps.worldEventDeliveries[deliveryId];
    if (!delivery) {
      throw new Error("world_event_delivery_not_found");
    }

    const now = new Date().toISOString();
    const updated: WorldEventDelivery = {
      ...delivery,
      status,
      ...(status === "completed" || status === "failed" ? { processed_at: now } : {}),
      ...(result && { processing_result: result }),
      ...(error && { error_message: error }),
    };

    this.maps.worldEventDeliveries[deliveryId] = updated;
    return updated;
  }

  getPendingDeliveries(consumerSystem?: string, limit: number = 50): WorldEventDelivery[] {
    let deliveries = Object.values(this.maps.worldEventDeliveries).filter(
      (d) => d.status === "pending"
    );

    if (consumerSystem) {
      deliveries = deliveries.filter((d) => d.consumer_system === consumerSystem);
    }

    // Sort by event priority and creation time
    deliveries.sort((a, b) => {
      const eventA = this.maps.worldEvents[a.event_id];
      const eventB = this.maps.worldEvents[b.event_id];
      if (!eventA || !eventB) return 0;

      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[eventA.priority] - priorityOrder[eventB.priority];
      if (priorityDiff !== 0) return priorityDiff;

      return eventA.created_at.localeCompare(eventB.created_at);
    });

    return deliveries.slice(0, limit);
  }

  getCausalChain(rootEventId: string): CausalChain | null {
    const rootEvent = this.maps.worldEvents[rootEventId];
    if (!rootEvent) {
      return null;
    }

    const nodes: CausalChainNode[] = [];
    const visited = new Set<string>();
    const queue: string[] = [rootEventId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const event = this.maps.worldEvents[currentId];
      if (!event) continue;

      const effects = this.getEventEffects(currentId);

      // Find child events
      const childEvents = Object.values(this.maps.worldEvents).filter(
        (e) => e.parent_event_id === currentId
      );

      nodes.push({
        event_id: currentId,
        event_type: event.event_type,
        created_at: event.created_at,
        source_system: event.source_system,
        effects,
        child_events: childEvents.map((e) => e.event_id),
      });

      // Add children to queue
      for (const child of childEvents) {
        if (!visited.has(child.event_id)) {
          queue.push(child.event_id);
        }
      }
    }

    // Calculate chain depth
    const calculateDepth = (eventId: string, depth: number = 0): number => {
      const event = this.maps.worldEvents[eventId];
      if (!event || !event.parent_event_id) return depth;
      return calculateDepth(event.parent_event_id, depth + 1);
    };

    const maxDepth = Math.max(...nodes.map((n) => calculateDepth(n.event_id)));

    return {
      root_event_id: rootEventId,
      nodes,
      total_effects: nodes.reduce((sum, n) => sum + n.effects.length, 0),
      total_events: nodes.length,
      chain_depth: maxDepth,
    };
  }

  createSnapshot(gameDate: CalendarDate, stateHash: string): WorldStateSnapshot {
    const now = new Date().toISOString();
    const activeEvents = Object.values(this.maps.worldEvents).filter(
      (e) => e.status === "active"
    );
    const pendingDeliveries = Object.values(this.maps.worldEventDeliveries).filter(
      (d) => d.status === "pending"
    );
    const failedDeliveries = Object.values(this.maps.worldEventDeliveries).filter(
      (d) => d.status === "failed"
    );

    const snapshot: WorldStateSnapshot = {
      snapshot_id: worldEventUid("snap"),
      created_at: now,
      game_date: { ...gameDate },
      schema_version: 1,
      active_events_count: activeEvents.length,
      pending_deliveries_count: pendingDeliveries.length,
      failed_deliveries_count: failedDeliveries.length,
      state_hash: stateHash,
    };

    this.maps.worldStateSnapshots[snapshot.snapshot_id] = snapshot;
    return snapshot;
  }

  getRecentSnapshots(limit: number = 10): WorldStateSnapshot[] {
    const snapshots = Object.values(this.maps.worldStateSnapshots);
    snapshots.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return snapshots.slice(0, limit);
  }

  registerConsumer(consumer: Omit<WorldEventConsumer, "created_at" | "updated_at">): WorldEventConsumer {
    const now = new Date().toISOString();
    const fullConsumer: WorldEventConsumer = {
      ...consumer,
      created_at: now,
      updated_at: now,
    };

    this.maps.worldEventConsumers[consumer.consumer_id] = fullConsumer;
    return fullConsumer;
  }

  getConsumer(consumerId: string): WorldEventConsumer | undefined {
    return this.maps.worldEventConsumers[consumerId];
  }

  getActiveEventsByGeography(scope: GeographicScope): WorldEvent[] {
    return Object.values(this.maps.worldEvents).filter((event) => {
      if (event.status !== "active") return false;
      return this.geographyMatches(event.geographic_scope, scope);
    });
  }

  private geographyMatches(eventScope: GeographicScope, queryScope: GeographicScope): boolean {
    // Simple matching logic - can be enhanced
    if (eventScope.type === queryScope.type) {
      if (eventScope.location_id && queryScope.location_id) {
        return eventScope.location_id === queryScope.location_id;
      }
      if (eventScope.lga_id && queryScope.lga_id) {
        return eventScope.lga_id === queryScope.lga_id;
      }
      if (eventScope.state_id && queryScope.state_id) {
        return eventScope.state_id === queryScope.state_id;
      }
      return true;
    }

    // Check hierarchical relationships
    const scopeHierarchy: Record<string, number> = {
      building: 0,
      street: 1,
      neighborhood: 2,
      ward: 3,
      lga: 4,
      city: 5,
      state: 6,
      fct: 7,
      national: 8,
      regional: 9,
    };

    const eventLevel = scopeHierarchy[eventScope.type] ?? -1;
    const queryLevel = scopeHierarchy[queryScope.type] ?? -1;

    // If event is at a higher level (more general), it affects the query scope
    if (eventLevel >= queryLevel) {
      return true;
    }

    return false;
  }

  getCatalog(): WorldEventCatalogService {
    return this.catalog;
  }

  getAllMaps(): PersistentWorldEventMaps {
    return this.maps;
  }

  static errorMessage(errorCode: string): string {
    const messages: Record<string, string> = {
      world_event_invalid_category: "Invalid event category",
      world_event_unauthorized_source: "Unauthorized source for this event category",
      world_event_not_found: "World event not found",
      world_event_delivery_not_found: "World event delivery not found",
    };
    return messages[errorCode] ?? errorCode;
  }
}
