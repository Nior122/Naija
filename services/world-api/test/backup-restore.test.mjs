import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { initialState } from "../dist/multiplayer/persistence.js";
import { DatabaseConnection, loadDatabaseConfigFromEnv } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";
import {
  BACKUP_FORMAT,
  BackupError,
  canonicalJson,
  exportWorldBackup,
  restoreWorldBackup,
  snapshotDigest,
  verifyWorldBackup,
} from "../dist/database/backup.js";
import { PostgresWorldStore } from "../dist/database/world-store.js";

/**
 * Stage 28 backup and restore tests.
 *
 * Pure tests (always run): format, checksum and validation rules for a backup object.
 * Live tests (DATABASE_URL + NAIJA_ALLOW_DB_TESTS=true, disposable database name containing "test"): export,
 * restore into a new key, refusal to overwrite, tampered files, and restore into a SECOND disposable database
 * that the test creates and drops. No live world data is read or written.
 */

const NOW = Date.UTC(2026, 9, 10);

function sampleBackup(mutate = () => {}) {
  const snapshot = initialState(NOW);
  mutate(snapshot);
  const backup = {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    worldKey: "t28-sample",
    stateVersion: 3,
    exportedAt: new Date(NOW).toISOString(),
    sha256: snapshotDigest(snapshot),
    snapshot,
  };
  return backup;
}

function expectBackupError(fn, code) {
  assert.throws(fn, (error) => error instanceof BackupError && error.code === code, `expected ${code}`);
}

// ---- Pure tests ------------------------------------------------------------------------------

test("backup: canonical JSON ignores key order, so equal snapshots have equal digests", () => {
  const a = { b: 1, a: { y: [1, 2], x: "z" } };
  const b = { a: { x: "z", y: [1, 2] }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(snapshotDigest(a), snapshotDigest(b));
  assert.notEqual(snapshotDigest(a), snapshotDigest({ a: { x: "z", y: [2, 1] }, b: 1 }));
});

test("backup: a well-formed backup verifies", () => {
  const verified = verifyWorldBackup(sampleBackup(), NOW);
  assert.equal(verified.worldKey, "t28-sample");
  assert.equal(verified.stateVersion, 3);
});

test("backup: a changed snapshot fails the checksum before any validation or write", () => {
  const backup = sampleBackup();
  backup.snapshot.worldClock.minute_of_day = 601;
  expectBackupError(() => verifyWorldBackup(backup, NOW), "backup_checksum_mismatch");
});

test("backup: wrong format, version, key, state version or checksum shape is rejected", () => {
  const cases = [
    (b) => { b.format = "other"; },
    (b) => { b.formatVersion = 2; },
    (b) => { b.worldKey = ""; },
    (b) => { b.stateVersion = 0; },
    (b) => { b.stateVersion = 1.5; },
    (b) => { b.sha256 = "ABC"; },
    (b) => { delete b.sha256; },
  ];
  for (const mutate of cases) {
    const backup = sampleBackup();
    mutate(backup);
    expectBackupError(() => verifyWorldBackup(backup, NOW), "backup_format_invalid");
  }
  expectBackupError(() => verifyWorldBackup(null, NOW), "backup_format_invalid");
  expectBackupError(() => verifyWorldBackup([], NOW), "backup_format_invalid");
});

test("backup: a snapshot the engine would refuse is rejected even when its checksum is correct", () => {
  const backup = sampleBackup((snapshot) => {
    snapshot.worldId = "some-other-world";
  });
  expectBackupError(() => verifyWorldBackup(backup, NOW), "backup_snapshot_invalid");
});

// ---- Live tests ------------------------------------------------------------------------------

const LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
const live = { skip: !LIVE ? "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" : false };

let db;
let sourceName;

if (LIVE) {
  sourceName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!sourceName.includes("test")) {
    throw new Error("Backup live tests refuse a database whose name does not contain \"test\".");
  }
}

function urlWithDatabase(url, name) {
  const copy = new URL(url);
  copy.pathname = `/${name}`;
  return copy.toString();
}

const createdDatabases = [];

before(async () => {
  if (!LIVE) return;
  db = new DatabaseConnection(loadDatabaseConfigFromEnv());
  await db.connect();
  await new MigrationManager(db).migrate();
});

after(async () => {
  if (!LIVE) return;
  for (const name of createdDatabases) {
    // Only names this file created in this run, and only test databases, are dropped.
    if (/^naija_restore_test_[a-f0-9]{12}$/.test(name)) {
      await db.query(`DROP DATABASE IF EXISTS ${name}`);
    }
  }
  await db.disconnect();
});

async function createSourceWorld() {
  const key = `t28-backup-${randomUUID()}`;
  const store = await PostgresWorldStore.open({ db, worldKey: key });
  store.state.worldClock.minute_of_day = 612;
  await store.flush();
  return { key, state: canonicalJson(store.state) };
}

test("backup live: export, verify and restore under a new key reproduces the saved state", live, async () => {
  const source = await createSourceWorld();
  const backup = await exportWorldBackup(db, source.key, NOW);
  const file = JSON.parse(JSON.stringify(backup));
  const target = `t28-restored-${randomUUID()}`;
  const restored = await restoreWorldBackup(db, file, target, NOW);
  assert.equal(restored.worldKey, target);
  assert.equal(restored.version, backup.stateVersion);
  const reopened = await PostgresWorldStore.open({ db, worldKey: target });
  assert.equal(canonicalJson(reopened.state), source.state);
});

test("backup live: restore never overwrites an existing world", live, async () => {
  const source = await createSourceWorld();
  const before = await db.queryOne("SELECT value, version FROM world_state WHERE key = $1", [source.key]);
  const backup = JSON.parse(JSON.stringify(await exportWorldBackup(db, source.key, NOW)));
  backup.snapshot.worldClock.minute_of_day = 900;
  backup.sha256 = snapshotDigest(backup.snapshot);
  await assert.rejects(restoreWorldBackup(db, backup, source.key, NOW), (error) => error.code === "backup_target_exists");
  const after = await db.queryOne("SELECT value, version FROM world_state WHERE key = $1", [source.key]);
  assert.equal(canonicalJson(after.value), canonicalJson(before.value));
  assert.equal(String(after.version), String(before.version));
});

test("backup live: a tampered backup file is refused and nothing is written", live, async () => {
  const source = await createSourceWorld();
  const backup = JSON.parse(JSON.stringify(await exportWorldBackup(db, source.key, NOW)));
  backup.snapshot.worldClock.minute_of_day = 1;
  const target = `t28-tampered-${randomUUID()}`;
  await assert.rejects(restoreWorldBackup(db, backup, target, NOW), (error) => error.code === "backup_checksum_mismatch");
  const rows = await db.query("SELECT key FROM world_state WHERE key = $1", [target]);
  assert.equal(rows.length, 0);
});

test("backup live: exporting a missing world fails with a clear code", live, async () => {
  await assert.rejects(exportWorldBackup(db, `t28-missing-${randomUUID()}`, NOW), (error) => error.code === "backup_world_missing");
});

test("backup live: restore into a SECOND disposable database and open the engine from it", live, async () => {
  const source = await createSourceWorld();
  const backup = JSON.parse(JSON.stringify(await exportWorldBackup(db, source.key, NOW)));

  const name = `naija_restore_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  createdDatabases.push(name);
  await db.query(`CREATE DATABASE ${name}`);

  const target = new DatabaseConnection({ ...loadDatabaseConfigFromEnv(), connectionString: urlWithDatabase(process.env.DATABASE_URL, name) });
  await target.connect();
  try {
    await new MigrationManager(target).migrate();
    const restored = await restoreWorldBackup(target, backup, source.key, NOW);
    assert.equal(restored.worldKey, source.key);
    const reopened = await PostgresWorldStore.open({ db: target, worldKey: source.key });
    assert.equal(canonicalJson(reopened.state), source.state);
  } finally {
    await target.disconnect();
  }
});
