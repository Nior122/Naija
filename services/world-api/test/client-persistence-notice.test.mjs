import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * Source-contract check for the client handling of persistence.restored (Stage 28, G3).
 *
 * IMPORTANT: this is NOT a behavioural client test. The client is Godot (GDScript), and no Godot binary is available to the
 * default suite. The behavioural check is game/tests/persistence_notice.gd (run with Godot 4.7.2, see the README). This
 * file only checks that the server's message type, the client's dispatch, and the notice text agree, so that a rename on
 * one side fails the default suite.
 */

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");

const serverSource = read("services/world-api/src/multiplayer/world-engine.ts");
const clientSource = read("game/scripts/services/multiplayer_client.gd");
const gameSource = read("game/scripts/prototype_game.gd");
const behaviouralTest = read("game/tests/persistence_notice.gd");

const CLAIM_PHRASES = ["recovered", "restored your", "all changes", "everything", "your progress", "are saved", "is saved"];

test("the server sends persistence.restored with the type the client expects", () => {
  assert.match(serverSource, /type: "persistence\.restored"/);
});

test("the client helper returns the notice only for persistence.restored", () => {
  assert.match(clientSource, /static func persistence_notice\(message: Dictionary\) -> String:/);
  assert.match(clientSource, /if str\(message\.get\("type", ""\)\) != "persistence\.restored":\n\t\treturn ""/);
});

test("the game dispatch routes persistence.restored through the helper and the existing notify path", () => {
  assert.match(gameSource, /"persistence\.restored":\n[\s\S]*?MultiplayerClientScript\.persistence_notice\(message\)/);
  assert.match(gameSource, /ui\.notify\(restored_notice\)/);
});

test("every match arm in _on_online_message is at the same indentation depth (a misplaced arm is a GDScript syntax error)", () => {
  const start = gameSource.indexOf("func _on_online_message(");
  const end = gameSource.indexOf("\nfunc ", start + 1);
  assert.ok(start >= 0 && end > start, "the function is present");
  const body = gameSource.slice(start, end);
  const arms = body.split("\n").filter((line) => /^\t+"[a-z._]+"(, "[a-z._]+")*:$/.test(line));
  assert.ok(arms.length > 10, "the dispatch has its arms");
  const depths = new Set(arms.map((line) => line.match(/^\t+/)[0].length));
  assert.deepEqual([...depths], [2]);
  assert.ok(arms.some((line) => line === "\t\t\"persistence.restored\":"), "the persistence.restored arm is present");
});

test("the notice text claims no recovery of outage-period changes", () => {
  const match = clientSource.match(/const PERSISTENCE_RESTORED_NOTICE: String = \(\s*"([^"]+)"\s*\)/);
  assert.ok(match, "the notice constant is present");
  const notice = match[1].toLowerCase();
  for (const phrase of CLAIM_PHRASES) {
    assert.equal(notice.includes(phrase), false, `the notice must not contain "${phrase}"`);
  }
  assert.match(notice, /does not confirm/);
});

test("the behavioural GDScript check exists alongside the source-contract check", () => {
  assert.match(behaviouralTest, /extends SceneTree/);
  assert.match(behaviouralTest, /persistence_notice\(/);
});
