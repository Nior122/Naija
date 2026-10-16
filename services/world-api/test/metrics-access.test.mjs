import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { decideMetricsAccess, parseMetricsAccess } from "../dist/metrics-access.js";
import { readApiConfig } from "../dist/config.js";
import { startApi, stopApi } from "./support/harness.mjs";

/**
 * Stage 28 metrics protection for /metrics and /metrics/prometheus.
 * Tokens here are test fixtures only. They are never logged by the application, and no default token exists.
 */

const TOKEN = "t28-metrics-token-0123456789abcdef-test-only";
const WRONG = "t28-metrics-token-0123456789abcdef-wrong!";
const dir = mkdtempSync(join(tmpdir(), "naija-metrics-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const tokenEnv = (extra = {}) => ({ NAIJA_ENV: "production", NAIJA_METRICS_ACCESS: "token", NAIJA_METRICS_TOKEN: TOKEN, ...extra });

// ---- configuration parsing ----

test("Parsing: production with no NAIJA_METRICS_ACCESS is refused; there is no default", () => {
  assert.throws(() => parseMetricsAccess({ NAIJA_ENV: "production" }, "production"), /NAIJA_METRICS_ACCESS is required in production/);
});

test("Parsing: open is refused in production and accepted in development and test", () => {
  assert.throws(() => parseMetricsAccess({ NAIJA_METRICS_ACCESS: "open" }, "production"), /not allowed in production/);
  assert.equal(parseMetricsAccess({ NAIJA_METRICS_ACCESS: "open" }, "development").mode, "open");
  assert.equal(parseMetricsAccess({ NAIJA_METRICS_ACCESS: "open" }, "test").mode, "open");
});

test("Parsing: development with nothing set defaults to open for local work", () => {
  assert.equal(parseMetricsAccess({}, "development").mode, "open");
  assert.equal(parseMetricsAccess({}, "test").mode, "open");
});

test("Parsing: token mode needs a token of at least 32 characters with no whitespace", () => {
  assert.throws(() => parseMetricsAccess({ NAIJA_METRICS_ACCESS: "token" }, "production"), /NAIJA_METRICS_TOKEN is required/);
  assert.throws(
    () => parseMetricsAccess({ NAIJA_METRICS_ACCESS: "token", NAIJA_METRICS_TOKEN: "short" }, "production"),
    (error) => /at least 32 characters/.test(error.message) && !error.message.includes("short"),
  );
  assert.throws(
    () => parseMetricsAccess({ NAIJA_METRICS_ACCESS: "token", NAIJA_METRICS_TOKEN: `${TOKEN} extra` }, "production"),
    /no whitespace/,
  );
  assert.equal(parseMetricsAccess(tokenEnv(), "production").mode, "token");
});

test("Parsing: a token given without token mode is refused, so a secret is never silently ignored", () => {
  assert.throws(() => parseMetricsAccess({ NAIJA_METRICS_TOKEN: TOKEN }, "development"), /NAIJA_METRICS_TOKEN is set but NAIJA_METRICS_ACCESS is not token/);
  assert.throws(
    () => parseMetricsAccess({ NAIJA_METRICS_ACCESS: "ingress", NAIJA_METRICS_TOKEN: TOKEN }, "production"),
    /Remove the token or use token mode/,
  );
});

test("Parsing: ingress and disabled are accepted in production; unknown modes are refused", () => {
  assert.equal(parseMetricsAccess({ NAIJA_METRICS_ACCESS: "ingress" }, "production").mode, "ingress");
  assert.equal(parseMetricsAccess({ NAIJA_METRICS_ACCESS: "DISABLED" }, "production").mode, "disabled");
  assert.throws(() => parseMetricsAccess({ NAIJA_METRICS_ACCESS: "public" }, "production"), /must be token, ingress, disabled, or open/);
});

test("Parsing: no error message contains the token value", () => {
  const cases = [
    { NAIJA_METRICS_ACCESS: "ingress", NAIJA_METRICS_TOKEN: TOKEN },
    { NAIJA_METRICS_ACCESS: "open", NAIJA_METRICS_TOKEN: TOKEN },
    { NAIJA_METRICS_ACCESS: "token", NAIJA_METRICS_TOKEN: "x".repeat(10) + " " + TOKEN },
  ];
  for (const env of cases) {
    try {
      parseMetricsAccess(env, "production");
    } catch (error) {
      assert.equal(error.message.includes(TOKEN), false);
    }
  }
});

test("Config: readApiConfig applies the same policy for the entry point", () => {
  assert.throws(() => readApiConfig({ NAIJA_ENV: "production", DATABASE_URL: "postgresql://u@h/d" }), /NAIJA_METRICS_ACCESS is required/);
  const config = readApiConfig(tokenEnv({ DATABASE_URL: "postgresql://u@h/d" }));
  assert.equal(config.metricsAccess.mode, "token");
  assert.equal(config.environment, "production");
});

// ---- per-request decisions ----

test("Decision: token mode accepts only the exact bearer token; the scheme is case-insensitive", () => {
  const access = parseMetricsAccess(tokenEnv(), "production");
  assert.equal(decideMetricsAccess(access, `Bearer ${TOKEN}`), "allowed");
  assert.equal(decideMetricsAccess(access, `bearer ${TOKEN}`), "allowed");
  assert.equal(decideMetricsAccess(access, undefined), "unauthorized");
  assert.equal(decideMetricsAccess(access, ""), "unauthorized");
  assert.equal(decideMetricsAccess(access, "Bearer"), "unauthorized");
  assert.equal(decideMetricsAccess(access, `Basic ${TOKEN}`), "unauthorized");
  assert.equal(decideMetricsAccess(access, `Bearer ${WRONG}`), "unauthorized");
  assert.equal(decideMetricsAccess(access, `Bearer ${TOKEN.slice(0, -1)}`), "unauthorized");
  assert.equal(decideMetricsAccess(access, `Bearer ${TOKEN} extra`), "unauthorized");
});

test("Decision: ingress and open allow every request at the application; disabled returns not found", () => {
  assert.equal(decideMetricsAccess({ mode: "ingress" }, undefined), "allowed");
  assert.equal(decideMetricsAccess({ mode: "open" }, undefined), "allowed");
  assert.equal(decideMetricsAccess({ mode: "disabled" }, `Bearer ${TOKEN}`), "not_found");
});

// ---- HTTP behaviour through the real server ----

async function withServer(env, fn) {
  const access = parseMetricsAccess(env, env.NAIJA_ENV ?? "test");
  const api = await startApi({ stateFile: join(dir, `${Math.random().toString(36).slice(2)}.json`), metricsAccess: access });
  try {
    await fn(api.baseUrl);
  } finally {
    await stopApi(api.server);
  }
}

test("HTTP token mode: authorized requests get metrics on both endpoints", async () => {
  await withServer(tokenEnv(), async (base) => {
    for (const path of ["/metrics", "/metrics/prometheus"]) {
      const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
      assert.equal(response.status, 200, path);
      const body = await response.text();
      assert.equal(body.includes(TOKEN), false, "the token must not be echoed");
    }
  });
});

test("HTTP token mode: a missing token is refused with 401 and no metric data", async () => {
  await withServer(tokenEnv(), async (base) => {
    for (const path of ["/metrics", "/metrics/prometheus"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401, path);
      assert.match(response.headers.get("www-authenticate") ?? "", /^Bearer/);
      const body = await response.text();
      assert.equal(body.includes("naija"), false);
      assert.equal(body.includes("{"), true, "a JSON error body, not metrics");
    }
  });
});

test("HTTP token mode: an invalid token is refused with 401", async () => {
  await withServer(tokenEnv(), async (base) => {
    const response = await fetch(`${base}/metrics/prometheus`, { headers: { authorization: `Bearer ${WRONG}` } });
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.equal(text.includes(WRONG) || text.includes(TOKEN), false, "neither value is echoed");
  });
});

test("HTTP disabled: both metrics endpoints return 404 even with a valid token", async () => {
  await withServer({ NAIJA_ENV: "production", NAIJA_METRICS_ACCESS: "disabled" }, async (base) => {
    for (const path of ["/metrics", "/metrics/prometheus"]) {
      const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
      assert.equal(response.status, 404, path);
    }
  });
});

test("HTTP ingress: the application serves metrics without a check, because the ingress is responsible", async () => {
  await withServer({ NAIJA_ENV: "production", NAIJA_METRICS_ACCESS: "ingress" }, async (base) => {
    const response = await fetch(`${base}/metrics/prometheus`);
    assert.equal(response.status, 200);
  });
});

test("HTTP local development and tests: open mode keeps unauthenticated access working", async () => {
  await withServer({ NAIJA_ENV: "development", NAIJA_METRICS_ACCESS: "open" }, async (base) => {
    assert.equal((await fetch(`${base}/metrics`)).status, 200);
    assert.equal((await fetch(`${base}/metrics/prometheus`)).status, 200);
  });
});

test("HTTP: /health is not behind the metrics policy", async () => {
  await withServer(tokenEnv(), async (base) => {
    const response = await fetch(`${base}/health`);
    assert.notEqual(response.status, 401);
  });
});
