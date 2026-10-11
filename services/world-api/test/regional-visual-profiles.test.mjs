// Stage 29: regional visual profiles.
//
// These are static checks. They read the GDScript source and scene file as data, and they
// compare the visual layer against the authoritative catalog and profile files. They do not
// execute GDScript. Runtime behaviour (lookup, application, stale-value handling) is covered by
// the headless Godot test, which is NOT RUN unless Godot 4.7.2 is available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regionalRegistry } from '../dist/geography/regional-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DATA_PATH = join(REPO_ROOT, 'game', 'data');
const GEO_DIR = join(DATA_PATH, 'geography');
const ENV_SCRIPT = join(REPO_ROOT, 'game', '3d_world', 'scripts', 'environment_config.gd');
const CONTROLLER = join(REPO_ROOT, 'game', '3d_world', 'scripts', 'world_3d_controller.gd');
const SCENE = join(REPO_ROOT, 'game', '3d_world', 'scenes', 'world_3d.tscn');

const readText = (path) => readFileSync(path, 'utf8');
const readJson = (path) => JSON.parse(readText(path));

// Values from the committed baseline (803fbdf, game/3d_world/scripts/environment_config.gd).
// Key corrected from ng:state:od to ng:state:on (audit F1); values are unchanged.
const EXPECTED_PRESETS = {
  'ng:state:la': {
    climate: 'tropical', terrain: 'coastal', sky_color: [0.55, 0.75, 0.95],
    fog_color: [0.75, 0.8, 0.85], fog_density: 0.0015, ambient_color: [0.65, 0.7, 0.8],
    ambient_energy: 0.45, building_density: 'high', vegetation: 'sparse',
  },
  'ng:state:on': {
    climate: 'tropical', terrain: 'forest', sky_color: [0.5, 0.7, 0.9],
    fog_color: [0.7, 0.75, 0.8], fog_density: 0.001, ambient_color: [0.6, 0.65, 0.75],
    ambient_energy: 0.4, building_density: 'medium', vegetation: 'moderate',
  },
  'ng:state:kd': {
    climate: 'semi-arid', terrain: 'savanna', sky_color: [0.6, 0.75, 0.9],
    fog_color: [0.8, 0.75, 0.7], fog_density: 0.0008, ambient_color: [0.7, 0.65, 0.6],
    ambient_energy: 0.5, building_density: 'medium', vegetation: 'sparse',
  },
  'ng:state:bo': {
    climate: 'arid', terrain: 'savanna', sky_color: [0.7, 0.8, 0.9],
    fog_color: [0.85, 0.8, 0.7], fog_density: 0.0005, ambient_color: [0.75, 0.7, 0.65],
    ambient_energy: 0.55, building_density: 'low', vegetation: 'very_sparse',
  },
  'ng:state:pl': {
    climate: 'montane', terrain: 'plateau', sky_color: [0.45, 0.65, 0.85],
    fog_color: [0.65, 0.7, 0.8], fog_density: 0.002, ambient_color: [0.55, 0.6, 0.7],
    ambient_energy: 0.35, building_density: 'low', vegetation: 'dense',
  },
};

const PRESET_FOR_BIOME = {
  coastal: 'ng:state:la', forest: 'ng:state:on', savanna: 'ng:state:kd',
  arid: 'ng:state:bo', montane: 'ng:state:pl',
};

const REQUIRED_KEYS = [
  'climate', 'terrain', 'sky_color', 'fog_color', 'fog_density',
  'ambient_color', 'ambient_energy', 'building_density', 'vegetation',
];

// --- Source parsing helpers -------------------------------------------------

function parseColor(text) {
  const m = /^Color\(([^)]*)\)$/.exec(text.trim());
  assert.ok(m, `expected a Color(...) literal, got ${text}`);
  return m[1].split(',').map((s) => Number(s.trim()));
}

function parseValue(raw) {
  const v = raw.trim();
  if (v.startsWith('Color(')) return parseColor(v);
  if (v.startsWith('"')) return v.slice(1, -1);
  return Number(v);
}

// Explicit records: "ng:state:xx": { ... } inside _load_regional_profiles().
function parseRecords(source) {
  const records = {};
  const re = /"(ng:state:\w+)":\s*\{[^\n]*\n([\s\S]*?)\n\t\t\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const rec = {};
    for (const kv of m[2].matchAll(/"(\w+)":\s*(Color\([^)]*\)|"[^"]*"|[^,\n]+)/g)) {
      rec[kv[1]] = parseValue(kv[2]);
    }
    records[m[1]] = rec;
  }
  return records;
}

// Dictionary constant block: const NAME := { "k": "v", ... }
function parseStringMap(source, constName) {
  const start = source.indexOf(`const ${constName} := {`);
  assert.ok(start >= 0, `${constName} not found`);
  const end = source.indexOf('\n}', start);
  const block = source.slice(start, end);
  const map = {};
  for (const m of block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
    map[m[1]] = m[2];
  }
  return map;
}

function functionBody(source, name) {
  const start = source.indexOf(`func ${name}(`);
  assert.ok(start >= 0, `func ${name} not found`);
  const next = source.indexOf('\nfunc ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

// --- Loaded data ------------------------------------------------------------

const envSource = readText(ENV_SCRIPT);
const records = parseRecords(envSource);
const REGION_BIOME = parseStringMap(envSource, 'REGION_BIOME');
const BIOME_PRESET_SOURCE = parseStringMap(envSource, 'BIOME_PRESET_SOURCE');
const catalogJson = readJson(join(GEO_DIR, 'regional-catalog.json'));
const profilesJson = readJson(join(GEO_DIR, 'regional-environment-profiles.json'));

async function loadRegistry() {
  await regionalRegistry.initialize(DATA_PATH);
  return regionalRegistry;
}

// Resolve every catalog region the way the GDScript does, and count by source.
function resolveAll(catalogIds, forEachRegion) {
  const counts = { direct: 0, mapped: 0, fallback: 0 };
  const resolution = {};
  for (const id of catalogIds) {
    if (records[id]) {
      counts.direct++;
      resolution[id] = { source: 'direct', preset: null };
    } else if (REGION_BIOME[id] && BIOME_PRESET_SOURCE[REGION_BIOME[id]]) {
      counts.mapped++;
      resolution[id] = { source: 'mapped', preset: BIOME_PRESET_SOURCE[REGION_BIOME[id]] };
    } else {
      counts.fallback++;
      resolution[id] = { source: 'fallback', preset: null };
    }
  }
  forEachRegion?.(resolution);
  return { counts, resolution };
}

// --- Tests ------------------------------------------------------------------

test('catalog: loads and lists states (count is derived, not fixed)', async () => {
  const registry = await loadRegistry();
  const states = registry.getAllStates();
  assert.ok(states.length > 0, 'catalog must list at least one state');
  const ids = states.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'state IDs must be unique');
  for (const id of ids) {
    assert.match(id, /^ng:state:[a-z]{2}$/, `state ID ${id} must be ng:state:<code>`);
  }
});

test('completeness: every catalog region resolves to a direct record or a mapped preset', async () => {
  const registry = await loadRegistry();
  const catalogIds = registry.getAllStates().map((s) => s.id);
  const { counts, resolution } = resolveAll(catalogIds);
  const unresolved = Object.entries(resolution).filter(([, r]) => r.source === 'fallback');
  assert.deepEqual(unresolved.map(([id]) => id), [], 'no region may depend on the default fallback');
  assert.equal(counts.direct + counts.mapped + counts.fallback, catalogIds.length);
  // Reported separately, per the Stage 29 verification list.
  console.log(`[stage29] catalog regions=${catalogIds.length} direct=${counts.direct} ` +
    `mapped=${counts.mapped} fallback=${counts.fallback}`);
});

test('completeness: no region has both a direct record and a biome mapping', async () => {
  const registry = await loadRegistry();
  const catalogIds = new Set(registry.getAllStates().map((s) => s.id));
  for (const id of Object.keys(REGION_BIOME)) {
    assert.ok(!records[id], `${id} has both a record and a mapping`);
    assert.ok(catalogIds.has(id), `mapping ${id} is not a catalog region`);
  }
  for (const id of Object.keys(records)) {
    assert.ok(catalogIds.has(id), `record ${id} is not a catalog region`);
  }
});

test('completeness: mappings match the authoritative non-visual data under the stated rule', async () => {
  const registry = await loadRegistry();
  const mismatches = [];
  for (const state of registry.getAllStates()) {
    if (records[state.id]) continue;
    const env = state.environment;
    let expected = null;
    if (env.terrain === 'coastal') expected = 'coastal';
    else if (env.climate === 'montane') expected = 'montane';
    else if (env.climate === 'arid') expected = 'arid';
    else if (env.terrain === 'forest') expected = 'forest';
    else if (env.terrain === 'savanna') expected = 'savanna';
    else if (env.terrain === 'plateau' && env.climate === 'tropical') expected = 'forest'; // D2
    if (REGION_BIOME[state.id] !== expected) {
      mismatches.push(`${state.id}: expected ${expected}, mapped ${REGION_BIOME[state.id]}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test('D2: Ekiti, Enugu, Taraba map to forest; authoritative classification is unchanged', async () => {
  const registry = await loadRegistry();
  for (const id of ['ng:state:ek', 'ng:state:en', 'ng:state:ta']) {
    assert.equal(REGION_BIOME[id], 'forest', `${id} must map to forest`);
    assert.equal(BIOME_PRESET_SOURCE.forest, 'ng:state:on', 'forest preset must reference the on record');
    assert.ok(!records[id], `${id} must not get its own visual copy`);
    const state = registry.getState(id);
    assert.ok(state, `${id} must exist in the catalog`);
    assert.equal(state.environment.climate, 'tropical', `${id} climate must stay tropical`);
    assert.equal(state.environment.terrain, 'plateau', `${id} terrain must stay plateau`);
    const profile = profilesJson.profiles[id];
    assert.equal(profile.climate, 'tropical');
    assert.equal(profile.terrain, 'plateau');
  }
});

test('schema: each explicit record has every required key and valid ranges', () => {
  for (const [id, rec] of Object.entries(records)) {
    for (const key of REQUIRED_KEYS) {
      assert.ok(Object.hasOwn(rec, key), `${id} missing ${key}`);
    }
    for (const colour of ['sky_color', 'fog_color', 'ambient_color']) {
      assert.equal(rec[colour].length, 3, `${id} ${colour} needs 3 components`);
      for (const c of rec[colour]) assert.ok(c >= 0 && c <= 1, `${id} ${colour} out of [0,1]`);
    }
    assert.ok(rec.fog_density > 0 && rec.fog_density <= 0.01, `${id} fog_density out of range`);
    assert.ok(rec.ambient_energy > 0 && rec.ambient_energy <= 2, `${id} ambient_energy out of range`);
  }
});

test('schema: every record and mapping names a catalog region and a known preset', () => {
  for (const preset of Object.keys(BIOME_PRESET_SOURCE)) {
    assert.ok(records[BIOME_PRESET_SOURCE[preset]], `preset ${preset} must reference an explicit record`);
  }
  for (const [id, biome] of Object.entries(REGION_BIOME)) {
    assert.ok(BIOME_PRESET_SOURCE[biome], `${id} maps to unknown biome ${biome}`);
  }
});

test('preservation: the five existing preset records keep their values', () => {
  assert.deepEqual(Object.keys(records).sort(), Object.keys(EXPECTED_PRESETS).sort());
  for (const [id, expected] of Object.entries(EXPECTED_PRESETS)) {
    assert.deepEqual(records[id], expected, `${id} record changed from baseline`);
  }
});

test('preservation: preset sources are the five records (no per-region numeric copies)', () => {
  assert.deepEqual(BIOME_PRESET_SOURCE, PRESET_FOR_BIOME);
  assert.equal(Object.keys(records).length, 5, 'exactly five explicit visual records');
});

test('authoritative data: profile file keeps only non-visual keys and matches the catalog', async () => {
  const registry = await loadRegistry();
  // climate and terrain are authoritative fields. The rest of REQUIRED_KEYS are visual-only.
  const visualOnly = new Set(REQUIRED_KEYS.filter((k) => k !== 'climate' && k !== 'terrain'));
  const authoritativeKeys = [
    'climate', 'terrain', 'primary_industries', 'languages',
    'cultural_significance', 'gameplay_features', 'restrictions',
  ].sort();
  for (const [id, profile] of Object.entries(profilesJson.profiles)) {
    for (const key of Object.keys(profile)) {
      assert.ok(!visualOnly.has(key), `${id}: visual key ${key} leaked into authoritative data`);
    }
    assert.deepEqual(Object.keys(profile).sort(), authoritativeKeys, `${id}: unexpected key set`);
  }
  for (const state of registry.getAllStates()) {
    const profile = profilesJson.profiles[state.id];
    assert.ok(profile, `${state.id} missing from profiles file`);
    assert.deepEqual(state.environment, profile, `${state.id} catalog environment differs from profiles file`);
  }
});

test('WorldEnvironment lookup: scene places WorldEnvironment under the script node', () => {
  const scene = readText(SCENE);
  const envNode = /\[node name="Environment"[^\]]*\]\s*\nscript = ExtResource\("([^"]+)"\)/.exec(scene);
  assert.ok(envNode, 'Environment node must carry the environment_config script');
  const worldEnvBlock = /\[node name="WorldEnvironment" type="WorldEnvironment" parent="Environment"\]([\s\S]*?)(\n\[|$)/.exec(scene);
  assert.ok(worldEnvBlock, 'WorldEnvironment must be a child of Environment');
  assert.match(worldEnvBlock[1], /environment = SubResource\(/, 'WorldEnvironment needs an Environment resource');
});

test('WorldEnvironment lookup: script searches its own child, not its parent', () => {
  const body = functionBody(envSource, '_apply_to_world_environment');
  assert.match(body, /get_node_or_null\("WorldEnvironment"\)/);
  assert.doesNotMatch(body, /get_parent\(\)/, 'lookup must not search the parent');
  assert.match(body, /push_warning/, 'missing node must produce a bounded warning');
  assert.match(body, /_warned_missing_world_env/, 'missing-node warning must be emitted once');
});

test('complete application: every visual variable is set from one record', () => {
  const apply = functionBody(envSource, '_apply_complete');
  for (const field of ['climate', 'terrain', 'sky_color', 'fog_color', 'fog_density',
    'ambient_light_color', 'ambient_light_energy', 'building_density', 'vegetation_density']) {
    assert.match(apply, new RegExp(`\\b${field}\\s*=`), `_apply_complete must set ${field}`);
  }
  const worldEnv = functionBody(envSource, '_apply_to_world_environment');
  for (const prop of ['background_color', 'fog_light_color', 'fog_density',
    'ambient_light_color', 'ambient_light_energy']) {
    assert.match(worldEnv, new RegExp(`env\\.${prop}\\s*=`), `must push ${prop} to the environment`);
  }
});

test('stale values: each explicit application goes through the complete-record path', () => {
  const apply = functionBody(envSource, 'apply_region_profile');
  assert.match(apply, /_apply_complete\(/);
  const partial = functionBody(envSource, 'apply_profile');
  assert.match(partial, /validate_profile\(profile\)/, 'partial records must be validated before use');
  assert.doesNotMatch(partial, /\bhas\(/, 'partial records must be refused, not merged key by key');
});

test('controller: no duplicate profile table, no silent Ondo fallback, invalid id removed', () => {
  const ctl = readText(CONTROLLER);
  assert.doesNotMatch(ctl, /_load_regional_environment_profile/, 'duplicate table must be removed');
  assert.doesNotMatch(ctl, /ng:state:od/, 'invalid id ng:state:od must not remain');
  assert.match(ctl, /environment_config\.apply_region_profile\(region_id\)/);
});

test('scope protection: environment script performs no I/O, networking, or persistence', () => {
  for (const forbidden of ['FileAccess', 'DirAccess', 'ResourceLoader', 'HTTPRequest', 'rpc(', 'user://']) {
    assert.ok(!envSource.includes(forbidden), `environment_config.gd must not use ${forbidden}`);
  }
});

test('scope protection: default biome is explicit and has a valid record', () => {
  const defaultBiome = /const DEFAULT_BIOME := "(\w+)"/.exec(envSource);
  assert.ok(defaultBiome, 'DEFAULT_BIOME must be declared');
  assert.ok(BIOME_PRESET_SOURCE[defaultBiome[1]], 'DEFAULT_BIOME must name a preset');
  assert.ok(records[BIOME_PRESET_SOURCE[defaultBiome[1]]], 'DEFAULT_BIOME preset must have a record');
});
