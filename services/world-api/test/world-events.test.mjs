import { describe, it } from "node:test";
import assert from "node:assert";
import {
  WorldEventService,
  WorldEventCatalogService,
  emptyWorldEventMaps,
  initializeWorldEventState,
} from "../dist/world-events/index.js";

describe("World Events System", () => {
  const catalog = new WorldEventCatalogService();
  const calendarDate = { year: 2025, month: 10, day: 10 };

  describe("WorldEventService", () => {
    it("creates a service with empty maps", () => {
      const maps = emptyWorldEventMaps();
      const service = new WorldEventService(maps, catalog);
      assert.ok(service);
      assert.deepStrictEqual(maps.worldEvents, {});
      assert.deepStrictEqual(maps.worldEventDeliveries, {});
      assert.deepStrictEqual(maps.worldEventEffects, {});
    });

    it("initializes world event state with default consumers", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      
      assert.ok(maps.worldEventProcessingConfig);
      assert.ok(Object.keys(maps.worldEventConsumers).length > 0);
      assert.ok(maps.worldEventConsumers["economy_consumer"]);
      assert.ok(maps.worldEventConsumers["business_consumer"]);
      assert.ok(maps.worldEventConsumers["transport_consumer"]);
      assert.ok(maps.worldEventConsumers["npc_consumer"]);
    });

    it("creates a government policy event", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      const event = service.createEvent({
        event_type: "policy_enacted",
        category: "government",
        source_system: "government",
        source_actor_id: "gov_official_1",
        source_actor_type: "government",
        geographic_scope: {
          type: "national",
        },
        payload: {
          policy_id: "policy_001",
          policy_name: "Tax Reform Act 2025",
          tax_rate_change: 0.05,
        },
        title: "New Tax Policy Enacted",
        description: "The federal government has enacted a new tax reform policy.",
        priority: "high",
      }, calendarDate);

      assert.ok(event);
      assert.strictEqual(event.event_type, "policy_enacted");
      assert.strictEqual(event.category, "government");
      assert.strictEqual(event.status, "active");
      assert.strictEqual(event.priority, "high");
      assert.strictEqual(event.visibility, "public");
      assert.ok(event.event_id);
      assert.ok(event.idempotency_key);
    });

    it("creates deliveries for relevant consumers", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      const event = service.createEvent({
        event_type: "tax_rate_changed",
        category: "economy",
        source_system: "economy",
        geographic_scope: {
          type: "national",
        },
        payload: {
          old_rate: 0.075,
          new_rate: 0.085,
        },
      }, calendarDate);

      const deliveries = service.getEventDeliveries(event.event_id);
      assert.ok(deliveries.length > 0);
      
      // Should have delivery to economy consumer
      const economyDelivery = deliveries.find(
        (d) => d.consumer_system === "economy"
      );
      assert.ok(economyDelivery);
      assert.strictEqual(economyDelivery.status, "pending");
    });

    it("prevents duplicate events via idempotency", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      const params = {
        event_type: "business_opened",
        category: "business",
        source_system: "businesses",
        source_record_id: "business_123",
        geographic_scope: {
          type: "lga",
          lga_id: "ng:lga:akure-south",
        },
        payload: {
          business_id: "business_123",
          business_name: "Test Business",
        },
      };

      const event1 = service.createEvent(params, calendarDate);
      const event2 = service.createEvent(params, calendarDate);

      assert.strictEqual(event1.event_id, event2.event_id);
    });

    it("queries events by category", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      service.createEvent({
        event_type: "policy_enacted",
        category: "government",
        source_system: "government",
        geographic_scope: { type: "national" },
        payload: { policy_id: "policy_1" },
      }, calendarDate);

      service.createEvent({
        event_type: "road_closed",
        category: "transport",
        source_system: "transportation",
        geographic_scope: { type: "street", location_id: "road_123" },
        payload: { road_id: "road_123" },
      }, calendarDate);

      const governmentEvents = service.queryEvents({ category: "government" });
      assert.strictEqual(governmentEvents.length, 1);
      assert.strictEqual(governmentEvents[0].category, "government");

      const transportEvents = service.queryEvents({ category: "transport" });
      assert.strictEqual(transportEvents.length, 1);
      assert.strictEqual(transportEvents[0].category, "transport");
    });

    it("updates event status", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      const event = service.createEvent({
        event_type: "business_opened",
        category: "business",
        source_system: "businesses",
        geographic_scope: { type: "lga", lga_id: "ng:lga:akure-south" },
        payload: { business_id: "business_456" },
      }, calendarDate);

      const updated = service.updateEventStatus(event.event_id, "completed");
      assert.strictEqual(updated.status, "completed");

      const retrieved = service.getEvent(event.event_id);
      assert.strictEqual(retrieved.status, "completed");
    });

    it("records event effects", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      const event = service.createEvent({
        event_type: "tax_rate_changed",
        category: "economy",
        source_system: "economy",
        geographic_scope: { type: "national" },
        payload: { old_rate: 0.075, new_rate: 0.085 },
      }, calendarDate);

      const effect = service.recordEventEffect({
        event_id: event.event_id,
        target_system: "businesses",
        target_record_id: "business_789",
        effect_type: "cost_increase",
        effect_data: {
          old_cost: 100000,
          new_cost: 108500,
          increase_percent: 8.5,
        },
        applied_at: new Date().toISOString(),
        status: "applied",
      });

      assert.ok(effect);
      assert.strictEqual(effect.event_id, event.event_id);
      assert.strictEqual(effect.target_system, "businesses");
      assert.strictEqual(effect.status, "applied");

      const effects = service.getEventEffects(event.event_id);
      assert.strictEqual(effects.length, 1);
    });

    it("updates delivery status", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      const event = service.createEvent({
        event_type: "road_closed",
        category: "transport",
        source_system: "transportation",
        geographic_scope: { type: "street", location_id: "road_abc" },
        payload: { road_id: "road_abc", reason: "construction" },
      }, calendarDate);

      const deliveries = service.getEventDeliveries(event.event_id);
      assert.ok(deliveries.length > 0);

      const delivery = deliveries[0];
      const updated = service.updateDeliveryStatus(
        delivery.delivery_id,
        "completed",
        "Successfully processed"
      );

      assert.strictEqual(updated.status, "completed");
      assert.strictEqual(updated.processing_result, "Successfully processed");
      assert.ok(updated.processed_at);
    });

    it("gets pending deliveries", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      service.createEvent({
        event_type: "policy_enacted",
        category: "government",
        source_system: "government",
        geographic_scope: { type: "national" },
        payload: { policy_id: "policy_test" },
      }, calendarDate);

      const pending = service.getPendingDeliveries();
      assert.ok(pending.length > 0);
      assert.strictEqual(pending[0].status, "pending");
    });

    it("builds causal chain", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      const rootEvent = service.createEvent({
        event_type: "policy_enacted",
        category: "government",
        source_system: "government",
        geographic_scope: { type: "national" },
        payload: { policy_id: "policy_root" },
      }, calendarDate);

      const childEvent = service.createEvent({
        event_type: "tax_rate_changed",
        category: "economy",
        source_system: "economy",
        geographic_scope: { type: "national" },
        payload: { old_rate: 0.075, new_rate: 0.085 },
        parent_event_id: rootEvent.event_id,
        correlation_id: rootEvent.event_id,
        causation_chain: [rootEvent.event_id],
      }, calendarDate);

      service.recordEventEffect({
        event_id: childEvent.event_id,
        target_system: "businesses",
        effect_type: "cost_increase",
        effect_data: { increase: 10 },
        applied_at: new Date().toISOString(),
        status: "applied",
      });

      const chain = service.getCausalChain(rootEvent.event_id);
      assert.ok(chain);
      assert.strictEqual(chain.root_event_id, rootEvent.event_id);
      assert.strictEqual(chain.total_events, 2);
      assert.strictEqual(chain.total_effects, 1);
      assert.strictEqual(chain.chain_depth, 1);
    });

    it("creates world state snapshots", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      service.createEvent({
        event_type: "business_opened",
        category: "business",
        source_system: "businesses",
        geographic_scope: { type: "lga", lga_id: "ng:lga:akure-south" },
        payload: { business_id: "business_snap" },
      }, calendarDate);

      const snapshot = service.createSnapshot(calendarDate, "hash_123");
      assert.ok(snapshot);
      assert.strictEqual(snapshot.active_events_count, 1);
      assert.strictEqual(snapshot.state_hash, "hash_123");

      const snapshots = service.getRecentSnapshots();
      assert.strictEqual(snapshots.length, 1);
    });

    it("filters events by geographic scope", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      service.createEvent({
        event_type: "road_closed",
        category: "transport",
        source_system: "transportation",
        geographic_scope: {
          type: "lga",
          lga_id: "ng:lga:akure-south",
        },
        payload: { road_id: "road_1" },
      }, calendarDate);

      service.createEvent({
        event_type: "road_closed",
        category: "transport",
        source_system: "transportation",
        geographic_scope: {
          type: "lga",
          lga_id: "ng:lga:ife-central",
        },
        payload: { road_id: "road_2" },
      }, calendarDate);

      const akureEvents = service.getActiveEventsByGeography({
        type: "lga",
        lga_id: "ng:lga:akure-south",
      });

      assert.strictEqual(akureEvents.length, 1);
      assert.strictEqual(akureEvents[0].geographic_scope.lga_id, "ng:lga:akure-south");
    });

    it("validates event category authorization", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      // Government events require government source
      assert.throws(() => {
        service.createEvent({
          event_type: "policy_enacted",
          category: "government",
          source_system: "government",
          source_actor_type: "player", // Not allowed
          geographic_scope: { type: "national" },
          payload: { policy_id: "policy_invalid" },
        }, calendarDate);
      }, /world_event_unauthorized_source/);
    });

    it("rejects invalid event category", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      assert.throws(() => {
        service.createEvent({
          event_type: "policy_enacted",
          category: "invalid_category",
          source_system: "government",
          geographic_scope: { type: "national" },
          payload: {},
        }, calendarDate);
      }, /world_event_invalid_category/);
    });

    it("registers custom consumer", () => {
      const maps = emptyWorldEventMaps();
      initializeWorldEventState(maps, catalog);
      const service = new WorldEventService(maps, catalog);

      const consumer = service.registerConsumer({
        consumer_id: "custom_consumer",
        consumer_name: "Custom Consumer",
        consumer_system: "custom",
        subscribed_categories: ["business", "economy"],
        subscribed_types: ["business_opened", "tax_rate_changed"],
        enabled: true,
      });

      assert.ok(consumer);
      assert.strictEqual(consumer.consumer_id, "custom_consumer");
      assert.strictEqual(consumer.enabled, true);

      const retrieved = service.getConsumer("custom_consumer");
      assert.ok(retrieved);
      assert.strictEqual(retrieved.consumer_name, "Custom Consumer");
    });
  });

  describe("WorldEventCatalogService", () => {
    it("loads catalog successfully", () => {
      const catalog = new WorldEventCatalogService();
      const rules = catalog.getRules();
      assert.ok(rules);
      assert.ok(rules.event_retention_days > 0);
      assert.ok(rules.max_retry_attempts > 0);
    });

    it("validates event categories", () => {
      const catalog = new WorldEventCatalogService();
      assert.strictEqual(catalog.isValidCategory("government"), true);
      assert.strictEqual(catalog.isValidCategory("economy"), true);
      assert.strictEqual(catalog.isValidCategory("invalid"), false);
    });

    it("validates event priorities", () => {
      const catalog = new WorldEventCatalogService();
      assert.strictEqual(catalog.isValidPriority("low"), true);
      assert.strictEqual(catalog.isValidPriority("normal"), true);
      assert.strictEqual(catalog.isValidPriority("high"), true);
      assert.strictEqual(catalog.isValidPriority("critical"), true);
      assert.strictEqual(catalog.isValidPriority("invalid"), false);
    });

    it("checks source type authorization", () => {
      const catalog = new WorldEventCatalogService();
      
      // Government category requires government source
      assert.strictEqual(
        catalog.isSourceTypeAllowed("government", "government"),
        true
      );
      assert.strictEqual(
        catalog.isSourceTypeAllowed("government", "player"),
        false
      );

      // Business category allows multiple sources
      assert.strictEqual(
        catalog.isSourceTypeAllowed("business", "player"),
        true
      );
      assert.strictEqual(
        catalog.isSourceTypeAllowed("business", "npc"),
        true
      );
    });

    it("gets default visibility for category", () => {
      const catalog = new WorldEventCatalogService();
      
      assert.strictEqual(
        catalog.getDefaultVisibility("government"),
        "public"
      );
      assert.strictEqual(
        catalog.getDefaultVisibility("npc"),
        "restricted"
      );
    });

    it("gets default consumers", () => {
      const catalog = new WorldEventCatalogService();
      const consumers = catalog.getDefaultConsumers();
      
      assert.ok(consumers.length > 0);
      assert.ok(consumers.find((c) => c.consumer_id === "economy_consumer"));
      assert.ok(consumers.find((c) => c.consumer_id === "business_consumer"));
    });

    it("gets default processing config", () => {
      const catalog = new WorldEventCatalogService();
      const config = catalog.getDefaultProcessingConfig();
      
      assert.ok(config);
      assert.ok(config.max_retry_attempts > 0);
      assert.ok(config.batch_size > 0);
      assert.ok(config.processing_timeout_seconds > 0);
    });
  });
});
