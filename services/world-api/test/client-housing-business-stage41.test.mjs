// Stage 41: the Godot client's housing and business interface must agree with the server contract.
//
// These tests read the GDScript sources as text. They do not run Godot, so they cannot prove that a screen works. They
// prove that the action names, payload keys, role lists, and message wiring in the client match the server source, so
// that a drift between the two fails here. Runtime verification in Godot is a separate, still-open step (see
// docs/PHASE_1_FEATURE_INVENTORY.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relativePath) => readFileSync(`${root}${relativePath}`, "utf8");

const contract = read("game/scripts/domain/property_business_contract.gd");
const housingPanel = read("game/scripts/ui/housing_panel.gd");
const businessPanel = read("game/scripts/ui/business_panel.gd");
const trackerSource = read("game/scripts/services/server_request_tracker.gd");
const prototypeGame = read("game/scripts/prototype_game.gd");
const prototypeUi = read("game/scripts/ui/prototype_ui.gd");
const clientNetwork = read("game/scripts/services/multiplayer_client.gd");
const propertyEngine = read("services/world-api/src/multiplayer/world-engine.ts");
const businessService = read("services/world-api/src/businesses/service.ts");
const propertyService = read("services/world-api/src/properties/service.ts");
const propertyTypes = read("services/world-api/src/properties/types.ts");

// --- Parsers -----------------------------------------------------------------------------------------------------------

/** The body of a GDScript const/var declaration: from its opening bracket to the matching close bracket. */
function gdLiteral(source, name) {
  const start = source.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `${name} is declared`);
  // Start at the "=" so that a type annotation such as Array[String] is not mistaken for the value.
  const equals = source.indexOf("=", start);
  const open = source.slice(equals).search(/[[{]/) + equals;
  const close = open + matchingEnd(source, open);
  return source.slice(open, close + 1);
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
    if (ch === '"' || ch === "`" || ch === "'") quote = ch;
    else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i - open;
    }
  }
  throw new Error("unbalanced literal");
}

/** A GDScript Dictionary literal of the form "action": ["key", ...] as a Map. */
function actionKeyMap(literal) {
  const map = new Map();
  for (const match of literal.matchAll(/"(\w+)":\s*\[([^\]]*)\]/g)) {
    map.set(match[1], [...match[2].matchAll(/"(\w+)"/g)].map((m) => m[1]));
  }
  return map;
}

/** A GDScript Array literal of strings as a Set. */
function stringSet(literal) {
  return new Set([...literal.matchAll(/"(\w*)"/g)].map((m) => m[1]));
}

/** The body of a TypeScript function declaration, from its signature to the next top-level closing brace. */
function tsFunctionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} exists`);
  // The body opens with a brace at the end of a line. An inline object return type does not, so it is skipped.
  const bodyOpen = source.slice(start).search(/\{\s*\n/);
  assert.notEqual(bodyOpen, -1, `${signature} has a body`);
  const open = start + bodyOpen;
  return source.slice(start, open + matchingEnd(source, open) + 1);
}

/** The switch cases of a TypeScript action dispatcher: action name -> source text of its case block. */
function caseBlocks(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start !== -1 && end !== -1, `switch range ${from} .. ${to} found`);
  const region = source.slice(start, end);
  const blocks = new Map();
  const matches = [...region.matchAll(/case "(\w+)":/g)];
  matches.forEach((match, index) => {
    const stop = index + 1 < matches.length ? matches[index + 1].index : region.length;
    blocks.set(match[1], region.slice(match.index, stop));
  });
  return blocks;
}

/** The payload keys a server case block reads, and the subset that it requires. */
function serverKeys(block) {
  const read = new Set();
  const required = new Set();
  for (const m of block.matchAll(/requiredString\("(\w+)"/g)) required.add(m[1]);
  for (const m of block.matchAll(/requiredInteger\("(\w+)"/g)) required.add(m[1]);
  for (const m of block.matchAll(/payload\.(\w+)/g)) read.add(m[1]);
  for (const m of block.matchAll(/requiredString\("(\w+)"/g)) read.add(m[1]);
  for (const m of block.matchAll(/requiredInteger\("(\w+)"/g)) read.add(m[1]);
  return { read, required };
}

/** Each literal call _read("a", {...}), _change("a", {...}), _confirm_change("a", {...}) in a panel. */
function panelCalls(source, helper) {
  const calls = [];
  const pattern = new RegExp(`\\b${helper}\\("(\\w+)"\\s*,\\s*`, "g");
  for (const match of source.matchAll(pattern)) {
    const after = match.index + match[0].length;
    const bracket = source[after];
    if (bracket !== "{") {
      calls.push({ action: match[1], keys: null });
      continue;
    }
    const body = source.slice(after, after + matchingEnd(source, after) + 1);
    const keys = [...body.matchAll(/"(\w+)"\s*:/g)].map((m) => m[1]);
    calls.push({ action: match[1], keys: [...new Set(keys)] });
  }
  return calls;
}

// --- Tables -----------------------------------------------------------------------------------------------------------

const clientPropertyActions = actionKeyMap(gdLiteral(contract, "PROPERTY_ACTIONS"));
const clientBusinessActions = actionKeyMap(gdLiteral(contract, "BUSINESS_ACTIONS"));
const clientPropertyChanging = stringSet(gdLiteral(contract, "PROPERTY_CHANGING_ACTIONS"));
const clientBusinessChanging = stringSet(gdLiteral(contract, "BUSINESS_CHANGING_ACTIONS"));

const serverPropertyChanging = stringSet(
  propertyEngine.match(/PROPERTY_CHANGING_ACTIONS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "",
);
const propertyCases = caseBlocks(propertyEngine, 'case "market": {', "/** Stage 36: a reused request ID");
const businessCases = caseBlocks(propertyEngine, 'case "discover": {', 'default:\n          throw new Error("business_action_unknown")');

describe("Stage 41 contract parsers find real content", () => {
  test("the tables, server cases and panel calls are non-empty, so the comparisons below are not vacuous", () => {
    assert.ok(clientPropertyActions.size === 14, `14 housing actions parsed (got ${clientPropertyActions.size})`);
    // Stage 43: 19 business actions (10 from Stage 41, plus create, add_product, add_service, set_listing, update_price,
    // hire_employee, fire_employee, add_branch, transfer_ownership). Stage 45 added produce (20). record_expense is not in the client.
    assert.ok(clientBusinessActions.size === 20, `20 business actions parsed (got ${clientBusinessActions.size})`);
    assert.ok(clientPropertyChanging.size === 10, `10 housing changing actions (got ${clientPropertyChanging.size})`);
    // Stage 43: 17 changing actions (the 8 from Stage 41, plus the 9 new changing actions; discover and view are the reads).
    // Stage 45: produce is a changing action, so 18.
    assert.ok(clientBusinessChanging.size === 18, `18 business changing actions (got ${clientBusinessChanging.size})`);
    assert.ok(serverPropertyChanging.size === 10, `server has 10 housing changing actions (got ${serverPropertyChanging.size})`);
    assert.ok(propertyCases.size >= 13 && businessCases.size >= 10, "server switch cases were found");
    assert.ok(panelCalls(housingPanel, "_read").length >= 3, "housing panel reads were found");
    assert.ok(panelCalls(housingPanel, "_confirm_change").length >= 7, "housing confirmations were found");
    assert.ok(panelCalls(businessPanel, "_read").length >= 2, "business panel reads were found");
  });
});

describe("Stage 41 client action tables match the server", () => {
  test("every housing action the client names is a server property action", () => {
    for (const action of clientPropertyActions.keys()) {
      assert.ok(propertyCases.has(action), `server has property action ${action}`);
    }
  });

  test("the client's changing and read-only housing lists match the server's", () => {
    assert.deepEqual([...clientPropertyChanging].sort(), [...serverPropertyChanging].sort());
    for (const action of clientPropertyActions.keys()) {
      const changing = clientPropertyChanging.has(action);
      assert.equal(changing, serverPropertyChanging.has(action), `${action} changing flag agrees`);
    }
  });

  test("each housing action reads the payload keys the client sends, and requires the keys it needs", () => {
    for (const [action, keys] of clientPropertyActions) {
      const block = propertyCases.get(action);
      const { read, required } = serverKeys(block);
      for (const key of keys) {
        assert.ok(read.has(key), `${action} reads ${key} on the server`);
      }
      for (const key of required) {
        assert.ok(keys.includes(key), `${action} sends required key ${key}`);
      }
    }
  });

  test("housing market filters the client sends are filters the server applies", () => {
    const filterKeys = new Set([...propertyService.matchAll(/filters\.(\w+)/g)].map((m) => m[1]));
    for (const match of housingPanel.matchAll(/filters\["(\w+)"\]/g)) {
      assert.ok(filterKeys.has(match[1]), `server filters by ${match[1]}`);
    }
  });

  test("the client's rent periods and property conditions are server values", () => {
    const periods = stringSet(gdLiteral(contract, "RENT_PERIODS"));
    const conditions = stringSet(gdLiteral(contract, "PROPERTY_CONDITIONS"));
    const serverPeriods = new Set(
      [...propertyTypes.match(/export type PropertyRentPeriod = ([^;]+);/)[1].matchAll(/"(\w+)"/g)]
        .map((m) => m[1]),
    );
    const serverConditions = new Set(
      [...propertyTypes.match(/export type PropertyCondition = ([^;]+);/)[1].matchAll(/"(\w+)"/g)]
        .map((m) => m[1]),
    );
    for (const period of periods) assert.ok(serverPeriods.has(period), `period ${period} is a server value`);
    for (const condition of conditions) {
      assert.ok(serverConditions.has(condition), `condition ${condition} is a server value`);
    }
  });

  test("every business action the client names is a server business action", () => {
    for (const action of clientBusinessActions.keys()) {
      assert.ok(businessCases.has(action), `server has business action ${action}`);
    }
  });

  test("the client's changing business list is changing on the server (read-only is only discover and view)", () => {
    const readOnly = new Set(["discover", "view"]);
    for (const action of clientBusinessChanging) {
      assert.ok(!readOnly.has(action), `${action} is not read-only on the server`);
    }
    const clientReads = [...clientBusinessActions.keys()].filter((a) => !clientBusinessChanging.has(a));
    assert.deepEqual(clientReads.sort(), ["discover", "view"]);
  });

  test("each business action reads the payload keys the client sends, and requires the keys it needs", () => {
    for (const [action, keys] of clientBusinessActions) {
      const { read, required } = serverKeys(businessCases.get(action));
      for (const key of keys) {
        assert.ok(read.has(key), `${action} reads ${key} on the server`);
      }
      for (const key of required) {
        assert.ok(keys.includes(key), `${action} sends required key ${key}`);
      }
    }
  });

  test("the client's business role lists match the server's authorizeBusinessAction calls", () => {
    const roleMap = new Map(); // client action -> server function that enforces it
    roleMap.set("restock", "restockInventory");
    roleMap.set("contribute_capital", "contributeCapital");
    roleMap.set("withdraw", "withdrawFromBusiness");
    roleMap.set("pay_salary", "paySalary");
    roleMap.set("transfer_funds", "transferBetweenBusinesses");
    roleMap.set("close", "closeBusiness");
    roleMap.set("add_product", "addBusinessProduct");
    roleMap.set("add_service", "addBusinessProduct");
    roleMap.set("set_listing", "setBusinessListing");
    roleMap.set("update_price", "updateBusinessPrice");
    roleMap.set("hire_employee", "hireEmployee");
    roleMap.set("fire_employee", "fireEmployee");
    roleMap.set("add_branch", "addBranch");
    roleMap.set("transfer_ownership", "transferOwnership");
    roleMap.set("produce", "runProduction");
    const clientRoles = gdLiteral(contract, "BUSINESS_ROLES");
    for (const [action, serverFunction] of roleMap) {
      const body = tsFunctionBody(businessService, `export function ${serverFunction}(`);
      const call = body.match(/authorizeBusinessAction\([^;]*\[([^\]]*)\]\)/);
      // A function may name its role list in a constant (for example LISTING_ROLES); resolve that constant.
      const named = call ? null : body.match(/authorizeBusinessAction\([^;]*,\s*([A-Z_]+)\)/);
      const roleSource = call
        ? call[1]
        : (named ? (businessService.match(new RegExp(`const ${named[1]}[^=]*=\\s*\\[([^\\]]*)\\]`))?.[1] ?? null) : null);
      assert.ok(roleSource !== null, `${serverFunction} authorises by role`);
      const serverRoles = [...roleSource.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
      const clientMatch = clientRoles.match(new RegExp(`"${action}":\\s*\\[([^\\]]*)\\]`));
      assert.ok(clientMatch, `client lists roles for ${action}`);
      const clientList = [...clientMatch[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
      assert.deepEqual(clientList, serverRoles, `${action} roles agree with ${serverFunction}`);
    }
  });

  test("buying never names a payer or buyer: the payer is always the session character", () => {
    const forbidden = /^(buyer|payer|buyer_character_id|payer_character_id|seller|from_character_id)/;
    const allKeys = [
      ...[...clientPropertyActions.values()].flat(),
      ...[...clientBusinessActions.values()].flat(),
      ...panelCalls(housingPanel, "_confirm_change").flatMap((c) => c.keys ?? []),
      ...panelCalls(housingPanel, "_change").flatMap((c) => c.keys ?? []),
      ...panelCalls(businessPanel, "_confirm_change").flatMap((c) => c.keys ?? []),
      ...panelCalls(businessPanel, "_change").flatMap((c) => c.keys ?? []),
    ];
    for (const key of allKeys) assert.ok(!forbidden.test(key), `no client payload uses ${key}`);
  });
});

describe("Stage 41 panels call only server-backed actions with the payload keys the server reads", () => {
  test("housing reads and changes name table actions, and changing calls use changing actions", () => {
    for (const call of panelCalls(housingPanel, "_read")) {
      assert.ok(clientPropertyActions.has(call.action), `_read(${call.action}) is a housing action`);
      assert.ok(!clientPropertyChanging.has(call.action), `${call.action} is read-only`);
    }
    for (const helper of ["_change", "_confirm_change"]) {
      for (const call of panelCalls(housingPanel, helper)) {
        assert.ok(clientPropertyChanging.has(call.action), `${helper}(${call.action}) is a changing action`);
      }
    }
  });

  test("business reads and changes name table actions, and changing calls use changing actions", () => {
    for (const call of panelCalls(businessPanel, "_read")) {
      assert.ok(clientBusinessActions.has(call.action), `_read(${call.action}) is a business action`);
      assert.ok(!clientBusinessChanging.has(call.action), `${call.action} is read-only`);
    }
    for (const helper of ["_change", "_confirm_change"]) {
      for (const call of panelCalls(businessPanel, helper)) {
        assert.ok(clientBusinessChanging.has(call.action), `${helper}(${call.action}) is a changing action`);
      }
    }
  });

  test("literal payloads in the panels carry exactly the keys the tables define", () => {
    const checks = [
      [housingPanel, clientPropertyActions],
      [businessPanel, clientBusinessActions],
    ];
    for (const [source, table] of checks) {
      for (const helper of ["_read", "_change", "_confirm_change"]) {
        for (const call of panelCalls(source, helper)) {
          if (call.keys === null) continue;
          const expected = table.get(call.action);
          for (const key of call.keys) {
            assert.ok(expected.includes(key), `${call.action} payload key ${key} is in the table`);
          }
          for (const key of expected) {
            assert.ok(call.keys.includes(key), `${call.action} payload sends ${key}`);
          }
        }
      }
    }
  });

  test("filter payloads leave out 'Any' filters rather than sending an empty string", () => {
    assert.ok(!/"(listing_type|location_id)":\s*""/.test(housingPanel), "no empty-string filter literal");
    assert.match(housingPanel, /if not listing_type\.is_empty\(\):/);
    assert.match(housingPanel, /if not _location_filter\.is_empty\(\):/);
  });

  test("role-restricted business controls are gated with can_perform for the same action", () => {
    for (const action of [
      "restock", "pay_salary", "transfer_funds", "contribute_capital", "withdraw", "close",
      "add_product", "add_service", "set_listing", "update_price", "hire_employee", "fire_employee", "add_branch",
      "transfer_ownership",
    ]) {
      assert.match(
        businessPanel,
        new RegExp(`can_perform\\("${action}"`),
        `${action} is shown only when its role is authorised`,
      );
    }
  });

  test("the money forms send the keys the table defines (their action name is a variable)", () => {
    assert.match(businessPanel, /_confirm_change\(action, \{"business_id": business_id, "amount_ngn": value\}/);
    assert.deepEqual(clientBusinessActions.get("withdraw"), ["business_id", "amount_ngn"]);
    assert.deepEqual(clientBusinessActions.get("contribute_capital"), ["business_id", "amount_ngn"]);
  });

  test("integers are checked locally before sending, and rejected values never reach the server", () => {
    assert.match(contract, /static func parse_whole/);
    const sends = [...housingPanel.matchAll(/_change\(|_confirm_change\(/g)].length;
    assert.ok(sends > 0);
    assert.match(housingPanel, /parse_whole\(quantity\.text\)/);
    assert.match(businessPanel, /parse_whole\(amount\.text\)/);
  });
});

describe("Stage 41 request state and wiring", () => {
  test("a changing request is tracked with a stable request ID, and retry reuses it", () => {
    assert.match(trackerSource, /func begin\(/);
    assert.match(trackerSource, /func retry\(\) -> String:/);
    assert.match(trackerSource, /_request_id = _new_request_id\(\)/);
    // retry() returns the same _request_id; begin() is the only place a new ID is generated.
    assert.equal([...trackerSource.matchAll(/_new_request_id\(\)/g)].length, 2, "one definition and one call");
  });

  test("a request is resolved only by a definitive reply, and *_not_saved / *_outcome_unknown stay unconfirmed", () => {
    assert.match(trackerSource, /func is_unconfirmed_code\(code: String\) -> bool:/);
    assert.match(trackerSource, /code\.ends_with\("_not_saved"\) or code\.ends_with\("_outcome_unknown"\)/);
    assert.match(trackerSource, /func apply_reply\(message: Dictionary\) -> bool:/);
  });

  test("prototype_game sends housing and business actions over the existing socket with the request ID", () => {
    // Stage 42 moved the send into a shared path (_send_tracked_command), which the housing and business sender now
    // calls. The envelope {action, payload} and the request ID are still what reaches the socket.
    assert.match(
      prototypeGame,
      /_send_domain_action\([\s\S]*?_send_tracked_command\(\s*message_type, \{"action": action, "payload": payload\.duplicate\(true\)\}, request_id\s*\)/,
    );
    assert.match(
      prototypeGame,
      /func _send_tracked_command\([\s\S]*?multiplayer_client\.send_command\(message_type, values, request_id\)/,
    );
    assert.match(prototypeGame, /_send_domain_action\("property\.action"/);
    assert.match(prototypeGame, /_send_domain_action\("business\.action"/);
    assert.match(clientNetwork, /func send_command\(\s*message_type: String, values: Dictionary = \{\}, request_id: String = ""/);
    assert.match(clientNetwork, /payload\["requestId"\] = request_id if not request_id\.is_empty\(\) else _new_request_id\(\)/);
  });

  test("typed replies are routed to the panels, and command.duplicate releases the matching request", () => {
    assert.match(prototypeGame, /"property\.result", "property\.error":\s*\n\s*ui\.show_housing_response\(message\)/);
    assert.match(prototypeGame, /"business\.result", "business\.error":\s*\n\s*ui\.show_business_response\(message\)/);
    assert.match(prototypeGame, /"command\.duplicate":\s*\n\s*ui\.show_command_duplicate\(/);
  });

  test("a lost connection marks a waiting change unconfirmed, and a send failure never leaves it pending", () => {
    assert.match(prototypeGame, /status == "reconnecting" or status == "offline"/);
    assert.match(prototypeGame, /ui\.show_connection_lost\(/);
    assert.match(prototypeGame, /ui\.show_send_failure\(request_id, failure\)/);
    assert.match(prototypeUi, /func show_send_failure\(/);
    assert.match(trackerSource, /func apply_send_failure\(/);
  });

  test("a request with no answer in time is marked unconfirmed by a timer, and not retried automatically", () => {
    assert.match(prototypeGame, /create_timer\(ServerRequestTracker\.REQUEST_TIMEOUT_SECONDS\)/);
    assert.match(trackerSource, /const REQUEST_TIMEOUT_SECONDS := 20\.0/);
    assert.match(trackerSource, /func apply_timeout\(/);
    assert.doesNotMatch(prototypeGame, /retry\(\)/, "the game never retries a change without the player");
  });

  test("profiles refresh from session.ready and from character.snapshot", () => {
    const sessionReady = prototypeGame.slice(
      prototypeGame.indexOf("func _on_online_session_ready("),
      prototypeGame.indexOf("func _on_online_message("),
    );
    assert.match(sessionReady, /_store_online_profiles\(character_data\)/);
    const snapshot = prototypeGame.slice(
      prototypeGame.indexOf('"character.snapshot":'),
      prototypeGame.indexOf('"world.snapshot":'),
    );
    assert.match(snapshot, /_store_online_profiles\(character_data\)/);
  });

  test("a changing button is disabled while a request waits, and confirmation never sends without the player", () => {
    assert.match(housingPanel, /disabled = _tracker\.has_pending\(\)/);
    assert.match(businessPanel, /disabled = _tracker\.has_pending\(\)/);
    assert.match(housingPanel, /_change\(str\(pending\.get\("action", ""\)\), pending\.get\("payload", \{\}\)\)/);
    assert.match(businessPanel, /_change\(str\(pending\.get\("action", ""\)\), pending\.get\("payload", \{\}\)\)/);
    assert.match(housingPanel, /func _on_confirm_pressed\(\) -> void:/);
    assert.match(businessPanel, /func _on_confirm_pressed\(\) -> void:/);
  });

  test("the UI layer owns the trackers, so a request keeps its state when a modal closes", () => {
    assert.match(prototypeUi, /var _housing_tracker := ServerRequestTracker\.new\(\)/);
    assert.match(prototypeUi, /var _business_tracker := ServerRequestTracker\.new\(\)/);
    assert.match(prototypeUi, /_housing_panel\.bind_tracker\(_housing_tracker\)/);
    assert.match(prototypeUi, /_business_panel\.bind_tracker\(_business_tracker\)/);
  });

  test("the HUD opens both screens from the server-backed profile records", () => {
    assert.match(prototypeUi, /_add_menu_button\(menu_grid, "Housing", "housing"\)/);
    assert.match(prototypeUi, /_add_menu_button\(menu_grid, "Businesses", "businesses"\)/);
    assert.match(prototypeGame, /"housing":\s*\n\s*ui\.show_housing\(/);
    assert.match(prototypeGame, /"businesses":\s*\n\s*ui\.show_businesses\(/);
  });
});

// Stage 43: the lifecycle screens. Financial and destructive actions are confirmed first; listing, staffing, and branch
// actions are sent directly (they move no money), and each is still checked by the server.
describe("Stage 43 lifecycle screens", () => {
  const confirmed = new Set(panelCalls(businessPanel, "_confirm_change").map((c) => c.action));
  const sentDirectly = new Set(panelCalls(businessPanel, "_change").map((c) => c.action));

  test("every financial or destructive business action asks for confirmation first", () => {
    for (const action of [
      "create", "buy_product", "buy_service", "restock", "pay_salary", "transfer_funds", "fire_employee",
      "transfer_ownership", "close",
    ]) {
      assert.ok(confirmed.has(action), `${action} is sent through _confirm_change`);
    }
    // The two money forms pass their action name as a variable, so the literal scan cannot see them. They are checked
    // here by their form call and by the confirmation helper they both use.
    assert.match(businessPanel, /_add_money_form\(card, business_id, "contribute_capital"/);
    assert.match(businessPanel, /_add_money_form\(card, business_id, "withdraw"/);
    assert.match(businessPanel, /_confirm_change\(action, \{"business_id": business_id, "amount_ngn": value\}/);
  });

  test("listing, staffing, and branch actions are sent without a confirmation, and each is a changing action", () => {
    for (const action of ["add_product", "add_service", "set_listing", "update_price", "hire_employee", "add_branch"]) {
      assert.ok(sentDirectly.has(action), `${action} is sent through _change`);
      assert.ok(clientBusinessChanging.has(action), `${action} is a changing action`);
    }
  });

  test("the ownership handover is offered only as an owner handover, with a fixed share and no unseen role choice", () => {
    assert.match(businessPanel, /"new_role": "owner",/);
    assert.match(businessPanel, /"share_percent": 100,/);
    assert.ok(!/new_role.*co_owner/.test(businessPanel.slice(businessPanel.indexOf("_add_transfer_ownership_form"))),
      "the transfer form does not offer a co-owner handover");
  });

  test("the create form names the setup fee and the capital, and the server result is shown, not a local success", () => {
    assert.match(businessPanel, /setup fee of %s plus %s starting capital/);
    assert.match(businessPanel, /_notice = str\(message\.get\("message", "Done\."\)\)/);
    assert.match(businessPanel, /if not _online:\n\t\t_notice = "Business changes need the connected shared world\."/);
  });

  test("the GDScript of the business screens has balanced brackets (strings and comments are ignored)", () => {
    for (const [name, source] of [
      ["property_business_contract.gd", contract],
      ["business_panel.gd", businessPanel],
      ["housing_panel.gd", housingPanel],
    ]) {
      const stack = [];
      const pairs = { ")": "(", "]": "[", "}": "{" };
      let line = 1;
      let inString = null;
      for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === "\n") {
          line += 1;
          inString = null;
          continue;
        }
        if (inString) {
          if (ch === "\\") i += 1;
          else if (ch === inString) inString = null;
          continue;
        }
        if (ch === "#") {
          while (i < source.length && source[i] !== "\n") i += 1;
          i -= 1;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inString = ch;
          continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") stack.push({ ch, line });
        else if (pairs[ch]) {
          const open = stack.pop();
          assert.ok(open && open.ch === pairs[ch], `${name}:${line} closes ${ch} that does not match`);
        }
      }
      assert.equal(stack.length, 0, `${name} has no unclosed bracket (first at line ${stack[0]?.line})`);
    }
  });
});
