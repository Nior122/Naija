import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../dist/app.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Stage 26 Integration Tests
 * Tests critical paths and end-to-end scenarios
 */

// Each server gets its own state file. Without this, the server falls back to the live
// services/world-api/data/world-state.json and every test run overwrites the real world.
const withServer = async (fn, options = {}) => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "naija-integration-"));
  const server = createApiServer({ tickIntervalMs: 100, ...options, stateFile: join(stateDirectory, "world-state.json") });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn({ baseUrl, server, port });
  } finally {
    await server.shutdown();
    rmSync(stateDirectory, { recursive: true, force: true });
  }
};

test("Integration: Health endpoint returns comprehensive status", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/health`);
    const health = await response.json();
    // The status and HTTP code follow the health contract (see assertHealthContract below). The event-loop and
    // heap checks are single samples, so a busy host can report "degraded" or even 503; this test does not require 200.
    assertHealthContract(response.status, health);

    // Verify structure
    assert.ok(health.status);
    assert.ok(health.version);
    assert.ok(health.uptime >= 0);
    assert.ok(health.timestamp > 0);
    
    // Verify checks
    assert.ok(health.checks);
    assert.ok(health.checks.memory);
    assert.ok(health.checks.event_loop);
    assert.ok(health.checks.connections);
    
    // Verify metrics
    assert.ok(health.metrics);
    assert.ok(health.metrics.connections);
    assert.ok(health.metrics.requests);
    assert.ok(health.metrics.memory);
    assert.ok(health.metrics.world);
  });
});

test("Integration: Metrics endpoint returns server metrics", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/metrics`);
    assert.equal(response.status, 200);
    
    const metrics = await response.json();
    
    // Verify structure
    assert.ok(metrics.connections);
    assert.equal(typeof metrics.connections.active, "number");
    assert.equal(typeof metrics.connections.total, "number");
    assert.equal(typeof metrics.connections.peak, "number");
    
    assert.ok(metrics.requests);
    assert.equal(typeof metrics.requests.total, "number");
    assert.equal(typeof metrics.requests.errors, "number");
    assert.equal(typeof metrics.requests.rate_per_second, "number");
    
    assert.ok(metrics.memory);
    assert.equal(typeof metrics.memory.rss_mb, "number");
    assert.equal(typeof metrics.memory.heap_used_mb, "number");
    assert.equal(typeof metrics.memory.heap_total_mb, "number");
    
    assert.ok(metrics.world);
    assert.equal(typeof metrics.world.players_online, "number");
    assert.equal(typeof metrics.world.tick_rate, "number");
    assert.equal(typeof metrics.world.last_tick_duration_ms, "number");
  });
});

test("Integration: World descriptor endpoint returns metadata", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/v1/world`);
    assert.equal(response.status, 200);
    
    const world = await response.json();
    assert.equal(world.id, "nigeria-main");
    assert.equal(world.name, "Nigeria");
    assert.ok(world.topology);
  });
});

test("Integration: Non-existent endpoint returns 404", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/nonexistent`);
    assert.equal(response.status, 404);
    
    const body = await response.json();
    assert.equal(body.error, "not_found");
  });
});

test("Integration: POST method returns 405", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/health`, { method: "POST" });
    assert.equal(response.status, 405);
    
    const body = await response.json();
    assert.equal(body.error, "method_not_allowed");
  });
});

test("Integration: WebSocket endpoint requires upgrade", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/ws`);
    assert.equal(response.status, 426);
    
    const body = await response.json();
    assert.equal(body.error, "websocket_upgrade_required");
  });
});

test("Integration: Multiple health requests return consistent data", async () => {
  await withServer(async ({ baseUrl }) => {
    const response1 = await fetch(`${baseUrl}/health`);
    const health1 = await response1.json();
    const response2 = await fetch(`${baseUrl}/health`);
    const health2 = await response2.json();

    // Both must follow the health contract. "healthy" is not required: a single-sample check can warn on a busy host.
    assertHealthContract(response1.status, health1);
    assertHealthContract(response2.status, health2);
    
    // Uptime should increase
    assert.ok(health2.uptime >= health1.uptime);
    
    // Version should be the same
    assert.equal(health1.version, health2.version);
  });
});

test("Integration: Metrics accumulate over requests", async () => {
  await withServer(async ({ baseUrl }) => {
    // Get initial metrics
    const metrics1 = await fetch(`${baseUrl}/metrics`).then(r => r.json());
    const initialRequests = metrics1.requests.total;
    
    // Make several requests
    await fetch(`${baseUrl}/health`);
    await fetch(`${baseUrl}/health`);
    await fetch(`${baseUrl}/metrics`);
    
    // Get final metrics
    const metrics2 = await fetch(`${baseUrl}/metrics`).then(r => r.json());
    
    // Requests should have increased
    assert.ok(metrics2.requests.total > initialRequests);
  });
});

/**
 * The health contract (src/monitoring.ts and src/app.ts):
 * - overall status is "unhealthy" if any check fails, "degraded" if any check warns, otherwise "healthy";
 * - HTTP 503 is returned only for "unhealthy"; "healthy" and "degraded" return HTTP 200.
 * This assertion checks that contract and does not depend on how busy the host is.
 */
function assertHealthContract(httpStatus, body) {
  const statuses = Object.values(body.checks).map((check) => check.status);
  const expected = statuses.includes("fail") ? "unhealthy" : statuses.includes("warn") ? "degraded" : "healthy";
  assert.equal(body.status, expected, "overall status must follow the individual check results");
  assert.equal(httpStatus, body.status === "unhealthy" ? 503 : 200, "HTTP status must follow the overall status");
}

test("Integration: health contract helper rejects inconsistent responses", () => {
  assert.throws(() => assertHealthContract(200, { status: "healthy", checks: { a: { status: "warn" } } }));
  assert.throws(() => assertHealthContract(200, { status: "unhealthy", checks: { a: { status: "fail" } } }));
  assert.throws(() => assertHealthContract(200, { status: "degraded", checks: { a: { status: "fail" } } }));
  assert.doesNotThrow(() => assertHealthContract(200, { status: "degraded", checks: { a: { status: "warn" } } }));
  assert.doesNotThrow(() => assertHealthContract(503, { status: "unhealthy", checks: { a: { status: "fail" } } }));
});

test("Integration: Server handles concurrent requests", async () => {
  await withServer(async ({ baseUrl }) => {
    // Ten concurrent requests. Each must succeed (HTTP 200), return a body that follows the health contract,
    // and never report "unhealthy". Whether the host reports "degraded" depends on load (the event-loop and heap
    // checks are single samples), so the test does not assert "healthy".
    const responses = await Promise.all(Array(10).fill(null).map(() => fetch(`${baseUrl}/health`)));
    const bodies = await Promise.all(responses.map((response) => response.json()));
    responses.forEach((response, index) => {
      assert.notEqual(bodies[index].status, "unhealthy", `request ${index} reported unhealthy`);
      assert.ok(["healthy", "degraded"].includes(bodies[index].status), `request ${index} status ${bodies[index].status}`);
      assertHealthContract(response.status, bodies[index]);
    });
  });
});

test("Integration: health reports unhealthy (HTTP 503) when the persistence dependency fails", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    assert.equal(body.checks.persistence.status, "fail");
    assert.equal(body.status, "unhealthy");
    assert.equal(response.status, 503);
    assertHealthContract(response.status, body);
  }, { persistenceHealth: async () => ({ status: "fail", message: "Database unreachable." }) });
});

test("Integration: health reports unhealthy (HTTP 503) when the persistence check throws", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.status, "unhealthy");
    assert.equal(body.checks.persistence.status, "fail");
    assert.equal(body.checks.persistence.message, "Persistence health check failed.", "no error details may be exposed");
  }, { persistenceHealth: async () => { throw new Error("connect ECONNREFUSED with password=secret"); } });
});

test("Integration: a passing persistence check is reported and cannot by itself make the service unhealthy", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    assert.equal(body.checks.persistence.status, "pass");
    assertHealthContract(response.status, body);
    if (body.status === "unhealthy") {
      const failing = Object.entries(body.checks).filter(([, check]) => check.status === "fail").map(([name]) => name);
      assert.ok(failing.some((name) => name !== "persistence"), "unhealthy must come from a non-persistence check");
    }
  }, { persistenceHealth: async () => ({ status: "pass", message: "Database reachable." }) });
});

test("Integration: a persistence warning is reported and prevents a healthy status", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    assert.equal(body.checks.persistence.status, "warn");
    assert.notEqual(body.status, "healthy", "a warning check must not produce a healthy status");
    assertHealthContract(response.status, body);
  }, { persistenceHealth: async () => ({ status: "warn", message: "Slow database response." }) });
});

test("Integration: Memory metrics are reasonable", async () => {
  await withServer(async ({ baseUrl }) => {
    const metrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
    
    // Memory should be positive and reasonable (< 1GB for a test)
    assert.ok(metrics.memory.rss_mb > 0);
    assert.ok(metrics.memory.rss_mb < 1024);
    
    assert.ok(metrics.memory.heap_used_mb > 0);
    assert.ok(metrics.memory.heap_used_mb < 1024);
    
    assert.ok(metrics.memory.heap_total_mb > 0);
    assert.ok(metrics.memory.heap_total_mb < 1024);
    
    // Heap used should be less than heap total
    assert.ok(metrics.memory.heap_used_mb <= metrics.memory.heap_total_mb);
  });
});

test("Integration: Connection tracking works", async () => {
  await withServer(async ({ baseUrl }) => {
    const metrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
    
    // Initially no connections
    assert.equal(metrics.connections.active, 0);
    assert.ok(metrics.connections.total >= 0);
    assert.ok(metrics.connections.peak >= 0);
  });
});

test("Integration: World metrics are initialized", async () => {
  await withServer(async ({ baseUrl }) => {
    const metrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
    
    // World metrics should be initialized
    assert.equal(typeof metrics.world.players_online, "number");
    assert.equal(typeof metrics.world.tick_rate, "number");
    assert.equal(typeof metrics.world.last_tick_duration_ms, "number");
    
    // Tick rate should be >= 0 (may be 0 if no ticks yet)
    assert.ok(metrics.world.tick_rate >= 0);
  });
});
