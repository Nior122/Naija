import assert from "node:assert/strict";
import { after, test } from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import {
  createMessage,
  newCreationKey,
  orphanProblems,
  startCreationServer,
  tempDirectory,
} from "./support/creation-fixture.mjs";
import { TestPeer } from "./support/harness.mjs";

/**
 * R4 identity-creation budget (approved limits: 10 new identities per IP and 100 globally, per rolling 60 minutes).
 *
 * Loopback addresses 127.0.0.1–127.0.0.4 stand in for distinct client IPs (Linux routes all of 127.0.0.0/8 locally).
 * Each test uses its own temporary world file. data/world-state.json is never touched.
 */

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 10, 12, 0, 0);
const BUDGET = { perIpLimit: 10, globalLimit: 100, windowMs: 60 * MINUTE };
const LIMITED = "identity_creation_limited";

const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileBackend(file) {
  const directory = file ? null : tempDirectory("naija-budget-");
  if (directory) directories.push(directory);
  const path = file ?? join(directory, "world-state.json");
  return { store: new FaultyStore(new WorldStore(path, START)), file: path };
}

function clock(initial = START) {
  let current = initial;
  return { now: () => current, set: (value) => (current = value), advance: (ms) => (current += ms) };
}

/** Opens a socket whose local address is `address`, so the server sees that address as the client IP. */
async function openFrom(url, address) {
  const socket = new WebSocket(url, { localAddress: address });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return new TestPeer(socket);
}

/** One creation from one client address; the socket is closed afterwards. */
async function createFrom(started, address, name = "Ada", creationKey = newCreationKey()) {
  const peer = await openFrom(started.websocketUrl, address);
  try {
    peer.send(createMessage(creationKey, name));
    const reply = await peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 10_000);
    return { reply, creationKey };
  } finally {
    await peer.close();
  }
}

function countPlayers(backend) {
  return Object.keys(backend.store.state.players).length;
}

function isLimited(reply) {
  return reply.type === "error" && reply.code === LIMITED;
}

test("R4 budget: the per-IP limit refuses the next new identity from that IP, and another IP is unaffected", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { identityBudget: { ...BUDGET, globalLimit: 1000 } });
  try {
    for (let index = 0; index < BUDGET.perIpLimit; index += 1) {
      const { reply } = await createFrom(started, "127.0.0.1", `Player${index}`);
      assert.equal(reply.type, "identity.created", `creation ${index + 1} from one IP is within the limit`);
    }
    const refused = await createFrom(started, "127.0.0.1", "Eleventh");
    assert.ok(isLimited(refused.reply), "the eleventh identity from the same IP is refused");
    assert.equal(countPlayers(backend), BUDGET.perIpLimit, "the refused creation left no record");
    assert.deepEqual(orphanProblems(backend.store.state), []);

    const other = await createFrom(started, "127.0.0.2", "OtherIp");
    assert.equal(other.reply.type, "identity.created", "another IP still has its own budget");
  } finally {
    await started.stop();
  }
});

test("R4 budget: the global limit applies across IPs, including to an IP with budget left", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { identityBudget: { ...BUDGET, globalLimit: 3 } });
  try {
    for (const address of ["127.0.0.1", "127.0.0.2", "127.0.0.3"]) {
      const { reply } = await createFrom(started, address);
      assert.equal(reply.type, "identity.created");
    }
    assert.ok(isLimited((await createFrom(started, "127.0.0.4")).reply), "a fourth IP is refused by the global limit");
    assert.ok(isLimited((await createFrom(started, "127.0.0.1")).reply), "an IP with per-IP budget left is refused by the global limit");
    assert.equal(countPlayers(backend), 3);
  } finally {
    await started.stop();
  }
});

test("R4 budget: the window is rolling, so a slot frees when its creation is more than the window old", async () => {
  const backend = fileBackend();
  const time = clock();
  const started = await startCreationServer(backend, {
    now: time.now,
    identityBudget: { ...BUDGET, perIpLimit: 2, globalLimit: 1000 },
  });
  try {
    assert.equal((await createFrom(started, "127.0.0.1")).reply.type, "identity.created"); // t0
    time.set(START + 10 * MINUTE);
    assert.equal((await createFrom(started, "127.0.0.1")).reply.type, "identity.created"); // t0 + 10
    time.set(START + 20 * MINUTE);
    assert.ok(isLimited((await createFrom(started, "127.0.0.1")).reply), "two creations inside the window: refused");

    time.set(START + 60 * MINUTE); // the t0 creation is exactly one window old and has left the window
    assert.equal((await createFrom(started, "127.0.0.1")).reply.type, "identity.created", "one slot freed");
    assert.ok(isLimited((await createFrom(started, "127.0.0.1")).reply), "the t0+10 creation still holds a slot");
  } finally {
    await started.stop();
  }
});

test("R4 budget: the global window is rolling as well", async () => {
  const backend = fileBackend();
  const time = clock();
  const started = await startCreationServer(backend, {
    now: time.now,
    identityBudget: { ...BUDGET, globalLimit: 2 },
  });
  try {
    assert.equal((await createFrom(started, "127.0.0.1")).reply.type, "identity.created"); // t0
    time.set(START + 10 * MINUTE);
    assert.equal((await createFrom(started, "127.0.0.2")).reply.type, "identity.created"); // t0 + 10
    time.set(START + 20 * MINUTE);
    assert.ok(isLimited((await createFrom(started, "127.0.0.3")).reply), "global limit reached: refused");

    time.set(START + 60 * MINUTE);
    assert.equal((await createFrom(started, "127.0.0.3")).reply.type, "identity.created", "the t0 creation has left the global window");
    assert.ok(isLimited((await createFrom(started, "127.0.0.4")).reply));
  } finally {
    await started.stop();
  }
});

test("R4 budget: concurrent creations from one IP never exceed the per-IP limit", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { identityBudget: { ...BUDGET, globalLimit: 1000 } });
  const peers = [];
  try {
    // 25 separate sockets (below the 30-per-minute connection limit), all sent before any reply is read.
    for (let index = 0; index < 25; index += 1) peers.push(await openFrom(started.websocketUrl, "127.0.0.1"));
    for (const [index, peer] of peers.entries()) peer.send(createMessage(newCreationKey(), `Race${index}`));
    const replies = await Promise.all(peers.map((peer) =>
      peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 15_000)));
    const created = replies.filter((reply) => reply.type === "identity.created").length;
    const limited = replies.filter(isLimited).length;
    assert.equal(created, BUDGET.perIpLimit, "exactly the per-IP limit is created");
    assert.equal(limited, 25 - BUDGET.perIpLimit, "every other request is refused, not lost");
    assert.equal(countPlayers(backend), BUDGET.perIpLimit, "the saved world holds exactly the created identities");
    assert.deepEqual(orphanProblems(backend.store.state), []);
  } finally {
    for (const peer of peers) await peer.close();
    await started.stop();
  }
});

test("R4 budget: concurrent creations across IPs never exceed the global limit", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { identityBudget: { ...BUDGET, globalLimit: 5 } });
  const peers = [];
  try {
    const addresses = ["127.0.0.1", "127.0.0.2", "127.0.0.3", "127.0.0.4"];
    for (const address of addresses) {
      for (let index = 0; index < 5; index += 1) peers.push(await openFrom(started.websocketUrl, address));
    }
    for (const [index, peer] of peers.entries()) peer.send(createMessage(newCreationKey(), `Global${index}`));
    const replies = await Promise.all(peers.map((peer) =>
      peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 15_000)));
    assert.equal(replies.filter((reply) => reply.type === "identity.created").length, 5, "exactly the global limit is created");
    assert.equal(replies.filter(isLimited).length, peers.length - 5);
    assert.equal(countPlayers(backend), 5);
  } finally {
    for (const peer of peers) await peer.close();
    await started.stop();
  }
});

test("R4 budget: refused, invalid, and failed creations do not use any budget", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { identityBudget: { ...BUDGET, perIpLimit: 2, globalLimit: 1000 } });
  try {
    // Invalid profile: rejected before any commit.
    for (let index = 0; index < 3; index += 1) {
      const peer = await openFrom(started.websocketUrl, "127.0.0.1");
      peer.send({ type: "identity.create", creationKey: newCreationKey(), profile: { name: "", age: 16 } });
      const reply = await peer.waitFor((message) => message.type === "error", 5000);
      assert.match(reply.code, /^invalid_/, "the profile is rejected before any commit");
      await peer.close();
    }
    // A save that fails: the creation is not kept, so it must not count.
    backend.store.failNextWrite();
    const failed = await createFrom(started, "127.0.0.1", "SaveFails");
    assert.equal(failed.reply.type, "error");
    assert.notEqual(failed.reply.code, LIMITED);
    assert.equal(countPlayers(backend), 0, "the failed save left no identity");

    // Both slots are still free.
    assert.equal((await createFrom(started, "127.0.0.1", "First")).reply.type, "identity.created");
    assert.equal((await createFrom(started, "127.0.0.1", "Second")).reply.type, "identity.created");
    assert.ok(isLimited((await createFrom(started, "127.0.0.1", "Third")).reply), "the per-IP limit of 2 applies to successes only");
    assert.equal(countPlayers(backend), 2);
    assert.deepEqual(orphanProblems(backend.store.state), []);
  } finally {
    await started.stop();
  }
});

test("R4 budget: a retry with an existing creation key is recovery, not a new identity, and is allowed when the budget is used up", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { identityBudget: { ...BUDGET, perIpLimit: 1, globalLimit: 1000 } });
  try {
    const original = await createFrom(started, "127.0.0.1", "Keeper");
    assert.equal(original.reply.type, "identity.created");
    assert.ok(isLimited((await createFrom(started, "127.0.0.1", "NewOne")).reply), "the single slot is used");

    const retry = await createFrom(started, "127.0.0.1", "Keeper", original.creationKey);
    assert.equal(retry.reply.type, "identity.created", "the retry is recovery of the existing identity");
    assert.equal(retry.reply.playerId, original.reply.playerId, "the same identity is returned");
    assert.equal(countPlayers(backend), 1, "no new identity was created by the retry");
  } finally {
    await started.stop();
  }
});

test("R4 budget: existing players from a shared IP can resume while the budget is used up", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { identityBudget: { ...BUDGET, perIpLimit: 2, globalLimit: 1000 } });
  try {
    // A household shares 127.0.0.1: two members create identities, and the third is refused.
    const members = [];
    for (const name of ["Mother", "Child"]) {
      const { reply } = await createFrom(started, "127.0.0.1", name);
      assert.equal(reply.type, "identity.created");
      members.push(reply);
    }
    assert.ok(isLimited((await createFrom(started, "127.0.0.1", "Visitor")).reply));

    // Both members can still play: a session resume is not a new identity.
    for (const member of members) {
      const peer = await openFrom(started.websocketUrl, "127.0.0.1");
      peer.send({ type: "session.resume", sessionToken: member.sessionToken });
      const ready = await peer.waitFor((message) => message.type === "session.ready" || message.type === "error", 5000);
      assert.equal(ready.type, "session.ready", "an existing member resumes normally");
      await peer.close();
    }
    assert.equal(countPlayers(backend), 2);
  } finally {
    await started.stop();
  }
});

test("R4 budget: the global count survives a restart, because it is derived from the saved identities", async () => {
  const backend = fileBackend();
  const file = backend.file;
  const options = { identityBudget: { ...BUDGET, perIpLimit: 10, globalLimit: 3 } };
  const first = await startCreationServer(backend, options);
  try {
    for (const address of ["127.0.0.1", "127.0.0.2", "127.0.0.3"]) {
      assert.equal((await createFrom(first, address)).reply.type, "identity.created");
    }
  } finally {
    await first.stop();
  }

  // Restart on the same saved file.
  const second = await startCreationServer(fileBackend(file), options);
  try {
    assert.ok(isLimited((await createFrom(second, "127.0.0.4")).reply), "the global limit still holds after restart");
  } finally {
    await second.stop();
  }
});

test("R4 budget: the per-IP counter is process-local and resets on restart (documented limitation)", async () => {
  const backend = fileBackend();
  const file = backend.file;
  const options = { identityBudget: { ...BUDGET, perIpLimit: 2, globalLimit: 100 } };
  const first = await startCreationServer(backend, options);
  try {
    assert.equal((await createFrom(first, "127.0.0.1")).reply.type, "identity.created");
    assert.equal((await createFrom(first, "127.0.0.1")).reply.type, "identity.created");
    assert.ok(isLimited((await createFrom(first, "127.0.0.1")).reply));
  } finally {
    await first.stop();
  }

  const second = await startCreationServer(fileBackend(file), options);
  try {
    assert.equal((await createFrom(second, "127.0.0.1")).reply.type, "identity.created", "the per-IP counter restarts at zero");
  } finally {
    await second.stop();
  }
});

test("R4 budget: the per-IP table is bounded and fails closed while it is full of active addresses", async () => {
  const backend = fileBackend();
  const time = clock();
  const started = await startCreationServer(backend, {
    now: time.now,
    identityBudget: { ...BUDGET, perIpLimit: 5, globalLimit: 1000, maxTrackedAddresses: 2 },
  });
  try {
    assert.equal((await createFrom(started, "127.0.0.1")).reply.type, "identity.created");
    assert.equal((await createFrom(started, "127.0.0.2")).reply.type, "identity.created");
    assert.ok(isLimited((await createFrom(started, "127.0.0.3")).reply), "a third address is refused while the table is full");

    time.set(START + 60 * MINUTE); // both entries have expired; the table can be pruned
    assert.equal((await createFrom(started, "127.0.0.3")).reply.type, "identity.created", "expired entries free the table");
  } finally {
    await started.stop();
  }
});

test("R4 budget: disabled by default; with no budget configured, creations are not limited by it", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend);
  try {
    for (let index = 0; index < 12; index += 1) {
      assert.equal((await createFrom(started, "127.0.0.1", `NoBudget${index}`)).reply.type, "identity.created");
    }
    assert.equal(countPlayers(backend), 12);
  } finally {
    await started.stop();
  }
});
