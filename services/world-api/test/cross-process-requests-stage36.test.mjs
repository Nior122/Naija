// Cross-process transaction safety and request idempotency (Stage 36), on live PostgreSQL.
//
// Each server runs in its own Node process (test/support/server-process.mjs) over one world key. The processes load the
// world at start, so two of them are two independent writers, as two production processes would be. The database
// decides the outcome: a save commits only if the world version is still the one that process loaded.
//
// These run only when DATABASE_URL points at a DISPOSABLE test database AND NAIJA_ALLOW_DB_TESTS=true is set.
// They are not run against any other database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { database } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";
import { PostgresWorldStore, WorldStateConflictError } from "../dist/database/world-store.js";
import { loadGovernmentCatalog } from "../dist/government/catalog.js";
import { openPeer, resumeSession } from "./support/harness.mjs";
import { activeOwnersOf, balanceOf } from "./support/property-world.mjs";
import { fundingRows, live, market, openWorld, player, purchase, settle } from "./support/property-socket.mjs";

const LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
const live_ = { skip: !LIVE ? "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" : false };

if (LIVE) {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live database tests: the database name must contain 'test'");
  }
}

// The line the server process prints when it is listening (see test/support/server-process.mjs).
const READY_PREFIX = "@@READY ";
const SERVER = join(dirname(fileURLToPath(import.meta.url)), "support", "server-process.mjs");
const CATALOG = loadGovernmentCatalog();
const EXPECTED_FUNDING = CATALOG.treasury_funding.map((rule) => `${rule.rule_id}:${rule.amount_ngn}`).sort();

/** Processes and peers started by the current test, stopped by its cleanup. */
let running = [];
let peers = [];
let worlds = [];

before(async () => {
  if (!LIVE) return;
  await database.connect();
  await new MigrationManager(database).migrate();
});

after(async () => {
  if (!LIVE) return;
  for (const peer of peers) await peer.close().catch(() => undefined);
  for (const server of running) await server.stop();
  for (const world of worlds) await world.backend.cleanup();
  await database.disconnect();
});

/** Starts a server process over a world key. Resolves once it is listening. */
async function spawnServer(worldKey, crash = "") {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, WORLD_KEY: worldKey, S36_CRASH: crash },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const websocketUrl = await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 30_000);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(`server exited before it was ready: ${stderr}`));
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split("\n").find((item) => item.startsWith(READY_PREFIX));
      if (line !== undefined) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice(READY_PREFIX.length)).websocketUrl);
      }
    });
  });
  const server = {
    child,
    websocketUrl,
    exited,
    stderr: () => stderr,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await exited;
    },
  };
  running.push(server);
  return server;
}

/** A socket for a player, through a server process (a session resume, as a returning player's client does). */
async function connect(server, playerRecord) {
  const peer = await openPeer(server.websocketUrl);
  peers.push(peer);
  const ready = await resumeSession(peer, playerRecord.sessionToken);
  assert.equal(ready.type, "session.ready", JSON.stringify(ready));
  return peer;
}

/** Resolves when the server closes this peer's socket (a process death, with no reply). */
function closed(peer) {
  return new Promise((resolve) => {
    if (peer.socket.readyState === peer.socket.CLOSED) return resolve();
    peer.socket.once("close", resolve);
  });
}

/** The stored world: what the database holds, not what any process holds in memory. */
async function storedWorld(worldKey) {
  const row = await database.queryOne("SELECT value, version FROM world_state WHERE key = $1", [worldKey]);
  return { state: row.value, version: Number(row.version) };
}

/** The durable request records of one world. */
function operations(worldKey) {
  return database.query(
    "SELECT player_id, request_id, command, fingerprint, world_version FROM world_operations WHERE world_key = $1 ORDER BY request_id",
    [worldKey],
  );
}

/**
 * A world with three players and their sale listings, plus one player at home (for character.rest). The players are
 * created through the protocol in one in-process server, which is then stopped (its state is flushed). Each test
 * starts its own processes over the stored world.
 */
async function seedWorld({ withFunding = true } = {}) {
  const world = await openWorld("postgres");
  worlds.push(world);
  try {
    const buyers = {
      a: await player(world, "Alpha", 50_000_000),
      b: await player(world, "Bravo", 50_000_000),
      c: await player(world, "Charlie", 50_000_000),
    };
    const listings = (await market(buyers.a.peer))
      .filter((listing) => listing.listing_type === "sale" && !live(world).properties[listing.property_id].is_land)
      .sort((x, y) => x.asking_price_ngn - y.asking_price_ngn)
      .slice(0, 5);
    assert.ok(listings.length >= 4, `premise: the seeded world has at least four non-land sale listings (has ${listings.length})`);
    const character = live(world).players[buyers.a.playerId].character;
    character.current_location = "home";
    character.position = { x: 440, y: 350 };
    if (!withFunding) removeAllocation(live(world));
    await world.backend.store.flush();
    return { world, worldKey: world.backend.worldKey, buyers, listings };
  } finally {
    // The seeding server is stopped on every path, so a failed premise cannot leave it running.
    await world.started.stop();
  }
}

/**
 * Test-side setup: removes the treasury allocation rows, and takes their amounts back out of the treasury accounts, so
 * the world is valid and has no allocation (the loader refuses a world whose treasury totals disagree with its ledger).
 */
function removeAllocation(state) {
  for (const [id, row] of Object.entries(state.governmentRevenue ?? {})) {
    if (!row.funding_rule_id) continue;
    for (const organisation of Object.values(state.governmentOrganisations ?? {})) {
      const account = organisation.treasury_account;
      if (account?.account_id === row.account_id) {
        account.total_credited_ngn -= row.amount_ngn;
        account.balance_ngn -= row.amount_ngn;
      }
    }
    delete state.governmentRevenue[id];
  }
}

/**
 * Waits until the stored world stops changing. A session resume saves the world after it answers the client, so a
 * test that reads the stored world straight after a resume could read it one save early. Polls every 50 ms and returns
 * once the version has been unchanged for 300 ms.
 */
async function settled(worldKey) {
  let last = (await storedWorld(worldKey)).version;
  let stableSince = Date.now();
  while (Date.now() - stableSince < 300) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const now = (await storedWorld(worldKey)).version;
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    }
  }
  return storedWorld(worldKey);
}

/** The request ID and command of each record, for assertions. */
const recordsOf = async (worldKey) => (await operations(worldKey)).map((row) => `${row.request_id}:${row.command}`);

// ---------------------------------------------------------------- roles
//
// Every session resume saves the world (the engine marks it dirty and flushes it), so each process that resumes a
// session moves the stored version. The process that resumed last is CURRENT: its saves succeed. Any process that
// resumed earlier is STALE: its saves fail the version check and it is fenced. Stale processes still answer requests
// from the durable record, because a duplicate or a reused ID does not save. Each test names its current and stale
// processes; a crash point is only reached by a current process, because a stale one fails before it inserts a record.

/** Starts a process and resumes a player's session in it. Returns the process and the peer. */
async function activate(worldKey, playerRecord, crash = "") {
  const server = await spawnServer(worldKey, crash);
  const peer = await connect(server, playerRecord);
  await settled(worldKey);
  return { server, peer };
}

// ---------------------------------------------------------------- a stale and a current process race

test("Stage 36 cross-process: a stale process and a current process race for one listing; exactly one purchase is applied", live_, async () => {
  const { worldKey, buyers, listings } = await seedWorld();
  const stale = await activate(worldKey, buyers.a);
  const current = await activate(worldKey, buyers.b);
  const listing = listings[0];
  const before = await storedWorld(worldKey);

  purchase(stale.peer, "race-stale", listing.listing_id);
  purchase(current.peer, "race-current", listing.listing_id);
  const [staleReply, currentReply] = await Promise.all([settle(stale.peer, "race-stale"), settle(current.peer, "race-current")]);

  assert.equal(currentReply.type, "property.result", `the current process applies its purchase: ${JSON.stringify(currentReply)}`);
  assert.equal(staleReply.type, "property.error", JSON.stringify(staleReply));
  assert.equal(staleReply.code, "property_not_saved", "the stale process's save fails the version check and nothing is applied");

  const after = await storedWorld(worldKey);
  assert.deepEqual(activeOwnersOf(after.state, listing.property_id), [buyers.b.characterId], "one owner: the current buyer");
  assert.equal(balanceOf(after.state, buyers.b.characterId), balanceOf(before.state, buyers.b.characterId) - listing.asking_price_ngn, "charged once");
  assert.equal(balanceOf(after.state, buyers.a.characterId), balanceOf(before.state, buyers.a.characterId), "the stale buyer is not charged");
  assert.deepEqual(await recordsOf(worldKey), ["race-current:property.action"], "one durable record: the current request");
});

test("Stage 36 cross-process: the same request ID at a stale and a current process at once is applied once", live_, async () => {
  const { worldKey, buyers, listings } = await seedWorld();
  const stale = await activate(worldKey, buyers.a);
  const current = await activate(worldKey, buyers.a);
  const listing = listings[1];
  const before = await storedWorld(worldKey);

  purchase(stale.peer, "twice-1", listing.listing_id);
  purchase(current.peer, "twice-1", listing.listing_id);
  const [staleReply, currentReply] = await Promise.all([settle(stale.peer, "twice-1"), settle(current.peer, "twice-1")]);

  assert.equal(currentReply.type, "property.result", JSON.stringify(currentReply));
  assert.ok(
    staleReply.type === "command.duplicate" || (staleReply.type === "property.error" && staleReply.code === "property_not_saved"),
    `the stale copy is a duplicate (if it read the record) or a refused save, never a second result: ${JSON.stringify(staleReply)}`,
  );
  const after = await storedWorld(worldKey);
  assert.equal(balanceOf(after.state, buyers.a.characterId), balanceOf(before.state, buyers.a.characterId) - listing.asking_price_ngn, "charged once");
  assert.deepEqual(activeOwnersOf(after.state, listing.property_id), [buyers.a.characterId]);
  assert.deepEqual(await recordsOf(worldKey), ["twice-1:property.action"]);
});

// ---------------------------------------------------------------- a request committed by one process, seen by another

test("Stage 36 cross-process: a request committed by one process is a duplicate in another that loaded earlier, and a reused ID is refused", live_, async () => {
  const { worldKey, buyers, listings } = await seedWorld();
  const stale = await activate(worldKey, buyers.a);
  const current = await activate(worldKey, buyers.a);
  const listing = listings[2];

  purchase(current.peer, "seen-1", listing.listing_id);
  assert.equal((await settle(current.peer, "seen-1")).type, "property.result");
  const afterCommit = await settled(worldKey);

  // The stale process has no memory of "seen-1". It finds the durable record, and does not save.
  purchase(stale.peer, "seen-1", listing.listing_id);
  assert.equal((await settle(stale.peer, "seen-1")).type, "command.duplicate");
  purchase(stale.peer, "seen-1", listings[3].listing_id);
  const reused = await settle(stale.peer, "seen-1");
  assert.equal(reused.type, "property.error", JSON.stringify(reused));
  assert.equal(reused.code, "property_request_id_reused");
  const after = await settled(worldKey);
  assert.equal(after.version, afterCommit.version, "the duplicate and the reused ID changed nothing");
  assert.equal(balanceOf(after.state, buyers.a.characterId), balanceOf(afterCommit.state, buyers.a.characterId), "charged once");

  // The same for a money-family command (character.rest): the current process applies it, the stale one sees it.
  current.peer.send({ type: "character.rest", requestId: "rest-1" });
  const applied = await current.peer.waitFor((message) => message.requestId === "rest-1" && (message.type === "character.snapshot" || message.type === "error"), 20_000);
  assert.equal(applied.type, "character.snapshot", JSON.stringify(applied));
  // character.rest answers before its save (existing behaviour, recorded in the Stage 36 doc). The retry must wait for
  // the save, or it would correctly find no record yet.
  await settled(worldKey);
  stale.peer.send({ type: "character.rest", requestId: "rest-1" });
  const restDuplicate = await stale.peer.waitFor((message) => message.requestId === "rest-1" && (message.type === "command.duplicate" || message.type === "error"), 20_000);
  assert.equal(restDuplicate.type, "command.duplicate", JSON.stringify(restDuplicate));
  stale.peer.send({ type: "character.rest", requestId: "rest-1", note: "different body" });
  const restReused = await stale.peer.waitFor((message) => message.requestId === "rest-1" && (message.type === "command.duplicate" || message.type === "error"), 20_000);
  assert.equal(restReused.type, "error", JSON.stringify(restReused));
  assert.equal(restReused.code, "request_id_reused");
  assert.deepEqual((await recordsOf(worldKey)).filter((row) => row.startsWith("rest-1")), ["rest-1:character.rest"]);
});

// ---------------------------------------------------------------- crash points

test("Stage 36 cross-process: a crash before COMMIT applies nothing, and a retry in a new process applies the change once", live_, async () => {
  const { worldKey, buyers, listings } = await seedWorld();
  await activate(worldKey, buyers.a);
  const crashing = await activate(worldKey, buyers.b, "before-commit:crash-before");
  const listing = listings[0];
  const before = await storedWorld(worldKey);

  purchase(crashing.peer, "crash-before", listing.listing_id);
  await closed(crashing.peer);
  const exit = await crashing.server.exited;
  assert.equal(exit.code, 3, `the process died inside the transaction: ${crashing.server.stderr()}`);

  const afterCrash = await settled(worldKey);
  assert.equal(afterCrash.version, before.version, "the uncommitted transaction left the world at its version");
  assert.deepEqual(activeOwnersOf(afterCrash.state, listing.property_id), activeOwnersOf(before.state, listing.property_id), "the listing is unchanged");
  assert.deepEqual(await recordsOf(worldKey), [], "no durable record for the uncommitted request");
  assert.equal(balanceOf(afterCrash.state, buyers.b.characterId), balanceOf(before.state, buyers.b.characterId), "not charged");

  // A new process loads the world as it is after the crash, and applies the retry once.
  const retry = await activate(worldKey, buyers.b);
  purchase(retry.peer, "crash-before", listing.listing_id);
  assert.equal((await settle(retry.peer, "crash-before")).type, "property.result");
  const after = await storedWorld(worldKey);
  assert.deepEqual(activeOwnersOf(after.state, listing.property_id), [buyers.b.characterId]);
  assert.equal(balanceOf(after.state, buyers.b.characterId), balanceOf(before.state, buyers.b.characterId) - listing.asking_price_ngn, "charged once");
  assert.deepEqual(await recordsOf(worldKey), ["crash-before:property.action"]);
});

test("Stage 36 cross-process: a crash after COMMIT keeps the change; the lost reply is answered as a duplicate, and so is a retry after a restart", live_, async () => {
  const { worldKey, buyers, listings } = await seedWorld();
  // The stale process loads before the commit. Its session is for the same buyer as the crashing request, because a
  // request ID belongs to one player. The resume is refused by the version check, and the duplicate lookup then answers.
  const stale = await spawnServer(worldKey);
  const crashing = await activate(worldKey, buyers.b, "after-commit:crash-after");
  const listing = listings[0];
  const before = await storedWorld(worldKey);

  purchase(crashing.peer, "crash-after", listing.listing_id);
  await closed(crashing.peer);
  const exit = await crashing.server.exited;
  assert.equal(exit.code, 3, `the process died after the commit: ${crashing.server.stderr()}`);

  const afterCrash = await storedWorld(worldKey);
  assert.deepEqual(activeOwnersOf(afterCrash.state, listing.property_id), [buyers.b.characterId], "the commit happened");
  assert.equal(balanceOf(afterCrash.state, buyers.b.characterId), balanceOf(before.state, buyers.b.characterId) - listing.asking_price_ngn);
  assert.deepEqual(await recordsOf(worldKey), ["crash-after:property.action"]);

  // The client retries in the stale process, which loaded the world before the commit: the durable record answers.
  const staleSession = await connect(stale, buyers.b);
  purchase(staleSession, "crash-after", listing.listing_id);
  const staleReply = await settle(staleSession, "crash-after");
  assert.equal(staleReply.type, "command.duplicate", JSON.stringify(staleReply));
  // After a restart, a process that loads the committed world answers the same way.
  const restarted = await activate(worldKey, buyers.b);
  purchase(restarted.peer, "crash-after", listing.listing_id);
  const restartedReply = await settle(restarted.peer, "crash-after");
  assert.equal(restartedReply.type, "command.duplicate", JSON.stringify(restartedReply));
  const after = await storedWorld(worldKey);
  assert.equal(balanceOf(after.state, buyers.b.characterId), balanceOf(afterCrash.state, buyers.b.characterId), "charged once, across the crash and the retries");
});

// ---------------------------------------------------------------- stale writer fencing

test("Stage 36 cross-process: a stale writer is fenced once another process commits; its change is absent until a new process applies it", live_, async () => {
  const { worldKey, buyers, listings } = await seedWorld();
  const stale = await activate(worldKey, buyers.a);
  const current = await activate(worldKey, buyers.b);

  const before = await settled(worldKey);
  purchase(current.peer, "fence-a", listings[0].listing_id);
  assert.equal((await settle(current.peer, "fence-a")).type, "property.result");

  purchase(stale.peer, "fence-b", listings[1].listing_id);
  const refused = await settle(stale.peer, "fence-b");
  assert.equal(refused.code, "property_not_saved", JSON.stringify(refused));
  purchase(stale.peer, "fence-c", listings[1].listing_id);
  const fenced = await settle(stale.peer, "fence-c");
  assert.equal(fenced.code, "property_persistence_unavailable", "a fenced process refuses further changes");

  const midway = await storedWorld(worldKey);
  assert.deepEqual(activeOwnersOf(midway.state, listings[1].property_id), activeOwnersOf(before.state, listings[1].property_id), "the fenced change is absent");
  assert.equal(balanceOf(midway.state, buyers.a.characterId), 50_000_000, "the fenced buyer is not charged");
  assert.deepEqual(await recordsOf(worldKey), ["fence-a:property.action"]);

  // A new process loads the current world, and the same request ID now applies once.
  const fresh = await activate(worldKey, buyers.a);
  purchase(fresh.peer, "fence-b", listings[1].listing_id);
  assert.equal((await settle(fresh.peer, "fence-b")).type, "property.result");
  assert.deepEqual(await recordsOf(worldKey), ["fence-a:property.action", "fence-b:property.action"]);
});

// ---------------------------------------------------------------- treasury allocation under two starters

test("Stage 36 cross-process: two processes start on a world with no treasury allocation; the allocation is written once", live_, async () => {
  const { worldKey, buyers } = await seedWorld({ withFunding: false });
  assert.deepEqual(fundingRows((await storedWorld(worldKey)).state), [], "premise: the world has no allocation rows");

  // Both processes load the world with no allocation, and both reconcile it at session resume, in memory. Their
  // resumes race; only one save can commit, so only one allocation is written.
  const x = await spawnServer(worldKey);
  const y = await spawnServer(worldKey);
  await Promise.all([connect(x, buyers.a), connect(y, buyers.b)]);
  const after = await settled(worldKey);
  assert.deepEqual(fundingRows(after.state), EXPECTED_FUNDING, "each rule has exactly one allocation row");

  // A new process loads the allocated world and does not write it again.
  await activate(worldKey, buyers.c);
  const final = await settled(worldKey);
  assert.deepEqual(fundingRows(final.state), EXPECTED_FUNDING, "a restart does not recreate the allocation");
});

// ---------------------------------------------------------------- beyond the in-memory window

test("Stage 36: an ID evicted from the 256-entry memory window is still refused or answered as a duplicate, from the durable record", live_, async () => {
  const world = await openWorld("postgres");
  worlds.push(world);
  try {
    const owner = await player(world, "Window", 50_000_000);
    const character = live(world).players[owner.playerId].character;
    character.current_location = "home";
    character.position = { x: 440, y: 350 };
    await world.backend.store.flush();
    // One connection per player at a time: close the setup connection before the test's own connections.
    await owner.peer.close();

    // 257 changing requests ("window-0" to "window-256"), from one player. The rate limit is per connection, so the
    // requests are sent in batches of 19, each on a fresh connection that is closed after its batch.
    const connectAs = async () => {
      const peer = await openPeer(world.started.websocketUrl);
      assert.equal((await resumeSession(peer, owner.sessionToken)).type, "session.ready");
      return peer;
    };
    let index = 0;
    while (index < 257) {
      const peer = await connectAs();
      for (let batch = 0; batch < 19 && index < 257; batch += 1, index += 1) {
        const requestId = `window-${index}`;
        peer.send({ type: "character.rest", requestId });
        const reply = await peer.waitFor((message) => message.requestId === requestId && (message.type === "character.snapshot" || message.type === "error"), 20_000);
        assert.equal(reply.type, "character.snapshot", JSON.stringify(reply));
      }
      await peer.close();
    }
    await settled(world.backend.worldKey);

    const inMemory = live(world).players[owner.playerId];
    assert.equal(inMemory.recentRequestRecords.length, 256, "the memory window holds the last 256 records");
    assert.equal(inMemory.recentRequestRecords.some((entry) => entry.request_id === "window-0"), false, "window-0 is evicted from memory");

    // The evicted ID is still known: a different body is refused, and the same request is a duplicate. Neither is applied.
    const energyBefore = live(world).players[owner.playerId].character.energy;
    const check = await connectAs();
    check.send({ type: "character.rest", requestId: "window-0", note: "different body" });
    const reused = await check.waitFor((message) => message.requestId === "window-0" && (message.type === "error" || message.type === "command.duplicate"), 20_000);
    assert.equal(reused.code, "request_id_reused", JSON.stringify(reused));
    check.send({ type: "character.rest", requestId: "window-0" });
    const duplicate = await check.waitFor((message) => message.requestId === "window-0" && (message.type === "error" || message.type === "command.duplicate"), 20_000);
    assert.equal(duplicate.type, "command.duplicate", JSON.stringify(duplicate));
    assert.equal(live(world).players[owner.playerId].character.energy, energyBefore, "neither is applied again");
    const rows = await recordsOf(world.backend.worldKey);
    assert.ok(rows.includes("window-0:character.rest"), "the durable record of window-0 is kept");
    assert.equal(rows.length, 257, "one durable record per applied request");
  } finally {
    await world.started.stop();
  }
});

// ---------------------------------------------------------------- store-level retention and fencing

test("Stage 36 store: records are kept for 90 days, pruned during a save, and a fenced save writes none", live_, async () => {
  const worldKey = `t36-store-${Math.random().toString(16).slice(2)}`;
  const fingerprint = "a".repeat(64);
  const store = await PostgresWorldStore.open({ db: database, worldKey });
  let other = null;
  try {
    store.queueOperation({ playerId: "p1", requestId: "old", command: "shop.purchase", fingerprint });
    store.queueOperation({ playerId: "p1", requestId: "recent", command: "shop.purchase", fingerprint });
    await store.flush();
    await database.query(
      "UPDATE world_operations SET recorded_at = NOW() - INTERVAL '91 days' WHERE world_key = $1 AND request_id = 'old'",
      [worldKey],
    );
    await database.query(
      "UPDATE world_operations SET recorded_at = NOW() - INTERVAL '89 days' WHERE world_key = $1 AND request_id = 'recent'",
      [worldKey],
    );
    const versionAfterFirstSave = store.getVersion();
    store.queueOperation({ playerId: "p1", requestId: "fresh", command: "shop.purchase", fingerprint });
    await store.flush();
    assert.equal(await store.findOperation("p1", "old"), undefined, "a record past the retention period is pruned");
    // A record carries the version of the save that wrote it.
    assert.deepEqual(await store.findOperation("p1", "recent"), { command: "shop.purchase", fingerprint, worldVersion: versionAfterFirstSave });
    assert.ok(await store.findOperation("p1", "fresh"));

    // Another instance loads the current version and saves first, so this store is stale: its queued record is not
    // written, and it fences.
    other = await PostgresWorldStore.open({ db: database, worldKey });
    await other.flush();
    store.queueOperation({ playerId: "p1", requestId: "late", command: "shop.purchase", fingerprint });
    await assert.rejects(store.flush(), WorldStateConflictError);
    assert.equal(store.isFenced(), true);
    assert.equal(await store.findOperation("p1", "late"), undefined, "a refused save writes no record");
  } finally {
    await database.query("DELETE FROM world_operations WHERE world_key = $1", [worldKey]);
    await database.query("DELETE FROM world_state WHERE key = $1", [worldKey]);
  }
});
