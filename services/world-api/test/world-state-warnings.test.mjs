import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { parseWorldStateWarnPercent, readApiConfig } from "../dist/config.js";
import { MonitoringService, renderPrometheusMetrics } from "../dist/monitoring.js";

/**
 * Capacity metrics and warning thresholds (R5). These tests use isolated MonitoringService instances,
 * so they never change the process-wide monitor.
 */

const originalWarn = console.warn;
afterEach(() => {
  console.warn = originalWarn;
});

function captureWarnings() {
  const messages = [];
  console.warn = (message) => messages.push(String(message));
  return messages;
}

describe("WORLD_STATE_WARN_PERCENT configuration", () => {
  test("defaults to 75 and 90 when unset or blank", () => {
    assert.deepEqual(parseWorldStateWarnPercent({}), [75, 90]);
    assert.deepEqual(parseWorldStateWarnPercent({ WORLD_STATE_WARN_PERCENT: "  " }), [75, 90]);
  });

  test("accepts strictly ascending integers from 1 to 99", () => {
    assert.deepEqual(parseWorldStateWarnPercent({ WORLD_STATE_WARN_PERCENT: "50, 80,99" }), [50, 80, 99]);
  });

  test("rejects descending, duplicate, out-of-range, and non-numeric values without echoing them", () => {
    for (const value of ["90,75", "50,50", "0", "100", "abc", "50,,80", "1.5"]) {
      assert.throws(
        () => parseWorldStateWarnPercent({ WORLD_STATE_WARN_PERCENT: value }),
        // The message is a fixed string, so it cannot echo the configured value.
        (error) => error.message === "WORLD_STATE_WARN_PERCENT must be strictly ascending integers from 1 to 99, for example 75,90.",
        `value ${JSON.stringify(value)} must be rejected`,
      );
    }
  });

  test("readApiConfig carries the parsed thresholds and rejects invalid ones", () => {
    const env = { NAIJA_ENV: "test", WORLD_STATE_WARN_PERCENT: "60,95" };
    assert.deepEqual(readApiConfig(env).worldStateWarnPercent, [60, 95]);
    assert.throws(() => readApiConfig({ NAIJA_ENV: "test", WORLD_STATE_WARN_PERCENT: "95,60" }), /WORLD_STATE_WARN_PERCENT/);
  });
});

describe("world-state capacity metrics and warnings", () => {
  test("a save records size, limit, ratio, and player count in metrics", () => {
    const monitor = new MonitoringService();
    monitor.recordWorldStateSaved(1000, 3, 4000);
    const world = monitor.getMetrics().world;
    assert.equal(world.state_bytes_last_saved, 1000);
    assert.equal(world.state_limit_bytes, 4000);
    assert.equal(world.state_usage_ratio, 0.25);
    assert.equal(world.persisted_players, 3);
  });

  test("Prometheus output includes the capacity gauges", () => {
    const monitor = new MonitoringService();
    monitor.recordWorldStateSaved(500, 2, 1000);
    const text = renderPrometheusMetrics(monitor.getMetrics(), 1);
    for (const name of [
      "naija_world_api_world_state_bytes",
      "naija_world_api_world_state_limit_bytes",
      "naija_world_api_world_state_usage_ratio",
      "naija_world_api_persisted_players",
    ]) {
      assert.match(text, new RegExp(`^${name} `, "m"), `${name} must be exported`);
    }
  });

  test("a warning is logged once per threshold as usage rises, and never includes record contents", () => {
    const monitor = new MonitoringService();
    monitor.configureWorldStateWarnings([50, 80]);
    const warnings = captureWarnings();
    monitor.recordWorldStateSaved(400, 1, 1000);
    assert.equal(warnings.length, 0, "below the first threshold: no warning");
    monitor.recordWorldStateSaved(600, 2, 1000);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /50%/);
    monitor.recordWorldStateSaved(650, 2, 1000);
    assert.equal(warnings.length, 1, "the same threshold is not repeated");
    monitor.recordWorldStateSaved(900, 3, 1000);
    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /80%/);
    assert.ok(!warnings.join("\n").includes("Ada"), "no player data in warnings");
  });

  test("invalid warning thresholds are rejected", () => {
    const monitor = new MonitoringService();
    assert.throws(() => monitor.configureWorldStateWarnings([80, 50]), /strictly ascending/);
    assert.throws(() => monitor.configureWorldStateWarnings([0]), /1 to 99/);
  });
});
