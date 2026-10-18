import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getDataClassification,
  requiresImmediatePersistence,
  requiresStrongConsistency,
  getDataTypesInCategory,
  getSynchronizationStrategy,
  DATA_CLASSIFICATIONS,
  DATA_CATEGORY_METADATA,
} from "../../dist/scaling/data-classification.js";

test("data classification - gets classification for known type", () => {
  const classification = getDataClassification("character");
  assert.equal(classification.category, "player");
  assert.equal(classification.consistencyLevel, "strong");
  assert.equal(classification.synchronizationStrategy, "on_demand");
  assert.equal(classification.persistenceRequirement, "immediate_durable");
});

test("data classification - returns default for unknown type", () => {
  const classification = getDataClassification("unknown_type");
  assert.equal(classification.category, "regional");
  assert.equal(classification.consistencyLevel, "eventual");
});

test("data classification - global data requires immediate persistence", () => {
  assert.equal(requiresImmediatePersistence("world_identity"), true);
  assert.equal(requiresImmediatePersistence("national_government"), true);
  assert.equal(requiresImmediatePersistence("election_results"), true);
});

test("data classification - player data requires immediate persistence", () => {
  assert.equal(requiresImmediatePersistence("character"), true);
  assert.equal(requiresImmediatePersistence("inventory"), true);
  assert.equal(requiresImmediatePersistence("education"), true);
});

test("data classification - financial data requires immediate persistence", () => {
  assert.equal(requiresImmediatePersistence("accounts"), true);
  assert.equal(requiresImmediatePersistence("transactions"), true);
  assert.equal(requiresImmediatePersistence("businesses"), true);
});

test("data classification - regional data uses periodic snapshot", () => {
  assert.equal(requiresImmediatePersistence("npc_state"), false);
  assert.equal(requiresImmediatePersistence("local_environment"), false);
});

test("data classification - transient data is memory only", () => {
  assert.equal(requiresImmediatePersistence("movement_updates"), false);
  assert.equal(requiresImmediatePersistence("presence"), false);
  assert.equal(requiresImmediatePersistence("session_state"), false);
});

test("data classification - global data requires strong consistency", () => {
  assert.equal(requiresStrongConsistency("world_identity"), true);
  assert.equal(requiresStrongConsistency("national_government"), true);
});

test("data classification - player data requires strong consistency", () => {
  assert.equal(requiresStrongConsistency("character"), true);
  assert.equal(requiresStrongConsistency("inventory"), true);
});

test("data classification - financial data requires strong consistency", () => {
  assert.equal(requiresStrongConsistency("accounts"), true);
  assert.equal(requiresStrongConsistency("transactions"), true);
});

test("data classification - regional data uses eventual consistency", () => {
  assert.equal(requiresStrongConsistency("npc_state"), false);
  assert.equal(requiresStrongConsistency("local_environment"), false);
});

test("data classification - transient data uses best effort", () => {
  assert.equal(requiresStrongConsistency("movement_updates"), false);
  assert.equal(requiresStrongConsistency("presence"), false);
});

test("data classification - gets data types in category", () => {
  const globalTypes = getDataTypesInCategory("global");
  assert.ok(globalTypes.includes("world_identity"));
  assert.ok(globalTypes.includes("national_government"));
  assert.ok(globalTypes.includes("election_results"));

  const playerTypes = getDataTypesInCategory("player");
  assert.ok(playerTypes.includes("character"));
  assert.ok(playerTypes.includes("inventory"));

  const financialTypes = getDataTypesInCategory("financial");
  assert.ok(financialTypes.includes("accounts"));
  assert.ok(financialTypes.includes("transactions"));

  const regionalTypes = getDataTypesInCategory("regional");
  assert.ok(regionalTypes.includes("npc_state"));
  assert.ok(regionalTypes.includes("local_environment"));

  const transientTypes = getDataTypesInCategory("transient");
  assert.ok(transientTypes.includes("movement_updates"));
  assert.ok(transientTypes.includes("presence"));
});

test("data classification - gets synchronization strategy", () => {
  assert.equal(getSynchronizationStrategy("world_identity"), "immediate_broadcast");
  assert.equal(getSynchronizationStrategy("character"), "on_demand");
  assert.equal(getSynchronizationStrategy("npc_state"), "regional_broadcast");
  assert.equal(getSynchronizationStrategy("nearby_players"), "interest_based");
  assert.equal(getSynchronizationStrategy("movement_updates"), "interest_based");
});

test("data classification - all classifications have required fields", () => {
  for (const [key, classification] of Object.entries(DATA_CLASSIFICATIONS)) {
    assert.ok(classification.category, `${key} missing category`);
    assert.ok(classification.consistencyLevel, `${key} missing consistencyLevel`);
    assert.ok(classification.description, `${key} missing description`);
    assert.ok(Array.isArray(classification.examples), `${key} missing examples`);
    assert.ok(classification.synchronizationStrategy, `${key} missing synchronizationStrategy`);
    assert.ok(classification.persistenceRequirement, `${key} missing persistenceRequirement`);
  }
});

test("data classification - category metadata is complete", () => {
  assert.ok(DATA_CATEGORY_METADATA.global);
  assert.ok(DATA_CATEGORY_METADATA.player);
  assert.ok(DATA_CATEGORY_METADATA.financial);
  assert.ok(DATA_CATEGORY_METADATA.regional);
  assert.ok(DATA_CATEGORY_METADATA.transient);

  for (const [key, metadata] of Object.entries(DATA_CATEGORY_METADATA)) {
    assert.ok(metadata.name, `${key} missing name`);
    assert.ok(metadata.description, `${key} missing description`);
    assert.ok(metadata.estimatedSize, `${key} missing estimatedSize`);
    assert.ok(metadata.updateFrequency, `${key} missing updateFrequency`);
    assert.ok(metadata.criticality, `${key} missing criticality`);
  }
});
