// Stage 44: career request routing in the Godot client.
//
// Defect: career.action was sent with an auto-generated request ID, and the career panel set its busy flag. A refused
// career.action (command limit) is answered with a generic "error" carrying that ID, not with career.error. The panel
// only cleared busy on career.result, career.error or a transport error, so it stayed busy, and update_profile was
// suppressed. Fix: prototype_game.gd keeps the ID of the in-flight career action, and routes a generic error to the
// career panel only when its ID matches. rate_limited stays notify-only for every other family (user decision).
//
// These tests read the GDScript sources as text. They prove the wiring is present; they do not run Godot. Nothing here
// shows the panel recovers on screen. That needs a Godot run, which was not available for this stage.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relativePath) => readFileSync(`${root}${relativePath}`, "utf8");

const prototypeGame = read("game/scripts/prototype_game.gd");
const multiplayerClient = read("game/scripts/services/multiplayer_client.gd");
const careerPanel = read("game/scripts/ui/career_panel.gd");

/** The body of a GDScript function, from its declaration to the next top-level declaration. */
function gdFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} is declared`);
  const rest = source.slice(start + signature.length);
  const next = rest.search(/\n(func |## )/);
  return next === -1 ? source.slice(start) : source.slice(start, start + signature.length + next);
}

describe("career action request routing (Godot client)", () => {
  test("the multiplayer client exposes a request ID that the caller can keep, and send_command accepts it", () => {
    assert.match(multiplayerClient, /func new_request_id\(\) -> String:\n\treturn _new_request_id\(\)/);
    const send = gdFunction(multiplayerClient, "func send_command(");
    assert.match(send, /request_id: String = ""/);
    assert.match(send, /payload\["requestId"\] = request_id if not request_id\.is_empty\(\) else _new_request_id\(\)/);
  });

  test("a career action is sent with a request ID that the game keeps as the in-flight career request", () => {
    const sendAction = gdFunction(prototypeGame, "func _on_career_action_requested(action: String, payload: Dictionary) -> void:");
    assert.match(sendAction, /var request_id: String = multiplayer_client\.new_request_id\(\)/);
    assert.match(sendAction, /_career_request_id = request_id/);
    assert.match(sendAction, /multiplayer_client\.send_command\(\s*"career\.action", \{"action": action, "payload": payload\.duplicate\(true\)\}, request_id\s*\)/);
  });

  test("a career action that cannot be sent forgets its request ID and reports the transport error", () => {
    const sendAction = gdFunction(prototypeGame, "func _on_career_action_requested(action: String, payload: Dictionary) -> void:");
    const failure = sendAction.slice(sendAction.indexOf("if not multiplayer_client.send_command("));
    assert.match(failure, /_career_request_id = ""\n\t\tui\.show_career_transport_error\(/);
  });

  test("a generic error whose request ID matches the in-flight career action goes to the career panel", () => {
    const dispatch = gdFunction(prototypeGame, "func _on_online_message(message: Dictionary) -> void:");
    const branch = dispatch.slice(dispatch.indexOf('"error":'), dispatch.indexOf('"command.duplicate":'));
    assert.match(branch, /if not str\(message\.get\("requestId", ""\)\)\.is_empty\(\):\n\t\t\t\tui\.show_request_error\(message\)/);
    assert.match(branch, /if str\(message\.get\("requestId", ""\)\) == _career_request_id:/);
    assert.match(branch, /_career_request_id = ""/);
    assert.match(branch, /ui\.show_career_transport_error\(\s*str\(message\.get\("message", "The server refused this career request\."\)\)\s*\)/);
  });

  test("a career reply clears the in-flight request ID only when it is that request's reply", () => {
    const dispatch = gdFunction(prototypeGame, "func _on_online_message(message: Dictionary) -> void:");
    assert.match(dispatch, /"career\.result", "career\.error":\n\t\t\t_clear_career_request\(message\)\n\t\t\tui\.show_career_response\(message\)/);
    const clear = gdFunction(prototypeGame, "func _clear_career_request(message: Dictionary) -> void:");
    assert.match(clear, /if str\(message\.get\("requestId", ""\)\) == _career_request_id:\n\t\t_career_request_id = ""/);
  });

  test("rate_limited is not sent to the career panel by code, so other families keep the toast only", () => {
    const routing = gdFunction(prototypeGame, "func _on_online_error(code: String, description: String) -> void:");
    assert.match(routing, /if code == "character_deceased":\n\t\tui\.show_career_transport_error\(description\)/);
    assert.doesNotMatch(routing, /rate_limited[^\n]*show_career_transport_error/);
    assert.match(routing, /ui\.notify\(/);
  });

  test("the career panel clears its busy flag on a transport error, and keeps update_profile gated only while busy", () => {
    const transport = gdFunction(careerPanel, "func show_transport_error(message: String) -> void:");
    assert.match(transport, /_busy = false/);
    const update = gdFunction(careerPanel, "func update_profile(career_profile: Dictionary) -> void:");
    assert.match(update, /if _busy or search_focused:\n\t\treturn/);
  });
});
