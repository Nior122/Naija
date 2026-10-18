import assert from "node:assert/strict";
import { after, test } from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { parseTrustedProxies } from "../dist/client-address.js";
import { monitoring } from "../dist/monitoring.js";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import {
  createMessage,
  newCreationKey,
  startCreationServer,
  tempDirectory,
} from "./support/creation-fixture.mjs";
import { TestPeer } from "./support/harness.mjs";

/**
 * R4 with a trusted proxy (approved design: docs/STAGE_28_IDENTITY_BUDGET.md, section "Client address").
 * Loopback addresses stand in for the proxy (127.0.0.1) and for clients (127.0.0.2 and others). Each test uses its
 * own temporary world file. data/world-state.json is never touched.
 */

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 10, 12, 0, 0);
const LIMITED = "identity_creation_limited";

const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function backend() {
  const directory = tempDirectory("naija-proxy-");
  directories.push(directory);
  return { store: new FaultyStore(new WorldStore(join(directory, "world-state.json"), START)) };
}

async function openFrom(url, address, headers = {}) {
  const socket = new WebSocket(url, { localAddress: address, headers });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return new TestPeer(socket);
}

async function createFrom(started, address, forwardedFor, name = "Ada") {
  const headers = forwardedFor === undefined ? {} : { "X-Forwarded-For": forwardedFor };
  const peer = await openFrom(started.websocketUrl, address, headers);
  try {
    peer.send(createMessage(newCreationKey(), name));
    return await peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 10_000);
  } finally {
    await peer.close();
  }
}

const isLimited = (reply) => reply.type === "error" && reply.code === LIMITED;
const isCreated = (reply) => reply.type === "identity.created";

test("R4 proxy: without a trusted proxy, a spoofed X-Forwarded-For does not create a fresh budget", async () => {
  const started = await startCreationServer(backend(), {
    identityBudget: { perIpLimit: 2, globalLimit: 1000, windowMs: 60 * MINUTE },
  });
  try {
    assert.ok(isCreated(await createFrom(started, "127.0.0.2", "198.51.100.11")));
    assert.ok(isCreated(await createFrom(started, "127.0.0.2", "198.51.100.12")));
    assert.ok(isLimited(await createFrom(started, "127.0.0.2", "198.51.100.13")), "the third is limited whatever the header says");
    assert.ok(isCreated(await createFrom(started, "127.0.0.3", "198.51.100.11")), "another socket address has its own budget");
  } finally {
    await started.stop();
  }
});

test("R4 proxy: behind a trusted proxy the forwarded client is limited; spoofed leftmost entries are ignored", async () => {
  const started = await startCreationServer(backend(), {
    identityBudget: { perIpLimit: 2, globalLimit: 1000, windowMs: 60 * MINUTE },
    trustedProxies: parseTrustedProxies("127.0.0.1"),
  });
  try {
    assert.ok(isCreated(await createFrom(started, "127.0.0.1", "1.1.1.1, 198.51.100.21")));
    assert.ok(isCreated(await createFrom(started, "127.0.0.1", "198.51.100.21")));
    assert.ok(isLimited(await createFrom(started, "127.0.0.1", "2.2.2.2, 198.51.100.21")), "same forwarded client, new spoofed prefix: still limited");
    assert.ok(isCreated(await createFrom(started, "127.0.0.1", "198.51.100.22")), "another forwarded client behind the same proxy is not limited");
  } finally {
    await started.stop();
  }
});

test("R4 proxy: an untrusted socket that claims a trusted address is counted as itself and cannot use that address's budget", async () => {
  const started = await startCreationServer(backend(), {
    identityBudget: { perIpLimit: 2, globalLimit: 1000, windowMs: 60 * MINUTE },
    trustedProxies: parseTrustedProxies("127.0.0.1"),
  });
  try {
    assert.ok(isCreated(await createFrom(started, "127.0.0.2", "127.0.0.1")));
    assert.ok(isCreated(await createFrom(started, "127.0.0.2", "127.0.0.1")));
    assert.ok(isLimited(await createFrom(started, "127.0.0.2", "127.0.0.1")), "127.0.0.2 is limited as itself");
    assert.ok(isCreated(await createFrom(started, "127.0.0.1", undefined)), "the trusted proxy's own budget is untouched by the spoof");
  } finally {
    await started.stop();
  }
});

test("R4 refusal: a per-IP refusal gives a retry time and reveals no address, identifier or internals", async () => {
  const started = await startCreationServer(backend(), {
    identityBudget: { perIpLimit: 1, globalLimit: 1000, windowMs: 60 * MINUTE },
  });
  try {
    assert.ok(isCreated(await createFrom(started, "127.0.0.2")));
    const refused = await createFrom(started, "127.0.0.2");
    assert.ok(isLimited(refused));
    assert.equal(typeof refused.retry_after_seconds, "number");
    assert.ok(refused.retry_after_seconds >= 1 && refused.retry_after_seconds <= 3600, `retry ${refused.retry_after_seconds}`);
    assert.match(refused.message, /^Too many new identities were created recently\. Try again in about \d+ minutes?\.$/);
    const text = JSON.stringify(refused);
    assert.ok(!text.includes("127.0.0"), "no address");
    assert.ok(!text.includes("player-"), "no player identifier");
    assert.ok(!/token|secret|limit\b|perIp|globalLimit/i.test(text), "no limit internals");
  } finally {
    await started.stop();
  }
});

test("R4 refusal: when the address table is full, the refusal gives no retry time", async () => {
  const started = await startCreationServer(backend(), {
    identityBudget: { perIpLimit: 10, globalLimit: 1000, windowMs: 60 * MINUTE, maxTrackedAddresses: 1 },
  });
  try {
    assert.ok(isCreated(await createFrom(started, "127.0.0.2")));
    const refused = await createFrom(started, "127.0.0.3");
    assert.ok(isLimited(refused));
    assert.equal("retry_after_seconds" in refused, false, "no time is given when the table is full");
    assert.equal(refused.message, "Too many new identities are being created right now. Try again later.");
  } finally {
    await started.stop();
  }
});

test("R4 refusal: a global refusal gives a retry time", async () => {
  const started = await startCreationServer(backend(), {
    identityBudget: { perIpLimit: 10, globalLimit: 1, windowMs: 60 * MINUTE },
  });
  try {
    assert.ok(isCreated(await createFrom(started, "127.0.0.2")));
    const refused = await createFrom(started, "127.0.0.3");
    assert.ok(isLimited(refused));
    assert.equal(typeof refused.retry_after_seconds, "number");
  } finally {
    await started.stop();
  }
});

test("R4 metrics: accepted, limited, capacity and failed creations are counted without any address or identifier", async () => {
  const started = await startCreationServer(backend(), {
    identityBudget: { perIpLimit: 1, globalLimit: 1000, windowMs: 60 * MINUTE },
  });
  try {
    const before = monitoring.getMetrics().identity_creation;
    assert.ok(isCreated(await createFrom(started, "127.0.0.2")));
    assert.ok(isLimited(await createFrom(started, "127.0.0.2")));
    // A separate server with an injected save failure, so the failure does not touch the server above.
    const failingBackend = backend();
    const failing = await startCreationServer(failingBackend, {
      identityBudget: { perIpLimit: 10, globalLimit: 1000, windowMs: 60 * MINUTE },
    });
    try {
      failingBackend.store.failNextWrite();
      const failed = await createFrom(failing, "127.0.0.4");
      assert.equal(failed.type, "error");
      assert.equal(failed.code, "persistence_failed");
    } finally {
      await failing.stop();
    }
    const after = monitoring.getMetrics().identity_creation;
    assert.equal(after.accepted - before.accepted, 1);
    assert.equal(after.limited - before.limited, 1);
    assert.equal(after.failed - before.failed, 1);
    assert.equal(after.capacity_refused - before.capacity_refused, 0);

    const json = JSON.stringify(monitoring.getMetrics());
    const prometheus = monitoring.getPrometheusMetrics();
    for (const text of [json, prometheus]) {
      assert.ok(!text.includes("127.0.0"), "no address in metrics");
      assert.ok(!text.includes("player-"), "no player identifier in metrics");
    }
    assert.match(prometheus, /naija_world_api_identity_creations_limited_total \d+/);
  } finally {
    await started.stop();
  }
});
