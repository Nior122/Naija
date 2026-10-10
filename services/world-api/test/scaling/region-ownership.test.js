import { test } from "node:test";
import assert from "node:assert/strict";
import {
  regionOwnershipRegistry,
  generateRegionPartitionId,
  DEFAULT_LEASE_DURATION_MS,
} from "../../dist/scaling/region-ownership.js";

test("region ownership - acquires ownership successfully", () => {
  const result = regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-1",
    requesterInstanceId: "server-test1",
    leaseDurationMs: 5000,
  });

  assert.equal(result.success, true);
  assert.ok(result.ownership);
  assert.equal(result.ownership.regionId, "test-region-1");
  assert.equal(result.ownership.ownerInstanceId, "server-test1");
  assert.equal(result.ownership.fencingToken, 1);
  assert.equal(result.ownership.status, "active");
});

test("region ownership - rejects duplicate ownership by different server", () => {
  // First server acquires
  regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-2",
    requesterInstanceId: "server-test2",
    leaseDurationMs: 5000,
  });

  // Second server tries to acquire same region
  const result = regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-2",
    requesterInstanceId: "server-test3",
    leaseDurationMs: 5000,
  });

  assert.equal(result.success, false);
  assert.ok(result.reason?.includes("already owned"));
  assert.ok(result.conflict);
  assert.equal(result.conflict.currentOwner, "server-test2");
});

test("region ownership - allows same server to extend lease", () => {
  // First acquisition
  const result1 = regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-3",
    requesterInstanceId: "server-test4",
    leaseDurationMs: 5000,
  });

  // Same server extends
  const result2 = regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-3",
    requesterInstanceId: "server-test4",
    leaseDurationMs: 10000,
  });

  assert.equal(result2.success, true);
  assert.ok(result2.ownership);
  assert.equal(result2.ownership.fencingToken, result1.ownership.fencingToken);
});

test("region ownership - validates ownership with fencing token", () => {
  const acquireResult = regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-4",
    requesterInstanceId: "server-test5",
    leaseDurationMs: 5000,
  });

  const validation = regionOwnershipRegistry.validateOwnership(
    "test-region-4",
    "server-test5",
    acquireResult.ownership.fencingToken
  );

  assert.equal(validation.valid, true);
});

test("region ownership - rejects invalid fencing token", () => {
  regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-5",
    requesterInstanceId: "server-test6",
    leaseDurationMs: 5000,
  });

  const validation = regionOwnershipRegistry.validateOwnership(
    "test-region-5",
    "server-test6",
    999 // Wrong token
  );

  assert.equal(validation.valid, false);
  assert.ok(validation.reason?.includes("Fencing token mismatch"));
});

test("region ownership - rejects wrong owner", () => {
  regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-6",
    requesterInstanceId: "server-test7",
    leaseDurationMs: 5000,
  });

  const validation = regionOwnershipRegistry.validateOwnership(
    "test-region-6",
    "server-test8", // Wrong owner
    1
  );

  assert.equal(validation.valid, false);
  assert.ok(validation.reason?.includes("owned by"));
});

test("region ownership - releases ownership", () => {
  regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-7",
    requesterInstanceId: "server-test9",
    leaseDurationMs: 5000,
  });

  const released = regionOwnershipRegistry.releaseOwnership(
    "test-region-7",
    "server-test9"
  );

  assert.equal(released, true);

  const ownership = regionOwnershipRegistry.getOwnership("test-region-7");
  assert.equal(ownership?.status, "released");
});

test("region ownership - rejects release by non-owner", () => {
  regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-8",
    requesterInstanceId: "server-test10",
    leaseDurationMs: 5000,
  });

  const released = regionOwnershipRegistry.releaseOwnership(
    "test-region-8",
    "server-test11" // Wrong owner
  );

  assert.equal(released, false);
});

test("region ownership - gets regions owned by server", () => {
  regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-9a",
    requesterInstanceId: "server-test12",
    leaseDurationMs: 5000,
  });

  regionOwnershipRegistry.acquireOwnership({
    regionId: "test-region-9b",
    requesterInstanceId: "server-test12",
    leaseDurationMs: 5000,
  });

  const regions = regionOwnershipRegistry.getRegionsOwnedBy("server-test12");
  assert.ok(regions.length >= 2);
  assert.ok(regions.some((r) => r.regionId === "test-region-9a"));
  assert.ok(regions.some((r) => r.regionId === "test-region-9b"));
});

test("region partition - generates valid partition IDs", () => {
  const partitionId = generateRegionPartitionId("lagos-mainland", 0);
  assert.equal(partitionId, "lagos-mainland:partition-0");

  const partitionId2 = generateRegionPartitionId("lagos-mainland", 3);
  assert.equal(partitionId2, "lagos-mainland:partition-3");
});

test("region partition - rejects invalid partition index", () => {
  assert.throws(
    () => generateRegionPartitionId("lagos-mainland", 10),
    /Invalid partition index/
  );

  assert.throws(
    () => generateRegionPartitionId("lagos-mainland", -1),
    /Invalid partition index/
  );
});

test("region ownership - default lease duration is reasonable", () => {
  assert.equal(DEFAULT_LEASE_DURATION_MS, 30000); // 30 seconds
});
