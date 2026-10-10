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
const withServer = async (fn) => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "naija-integration-"));
  const server = createApiServer({ tickIntervalMs: 100, stateFile: join(stateDirectory, "world-state.json") });
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
    assert.equal(response.status, 200);
    
    const health = await response.json();
    
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
    const health1 = await fetch(`${baseUrl}/health`).then(r => r.json());
    const health2 = await fetch(`${baseUrl}/health`).then(r => r.json());
    
    // Both should be healthy
    assert.equal(health1.status, "healthy");
    assert.equal(health2.status, "healthy");
    
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

test("Integration: Server handles concurrent requests", async () => {
  await withServer(async ({ baseUrl }) => {
    // Make 10 concurrent requests
    const promises = Array(10).fill(null).map(() => 
      fetch(`${baseUrl}/health`).then(r => r.json())
    );
    
    const results = await Promise.all(promises);
    
    // All should succeed. The event-loop check is a single timing sample that reports "degraded"
    // when the host is busy (for example, while other test files run in parallel), so accept
    // healthy or degraded here. Only "unhealthy" means a real failure.
    results.forEach(result => {
      assert.ok(["healthy", "degraded"].includes(result.status), `unexpected status ${result.status}`);
    });
  });
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
