import assert from "node:assert/strict";
import { test } from "node:test";
import { readApiConfig } from "../dist/config.js";

/**
 * Production persistence is PostgreSQL only. The config reader rejects a file backend in production at configuration
 * time, matching the startup check in persistence/open.ts. Test and development modes are unaffected.
 */

const production = {
  NAIJA_ENV: "production",
  NAIJA_METRICS_ACCESS: "ingress",
};

test("production config: a file backend is rejected, whatever the case of the value", () => {
  for (const value of ["file", "FILE", " File "]) {
    assert.throws(
      () => readApiConfig({ ...production, PERSISTENCE_BACKEND: value }),
      /PERSISTENCE_BACKEND=file is not allowed when NAIJA_ENV=production/,
      value,
    );
  }
});

test("production config: a PostgreSQL backend is accepted", () => {
  const config = readApiConfig({ ...production, PERSISTENCE_BACKEND: "postgres" });
  assert.equal(config.environment, "production");
});

test("test config: a file backend is still accepted", () => {
  const config = readApiConfig({ NAIJA_ENV: "test", PERSISTENCE_BACKEND: "file" });
  assert.equal(config.environment, "test");
});
