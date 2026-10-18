import { describe, test } from "node:test";
import assert from "node:assert";
import { NPCService, NPCCatalogService, emptyNPCMaps, initializeNPCWorldState } from "../dist/npc/index.js";

describe("NPC System", () => {
  const calendarDate = { year: 2025, month: 1, day: 1, hour: 12, minute: 0 };

  test("creates an NPC service with empty maps", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);
    assert.ok(service);
    assert.strictEqual(Object.keys(maps.npcProfiles).length, 0);
  });

  test("initializes NPC world state", () => {
    const maps = emptyNPCMaps();
    initializeNPCWorldState(maps, calendarDate);
    assert.ok(maps.npcSimulationState);
    assert.strictEqual(maps.npcSimulationState.total_ticks_processed, 0);
  });

  test("creates an NPC successfully", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-1",
      name: "John Doe",
      age: 30,
      life_stage_id: "adult",
      household_id: "household-1",
      home_location_id: "location-1",
      current_location_id: "location-1",
      education_level: "bachelor",
    }, calendarDate);

    assert.ok(npc);
    assert.strictEqual(npc.name, "John Doe");
    assert.strictEqual(npc.age, 30);
    assert.strictEqual(npc.employment_status, "unemployed");
    assert.strictEqual(maps.npcProfiles[npc.npc_id], npc);
  });

  test("creates an NPC with employment", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-2",
      name: "Jane Smith",
      age: 35,
      life_stage_id: "adult",
      household_id: "household-2",
      home_location_id: "location-2",
      current_location_id: "location-2",
      occupation: "teacher",
      employer_id: "school-1",
      employment_status: "employed",
      education_level: "master",
    }, calendarDate);

    assert.ok(npc);
    assert.strictEqual(npc.occupation, "teacher");
    assert.strictEqual(npc.employment_status, "employed");
  });

  test("retrieves NPC by ID", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-3",
      name: "Bob Johnson",
      age: 25,
      life_stage_id: "young_adult",
      household_id: "household-3",
      home_location_id: "location-3",
      current_location_id: "location-3",
      education_level: "secondary",
    }, calendarDate);

    const retrieved = service.getNPC(npc.npc_id);
    assert.strictEqual(retrieved, npc);
  });

  test("retrieves NPCs by household", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    service.createNPC({
      person_id: "person-4",
      name: "Alice Brown",
      age: 40,
      life_stage_id: "adult",
      household_id: "household-4",
      home_location_id: "location-4",
      current_location_id: "location-4",
      education_level: "bachelor",
    }, calendarDate);

    service.createNPC({
      person_id: "person-5",
      name: "Charlie Brown",
      age: 15,
      life_stage_id: "child",
      household_id: "household-4",
      home_location_id: "location-4",
      current_location_id: "location-4",
      education_level: "secondary",
    }, calendarDate);

    const householdNPCs = service.getNPCsByHousehold("household-4");
    assert.strictEqual(householdNPCs.length, 2);
  });

  test("updates NPC activity", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-6",
      name: "David Wilson",
      age: 28,
      life_stage_id: "adult",
      household_id: "household-5",
      home_location_id: "location-5",
      current_location_id: "location-5",
      education_level: "bachelor",
    }, calendarDate);

    service.updateNPCActivity({
      npc_id: npc.npc_id,
      activity_type: "working",
      location_id: "workplace-1",
    });

    const updated = service.getNPC(npc.npc_id);
    assert.strictEqual(updated.current_activity, "working");
    assert.strictEqual(updated.current_location_id, "workplace-1");
  });

  test("retrieves activity history", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-7",
      name: "Eva Martinez",
      age: 32,
      life_stage_id: "adult",
      household_id: "household-6",
      home_location_id: "location-6",
      current_location_id: "location-6",
      education_level: "master",
    }, calendarDate);

    service.updateNPCActivity({
      npc_id: npc.npc_id,
      activity_type: "sleeping",
      location_id: "location-6",
    });

    service.updateNPCActivity({
      npc_id: npc.npc_id,
      activity_type: "working",
      location_id: "workplace-2",
    });

    const history = service.getActivityHistory(npc.npc_id, 5);
    assert.ok(history.length >= 2);
  });

  test("updates NPC needs", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-8",
      name: "Frank Lee",
      age: 45,
      life_stage_id: "adult",
      household_id: "household-7",
      home_location_id: "location-7",
      current_location_id: "location-7",
      education_level: "bachelor",
    }, calendarDate);

    const initialNeeds = service.getNeeds(npc.npc_id);
    assert.ok(initialNeeds);
    assert.strictEqual(initialNeeds.hunger, 80);

    service.updateNeeds(npc.npc_id, 2); // 2 hours elapsed

    const updatedNeeds = service.getNeeds(npc.npc_id);
    assert.ok(updatedNeeds);
    assert.ok(updatedNeeds.hunger < initialNeeds.hunger);
  });

  test("satisfies NPC need", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-9",
      name: "Grace Kim",
      age: 29,
      life_stage_id: "adult",
      household_id: "household-8",
      home_location_id: "location-8",
      current_location_id: "location-8",
      education_level: "bachelor",
    }, calendarDate);

    service.updateNeeds(npc.npc_id, 5); // Reduce hunger
    const beforeNeeds = service.getNeeds(npc.npc_id);
    
    service.satisfyNeed(npc.npc_id, "hunger", 50);
    
    const afterNeeds = service.getNeeds(npc.npc_id);
    assert.ok(afterNeeds.hunger > beforeNeeds.hunger);
  });

  test("creates NPC routine", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-10",
      name: "Henry Chen",
      age: 33,
      life_stage_id: "adult",
      household_id: "household-9",
      home_location_id: "location-9",
      current_location_id: "location-9",
      education_level: "master",
    }, calendarDate);

    const routine = service.createRoutine({
      npc_id: npc.npc_id,
      name: "Standard Work Routine",
      description: "Typical 9-5 worker schedule",
      schedule: [
        {
          day_of_week: null,
          start_hour: 22,
          start_minute: 0,
          end_hour: 6,
          end_minute: 0,
          activity: "sleeping",
          target_location_id: "location-9",
          priority: 1,
          conditions: [],
        },
        {
          day_of_week: null,
          start_hour: 8,
          start_minute: 0,
          end_hour: 16,
          end_minute: 0,
          activity: "working",
          target_location_id: "workplace-3",
          priority: 1,
          conditions: [],
        },
      ],
    });

    assert.ok(routine);
    assert.strictEqual(routine.npc_id, npc.npc_id);
    assert.strictEqual(routine.schedule.length, 2);
  });

  test("retrieves NPC routine", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-11",
      name: "Iris Patel",
      age: 27,
      life_stage_id: "adult",
      household_id: "household-10",
      home_location_id: "location-10",
      current_location_id: "location-10",
      education_level: "bachelor",
    }, calendarDate);

    service.createRoutine({
      npc_id: npc.npc_id,
      name: "Student Routine",
      description: "Full-time student schedule",
      schedule: [
        {
          day_of_week: null,
          start_hour: 8,
          start_minute: 0,
          end_hour: 14,
          end_minute: 0,
          activity: "studying",
          target_location_id: "school-1",
          priority: 1,
          conditions: [],
        },
      ],
    });

    const routine = service.getNPCRoutine(npc.npc_id);
    assert.ok(routine);
    assert.strictEqual(routine.name, "Student Routine");
  });

  test("processes NPC tick", () => {
    const maps = emptyNPCMaps();
    initializeNPCWorldState(maps, calendarDate);
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-12",
      name: "Jack Thompson",
      age: 38,
      life_stage_id: "adult",
      household_id: "household-11",
      home_location_id: "location-11",
      current_location_id: "location-11",
      education_level: "bachelor",
    }, calendarDate);

    const originalSimulationTime = npc.last_simulation_time;
    
    // Wait a tiny bit to ensure timestamp difference
    const start = Date.now();
    while (Date.now() - start < 2) {
      // busy wait for 2ms
    }
    
    service.processNPCTick(npc.npc_id, calendarDate);

    const updatedNPC = service.getNPC(npc.npc_id);
    assert.ok(updatedNPC.last_simulation_time >= originalSimulationTime);
    assert.ok(updatedNPC.last_decision_time >= originalSimulationTime);
  });

  test("processes simulation tick for all active NPCs", () => {
    const maps = emptyNPCMaps();
    initializeNPCWorldState(maps, calendarDate);
    const service = new NPCService(maps);

    const npc1 = service.createNPC({
      person_id: "person-13",
      name: "Karen White",
      age: 31,
      life_stage_id: "adult",
      household_id: "household-12",
      home_location_id: "location-12",
      current_location_id: "location-12",
      education_level: "master",
    }, calendarDate);

    const npc2 = service.createNPC({
      person_id: "person-14",
      name: "Leo Garcia",
      age: 26,
      life_stage_id: "adult",
      household_id: "household-13",
      home_location_id: "location-13",
      current_location_id: "location-13",
      education_level: "bachelor",
    }, calendarDate);

    service.setSimulationStatus(npc1.npc_id, "active");
    service.setSimulationStatus(npc2.npc_id, "active");

    service.processSimulationTick(calendarDate);

    const state = service.getSimulationState();
    assert.ok(state);
    assert.strictEqual(state.total_ticks_processed, 1);
  });

  test("creates population configuration", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const config = service.createPopulationConfig({
      name: "Akure South Sample Population",
      target_location_id: "location-14",
      household_count: 10,
      persons_per_household_min: 2,
      persons_per_household_max: 6,
      age_distribution: {
        child_percentage: 0.30,
        young_adult_percentage: 0.25,
        adult_percentage: 0.35,
        elderly_percentage: 0.10,
      },
      employment_rate: 0.65,
      seed: 12345,
    });

    assert.ok(config);
    assert.strictEqual(config.name, "Akure South Sample Population");
    assert.strictEqual(config.household_count, 10);
    assert.strictEqual(config.seed, 12345);
  });

  test("sets NPC simulation status", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-15",
      name: "Mia Robinson",
      age: 24,
      life_stage_id: "young_adult",
      household_id: "household-14",
      home_location_id: "location-15",
      current_location_id: "location-15",
      education_level: "bachelor",
    }, calendarDate);

    service.setSimulationStatus(npc.npc_id, "active");
    let updated = service.getNPC(npc.npc_id);
    assert.strictEqual(updated.simulation_status, "active");

    service.setSimulationStatus(npc.npc_id, "inactive");
    updated = service.getNPC(npc.npc_id);
    assert.strictEqual(updated.simulation_status, "inactive");

    service.setSimulationStatus(npc.npc_id, "distant");
    updated = service.getNPC(npc.npc_id);
    assert.strictEqual(updated.simulation_status, "distant");
  });

  test("retrieves all NPCs", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    service.createNPC({
      person_id: "person-16",
      name: "Noah Clark",
      age: 42,
      life_stage_id: "adult",
      household_id: "household-15",
      home_location_id: "location-16",
      current_location_id: "location-16",
      education_level: "master",
    }, calendarDate);

    service.createNPC({
      person_id: "person-17",
      name: "Olivia Lewis",
      age: 36,
      life_stage_id: "adult",
      household_id: "household-16",
      home_location_id: "location-17",
      current_location_id: "location-17",
      education_level: "bachelor",
    }, calendarDate);

    const allNPCs = service.getAllNPCs();
    assert.ok(allNPCs.length >= 2);
  });

  test("retrieves active NPCs", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc1 = service.createNPC({
      person_id: "person-18",
      name: "Peter Hall",
      age: 39,
      life_stage_id: "adult",
      household_id: "household-17",
      home_location_id: "location-18",
      current_location_id: "location-18",
      education_level: "bachelor",
    }, calendarDate);

    const npc2 = service.createNPC({
      person_id: "person-19",
      name: "Quinn Adams",
      age: 34,
      life_stage_id: "adult",
      household_id: "household-18",
      home_location_id: "location-19",
      current_location_id: "location-19",
      education_level: "master",
    }, calendarDate);

    service.setSimulationStatus(npc1.npc_id, "active");
    service.setSimulationStatus(npc2.npc_id, "inactive");

    const activeNPCs = service.getActiveNPCs();
    assert.strictEqual(activeNPCs.length, 1);
    assert.strictEqual(activeNPCs[0].name, "Peter Hall");
  });

  test("catalog service loads occupations", () => {
    const catalog = new NPCCatalogService();
    const occupations = catalog.getOccupations();
    assert.ok(occupations.length > 0);
    assert.ok(catalog.getOccupation("teacher"));
  });

  test("catalog service loads location types", () => {
    const catalog = new NPCCatalogService();
    const locationTypes = catalog.getLocationTypes();
    assert.ok(locationTypes.length > 0);
    assert.ok(catalog.getLocationType("home"));
  });

  test("catalog service loads routine templates", () => {
    const catalog = new NPCCatalogService();
    const templates = catalog.getRoutineTemplates();
    assert.ok(templates.length > 0);
    assert.ok(catalog.getRoutineTemplate("standard_worker"));
  });

  test("catalog service provides activity durations", () => {
    const catalog = new NPCCatalogService();
    const duration = catalog.getActivityDuration("sleeping");
    assert.ok(duration > 0);
  });

  test("catalog service provides need thresholds", () => {
    const catalog = new NPCCatalogService();
    const critical = catalog.getNeedThreshold("critical");
    const low = catalog.getNeedThreshold("low");
    assert.ok(critical < low);
  });

  test("NPC generation includes personality traits", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-20",
      name: "Rachel Green",
      age: 30,
      life_stage_id: "adult",
      household_id: "household-19",
      home_location_id: "location-20",
      current_location_id: "location-20",
      education_level: "bachelor",
    }, calendarDate);

    assert.ok(npc.personality_traits);
    assert.ok(npc.personality_traits.length > 0);
    assert.ok(npc.personality_traits.length <= 2);
  });

  test("NPC needs are initialized correctly", () => {
    const maps = emptyNPCMaps();
    const service = new NPCService(maps);

    const npc = service.createNPC({
      person_id: "person-21",
      name: "Sam Taylor",
      age: 28,
      life_stage_id: "adult",
      household_id: "household-20",
      home_location_id: "location-21",
      current_location_id: "location-21",
      education_level: "master",
    }, calendarDate);

    const needs = service.getNeeds(npc.npc_id);
    assert.ok(needs);
    assert.strictEqual(needs.hunger, 80);
    assert.strictEqual(needs.rest, 80);
    assert.strictEqual(needs.social, 70);
    assert.strictEqual(needs.health, 90);
  });
});
