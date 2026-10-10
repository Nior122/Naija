import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIdentityBudget } from "../dist/config.js";

/**
 * R4 configuration. The budget is off unless NAIJA_IDENTITY_BUDGET=enabled. The approved values (10 per IP,
 * 100 in total, 60 minutes) are the defaults once enabled. Invalid values stop startup with a fixed message that
 * does not repeat the value.
 */

const BASE = { NAIJA_ENV: "test" };

test("R4 config: the budget is disabled when NAIJA_IDENTITY_BUDGET is absent", () => {
  assert.equal(parseIdentityBudget({ ...BASE }), undefined);
});

test("R4 config: explicitly disabled returns no budget", () => {
  assert.equal(parseIdentityBudget({ ...BASE, NAIJA_IDENTITY_BUDGET: "disabled" }), undefined);
});

test("R4 config: enabled with no other settings uses the approved defaults (10 per IP, 100 in total, 60 minutes)", () => {
  assert.deepEqual(parseIdentityBudget({ ...BASE, NAIJA_IDENTITY_BUDGET: "enabled" }), {
    perIpLimit: 10,
    globalLimit: 100,
    windowMs: 60 * 60_000,
  });
});

test("R4 config: each limit and the window can be changed by the operator", () => {
  assert.deepEqual(
    parseIdentityBudget({
      ...BASE,
      NAIJA_IDENTITY_BUDGET: "enabled",
      NAIJA_IDENTITY_LIMIT_PER_IP: "3",
      NAIJA_IDENTITY_LIMIT_GLOBAL: "250",
      NAIJA_IDENTITY_WINDOW_MINUTES: "15",
    }),
    { perIpLimit: 3, globalLimit: 250, windowMs: 15 * 60_000 },
  );
});

test("R4 config: the limits are validated even while the budget is disabled", () => {
  assert.throws(() => parseIdentityBudget({ ...BASE, NAIJA_IDENTITY_LIMIT_PER_IP: "0" }), /NAIJA_IDENTITY_LIMIT_PER_IP must be an integer from 1 to 1000\./);
});

test("R4 config: out-of-range and non-integer values are rejected with a fixed message that does not repeat the value", () => {
  const cases = [
    ["NAIJA_IDENTITY_LIMIT_PER_IP", "0", "NAIJA_IDENTITY_LIMIT_PER_IP must be an integer from 1 to 1000."],
    ["NAIJA_IDENTITY_LIMIT_PER_IP", "1001", "NAIJA_IDENTITY_LIMIT_PER_IP must be an integer from 1 to 1000."],
    ["NAIJA_IDENTITY_LIMIT_PER_IP", "10.5", "NAIJA_IDENTITY_LIMIT_PER_IP must be an integer from 1 to 1000."],
    ["NAIJA_IDENTITY_LIMIT_GLOBAL", "abc", "NAIJA_IDENTITY_LIMIT_GLOBAL must be an integer from 1 to 100000."],
    ["NAIJA_IDENTITY_LIMIT_GLOBAL", "100001", "NAIJA_IDENTITY_LIMIT_GLOBAL must be an integer from 1 to 100000."],
    ["NAIJA_IDENTITY_WINDOW_MINUTES", "0", "NAIJA_IDENTITY_WINDOW_MINUTES must be an integer from 1 to 1440."],
    ["NAIJA_IDENTITY_WINDOW_MINUTES", "1441", "NAIJA_IDENTITY_WINDOW_MINUTES must be an integer from 1 to 1440."],
    ["NAIJA_IDENTITY_WINDOW_MINUTES", "-5", "NAIJA_IDENTITY_WINDOW_MINUTES must be an integer from 1 to 1440."],
  ];
  for (const [name, value, message] of cases) {
    assert.throws(
      () => parseIdentityBudget({ ...BASE, NAIJA_IDENTITY_BUDGET: "enabled", [name]: value }),
      (error) => {
        // The message is a fixed string, so the rejected value cannot appear in it.
        assert.equal(error.message, message);
        return true;
      },
      `${name}=${value} must be rejected`,
    );
  }
});

test("R4 config: an unknown NAIJA_IDENTITY_BUDGET value is rejected and not echoed", () => {
  assert.throws(
    () => parseIdentityBudget({ ...BASE, NAIJA_IDENTITY_BUDGET: "on-please-secret-value" }),
    (error) => {
      assert.equal(error.message, "NAIJA_IDENTITY_BUDGET must be 'enabled' or 'disabled'.");
      assert.ok(!error.message.includes("secret"), "the value is not echoed");
      return true;
    },
  );
});

test("R4 config: a blank limit uses the default rather than failing", () => {
  assert.deepEqual(parseIdentityBudget({ ...BASE, NAIJA_IDENTITY_BUDGET: "enabled", NAIJA_IDENTITY_LIMIT_PER_IP: "  " }), {
    perIpLimit: 10,
    globalLimit: 100,
    windowMs: 60 * 60_000,
  });
});
