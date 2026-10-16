import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApiServer } from "../dist/app.js";
import { MonitoringService, PROMETHEUS_CONTENT_TYPE, renderPrometheusMetrics } from "../dist/monitoring.js";

/**
 * Stage 28: advanced monitoring. Covers real performance sampling, the Prometheus
 * text exposition, and the HTTP endpoint. No external services are involved.
 */

const instances = [];
function createService() {
  const service = new MonitoringService("test");
  instances.push(service);
  return service;
}

after(() => {
  for (const service of instances) service.dispose();
});

function busyWait(milliseconds) {
  const end = Date.now() + milliseconds;
  let value = 0;
  while (Date.now() < end) value += 1;
  return value;
}

test("Monitoring: connection counters track peak and never go negative", () => {
  const service = createService();
  service.recordConnection();
  service.recordConnection();
  service.recordDisconnection();
  service.recordDisconnection();
  service.recordDisconnection();
  const metrics = service.getMetrics();
  assert.equal(metrics.connections.active, 0);
  assert.equal(metrics.connections.total, 2);
  assert.equal(metrics.connections.peak, 2);
});

test("Monitoring: server errors are counted, request totals include every request", () => {
  const service = createService();
  service.recordRequest(false);
  service.recordRequest(false);
  service.recordError();
  const metrics = service.getMetrics();
  assert.equal(metrics.requests.total, 2);
  assert.equal(metrics.requests.errors, 1);
});

test("Monitoring: event-loop delay is measured, not hard-coded to zero", async () => {
  const service = createService();
  // Let the histogram take its first sample, then stall inside a timer callback.
  // (A stall in synchronous code before the first tick is not attributed by Node's histogram.)
  await new Promise((resolve) => setTimeout(resolve, 30));
  await new Promise((resolve) => setTimeout(() => { busyWait(100); resolve(); }, 5));
  await new Promise((resolve) => setTimeout(resolve, 60));
  const metrics = service.getMetrics();
  assert.ok(
    metrics.performance.event_loop_delay_ms >= 50,
    `expected a measured stall of at least 50ms, got ${metrics.performance.event_loop_delay_ms}`,
  );
});

test("Monitoring: CPU percent reflects work done since the last sample", () => {
  const service = createService();
  busyWait(100);
  const metrics = service.getMetrics();
  assert.ok(Number.isFinite(metrics.performance.cpu_percent));
  assert.ok(metrics.performance.cpu_percent > 0, "busy work must register as CPU use");
});

test("Monitoring: Prometheus output has HELP and TYPE for every metric and valid names", () => {
  const service = createService();
  const text = service.getPrometheusMetrics();
  const lines = text.trimEnd().split("\n");
  const sampleLines = lines.filter((line) => !line.startsWith("#"));
  assert.ok(sampleLines.length >= 10, "expected the full metric set");

  for (const sample of sampleLines) {
    const match = /^([a-z_:][a-zA-Z0-9_:]*) (-?\d+(\.\d+)?(e[+-]?\d+)?)$/.exec(sample);
    assert.ok(match, `malformed sample line: ${sample}`);
    const name = match[1];
    assert.ok(text.includes(`# HELP ${name} `), `missing HELP for ${name}`);
    assert.ok(text.includes(`# TYPE ${name} `), `missing TYPE for ${name}`);
    assert.ok(name.startsWith("naija_world_api_"), `metric ${name} lacks the service prefix`);
  }
  assert.ok(text.includes("naija_world_api_up 1\n"));
});

test("Monitoring: counters end in _total and are typed as counters", () => {
  const text = renderPrometheusMetrics(createService().getMetrics(), 12.5);
  const typeLines = text.split("\n").filter((line) => line.startsWith("# TYPE "));
  for (const line of typeLines) {
    const [, , name, type] = line.split(" ");
    if (type === "counter") assert.ok(name.endsWith("_total"), `${name} is a counter without _total`);
    else assert.equal(type, "gauge", `unexpected metric type in ${line}`);
  }
  assert.ok(text.includes("# TYPE naija_world_api_requests_total counter\n"));
  assert.ok(text.includes("naija_world_api_uptime_seconds 12.5\n"));
});

test("Monitoring: non-finite values are rendered as 0 so scrapes never break", () => {
  const metrics = createService().getMetrics();
  metrics.performance.cpu_percent = Number.NaN;
  metrics.world.tick_rate = Number.POSITIVE_INFINITY;
  const text = renderPrometheusMetrics(metrics, 1);
  assert.ok(text.includes("naija_world_api_cpu_percent 0\n"));
  assert.ok(text.includes("naija_world_api_tick_rate 0\n"));
  assert.ok(!/NaN|Infinity/.test(text));
});

test("HTTP: /metrics/prometheus serves text format and /metrics stays JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "naija-metrics-"));
  const server = createApiServer({ stateFile: join(dir, "state.json") });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const prometheus = await fetch(`${base}/metrics/prometheus`);
    assert.equal(prometheus.status, 200);
    assert.equal(prometheus.headers.get("content-type"), PROMETHEUS_CONTENT_TYPE);
    assert.equal(prometheus.headers.get("x-content-type-options"), "nosniff");
    const body = await prometheus.text();
    assert.ok(body.includes("naija_world_api_up 1\n"));

    const json = await fetch(`${base}/metrics`);
    assert.equal(json.status, 200);
    assert.match(json.headers.get("content-type"), /application\/json/);
    const parsed = await json.json();
    assert.ok(typeof parsed.performance.event_loop_delay_ms === "number");

    const rejected = await fetch(`${base}/metrics/prometheus`, { method: "POST" });
    assert.equal(rejected.status, 405);
  } finally {
    await server.shutdown();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
