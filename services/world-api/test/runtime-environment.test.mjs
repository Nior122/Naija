import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  assertTestWorldFileIsolation,
  effectiveEnvironment,
  isLocalEnvironment,
  LIVE_WORLD_FILE,
  readRuntimeEnvironment,
} from "../dist/runtime-environment.js";
import { readApiConfig } from "../dist/config.js";

/** Stage 28: NAIJA_ENV parsing and the rule that tests never touch the live world file. */

const dir = mkdtempSync(join(tmpdir(), "naija-env-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("NAIJA_ENV: required at the entry point; an unset value is an error there", () => {
  assert.throws(() => readRuntimeEnvironment({}, { required: true }), /NAIJA_ENV must be set to production, development, or test/);
  assert.throws(() => readRuntimeEnvironment({ NAIJA_ENV: "  " }, { required: true }), /must be set/);
  assert.equal(readRuntimeEnvironment({}, { required: false }), undefined);
});

test("NAIJA_ENV: the three known values are accepted, case and spaces ignored; anything else is refused", () => {
  assert.equal(readRuntimeEnvironment({ NAIJA_ENV: "production" }, { required: true }), "production");
  assert.equal(readRuntimeEnvironment({ NAIJA_ENV: " Development " }, { required: true }), "development");
  assert.equal(readRuntimeEnvironment({ NAIJA_ENV: "TEST" }, { required: true }), "test");
  for (const bad of ["staging", "prod", "local", "dev"]) {
    assert.throws(() => readRuntimeEnvironment({ NAIJA_ENV: bad }, { required: false }), /production, development, or test/, bad);
  }
});

test("Library policy: an unset environment is treated as production, so local-only options stay off", () => {
  assert.equal(effectiveEnvironment(undefined), "production");
  assert.equal(isLocalEnvironment(undefined), false);
  assert.equal(isLocalEnvironment("development"), true);
  assert.equal(isLocalEnvironment("test"), true);
  assert.equal(isLocalEnvironment("production"), false);
});

test("Test isolation: under NAIJA_ENV=test an explicit temporary file is required", () => {
  const env = { NAIJA_ENV: "test" };
  assert.throws(() => assertTestWorldFileIsolation(undefined, env), /requires an explicit test world file/);
  assert.throws(() => assertTestWorldFileIsolation("   ", env), /requires an explicit test world file/);
  assert.doesNotThrow(() => assertTestWorldFileIsolation(join(dir, "state.json"), env));
});

test("Test isolation: the live world file is refused by absolute, relative, and symlinked paths", () => {
  const env = { NAIJA_ENV: "test" };
  assert.throws(() => assertTestWorldFileIsolation(LIVE_WORLD_FILE, env), /refuses the live world file/);
  assert.throws(() => assertTestWorldFileIsolation("data/world-state.json", env), /refuses the live world file/);
  const link = join(dir, "link-to-live.json");
  symlinkSync(LIVE_WORLD_FILE, link);
  assert.throws(() => assertTestWorldFileIsolation(link, env), /refuses the live world file/);
});

test("Test isolation: outside NAIJA_ENV=test the check does not apply (development may use its own file)", () => {
  assert.doesNotThrow(() => assertTestWorldFileIsolation(undefined, { NAIJA_ENV: "development" }));
  assert.doesNotThrow(() => assertTestWorldFileIsolation(undefined, {}));
});

test("readApiConfig: NAIJA_ENV is required and the environment is carried into the config", () => {
  assert.throws(() => readApiConfig({ PORT: "3000" }), /NAIJA_ENV must be set/);
  const config = readApiConfig({ NAIJA_ENV: "development", DATA_FILE: join(dir, "dev.json") });
  assert.equal(config.environment, "development");
  assert.equal(config.dataFile, join(dir, "dev.json"));
  assert.equal(config.metricsAccess.mode, "open");
});

test("readApiConfig: reads the environment it is given, not the process environment", () => {
  const config = readApiConfig({ NAIJA_ENV: "test", PORT: "4010", DATA_FILE: join(dir, "t.json") });
  assert.equal(config.port, 4010);
  assert.equal(config.environment, "test");
});
