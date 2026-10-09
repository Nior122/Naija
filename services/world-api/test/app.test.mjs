import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { readApiConfig } from "../dist/config.js";

const activeServers = new Set();
const activeDirectories = new Set();

class TestPeer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  waitFor(predicate, timeoutMs = 3000) {
    const messageIndex = this.messages.findIndex(predicate);
    if (messageIndex >= 0) return Promise.resolve(this.messages.splice(messageIndex, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
          reject(new Error("Timed out waiting for a WebSocket event."));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  waitForType(type, timeoutMs) {
    return this.waitFor((message) => message.type === type, timeoutMs);
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.socket.terminate();
        resolve();
      }, 1000);
      this.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
      else this.socket.terminate();
    });
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    websocketUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

async function startServer(stateFile, options = {}) {
  const server = createApiServer({ stateFile, ...options });
  const urls = await listen(server);
  activeServers.add(server);
  return { server, ...urls };
}

async function stopServer(server) {
  await server.shutdown();
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
  activeServers.delete(server);
}

async function withServer(run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "naija-multiplayer-test-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const { beforeStart, ...serverOptions } = options;
  if (beforeStart) await beforeStart(stateFile);
  const running = await startServer(stateFile, serverOptions);
  try {
    await run({ ...running, stateFile });
  } finally {
    await stopServer(running.server);
  }
}

async function openPeer(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return new TestPeer(socket);
}

async function createCharacter(peer, name, overrides = {}) {
  const creationKey = randomBytes(32).toString("hex");
  peer.send({
    type: "identity.create",
    creationKey,
    profile: {
      name,
      age: 16,
      character_type: "girl",
      appearance: {
        skin_tone: "#9b654d",
        hairstyle: "Braids",
        clothing_color: "#27734a",
      },
      ...overrides,
    },
  });
  const created = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: created.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { ...created, ready, creationKey };
}

const AKURE_REGION_ID = "ng:region:ondo:akure-south-core";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("game-time scaling is configurable and validates its bounds", () => {
  const previousValue = process.env.GAME_MINUTE_MS;
  try {
    process.env.GAME_MINUTE_MS = "1200";
    assert.equal(readApiConfig().gameMinuteMs, 1200);
    process.env.GAME_MINUTE_MS = "0";
    assert.throws(() => readApiConfig(), /GAME_MINUTE_MS/);
  } finally {
    if (previousValue === undefined) delete process.env.GAME_MINUTE_MS;
    else process.env.GAME_MINUTE_MS = previousValue;
  }
});

afterEach(async () => {
  for (const server of [...activeServers]) await stopServer(server);
  for (const directory of activeDirectories) await rm(directory, { recursive: true, force: true });
  activeDirectories.clear();
});

test("HTTP health, world metadata, 404, and read-only method checks remain intact", async () => {
  await withServer(async ({ baseUrl }) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.deepEqual(await health.json(), { status: "ok", service: "world-api" });

    const world = await fetch(`${baseUrl}/api/v1/world`);
    assert.equal(world.status, 200);
    assert.deepEqual(await world.json(), {
      id: "nigeria-main",
      name: "Nigeria",
      projectName: "Naija: One World",
      topology: "single-logical-world",
      implementationStage: 7,
      simulationImplemented: true,
      simulationScope: "bounded-multiplayer-prototype",
      geographyImplemented: true,
      educationImplemented: true,
      educationScope: "fictional-configurable-education-prototype",
      lifeSimulationImplemented: true,
      lifeSimulationScope: "configurable-calendar-family-relationships-and-life-history-foundation",
      careersImplemented: true,
      careersScope: "server-authoritative-configurable-vacancies-employment-work-sessions-and-payroll-prototype",
      economyImplemented: true,
      economyScope: "naira-denominated-ledger-banking-market-goods-tax-estimation-and-credit-prototype",
      geographicCoverage: "national-admin-registry-plus-bounded-akure-south-sample",
      fullNationalGeography: false,
      fullNationalSimulation: false,
    });

    const missing = await fetch(`${baseUrl}/not-a-route`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "not_found" });

    const rejected = await fetch(`${baseUrl}/api/v1/world`, { method: "POST" });
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.get("allow"), "GET");
    assert.deepEqual(await rejected.json(), { error: "method_not_allowed" });
  });
});

test("two real WebSocket clients share presence, validated movement, nearby chat and wave interaction", async () => {
  await withServer(async ({ websocketUrl }) => {
    const first = await openPeer(websocketUrl);
    const second = await openPeer(websocketUrl);
    try {
      const firstIdentity = await createCharacter(first, "Ayo", {
        money: 9_999_999,
        position: { x: 15_000, y: -100 },
      });
      const secondIdentity = await createCharacter(second, "Dara");
      assert.equal(firstIdentity.ready.character.money, 5000);
      assert.deepEqual(firstIdentity.ready.character.position, { x: 720, y: 540 });
      assert.equal(firstIdentity.ready.character.current_location, "home");
      assert.equal(firstIdentity.ready.character.geographic_location, null);
      assert.equal(firstIdentity.ready.world.id, "nigeria-main");
      assert.notEqual(firstIdentity.playerId, secondIdentity.playerId);

      const movementSeenBySecond = second.waitFor(
        (message) =>
          message.type === "world.snapshot" &&
          message.players.some((player) =>
            player.playerId === firstIdentity.playerId && player.position.x > 725,
          ),
      );
      first.send({
        type: "movement.input",
        sequence: 1,
        direction: { x: 1, y: 0 },
        running: false,
      });
      const snapshot = await movementSeenBySecond;
      const movingPlayer = snapshot.players.find((player) => player.playerId === firstIdentity.playerId);
      assert.ok(movingPlayer.position.x > 725);

      await delay(70);
      first.send({
        type: "movement.input",
        sequence: 2,
        direction: { x: 0, y: 0 },
        running: false,
      });
      const firstChat = first.waitForType("chat.message");
      const secondChat = second.waitForType("chat.message");
      first.send({ type: "chat.send", text: "Good morning, Dara!" });
      const [fromSender, fromNearbyPlayer] = await Promise.all([firstChat, secondChat]);
      assert.equal(fromSender.playerId, firstIdentity.playerId);
      assert.equal(fromNearbyPlayer.text, "Good morning, Dara!");
      assert.equal(fromNearbyPlayer.characterName, "Ayo");

      for (let index = 0; index < 4; index += 1) {
        const echoedChat = first.waitForType("chat.message");
        first.send({ type: "chat.send", text: `Nearby message ${index + 2}` });
        await echoedChat;
      }
      const chatRateLimit = first.waitFor(
        (message) => message.type === "error" && message.code === "rate_limited",
      );
      first.send({ type: "chat.send", text: "This should be rate-limited." });
      assert.equal((await chatRateLimit).code, "rate_limited");

      const interaction = second.waitForType("player.interaction");
      first.send({ type: "player.interact", action: "wave", targetPlayerId: secondIdentity.playerId });
      const wave = await interaction;
      assert.equal(wave.playerId, firstIdentity.playerId);
      assert.equal(wave.targetPlayerId, secondIdentity.playerId);

      await delay(60);
      const error = first.waitForType("error");
      first.send({ type: "movement.input", sequence: 3, direction: { x: 3, y: 0 }, running: false });
      assert.equal((await error).code, "invalid_movement");
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  }, { gameMinuteMs: 10_000, broadcastIntervalMs: 25, tickIntervalMs: 10 });
});

test("two geographic clients synchronize in one chunk then filter a player outside nearby interest", async () => {
  await withServer(async ({ websocketUrl }) => {
    const first = await openPeer(websocketUrl);
    const second = await openPeer(websocketUrl);
    try {
      const firstIdentity = await createCharacter(first, "Ayo", {
        geographic_location: { region_id: AKURE_REGION_ID, latitude: 7.25, longitude: 5.2 },
      });
      assert.equal(firstIdentity.ready.character.current_location, "town");
      const firstLocation = firstIdentity.ready.character.geographic_location;
      assert.equal(firstLocation.region_id, AKURE_REGION_ID);
      assert.equal(firstLocation.chunk_id, "ng:500m:1142:1612");

      const secondIdentity = await createCharacter(second, "Dara", {
        geographic_location: { region_id: AKURE_REGION_ID, latitude: 7.2501, longitude: 5.2002 },
      });
      const firstPresence = secondIdentity.ready.players.find(
        (presence) => presence.playerId === firstIdentity.playerId,
      );
      assert.ok(firstPresence, "same-chunk player should be present in session.ready");
      assert.equal(firstPresence.regionId, AKURE_REGION_ID);
      assert.equal(firstPresence.chunkId, firstLocation.chunk_id);
      assert.equal(firstPresence.geographicLocation.chunk_id, firstLocation.chunk_id);
      const joined = await first.waitFor(
        (message) => message.type === "presence.joined" && message.player.playerId === secondIdentity.playerId,
      );
      assert.equal(joined.player.geographicLocation.region_id, AKURE_REGION_ID);

      await first.waitFor(
        (message) =>
          message.type === "world.snapshot" &&
          message.players.some((presence) => presence.playerId === secondIdentity.playerId),
      );
      const nearbyRemoval = first.waitFor(
        (message) =>
          message.type === "world.snapshot" &&
          !message.players.some((presence) => presence.playerId === secondIdentity.playerId),
        5000,
      );
      const movedToDifferentChunk = second.waitFor(
        (message) =>
          message.type === "world.snapshot" &&
          message.players.some((presence) =>
            presence.playerId === secondIdentity.playerId && presence.chunkId !== firstLocation.chunk_id,
          ),
        5000,
      );
      const stopAt = Date.now() + 2500;
      let sequence = 0;
      while (Date.now() < stopAt) {
        sequence += 1;
        second.send({
          type: "movement.input",
          sequence,
          direction: { x: 1, y: 0 },
          running: true,
        });
        await delay(50);
      }
      second.send({
        type: "movement.input",
        sequence: sequence + 1,
        direction: { x: 0, y: 0 },
        running: false,
      });
      const [removed, moved] = await Promise.all([nearbyRemoval, movedToDifferentChunk]);
      const secondPresence = moved.players.find((presence) => presence.playerId === secondIdentity.playerId);
      assert.notEqual(secondPresence.chunkId, firstLocation.chunk_id);
      assert.equal(removed.players.some((presence) => presence.playerId === secondIdentity.playerId), false);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  }, { gameMinuteMs: 10_000, broadcastIntervalMs: 25, tickIntervalMs: 10 });
});

test("geographic entry is server-derived, outdoor-only, and can be cleared", async () => {
  await withServer(async ({ websocketUrl }) => {
    const peer = await openPeer(websocketUrl);
    try {
      const invalidPeer = await openPeer(websocketUrl);
      try {
        const invalid = invalidPeer.waitForType("error");
        invalidPeer.send({
          type: "identity.create",
          creationKey: randomBytes(32).toString("hex"),
          profile: {
            name: "Out of bounds",
            age: 15,
            character_type: "girl",
            geographic_location: { region_id: AKURE_REGION_ID, latitude: 7.3, longitude: 5.2 },
          },
        });
        assert.equal((await invalid).code, "invalid_geographic_location");
      } finally {
        await invalidPeer.close();
      }

      const identity = await createCharacter(peer, "Bisi", {
        geographic_location: { region_id: AKURE_REGION_ID, latitude: 7.25, longitude: 5.2 },
      });
      const left = peer.waitFor(
        (message) => message.type === "character.snapshot" && message.character.geographic_location === null,
      );
      peer.send({ type: "geography.leave" });
      assert.equal((await left).character.geographic_location, null);

      const refused = peer.waitFor((message) => message.type === "error" && message.code === "geography_region_unavailable");
      peer.send({ type: "geography.enter", regionId: "ng:region:not-available" });
      assert.equal((await refused).code, "geography_region_unavailable");

      const rejoined = peer.waitFor(
        (message) => message.type === "character.snapshot" && message.character.geographic_location !== null,
      );
      peer.send({ type: "geography.enter", regionId: AKURE_REGION_ID });
      const snapshot = await rejoined;
      assert.equal(snapshot.character.current_location, "town");
      assert.equal(snapshot.character.geographic_location.region_id, AKURE_REGION_ID);
      assert.equal(snapshot.character.geographic_location.chunk_id, identity.ready.character.geographic_location.chunk_id);
    } finally {
      await peer.close();
    }
  }, { gameMinuteMs: 10_000, broadcastIntervalMs: 25, tickIntervalMs: 10 });
});

test("malformed and untrusted payloads are rejected without changing server-owned values", async () => {
  await withServer(async ({ websocketUrl, stateFile }) => {
    const peer = await openPeer(websocketUrl);
    try {
      const identity = await createCharacter(peer, "Kemi", {
        money: 0,
        health: 0,
        inventory: [],
        current_location: "market",
        appearance: {
          skin_tone: "not-a-supported-tone",
          hairstyle: "untrusted-style",
          clothing_color: "#ffffff",
        },
      });
      assert.equal(identity.ready.character.money, 5000);
      assert.equal(identity.ready.character.health, 100);
      assert.equal(identity.ready.character.current_location, "home");
      assert.equal(identity.ready.character.geographic_location, null);
      assert.equal(identity.ready.character.inventory.length, 5);
      assert.equal(identity.ready.character.appearance.skin_tone, "#9b654d");
      assert.equal(identity.ready.character.appearance.hairstyle, "Short curls");

      const invalid = peer.waitForType("error");
      peer.send({ type: "chat.send", text: "\u0000spam" });
      assert.equal((await invalid).code, "chat_invalid");

      const unknown = peer.waitForType("error");
      peer.send({ type: "character.setMoney", money: 0 });
      assert.equal((await unknown).code, "unknown_message");

      const state = JSON.parse(await readFile(stateFile, "utf8"));
      assert.equal(state.players[identity.playerId].character.money, 5000);
    } finally {
      await peer.close();
    }
  });
});

test("unauthenticated commands and duplicate identity creation are bounded per socket", async () => {
  await withServer(async ({ websocketUrl, stateFile }) => {
    const peer = await openPeer(websocketUrl);
    try {
      const rateLimit = peer.waitFor(
        (message) => message.type === "error" && message.code === "rate_limited",
      );
      for (let index = 0; index < 21; index += 1) {
        peer.send({ type: "not-a-command" });
      }
      assert.equal((await rateLimit).code, "rate_limited");

      await peer.close();
      const identityPeer = await openPeer(websocketUrl);
      try {
        const creationKey = randomBytes(32).toString("hex");
        identityPeer.send({
          type: "identity.create",
          creationKey,
          profile: { name: "Mina", age: 15, character_type: "androgynous" },
        });
        const created = await identityPeer.waitForType("identity.created");
        const repeated = identityPeer.waitForType("error");
        identityPeer.send({
          type: "identity.create",
          creationKey: randomBytes(32).toString("hex"),
          profile: { name: "A second character", age: 16, character_type: "girl" },
        });
        assert.equal((await repeated).code, "already_authenticated");
        const state = JSON.parse(await readFile(stateFile, "utf8"));
        assert.equal(Object.keys(state.players).length, 1);
        assert.equal(state.players[created.playerId].character.name, "Mina");
      } finally {
        await identityPeer.close();
      }
    } finally {
      await peer.close();
    }
  });
});

test("state-changing requests require IDs and do not replay a successful travel", async () => {
  const token = "A".repeat(43);
  const createdAt = new Date().toISOString();
  const playerId = "player-idempotency-test";
  const seededState = {
    schemaVersion: 1,
    worldId: "nigeria-main",
    worldClock: { day: 1, minute_of_day: 470, updated_at: createdAt },
    players: {
      [playerId]: {
        playerId,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        creationKeyHash: createHash("sha256").update("B".repeat(64)).digest("hex"),
        recentRequestIds: [],
        createdAt,
        lastSeen: createdAt,
        character: {
          player_id: playerId,
          character_id: "character-idempotency-test",
          name: "Tomi",
          age: 16,
          character_type: "androgynous",
          appearance: {},
          money: 5000,
          health: 100,
          energy: 90,
          hunger: 80,
          education_level: "Secondary school (prototype)",
          school_id: "idera_secondary_school",
          home_id: "home-idempotency-test",
          current_location: "home",
          position: { x: 220, y: 600 },
          direction: { x: 0, y: 1 },
          inventory: [],
          academic_scores: { Mathematics: 72 },
          attendance: [],
          reputation: 0,
          household: {},
          created_at: createdAt,
          updated_at: createdAt,
        },
      },
    },
  };
  await withServer(async ({ websocketUrl, stateFile }) => {
    const peer = await openPeer(websocketUrl);
    try {
      peer.send({ type: "session.resume", sessionToken: token });
      const ready = await peer.waitForType("session.ready");
      assert.equal(ready.character.geographic_location, null);

      const missingId = peer.waitForType("error");
      peer.send({ type: "world.travel", exitId: "home-front-door" });
      assert.equal((await missingId).code, "request_id_required");

      const firstSnapshot = peer.waitFor(
        (message) =>
          message.type === "character.snapshot" && message.character.current_location === "town",
      );
      const requestId = "travel-request-123";
      peer.send({ type: "world.travel", exitId: "home-front-door", requestId });
      await firstSnapshot;

      const duplicate = peer.waitForType("command.duplicate");
      peer.send({ type: "world.travel", exitId: "home-front-door", requestId });
      assert.equal((await duplicate).requestId, requestId);
      await delay(50);
      const saved = JSON.parse(await readFile(stateFile, "utf8"));
      assert.equal(saved.players[playerId].character.current_location, "town");
      assert.equal(saved.players[playerId].character.geographic_location, null);
      assert.deepEqual(saved.players[playerId].recentRequestIds, [requestId]);
    } finally {
      await peer.close();
    }
  }, {
    gameMinuteMs: 10_000,
    beforeStart: async (stateFile) => writeFile(stateFile, JSON.stringify(seededState)),
  });
});

test("identity creation retries recover the same player without duplicating records", async () => {
  await withServer(async ({ websocketUrl, stateFile }) => {
    const first = await openPeer(websocketUrl);
    const creationKey = randomBytes(32).toString("hex");
    const profile = { name: "Moyo", age: 15, character_type: "androgynous", appearance: {} };
    first.send({ type: "identity.create", creationKey, profile });
    const original = await first.waitForType("identity.created");
    await first.close();

    const retry = await openPeer(websocketUrl);
    try {
      retry.send({ type: "identity.create", creationKey, profile });
      const recovered = await retry.waitForType("identity.created");
      assert.equal(recovered.playerId, original.playerId);
      assert.notEqual(recovered.sessionToken, original.sessionToken);
      retry.send({ type: "session.resume", sessionToken: recovered.sessionToken });
      const ready = await retry.waitForType("session.ready");
      assert.equal(ready.playerId, original.playerId);
      const saved = JSON.parse(await readFile(stateFile, "utf8"));
      assert.equal(Object.keys(saved.players).length, 1);
      assert.notEqual(JSON.stringify(saved).includes(creationKey), true);
    } finally {
      await retry.close();
    }
  });
});

test("session and character state persist through disconnect and API restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-reconnect-test-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const firstServer = await startServer(stateFile, {
    gameMinuteMs: 10_000,
    broadcastIntervalMs: 25,
    tickIntervalMs: 10,
  });
  const firstPeer = await openPeer(firstServer.websocketUrl);
  let identity;
  try {
    identity = await createCharacter(firstPeer, "Sade");
    const moved = firstPeer.waitForType("world.snapshot");
    firstPeer.send({
      type: "movement.input",
      sequence: 1,
      direction: { x: 1, y: 0 },
      running: false,
    });
    await moved;
    await delay(120);
  } finally {
    await firstPeer.close();
  }
  await stopServer(firstServer.server);

  const onDisk = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(onDisk.players[identity.playerId].character.name, "Sade");
  assert.equal(JSON.stringify(onDisk).includes(identity.sessionToken), false);
  const savedPosition = onDisk.players[identity.playerId].character.position;
  assert.ok(savedPosition.x > 720);

  const secondServer = await startServer(stateFile, {
    gameMinuteMs: 10_000,
    broadcastIntervalMs: 25,
    tickIntervalMs: 10,
  });
  const secondPeer = await openPeer(secondServer.websocketUrl);
  try {
    secondPeer.send({ type: "session.resume", sessionToken: identity.sessionToken });
    const ready = await secondPeer.waitForType("session.ready");
    assert.equal(ready.playerId, identity.playerId);
    assert.equal(ready.character.name, "Sade");
    assert.deepEqual(ready.character.position, savedPosition);
    assert.equal(ready.character.geographic_location, null);
    assert.equal(ready.character.money, 5000);
  } finally {
    await secondPeer.close();
    await stopServer(secondServer.server);
  }
});

test("world clock is shared, advances on the server, and rolls over at midnight", async () => {
  await withServer(async ({ websocketUrl }) => {
    const first = await openPeer(websocketUrl);
    const second = await openPeer(websocketUrl);
    try {
      const firstIdentity = await createCharacter(first, "Bola");
      const secondIdentity = await createCharacter(second, "Lara");
      assert.equal(firstIdentity.ready.world.clock.day, 4);
      const rollover = await first.waitFor(
        (message) => message.type === "world.snapshot" && message.clock.day === 5,
        3000,
      );
      assert.equal(rollover.clock.minute_of_day, 0);
      const secondSnapshot = await second.waitFor(
        (message) => message.type === "world.snapshot" && message.clock.day === 5,
      );
      assert.equal(secondSnapshot.clock.day, 5);
      assert.notEqual(firstIdentity.playerId, secondIdentity.playerId);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  }, {
    gameMinuteMs: 100,
    broadcastIntervalMs: 20,
    tickIntervalMs: 10,
    beforeStart: async (stateFile) => {
      await writeFile(
        stateFile,
        JSON.stringify({
          schemaVersion: 1,
          worldId: "nigeria-main",
          worldClock: { day: 4, minute_of_day: 1439, updated_at: new Date().toISOString() },
          players: {},
        }),
      );
    },
  });
});

test("WebSocket upgrades enforce the configured browser Origin allowlist", async () => {
  await withServer(async ({ websocketUrl }) => {
    await assert.rejects(
      () => new Promise((resolve, reject) => {
        const socket = new WebSocket(websocketUrl, { origin: "https://example.invalid" });
        socket.once("open", () => {
          socket.close();
          resolve();
        });
        socket.once("error", reject);
      }),
      /Unexpected server response: 403/,
    );
  });
}, { allowedOrigins: ["https://game.example"] });
