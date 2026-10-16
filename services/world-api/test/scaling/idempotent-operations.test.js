import { test } from "node:test";
import assert from "node:assert/strict";
import {
  idempotencyStore,
  generateIdempotencyKey,
  requiresIdempotency,
  FINANCIAL_OPERATION_TYPES,
} from "../../dist/scaling/idempotent-operations.js";

test("idempotent operations - executes operation successfully", async () => {
  const result = await idempotencyStore.executeWithIdempotency({
    idempotencyKey: "test-key-1",
    operationType: "money_transfer",
    playerId: "player-test1",
    request: { amount: 1000 },
    execute: async (req) => ({ success: true, newBalance: 5000 - req.amount }),
  });

  assert.equal(result.success, true);
  assert.ok(result.response);
  assert.equal(result.response.success, true);
  assert.equal(result.response.newBalance, 4000);
  assert.equal(result.duplicate, undefined);
});

test("idempotent operations - returns cached response for duplicate key", async () => {
  const key = "test-key-2";

  // First execution
  const result1 = await idempotencyStore.executeWithIdempotency({
    idempotencyKey: key,
    operationType: "money_transfer",
    playerId: "player-test2",
    request: { amount: 2000 },
    execute: async (req) => ({ transferred: req.amount }),
  });

  assert.equal(result1.success, true);
  assert.equal(result1.response.transferred, 2000);

  // Second execution with same key
  const result2 = await idempotencyStore.executeWithIdempotency({
    idempotencyKey: key,
    operationType: "money_transfer",
    playerId: "player-test2",
    request: { amount: 2000 },
    execute: async (req) => ({ transferred: req.amount }),
  });

  assert.equal(result2.success, true);
  assert.equal(result2.duplicate, true);
  assert.deepEqual(result2.response, result1.response);
});

test("idempotent operations - rejects pending operation", async () => {
  const key = "test-key-3";

  // Start first execution but don't complete it
  const promise1 = idempotencyStore.executeWithIdempotency({
    idempotencyKey: key,
    operationType: "money_transfer",
    playerId: "player-test3",
    request: { amount: 3000 },
    execute: async (req) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { transferred: req.amount };
    },
  });

  // Try to execute again while first is pending
  const result2 = await idempotencyStore.executeWithIdempotency({
    idempotencyKey: key,
    operationType: "money_transfer",
    playerId: "player-test3",
    request: { amount: 3000 },
    execute: async (req) => ({ transferred: req.amount }),
  });

  assert.equal(result2.success, false);
  assert.ok(result2.reason?.includes("already in progress"));

  // Wait for first to complete
  await promise1;
});

test("idempotent operations - allows retry after failure", async () => {
  const key = "test-key-4";
  let attemptCount = 0;

  // First execution fails
  const result1 = await idempotencyStore.executeWithIdempotency({
    idempotencyKey: key,
    operationType: "money_transfer",
    playerId: "player-test4",
    request: { amount: 4000 },
    execute: async () => {
      attemptCount++;
      throw new Error("Simulated failure");
    },
  });

  assert.equal(result1.success, false);
  assert.equal(attemptCount, 1);

  // Second execution succeeds
  const result2 = await idempotencyStore.executeWithIdempotency({
    idempotencyKey: key,
    operationType: "money_transfer",
    playerId: "player-test4",
    request: { amount: 4000 },
    execute: async () => {
      attemptCount++;
      return { success: true };
    },
  });

  assert.equal(result2.success, true);
  assert.equal(attemptCount, 2);
});

test("idempotent operations - gets operation status", async () => {
  const key = "test-key-5";

  await idempotencyStore.executeWithIdempotency({
    idempotencyKey: key,
    operationType: "money_transfer",
    playerId: "player-test5",
    request: { amount: 5000 },
    execute: async () => ({ success: true }),
  });

  const status = idempotencyStore.getOperationStatus(key);
  assert.ok(status);
  assert.equal(status.status, "completed");
  assert.equal(status.operationType, "money_transfer");
  assert.equal(status.playerId, "player-test5");
});

test("idempotent operations - generates unique idempotency keys", () => {
  const key1 = generateIdempotencyKey();
  const key2 = generateIdempotencyKey();

  assert.notEqual(key1, key2);
  assert.ok(key1.startsWith("idem-"));
  assert.ok(key2.startsWith("idem-"));
});

test("idempotent operations - identifies financial operations requiring idempotency", () => {
  assert.equal(requiresIdempotency("money_transfer"), true);
  assert.equal(requiresIdempotency("bank_deposit"), true);
  assert.equal(requiresIdempotency("bank_withdrawal"), true);
  assert.equal(requiresIdempotency("loan_disbursement"), true);
  assert.equal(requiresIdempotency("loan_repayment"), true);
  assert.equal(requiresIdempotency("business_transaction"), true);
  assert.equal(requiresIdempotency("property_purchase"), true);
  assert.equal(requiresIdempotency("salary_payment"), true);
});

test("idempotent operations - non-financial operations don't require idempotency", () => {
  assert.equal(requiresIdempotency("update_profile"), false);
  assert.equal(requiresIdempotency("send_message"), false);
  assert.equal(requiresIdempotency("move_player"), false);
});

test("idempotent operations - financial operation types are complete", () => {
  assert.ok(FINANCIAL_OPERATION_TYPES.length > 0);
  assert.ok(FINANCIAL_OPERATION_TYPES.includes("money_transfer"));
  assert.ok(FINANCIAL_OPERATION_TYPES.includes("bank_deposit"));
  assert.ok(FINANCIAL_OPERATION_TYPES.includes("bank_withdrawal"));
});
