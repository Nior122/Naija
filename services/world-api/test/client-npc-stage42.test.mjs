// Stage 42: the Godot client's NPC social interface must agree with the server contract.
//
// These tests read the GDScript and TypeScript sources as text. They do not run Godot, so they cannot prove that the
// panel works on a screen. They prove that the action names, payload keys, message types, reply routing, and the
// rules about where state comes from match the server source, so a drift fails here. Runtime verification in Godot is
// a separate, still-open step (see docs/PHASE_1_FEATURE_INVENTORY.md).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relativePath) => readFileSync(`${root}${relativePath}`, "utf8");

const contract = read("game/scripts/domain/npc_social_contract.gd");
const npcPanel = read("game/scripts/ui/npc_panel.gd");
const prototypeGame = read("game/scripts/prototype_game.gd");
const prototypeUi = read("game/scripts/ui/prototype_ui.gd");
const worldEngine = read("services/world-api/src/multiplayer/world-engine.ts");
const socialSource = read("services/world-api/src/npc/social.ts");
const npcTypes = read("services/world-api/src/npc/types.ts");
const socialCatalogSource = read("services/world-api/src/npc/social-catalog.ts");
const residentCatalog = JSON.parse(read("game/data/npc/social_catalog.json"));

/** The body of a GDScript const declaration: from its "=" to the matching close bracket. */
function gdLiteral(source, name) {
  const start = source.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `${name} is declared`);
  const equals = source.indexOf("=", start);
  const open = source.slice(equals).search(/[[{]/) + equals;
  return source.slice(open, open + matchingEnd(source, open) + 1);
}

/** Index of the bracket that closes the one at `open`, skipping string literals. */
function matchingEnd(source, open) {
  const pairs = { "[": "]", "{": "}", "(": ")" };
  const stack = [pairs[source[open]]];
  let quote = "";
  for (let i = open + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i - open;
    }
  }
  throw new Error("unbalanced literal");
}

/** The source of a GDScript function, from its declaration to the next top-level declaration. */
function gdFunction(source, name) {
  const start = source.search(new RegExp(`^func ${name}\\(`, "m"));
  assert.notEqual(start, -1, `func ${name} exists`);
  const rest = source.slice(start + 1);
  const next = rest.search(/^(func |static func |var |const |signal |class_name |extends |enum )/m);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

/** The string values of a GDScript array literal, as a Set. */
function stringSet(literal) {
  return new Set([...literal.matchAll(/"(\w*)"/g)].map((m) => m[1]));
}

/** The NPC social actions the server accepts (NPC_SOCIAL_ACTIONS in social-catalog.ts). */
function serverActions() {
  const match = socialCatalogSource.match(/export const NPC_SOCIAL_ACTIONS[^=]*=\s*\[([^\]]*)\]/);
  assert.ok(match, "server declares NPC_SOCIAL_ACTIONS");
  return stringSet(match[1]);
}

/** The body of a TypeScript method, from its signature to the matching close brace. */
function tsMethod(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} exists`);
  const open = source.indexOf("{", start + signature.length);
  return source.slice(start, open + matchingEnd(source, open) + 1);
}

/** All client source files under game/scripts, as text. */
function allClientSources(dir = `${root}game/scripts`) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...allClientSources(path));
    else if (path.endsWith(".gd")) out.push(readFileSync(path, "utf8"));
  }
  return out;
}

// --- Tables ------------------------------------------------------------------------------------------------------------

const clientActions = stringSet(gdLiteral(contract, "ACTIONS"));
const clientConfirm = stringSet(gdLiteral(contract, "CONFIRM_ACTIONS"));

describe("Stage 42 contract parsers find real content", () => {
  test("the tables are non-empty, so the comparisons below are not vacuous", () => {
    assert.equal(clientActions.size, 5, "five client actions parsed");
    assert.equal(serverActions().size, 5, "five server actions parsed");
    assert.ok(worldEngine.includes('case "npc.action"'), "server dispatches npc.action");
    assert.ok(worldEngine.includes('case "npc.view"'), "server dispatches npc.view");
  });
});

describe("Stage 42 client action tables match the server", () => {
  test("the client's actions are exactly the server's actions", () => {
    assert.deepEqual([...clientActions].sort(), [...serverActions()].sort());
  });

  test("every action the client asks to confirm is a server action", () => {
    for (const action of clientConfirm) assert.ok(clientActions.has(action), `${action} is a client action`);
    assert.ok(clientConfirm.has("argue"), "arguing asks for confirmation before it is sent");
  });

  test("the server reads the top-level action and npcId the client sends", () => {
    const body = tsMethod(worldEngine, "private async npcAction(");
    assert.match(body, /message\.action/, "npcAction reads message.action");
    assert.match(body, /message\.npcId/, "npcAction reads message.npcId");
    const viewBody = tsMethod(worldEngine, "private npcView(");
    assert.match(viewBody, /message\.npcId/, "npcView reads message.npcId");
    assert.ok(gdLiteral(contract, "ACTION_KEYS").includes('"npcId"'), "the client sends npcId");
    assert.ok(gdLiteral(contract, "VIEW_KEYS").includes('"npcId"'), "the client sends npcId for the view");
  });

  test("the message types the client uses are the ones the server handles", () => {
    assert.ok(contract.includes('const CHANGING_MESSAGE := "npc.action"'));
    assert.ok(contract.includes('const VIEW_MESSAGE := "npc.view"'));
    for (const type of ["npc.result", "npc.error", "npc.view"]) {
      assert.ok(gdLiteral(contract, "REPLY_TYPES").includes(`"${type}"`), `${type} is a client reply type`);
      assert.ok(worldEngine.includes(`"${type}"`), `server sends ${type}`);
    }
  });
});

// --- Where the state comes from ----------------------------------------------------------------------------------------

describe("Stage 42 client state comes from the server", () => {
  test("the client declares no resident records: no catalogue name, ID or household key", () => {
    // The first names in household_factory.gd are a general name pool for generated characters, not residents, so the
    // check uses the catalogue's full names and its ID and household prefixes.
    const fullNames = residentCatalog.residents.map((r) => r.name);
    assert.ok(fullNames.length >= 6, "the catalogue lists the residents");
    const pattern = new RegExp(`${fullNames.join("|")}|npc-nb-|household-nb-`);
    for (const source of allClientSources()) {
      assert.doesNotMatch(source, pattern, "no hardcoded resident in the client");
    }
  });

  test("the panel never writes a score: the only payload keys are the protocol keys", () => {
    assert.ok(!gdLiteral(contract, "ACTION_KEYS").includes("affinity"));
    assert.doesNotMatch(npcPanel, /affinity\s*=/, "the panel does not assign affinity");
    assert.doesNotMatch(npcPanel, /\.bond\[|\["affinity"\]\s*=/, "the panel does not write bond values");
  });

  test("the panel reads the list and refusal sentences from the server's profile", () => {
    assert.ok(npcPanel.includes('"reason_message"'), "the panel shows the server's refusal sentence");
    assert.ok(socialSource.includes("reason_message:"), "the server sends reason_message on each action row");
    assert.ok(npcTypes.includes("reason_message: string | null"), "the server type declares reason_message");
    assert.ok(npcPanel.includes('"tier_label"') && npcPanel.includes('"activity_label"'), "labels come from the server");
    assert.ok(!npcPanel.includes('"Hostile"') && !npcPanel.includes('"Friend"'), "no client-side tier names");
  });

  test("the snapshot carries npc_profiles and the client reads them", () => {
    assert.ok(worldEngine.includes("snapshot.npc_profiles = visibleNPCProfiles("), "server adds npc_profiles to the snapshot");
    assert.ok(prototypeGame.includes('character_data.get("npc_profiles"'), "client reads npc_profiles");
    assert.ok(prototypeGame.includes("ui.update_npc_profiles(_online_npc_profiles)"), "client refreshes the open panel");
  });

  test("the offline screen shows no placeholder residents", () => {
    assert.ok(npcPanel.includes("no local placeholder"), "offline text says nothing is local");
    assert.ok(gdFunction(npcPanel, "_render").includes("if not _online:"), "offline render returns before any list");
  });
});

// --- Requests, confirmations, and tracking -----------------------------------------------------------------------------

describe("Stage 42 requests use the Stage 41 tracker and envelope", () => {
  test("every changing request begins a tracked request before it is emitted", () => {
    const change = gdFunction(npcPanel, "_change");
    const begin = change.indexOf("_tracker.begin(");
    const emit = change.indexOf("npc_action_requested.emit(");
    assert.ok(begin !== -1 && emit !== -1 && begin < emit, "_change begins the request, then emits it");
    const retry = gdFunction(npcPanel, "_retry_pending");
    assert.ok(retry.includes("_tracker.retry()"), "retry reuses the tracker's request ID");
    assert.ok(retry.includes("npc_action_requested.emit("), "retry emits with the tracker's ID");
    assert.equal(
      [...npcPanel.matchAll(/npc_action_requested\.emit\(/g)].length,
      2,
      "the panel emits a changing request only from _change and _retry_pending",
    );
  });

  test("the panel does not block while a request waits, and disables sending during a wait", () => {
    assert.ok(gdFunction(npcPanel, "_add_action_button").includes("not _tracker.has_pending()"));
    assert.ok(gdFunction(npcPanel, "_change").includes("request_id.is_empty()"), "a second request is refused");
  });

  test("the panel shows pending, unconfirmed, and discard states through the tracker", () => {
    const pending = gdFunction(npcPanel, "_add_pending_box");
    assert.ok(pending.includes("_tracker.is_waiting()"), "pending state is shown");
    assert.ok(pending.includes("_retry_pending"), "unconfirmed state offers a retry");
    assert.ok(pending.includes("_discard_pending"), "unconfirmed state offers a discard");
  });

  test("prototype_game sends through the shared send path with the request ID and a timeout", () => {
    const send = gdFunction(prototypeGame, "_send_tracked_command");
    assert.ok(send.includes("multiplayer_client.send_command(message_type, values, request_id)"));
    assert.ok(send.includes("ServerRequestTracker.REQUEST_TIMEOUT_SECONDS"), "a timeout is scheduled");
    assert.ok(send.includes("ui.show_send_failure(request_id, failure)"), "a send failure reaches the panel");
    const handler = gdFunction(prototypeGame, "_on_npc_action_requested");
    assert.ok(handler.includes("_send_tracked_command(NPCSocialContract.CHANGING_MESSAGE"));
  });

  test("the Stage 41 housing and business sender now goes through the same shared path", () => {
    assert.ok(gdFunction(prototypeGame, "_send_domain_action").includes("_send_tracked_command("));
  });

  test("the view is a read: it is not tracked and does not use a pending request", () => {
    const view = gdFunction(prototypeGame, "_on_npc_view_requested");
    assert.ok(!view.includes("_send_tracked_command"), "the view does not go through the tracked path");
    assert.ok(view.includes("multiplayer_client.send_command(NPCSocialContract.VIEW_MESSAGE"));
  });

  test("confirmation is shown before a damaging action is sent", () => {
    const onAction = gdFunction(npcPanel, "_on_action_pressed");
    assert.ok(onAction.includes("NPCSocialContract.needs_confirmation(action)"));
    assert.ok(onAction.indexOf("_confirm = {") < onAction.indexOf("_change(action, _selected_id)"));
  });
});

// --- Reply routing -----------------------------------------------------------------------------------------------------

describe("Stage 42 replies reach the tracker and the panel", () => {
  test("prototype_game routes the three NPC reply types to the UI", () => {
    assert.ok(prototypeGame.includes('"npc.result", "npc.error", "npc.view":'));
    assert.ok(prototypeGame.includes("ui.show_npc_response(message)"));
  });

  test("the UI owns the NPC tracker and updates it on every path a Stage 41 tracker is updated", () => {
    assert.ok(prototypeUi.includes("var _npc_tracker := ServerRequestTracker.new()"));
    for (const fn of ["show_command_duplicate", "show_connection_lost", "request_timed_out", "show_send_failure", "show_npc_response"]) {
      assert.ok(gdFunction(prototypeUi, fn).includes("_npc_tracker"), `${fn} updates the NPC tracker`);
    }
  });

  test("the NPC tracker survives a closed modal, as the Stage 41 trackers do", () => {
    const close = gdFunction(prototypeUi, "_close_modal");
    assert.ok(close.includes("_npc_panel = null"), "closing clears the panel reference only");
    assert.ok(!close.includes("_npc_tracker = "), "the tracker is not replaced when the modal closes");
  });

  test("a reply that answers a pending request is applied even when the panel is closed", () => {
    const response = gdFunction(prototypeUi, "show_npc_response");
    assert.ok(response.indexOf("apply_reply(message)") < response.indexOf("_npc_panel.apply_server_response"));
  });

  test("the panel is opened from the menu and is reachable from the menu grid", () => {
    assert.ok(prototypeUi.includes('_add_menu_button(menu_grid, "People", "people")'));
    assert.ok(prototypeGame.includes('"people":\n\t\t\tui.show_people(character, _online_mode, _online_npc_profiles)'));
  });
});
