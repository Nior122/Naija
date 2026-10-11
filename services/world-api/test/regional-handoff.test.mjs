// Stage 29 F5: regional handoff from the 2D client to the 3D world.
//
// These are STATIC checks. They read GDScript source and data files as text and cross-check
// them. They do not execute GDScript, so they are not runtime evidence. The behaviour itself is
// covered by game/tests/regional_handoff.gd, which is NOT RUN unless Godot 4.7.2 is available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const GAME = join(REPO_ROOT, 'game');
const PROTOTYPE = join(GAME, 'scripts', 'prototype_game.gd');
const CHARACTER = join(GAME, 'scripts', 'domain', 'character_state.gd');
const CLOCK = join(GAME, 'scripts', 'domain', 'world_clock.gd');
const SWITCHER = join(GAME, '3d_world', 'scripts', 'scene_switcher.gd');
const CONTROLLER = join(GAME, '3d_world', 'scripts', 'world_3d_controller.gd');
const ENV_SCRIPT = join(GAME, '3d_world', 'scripts', 'environment_config.gd');
const SAMPLE = join(GAME, 'data', 'geography', 'processed', 'akure-south-core.json');
const CATALOG = join(GAME, 'data', 'geography', 'regional-catalog.json');

const readText = (path) => readFileSync(path, 'utf8');

// Body of a GDScript function: from its header to the next top-level func (or end of file).
function functionBody(source, name) {
  const start = source.search(new RegExp(`^(?:static )?func ${name}\\(`, 'm'));
  assert.ok(start >= 0, `function ${name} must exist`);
  const rest = source.slice(start + 1);
  const next = rest.search(/^(?:static )?func /m);
  return next < 0 ? rest : rest.slice(0, next);
}

// Code lines only: whole-line comments are removed so commented-out calls are not counted.
const codeOnly = (source) =>
  source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

test('2D shared state: every character and clock method call exists on its class', () => {
  // Regression guard for F5. prototype_game.gd called character.to_dict(), clock.to_dict(),
  // character.from_dict() and clock.from_dict(). None of those methods is defined anywhere.
  const defined = {
    character: new Set([...readText(CHARACTER).matchAll(/^func (\w+)\(/gm)].map((m) => m[1])),
    clock: new Set([...readText(CLOCK).matchAll(/^func (\w+)\(/gm)].map((m) => m[1])),
  };
  // Methods every Object already has, which GDScript resolves without a script definition.
  const objectBuiltins = new Set(['get', 'set', 'call', 'free', 'get_class', 'has_method',
    'connect', 'emit_signal', 'is_class', 'get_script', 'set_script']);
  const missing = [];
  for (const m of codeOnly(readText(PROTOTYPE)).matchAll(/\b(character|clock)\.(\w+)\(/g)) {
    const [, owner, method] = m;
    if (!defined[owner].has(method) && !objectBuiltins.has(method)) {
      missing.push(`${owner}.${method}()`);
    }
  }
  assert.deepEqual(missing, [], 'prototype_game.gd calls methods that its classes do not define');
  assert.doesNotMatch(readText(PROTOTYPE), /\.to_dict\(|\.from_dict\(/,
    'the nonexistent to_dict/from_dict names must not return to the 2D client');
});

test('2D shared state: export uses the save-format serialiser, which carries geographic_location', () => {
  const get = functionBody(readText(PROTOTYPE), 'get_shared_state');
  assert.match(get, /"character": character\.to_dictionary\(\)/);
  assert.match(get, /"clock": clock\.to_dictionary\(\)/);
  const character = readText(CHARACTER);
  assert.match(functionBody(character, 'to_dictionary'), /"geographic_location": geographic_location\.duplicate/,
    'the exported character dictionary must carry geographic_location');
});

test('2D shared state: restore loads the clock before the character, as the save path does', () => {
  const set = functionBody(readText(PROTOTYPE), 'set_shared_state');
  const clockAt = set.indexOf('clock.load_dictionary(state.clock)');
  const characterAt = set.indexOf('character.load_dictionary(state.character, clock.calendar_date())');
  assert.ok(clockAt >= 0, 'clock must be restored with load_dictionary');
  assert.ok(characterAt >= 0, 'character must be restored with load_dictionary and the clock date');
  assert.ok(clockAt < characterAt, 'clock must be restored before the character');
});

test('handoff: the switcher derives the region from the 2D location and passes it as region_id', () => {
  const switcher = readText(SWITCHER);
  const restore = functionBody(switcher, '_restore_3d_state');
  assert.match(restore, /"region_id": region_id_from_character\(shared_character_data\)/);
  assert.match(restore, /"character": shared_character_data/, 'character must still be passed');
  assert.match(restore, /"world": shared_world_state/, 'world must still be passed');
  const derive = functionBody(switcher, 'region_id_from_character');
  assert.match(derive, /"geographic_location"/);
  assert.match(derive, /"state_id"/);
  assert.match(switcher, /^static func region_id_from_character\(/m, 'helper must be static');
});

test('handoff: the controller validates a region before any state change', () => {
  const change = functionBody(readText(CONTROLLER), 'change_region');
  const validateAt = change.indexOf('resolve_region_profile(new_region_id)');
  const assignAt = change.indexOf('region_id = new_region_id');
  assert.ok(validateAt >= 0, 'change_region must validate through resolve_region_profile');
  assert.ok(assignAt > validateAt, 'validation must run before region_id is assigned');
  assert.match(change, /push_warning\(/, 'a refused region must produce a warning');
  assert.match(change, /\breturn\b[\s\S]*\bregion_id = new_region_id/,
    'a refused region must return before the assignment');
});

test('handoff: set_shared_state never assigns the region without validation', () => {
  const set = functionBody(readText(CONTROLLER), 'set_shared_state');
  assert.doesNotMatch(set, /\bregion_id = /, 'set_shared_state must not write region_id directly');
  assert.doesNotMatch(set, /change_region\(state\.region_id\)/, 'the unvalidated call must be gone');
  assert.match(set, /change_region\(handed_region\)/, 'the handed region must go through change_region');
});

test('handoff: the controller default is unchanged (ng:state:on)', () => {
  assert.match(readText(CONTROLLER), /@export var region_id: String = "ng:state:on"/);
});

test('handoff: the sample state_id is a catalog state with a Phase C visual resolution', () => {
  const sample = JSON.parse(readText(SAMPLE));
  const catalogIds = new Set(
    JSON.parse(readText(CATALOG)).states.map((state) => state.id),
  );
  assert.ok(catalogIds.has(sample.state_id), `sample state_id ${sample.state_id} must be a catalog state`);
  const env = readText(ENV_SCRIPT);
  const explicit = new Set([...env.matchAll(/^\s+"(ng:state:\w+)": \{/gm)].map((m) => m[1]));
  const biomeBlock = /const REGION_BIOME := \{([\s\S]*?)\n\}/.exec(env);
  assert.ok(biomeBlock, 'REGION_BIOME must exist');
  const mapped = new Set([...biomeBlock[1].matchAll(/"(ng:state:\w+)":/g)].map((m) => m[1]));
  assert.ok(explicit.has(sample.state_id) || mapped.has(sample.state_id),
    `sample state_id ${sample.state_id} must resolve to a profile`);
});

test('handoff: the sample location carries the canonical state field the switcher reads', () => {
  // The 2D location is built by geographic_region_preview.gd from the sample's state_id.
  const preview = readText(join(GAME, 'scripts', 'world', 'geographic_region_preview.gd'));
  assert.match(preview, /"state_id": str\(region_data\.get\("state_id", ""\)\)/);
});
