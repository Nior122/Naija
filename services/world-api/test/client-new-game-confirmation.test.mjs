// New-life overwrite confirmation: the Godot creation screen and the new-life path must agree.
//
// These tests read the GDScript sources as text. They do not run Godot. They prove that the confirmation is wired in
// the order the rule needs: the save check happens before any request is emitted, the replacement mark is set only by
// the confirmed handler, and the game-side refusal happens before any state changes. Runtime behaviour is covered by
// game/tests/new_game_confirmation_headless.gd, which needs a Godot 4.7.2 binary and has not run in CI.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relativePath) => readFileSync(`${root}${relativePath}`, "utf8");

const prototypeUi = read("game/scripts/ui/prototype_ui.gd");
const prototypeGame = read("game/scripts/prototype_game.gd");
const headlessTest = read("game/tests/new_game_confirmation_headless.gd");

/** The body of a GDScript function: from its `func` line to the next top-level `func` (or end of file). */
function functionBody(source, name) {
  const start = source.indexOf(`\nfunc ${name}(`);
  assert.ok(start >= 0, `function ${name} must exist`);
  const rest = source.slice(start + 1);
  const next = rest.indexOf("\nfunc ", 1);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("creation screen confirmation (prototype_ui.gd)", () => {
  test("Begin your life checks the local save at the press, before it emits a request", () => {
    const body = functionBody(prototypeUi, "_on_create_pressed");
    const check = body.indexOf("SaveServiceScript.has_save()");
    const confirm = body.indexOf("show_replace_save_confirmation(profile)");
    const emit = body.indexOf("create_requested.emit(profile)");
    assert.ok(check >= 0, "_on_create_pressed must check SaveServiceScript.has_save()");
    assert.ok(confirm > check, "the confirmation must open after the save check");
    assert.ok(emit > check, "the direct request must come after the save check");
    assert.ok(body.includes("return"), "the confirmation branch must return before the direct request");
  });

  test("the confirmation has a Replace button and a Cancel button that emits nothing", () => {
    const body = functionBody(prototypeUi, "show_replace_save_confirmation");
    assert.ok(body.includes('_button("Replace saved life"'), "the confirmation must offer Replace saved life");
    assert.ok(body.includes('_add_modal_close(card, "Cancel")'), "the confirmation must offer a Cancel that only closes");
    assert.ok(!body.includes("emit("), "opening the confirmation must not emit any request");
    assert.ok(body.includes("_on_replace_save_confirmed.bind(profile)"), "Replace must be bound to the confirmed handler");
  });

  test("only the confirmed handler sets the replacement mark and emits the request", () => {
    const body = functionBody(prototypeUi, "_on_replace_save_confirmed");
    assert.ok(body.includes("_close_modal()"), "the confirmed handler must close the dialog");
    assert.ok(body.includes('confirmed_profile["replace_existing_save"] = true'), "the handler must set the replacement mark");
    assert.ok(body.includes("create_requested.emit(confirmed_profile)"), "the handler must emit the marked request");
  });

  test("create_requested is emitted from exactly the two reviewed places", () => {
    const emits = prototypeUi.match(/create_requested\.emit\(/g) ?? [];
    assert.equal(emits.length, 2, "a third emit would be a path that could skip the save check");
  });
});

describe("new-life path refusal (prototype_game.gd)", () => {
  test("_start_new_game refuses to replace a save without the mark, before any state change", () => {
    const body = functionBody(prototypeGame, "_start_new_game");
    const guard = body.indexOf("SaveServiceScript.has_save()");
    const mark = body.indexOf('bool(profile.get("replace_existing_save", false))');
    const refuse = body.indexOf('"Saved life kept"');
    const firstChange = body.indexOf("multiplayer_client.disconnect_from_world()");
    assert.ok(guard >= 0 && mark > guard, "the guard must check both the save and the replacement mark");
    assert.ok(refuse > guard && body.slice(refuse).includes("return"), "the refusal must show a notice and return");
    assert.ok(firstChange > refuse, "the refusal must come before the online session is released");
  });

  test("the save is written only after the guard, through the existing new-life save", () => {
    const body = functionBody(prototypeGame, "_start_new_game");
    assert.ok(body.indexOf("_save_game(false)") > body.indexOf("SaveServiceScript.has_save()"));
  });
});

describe("headless Godot test (game/tests/new_game_confirmation_headless.gd)", () => {
  test("covers no-save start, confirmation, cancel, replace, and the bypass refusal", () => {
    for (const label of [
      "No save: Begin your life starts play immediately",
      "Save exists: the save file is unchanged while the confirmation is open",
      "Cancel leaves the save file byte for byte unchanged",
      "Cancel keeps the typed name on the creation form",
      "Replace saved life starts play",
      "Bypass without the mark leaves the save file byte for byte unchanged",
      "With the replacement mark, the save is replaced",
    ]) {
      assert.ok(headlessTest.includes(label), `headless test must check: ${label}`);
    }
  });

  test("protects the real save file with the shared recovery protocol", () => {
    assert.ok(headlessTest.includes("SaveSlotGuardScript.new()"));
    assert.ok(headlessTest.includes('_guard.begin("new_game_confirmation_headless", SAVE_PATH)'));
    assert.ok(headlessTest.includes("_guard.finish()"));
  });
});
