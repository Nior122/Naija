// Stage 44: the Godot client must resolve a pending business, housing or NPC request when the server answers it with a
// generic error that carries the request ID (for example rate_limited). Before this, the socket's "error" was not routed
// to the trackers, so the request waited for its timeout and was then reported as possibly unconfirmed.
//
// These tests read the GDScript sources as text. They prove the wiring is present; they do not run Godot. The tracker's
// logic is run by game/tests/business_request_errors_headless.gd, and the screen itself is not verified by either.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relativePath) => readFileSync(`${root}${relativePath}`, "utf8");

const prototypeGame = read("game/scripts/prototype_game.gd");
const prototypeUi = read("game/scripts/ui/prototype_ui.gd");
const tracker = read("game/scripts/services/server_request_tracker.gd");
const headlessTest = read("game/tests/business_request_errors_headless.gd");
const serverEngine = read("services/world-api/src/multiplayer/world-engine.ts");

/** The body of a GDScript function, from its declaration to the next top-level declaration. */
function gdFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} is declared`);
  const rest = source.slice(start + signature.length);
  const next = rest.search(/\n(func |## )/);
  return next === -1 ? source.slice(start) : source.slice(start, start + signature.length + next);
}

describe("generic request errors reach the request trackers (Godot client)", () => {
  test("the server sends a refused command as a generic error with the request ID", () => {
    assert.match(serverEngine, /this\.sendError\(context, "rate_limited", "Too many commands were sent in a short time\.", requestId\);/);
    assert.match(serverEngine, /private sendError\(context: ConnectionContext, code: string, message: string, requestId\?: string/);
  });

  test("the message dispatch routes an error that carries a request ID to the UI", () => {
    const dispatch = gdFunction(prototypeGame, "func _on_online_message(message: Dictionary) -> void:");
    const branch = dispatch.slice(dispatch.indexOf('"error":'), dispatch.indexOf('"command.duplicate":'));
    assert.notEqual(branch, "", "an error branch exists in the dispatch");
    assert.match(branch, /str\(message\.get\("requestId", ""\)\)\.is_empty\(\)/, "the branch checks for a request ID");
    assert.match(branch, /ui\.show_request_error\(message\)/, "the branch forwards the reply to the UI");
  });

  test("the UI offers the reply to the housing, business and NPC trackers, and shows the server's message", () => {
    const router = gdFunction(prototypeUi, "func show_request_error(message: Dictionary) -> void:");
    assert.match(router, /_housing_tracker\.apply_reply\(message\)/);
    assert.match(router, /_business_tracker\.apply_reply\(message\)/);
    assert.match(router, /_npc_tracker\.apply_reply\(message\)/);
    assert.match(router, /str\(message\.get\("message", "The server rejected the request\."\)\)/);
    assert.match(router, /_tell_business\(text\)/);
  });

  test("the tracker treats a generic error with its request ID as an answer, and internal_error as unconfirmed", () => {
    const applyReply = gdFunction(tracker, "func apply_reply(message: Dictionary) -> bool:");
    assert.match(applyReply, /reply_type\.ends_with\("\.error"\) or reply_type == "error"/);
    const classify = gdFunction(tracker, "static func is_unconfirmed_code(code: String) -> bool:");
    assert.match(classify, /code == "internal_error"/);
    assert.match(classify, /_not_saved/);
    assert.match(classify, /_outcome_unknown/);
  });

  test("rate_limited is not routed to the career transport panel; character_deceased still is", () => {
    // Stage 44: a refused command is a refusal of one request. Before this, _on_online_error also sent rate_limited to
    // the career transport panel, so a business request's refusal showed in the career panel too.
    const routing = gdFunction(prototypeGame, "func _on_online_error(code: String, description: String) -> void:");
    assert.match(routing, /if code == "character_deceased":\n\t\tui\.show_career_transport_error\(description\)/);
    assert.doesNotMatch(routing, /\["character_deceased", "rate_limited"\]/);
    assert.doesNotMatch(routing, /if code (==|in) [^\n]*rate_limited[^\n]*\n\s*ui\.show_career_transport_error/);
    assert.match(routing, /ui\.notify\(/, "the notice for the error is still shown");
    // The refused request still reaches its own panel through the "error" branch (see the dispatch test above).
    const dispatch = gdFunction(prototypeGame, "func _on_online_message(message: Dictionary) -> void:");
    assert.match(dispatch, /ui\.show_request_error\(message\)/);
  });

  test("the headless tracker test exists and covers the generic error, internal_error and the typed refusal", () => {
    assert.match(headlessTest, /"type": "error", "code": "rate_limited"/);
    assert.match(headlessTest, /"code": "internal_error"/);
    assert.match(headlessTest, /"type": "business\.error", "code": "business_action_invalid"/);
    assert.match(headlessTest, /preload\("res:\/\/scripts\/services\/server_request_tracker\.gd"\)/);
  });
});
