#!/usr/bin/env node
// Stage 44: fixture tool for the Godot business integration runs. It is NOT a game feature and is not used by the server.
//
// Why it exists: a new character starts with ₦5,000 (game/scripts/domain/character_state.gd), and a provision store costs
// ₦80,000 to set up. A Godot run cannot create a business from a fresh character, so the fixture gives the test
// characters money. The money is set in the saved world file while the server is STOPPED, because the file backend
// keeps the world in memory and would overwrite an edit made while it runs. This is the same adjustment the Stage 43
// socket helper makes in memory (services/world-api/test/support/business-socket.mjs, `citizen`): the character's
// money, its cash account balance, and an adult date of birth. No business, stock, or ledger row is written here.
//
// Subcommands (run from the repository root, with Node 22):
//   create --url ws://127.0.0.1:3000/ws --out <sessions.json> [--roles owner,buyer,candidate,stranger]
//       Server RUNNING. Creates each character over the real socket (identity.create), resumes it, and writes
//       the session tokens to <sessions.json>. Tokens are secrets: keep the file outside the repository.
//   fund --data <world.json> --sessions <sessions.json>
//       Server STOPPED. Sets the cash, age, and date of birth of each role, and writes the file atomically.
//   report --data <world.json> [--sessions <sessions.json>]
//       Read-only. Prints the cash, business balances, stock, and recent ledger rows for the fixture world.
//
// Test money targets are in TARGET_CASH_NGN. They are fixture values, not game economy values.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const TARGET_CASH_NGN = { owner: 400_000, buyer: 60_000, candidate: 0, stranger: 5_000 };
const DEFAULT_ROLES = ["owner", "buyer", "candidate", "stranger"];

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      out[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else out._.push(argv[i]);
  }
  return out;
}

function fail(message) {
  console.error(`provision: ${message}`);
  process.exit(1);
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const queue = [];
    const waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const index = waiters.findIndex((w) => w.test(message));
      if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
      else queue.push(message);
    });
    socket.on("open", () => resolve({
      send: (message) => socket.send(JSON.stringify(message)),
      waitFor: (test, ms = 15000) => {
        const found = queue.findIndex(test);
        if (found >= 0) return Promise.resolve(queue.splice(found, 1)[0]);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error("timed out waiting for the server")), ms);
          waiters.push({ test, resolve: (m) => { clearTimeout(timer); res(m); } });
        });
      },
      close: () => socket.close(),
    }));
    socket.on("error", reject);
  });
}

async function create(options) {
  const url = options.url;
  const out = options.out;
  if (!url || !out) fail("create needs --url and --out");
  const roles = (options.roles ?? DEFAULT_ROLES.join(",")).split(",").map((r) => r.trim()).filter(Boolean);
  const result = {};
  const suffix = randomBytes(3).toString("hex");
  for (const role of roles) {
    const peer = await openSocket(url);
    peer.send({
      type: "identity.create",
      creationKey: randomBytes(32).toString("hex"),
      profile: {
        name: `Stage44 ${role} ${suffix}`, age: 16, character_type: "girl",
        appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" },
      },
    });
    const created = await peer.waitFor((m) => m.type === "identity.created" || m.type === "identity.error" || m.type === "error");
    if (created.type !== "identity.created") fail(`identity.create for ${role} was refused: ${JSON.stringify(created)}`);
    peer.send({ type: "session.resume", sessionToken: created.sessionToken });
    const ready = await peer.waitFor((m) => m.type === "session.ready" || m.type === "session.error" || m.type === "error");
    if (ready.type !== "session.ready") fail(`session.resume for ${role} failed: ${JSON.stringify(ready)}`);
    result[role] = {
      playerId: created.playerId,
      characterId: ready.character.character_id,
      name: ready.character.name,
      sessionToken: created.sessionToken,
    };
    peer.close();
  }
  writeFileSync(out, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(`provision: wrote ${roles.length} sessions to ${out} (tokens are secrets; keep this file outside the repository)`);
  for (const role of roles) console.log(`  ${role}: ${result[role].characterId}`);
}

function loadWorld(path) {
  if (!existsSync(path)) fail(`no world file at ${path}`);
  const world = JSON.parse(readFileSync(path, "utf8"));
  if (!world.players || !world.economyAccounts) fail("the file is not a world state");
  return world;
}

function cashAccount(world, characterId) {
  const accounts = Object.values(world.economyAccounts).filter(
    (a) => a.kind === "cash" && a.character_id === characterId,
  );
  if (accounts.length !== 1) fail(`expected one cash account for ${characterId}, found ${accounts.length}`);
  return accounts[0];
}

async function fund(options) {
  const { data, sessions } = options;
  if (!data || !sessions) fail("fund needs --data and --sessions");
  // The server must be stopped: an edit under a running file backend is overwritten on its next save.
  const stillUp = await new Promise((resolve) => {
    const probe = new WebSocket(options.probe ?? "ws://127.0.0.1:3000/ws");
    probe.on("open", () => { probe.close(); resolve(true); });
    probe.on("error", () => resolve(false));
  });
  if (stillUp) fail("a server is still listening on the probe URL. Stop it before funding the fixture.");
  const world = loadWorld(data);
  const roles = JSON.parse(readFileSync(sessions, "utf8"));
  const year = world.worldClock.world_date.year;
  for (const [role, record] of Object.entries(roles)) {
    const target = TARGET_CASH_NGN[role];
    if (target === undefined) fail(`no cash target for role ${role}`);
    const player = world.players[record.playerId];
    if (!player) fail(`player ${record.playerId} is not in the world file`);
    const account = cashAccount(world, record.characterId);
    player.character.date_of_birth = { year: year - 30, month: 1, day: 1 };
    player.character.age = 30;
    player.character.money = target;
    account.balance_ngn = target;
    console.log(`fund: ${role} -> cash ₦${target.toLocaleString("en-NG")} (adult)`);
  }
  const temp = `${data}.provision-tmp`;
  writeFileSync(temp, JSON.stringify(world, null, 2));
  renameSync(temp, data);
  console.log(`fund: wrote ${data}`);
}

function report(options) {
  const world = loadWorld(options.data);
  const roles = options.sessions && existsSync(options.sessions)
    ? JSON.parse(readFileSync(options.sessions, "utf8")) : {};
  const out = { world_date: world.worldClock.world_date, roles: {}, businesses: {} };
  for (const [role, record] of Object.entries(roles)) {
    out.roles[role] = { character_id: record.characterId, cash_ngn: cashAccount(world, record.characterId).balance_ngn };
  }
  for (const business of Object.values(world.businesses)) {
    // The business account is kind "current" and its holder is the business ID (businesses/service.ts).
    const account = Object.values(world.economyAccounts).find(
      (a) => a.kind === "current" && a.character_id === business.business_id,
    );
    out.businesses[business.name] = {
      business_id: business.business_id,
      status: business.status,
      balance_ngn: business.balance_ngn,
      account_balance_ngn: account?.balance_ngn ?? null,
      stock: Object.values(world.businessInventory)
        .filter((i) => i.business_id === business.business_id)
        .map((i) => ({ product: i.product_definition_id, quantity: i.quantity })),
      ledger: Object.values(world.economyTransactions ?? {})
        .filter((t) => account !== undefined && t.account_id === account.account_id)
        .map((t) => ({
          kind: t.kind, amount_ngn: t.amount_ngn, balance_after_ngn: t.balance_after_ngn,
          counterparty_account_id: t.counterparty_account_id,
        })),
      products: Object.values(world.businessProducts ?? {})
        .filter((p) => p.business_id === business.business_id)
        .map((p) => ({
          product_definition_id: p.product_definition_id, display_name: p.display_name,
          price_ngn: p.price_ngn, available: p.available,
        })),
      branches: Object.values(world.businessBranches ?? {})
        .filter((b) => b.business_id === business.business_id)
        .map((b) => ({ name: b.name, location_id: b.location_id, status: b.status })),
      ownership: Object.values(world.businessOwnership ?? {})
        .filter((o) => o.business_id === business.business_id)
        .map((o) => ({ character_id: o.character_id, role: o.role, active: o.active ?? null })),
      sales_count: Object.values(world.businessSales ?? {})
        .filter((s) => s.business_id === business.business_id).length,
    };
  }
  console.log(JSON.stringify(out, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
const options = args(rest);
if (command === "create") await create(options);
else if (command === "fund") await fund(options);
else if (command === "report") report(options);
else fail("usage: provision.mjs create|fund|report (see the header of this file)");
