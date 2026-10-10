import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore, WORLD_STATE_LIMIT_BYTES } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import { createMessage, newCreationKey, startCreationServer } from "./support/creation-fixture.mjs";
import { createIdentity, openPeer, resumeSession, stopApi } from "./support/harness.mjs";

/**
 * Persistence failure audit (file backend). Stage 28, Task 1.
 *
 * Every test uses a temporary directory. None reads or writes services/world-api/data/world-state.json.
 * Each test states the contract it checks. Tests marked CURRENT BEHAVIOUR record a gap; they do not endorse it.
 */

const MiB = 1024 * 1024;
const LIMIT_OPTIONS = { connectionAttemptsPerMinute: 1_000_000_000 };
const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileBackend(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "naija-audit-"));
  directories.push(directory);
  const file = join(directory, "world-state.json");
  const store = new FaultyStore(new WorldStore(file, Date.now(), options));
  return { store, file, directory };
}

/** One creation over its own socket (one identity per socket). Returns the reply. */
async function createOne(url, name = "Probe") {
  const peer = await openPeer(url);
  try {
    peer.send(createMessage(newCreationKey(), name));
    return await peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 10_000);
  } finally {
    await peer.close();
  }
}

function playerCount(store) {
  return Object.keys(store.state.players).length;
}

test("audit: after a successful save, repeated refused saves leave the file byte-identical and remove nothing", async () => {
  const backend = fileBackend();
  const started = await startCreationServer({ store: backend.store }, LIMIT_OPTIONS);
  try {
    const seed = await createOne(started.websocketUrl, "Seed");
    assert.equal(seed.type, "identity.created");
    const durable = readFileSync(backend.file);
    const seedId = seed.playerId;

    backend.store.state.players[seedId].character.test_padding = "x".repeat(17 * MiB);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const reply = await createOne(started.websocketUrl, "Refused");
      assert.equal(reply.code, "world_capacity_reached", `refused attempt ${attempt + 1}`);
      assert.deepEqual(readFileSync(backend.file), durable, `the file is unchanged after refusal ${attempt + 1}`);
    }
    // The previous identities are still in memory and on disk; nothing was truncated.
    assert.ok(backend.store.state.players[seedId], "the seeded identity is still in memory");

    // Remove the padding: a later normal save succeeds and the file changes (no sticky refusal).
    delete backend.store.state.players[seedId].character.test_padding;
    const ok = await createOne(started.websocketUrl, "After");
    assert.equal(ok.type, "identity.created");
    assert.notDeepEqual(readFileSync(backend.file), durable, "a later save writes the new state");
    assert.equal(new WorldStore(backend.file, Date.now()).state.players[ok.playerId] !== undefined, true);
  } finally {
    const padded = backend.store.state.players[Object.keys(backend.store.state.players)[0]];
    if (padded) delete padded.character.test_padding;
    await started.stop();
  }
});

test("audit: a restart after a refused save loads the last valid world, not the live world", async () => {
  const backend = fileBackend();
  const started = await startCreationServer({ store: backend.store }, LIMIT_OPTIONS);
  const peer = await openPeer(started.websocketUrl);
  try {
    peer.send(createMessage(newCreationKey(), "Restart"));
    const seed = await peer.waitFor((message) => message.type === "identity.created", 10_000);
    const beforeFile = JSON.parse(readFileSync(backend.file, "utf8"));

    // Live-only changes: a padded record (which makes the next save refuse) and a changed value.
    backend.store.state.players[seed.playerId].character.money = 1;
    backend.store.state.players[seed.playerId].character.test_padding = "x".repeat(17 * MiB);
    await assert.rejects(backend.store.flush(), (error) => error.message === "world_capacity_reached");

    const reloaded = new WorldStore(backend.file, Date.now());
    assert.equal(reloaded.state.players[seed.playerId].character.money, beforeFile.players[seed.playerId].character.money,
      "the restarted world has the last saved money, not the unsaved value");
    assert.equal(reloaded.state.players[seed.playerId].character.test_padding, undefined, "no padding is loaded");
  } finally {
    await peer.close();
    const padded = backend.store.state.players[Object.keys(backend.store.state.players)[0]];
    if (padded) delete padded.character.test_padding;
    await started.stop();
  }
});

test("audit: a truncated (partially written) file at startup is refused and is not overwritten", () => {
  const backend = fileBackend();
  const valid = new WorldStore(backend.file, Date.now());
  valid.state.worldClock.minute_of_day = 5;
  return valid.flush().then(() => {
    const bytes = readFileSync(backend.file);
    const truncated = bytes.subarray(0, Math.floor(bytes.length / 2));
    writeFileSync(backend.file, truncated);
    assert.throws(() => new WorldStore(backend.file, Date.now()), /Could not load multiplayer world data/);
    assert.deepEqual(readFileSync(backend.file), truncated, "the damaged file is left as it was, for the operator to inspect");
  });
});

test("audit: an interrupted save leaves a temporary file that the next start ignores", async () => {
  const backend = fileBackend();
  await new WorldStore(backend.file, Date.now()).flush();
  const durable = readFileSync(backend.file);
  writeFileSync(join(backend.directory, "world-state.json.4242.leftover.tmp"), "{ not json");
  const loaded = new WorldStore(backend.file, Date.now());
  assert.ok(loaded.state, "the saved world loads");
  assert.deepEqual(readFileSync(backend.file), durable, "the saved file is untouched by startup");
});

test("audit: an oversized file at startup is refused before parsing and is not overwritten", () => {
  const backend = fileBackend();
  writeFileSync(backend.file, " ".repeat(WORLD_STATE_LIMIT_BYTES + 1));
  assert.throws(() => new WorldStore(backend.file, Date.now()), /16 MiB prototype limit/);
  assert.equal(statSync(backend.file).size, WORLD_STATE_LIMIT_BYTES + 1, "the file is not truncated");
});

test("audit: a failed (non-capacity) save keeps the previous file, leaves no temporary file, and the next save works", async () => {
  const backend = fileBackend();
  const started = await startCreationServer({ store: backend.store }, LIMIT_OPTIONS);
  try {
    assert.equal((await createOne(started.websocketUrl, "First")).type, "identity.created");
    const durable = readFileSync(backend.file);
    backend.store.failNextWrite("injected disk failure");
    const failed = await createOne(started.websocketUrl, "Failed");
    assert.equal(failed.code, "persistence_failed");
    assert.deepEqual(readFileSync(backend.file), durable, "the previous file is kept");
    assert.deepEqual(readdirSync(backend.directory).filter((name) => name.endsWith(".tmp")), [], "no temporary file is left");

    assert.equal((await createOne(started.websocketUrl, "Next")).type, "identity.created");
    const reloaded = new WorldStore(backend.file, Date.now());
    assert.equal(Object.keys(reloaded.state.players).length, 2, "the saved world has the two successful identities");
  } finally {
    await started.stop();
  }
});

for (const format of ["pretty", "compact"]) {
  test(`audit (${format}): at a small limit, refusal keeps the file byte-identical, keeps its format, and restart loads the same world`, async (t) => {
    const limit = 400 * 1024;
    const backend = fileBackend({ maxBytes: limit, format });
    const started = await startCreationServer({ store: backend.store }, LIMIT_OPTIONS);
    let refusal = null;
    try {
      let created = 0;
      const replies = [];
      for (let attempt = 0; attempt < 40 && refusal === null; attempt += 1) {
        const reply = await createOne(started.websocketUrl, "Fill");
        replies.push(reply.type === "error" ? `error:${reply.code}` : reply.type);
        if (reply.type === "identity.created") created += 1;
        else refusal = reply;
      }
      t.diagnostic(`${format}: created=${created} replies=${replies.slice(-3).join(",")} file=${backend.file} size=${existsSync(backend.file) ? statSync(backend.file).size : "none"}`);
      assert.ok(created >= 3, `several identities fit first (created ${created})`);
      assert.equal(refusal?.code, "world_capacity_reached");
      const durable = readFileSync(backend.file);
      assert.ok(durable.length <= limit, "the saved file respects the limit");
      const text = durable.toString("utf8");
      if (format === "pretty") assert.match(text, /\n {2}"/, "a pretty file stays pretty after a refusal");
      else assert.doesNotMatch(text.trimEnd(), /\n/, "a compact file stays compact after a refusal");

      // Identity sizes vary, so a small identity could still fit. Pad the live world so the second attempt is refused.
      backend.store.state.lifeEvents["audit-pad"] = { payload: "x".repeat(MiB) };
      const again = await createOne(started.websocketUrl, "Again");
      assert.equal(again.code, "world_capacity_reached");
      assert.deepEqual(readFileSync(backend.file), durable, "a second refusal does not change the file");

      const reloaded = new WorldStore(backend.file, Date.now(), { maxBytes: limit, format });
      assert.equal(Object.keys(reloaded.state.players).length, created, "restart loads exactly the saved identities");
    } finally {
      delete backend.store.state.lifeEvents["audit-pad"];
      await started.stop();
    }
  });
}

test("audit: a graceful shutdown after gameplay growth refuses the final save, reports it, and keeps the previous file", async () => {
  const backend = fileBackend();
  const started = await startCreationServer({ store: backend.store }, LIMIT_OPTIONS);
  const peer = await openPeer(started.websocketUrl);
  peer.send(createMessage(newCreationKey(), "Shut"));
  const seed = await peer.waitFor((message) => message.type === "identity.created", 10_000);
  await peer.close();
  const durable = readFileSync(backend.file);
  backend.store.state.players[seed.playerId].character.test_padding = "x".repeat(17 * MiB);
  await assert.rejects(stopApi(started.server), (error) => error.message === "world_capacity_reached");
  assert.deepEqual(readFileSync(backend.file), durable, "the previous file is kept after the failed final save");
});

test("audit: a shutdown after a refused creation (live state within the limit) completes cleanly", async () => {
  const backend = fileBackend();
  const started = await startCreationServer({ store: backend.store }, LIMIT_OPTIONS);
  try {
    const seed = await createOne(started.websocketUrl, "Seed");
    backend.store.state.players[seed.playerId].character.test_padding = "x".repeat(17 * MiB);
    const refused = await createOne(started.websocketUrl, "Refused");
    assert.equal(refused.code, "world_capacity_reached");
    delete backend.store.state.players[seed.playerId].character.test_padding;
    await stopApi(started.server);
    assert.ok(new WorldStore(backend.file, Date.now()).state.players[seed.playerId]);
  } finally {
    await started.stop().catch(() => undefined);
  }
});

test("audit: gameplay after saves stop changes live memory only; a restart loses those changes (documented risk)", async () => {
  const backend = fileBackend();
  const started = await startCreationServer({ store: backend.store }, { ...LIMIT_OPTIONS, tickIntervalMs: 50 });
  const peer = await openPeer(started.websocketUrl);
  try {
    const { playerId, sessionToken } = await createIdentity(peer, "Gamer");
    await resumeSession(peer, sessionToken);
    // Let the periodic save that follows the resume (one second after the last save) finish before reading.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const durable = readFileSync(backend.file);
    const durableState = JSON.parse(durable.toString("utf8"));

    // Make the periodic save refuse, then let the world run: time passes and the live world changes.
    // The padding is a life event, not a character field: the world broadcast would send a character field to the
    // connected peer (17 MiB per message) and exhaust this test process.
    backend.store.state.lifeEvents["audit-pad"] = { payload: "x".repeat(17 * MiB) };
    const notice = await peer.waitFor((message) => message.type === "error" && message.code === "world_capacity_reached", 10_000);
    assert.equal(notice.code, "world_capacity_reached");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    delete backend.store.state.lifeEvents["audit-pad"];

    assert.notDeepEqual(backend.store.state.worldClock, durableState.worldClock, "the live world kept changing");
    assert.deepEqual(readFileSync(backend.file), durable, "the saved file did not change");
    const reloaded = new WorldStore(backend.file, Date.now());
    assert.deepEqual(reloaded.state.worldClock, durableState.worldClock, "after a restart the unsaved progress is gone");
  } finally {
    await peer.close();
    delete backend.store.state.lifeEvents["audit-pad"];
    await started.stop().catch(() => undefined);
  }
});

test("audit CURRENT BEHAVIOUR: while saves are refused by the size limit, /health stays reachable and reports no save failure", async () => {
  const backend = fileBackend();
  const started = await startCreationServer({ store: backend.store }, LIMIT_OPTIONS);
  try {
    const seed = await createOne(started.websocketUrl, "Health");
    backend.store.state.players[seed.playerId].character.test_padding = "x".repeat(17 * MiB);
    assert.equal((await createOne(started.websocketUrl, "Refused")).code, "world_capacity_reached");
    const response = await fetch(`${started.baseUrl}/health`);
    const body = await response.json();
    // Recorded, not endorsed: /health does not include the last save result or the size limit. It stays
    // reachable and is not "unhealthy" while every save is refused. Any warning here comes from memory.
    assert.equal(response.status, 200);
    assert.notEqual(body.status, "unhealthy");
    assert.ok(!Object.keys(body.checks ?? {}).some((name) => /save|persist|capacity|world/i.test(name)),
      `no check in /health reports the save failure (checks: ${Object.keys(body.checks ?? {}).join(", ")})`);
    delete backend.store.state.players[seed.playerId].character.test_padding;
  } finally {
    await started.stop().catch(() => undefined);
  }
});

test("audit: a persistence failure notifies each online player once per episode, and a later successful save re-arms it", async (t) => {
  const backend = fileBackend();
  const started = await startCreationServer({ store: backend.store }, { ...LIMIT_OPTIONS, tickIntervalMs: 50 });
  const peer = await openPeer(started.websocketUrl);
  const countNotices = () => peer.messages.filter((message) => message.type === "error" && message.code === "persistence_failed").length;
  try {
    const { sessionToken } = await createIdentity(peer, "Notice");
    await resumeSession(peer, sessionToken);
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    // Episode 1: the world keeps changing (time passes), so the periodic save keeps being attempted and failing.
    for (let index = 0; index < 500; index += 1) backend.store.failNextWrite(`injected failure ${index}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const firstEpisode = countNotices();
    t.diagnostic(`persistence_failed notices in episode 1 (2 s of retries): ${firstEpisode}`);
    assert.equal(firstEpisode, 1, "one notice for the first episode");

    // A successful save ends the episode. Clear the queued faults and let a save succeed.
    backend.store.failures.length = 0;
    const before = readFileSync(backend.file);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assert.notDeepEqual(readFileSync(backend.file), before, "a save succeeded between the episodes");

    // Episode 2 is notified again.
    for (let index = 0; index < 500; index += 1) backend.store.failNextWrite(`second failure ${index}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const secondEpisode = countNotices() - firstEpisode;
    t.diagnostic(`persistence_failed notices in episode 2: ${secondEpisode}`);
    assert.equal(secondEpisode, 1, "one notice for the second episode");
  } finally {
    backend.store.failures.length = 0;
    await peer.close();
    await started.stop().catch(() => undefined);
  }
});

for (const format of ["pretty", "compact"]) {
  test(`audit (${format}): the limit is a byte limit on the serialized file (one byte under refuses, exact size saves)`, async () => {
    const probe = fileBackend({ format });
    probe.store.state.worldClock.minute_of_day = 3;
    const exact = Buffer.byteLength(format === "compact" ? JSON.stringify(probe.store.state) : JSON.stringify(probe.store.state, null, 2), "utf8");

    const under = fileBackend({ maxBytes: exact - 1, format });
    under.store.state.worldClock.minute_of_day = 3;
    await assert.rejects(under.store.flush(), (error) => error.message === "world_capacity_reached");
    assert.throws(() => statSync(under.file), /ENOENT/, "a refused first save creates no file");

    const exactBackend = fileBackend({ maxBytes: exact, format });
    exactBackend.store.state.worldClock.minute_of_day = 3;
    await exactBackend.store.flush();
    assert.equal(statSync(exactBackend.file).size, exact, "a save at exactly the limit is written");
  });
}
