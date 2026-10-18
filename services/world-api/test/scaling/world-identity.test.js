import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateWorldIdentity,
  assertSingleAuthoritativeWorld,
  generateServerInstanceId,
  WORLD_ID,
  WORLD_METADATA,
} from "../../dist/scaling/world-identity.js";

test("world identity - validates correct world ID", () => {
  const result = validateWorldIdentity(WORLD_ID);
  assert.equal(result.valid, true);
  assert.equal(result.worldIdentity?.worldId, WORLD_ID);
  assert.equal(result.worldIdentity?.authoritative, true);
});

test("world identity - rejects incorrect world ID", () => {
  const result = validateWorldIdentity("nigeria-fake");
  assert.equal(result.valid, false);
  assert.ok(result.reason?.includes("World ID mismatch"));
});

test("world identity - warns on version mismatch but accepts", () => {
  const originalWarn = console.warn;
  let warnCalled = false;
  console.warn = () => { warnCalled = true; };

  const result = validateWorldIdentity(WORLD_ID, "0.0.1");
  assert.equal(result.valid, true);
  assert.equal(warnCalled, true);

  console.warn = originalWarn;
});

test("world identity - asserts single authoritative world", () => {
  assert.doesNotThrow(() => assertSingleAuthoritativeWorld(WORLD_ID));
  assert.doesNotThrow(() => assertSingleAuthoritativeWorld(undefined));
});

test("world identity - throws on duplicate world", () => {
  assert.throws(
    () => assertSingleAuthoritativeWorld("nigeria-duplicate"),
    /CRITICAL.*separate Nigerian world/
  );
});

test("world identity - generates unique server instance IDs", () => {
  const id1 = generateServerInstanceId();
  const id2 = generateServerInstanceId();
  assert.notEqual(id1, id2);
  assert.ok(id1.startsWith("server-"));
  assert.ok(id2.startsWith("server-"));
});

test("world metadata - contains required fields", () => {
  assert.equal(WORLD_METADATA.worldId, WORLD_ID);
  assert.equal(WORLD_METADATA.topology, "single-logical-world");
  assert.equal(WORLD_METADATA.authoritativeServer, true);
  assert.equal(WORLD_METADATA.supportsMultiplePhysicalServers, true);
  assert.ok(WORLD_METADATA.dataClassification);
});

test("world metadata - data classification is complete", () => {
  const { dataClassification } = WORLD_METADATA;
  assert.ok(dataClassification.global.length > 0);
  assert.ok(dataClassification.player.length > 0);
  assert.ok(dataClassification.financial.length > 0);
  assert.ok(dataClassification.regional.length > 0);
  assert.ok(dataClassification.transient.length > 0);
});
