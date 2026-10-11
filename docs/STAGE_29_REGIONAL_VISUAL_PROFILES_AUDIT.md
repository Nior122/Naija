# Stage 29: Regional Visual Profiles, Phase A Audit

Status: **Phase A (audit) COMPLETE. Phases B to I NOT STARTED. Stage 29 is OPEN.** Two decisions are required
from the project owner before the content model can be designed (Section 9). Stage 28 remains OPEN. Production
remains NOT READY.

No profile data, runtime code, or tests were changed by this audit. This record is the written audit checkpoint
required before any Stage 29 edit.

## 1. Starting state

- Branch `arena/00cdea0e-naija`. HEAD, `origin/arena/00cdea0e-naija`, and `git ls-remote` all at `e0c0626`
  (the case-access commit). 0 ahead, 0 behind, working tree clean, 0 stashes.
- Checkpoint at the audit start: `/home/user/stage29-checkpoints/20261011-*-at-e0c0626/` (bundle verified;
  `SHA256SUMS`, `head.txt`, `remote.txt`, `status.txt`). The earlier checkpoint
  `20261011-044535-pre-session` predates `e0c0626` and is not current evidence.
- Baseline before any change: `services/world-api` `npm run build` exit 0;
  `node --test test/regional-registry.test.mjs` 15 tests, 15 pass, exit 0;
  `node --test test/geography.test.mjs` 7 tests, 7 pass, exit 0.

## 2. Authoritative region source

**`game/data/geography/regional-catalog.json` is the authoritative list of regions.** It has 37 states with unique
IDs of the form `ng:state:<lowercase code>`, and unique codes. The server (`services/world-api/src/geography/`),
the government and justice code (`ng:state:fc` is named in comments and in `STATE_ID_PATTERN`), and the importer
(`ng:state:${stateCode.toLowerCase()}`) all use this namespace.

Verified by the processed 2D sample: `game/data/geography/processed/akure-south-core.json` has `state_id` =
`ng:state:on`. Ondo's correct catalog ID is therefore **`ng:state:on`**, not `ng:state:od`.

Historical "36 states plus FCT" wording in the catalog notice is consistent with 37 total IDs; the count used here is
the number of catalog entries, which is 37.

## 3. Verified counts

Counts are computed from the files, not from historical documentation.

**Phase A snapshot.** The counts and the visual-layer figures in this section describe the files as they were
before Phase C (`803fbdf`). They are kept for the audit record. Current state: Section 14.5.

| Measure | Count | Notes |
|---|---|---|
| Authoritative regions (catalog entries) | 37 | Unique IDs; unique codes |
| Non-visual profiles in `regional-environment-profiles.json` | 37 | One-to-one with catalog IDs; no duplicates, orphans, or missing entries |
| Malformed non-visual profiles | 0 | All 37 share the same 7-key schema; catalog `environment` blocks equal the profiles file |
| Visual entries in `environment_config.gd` | 5 keys, **4 valid** | `ng:state:la`, `ng:state:kd`, `ng:state:bo`, `ng:state:pl` are valid. `ng:state:od` is **invalid** (no such region) |
| Visual entries in `world_3d_controller.gd` | 3 keys, **2 valid** | `ng:state:la`, `ng:state:kd` valid. `ng:state:od` is **invalid** |
| Invalid visual mappings | 1 ID (`ng:state:od`) in both files | Orphan. Intended for Ondo |
| Regions without a valid visual profile | **33** | 32 never had an entry, plus Ondo (`ng:state:on`), whose entry is keyed to `od` |
| Regions without a valid non-visual profile | 0 | |
| Duplicate IDs or duplicate visual mappings | 0 | |
| Regions resolving to the controller's silent fallback | **35** of 37 | Only Lagos and Kaduna have their own entry in the controller |
| Regions resolving to a non-Ondo visual through a valid entry | 4 | Lagos, Kaduna, Borno, Plateau in `environment_config.gd` |

Historical "5 of 37 regions have visual profiles" (`OUTSTANDING_FEATURES_REGISTER.md` 1.3, `STAGE_26` item 13)
conflates the two layers and counts the orphaned Ondo key. Accurate statement today: **4 of 37 regions have a valid
visual profile.** After correcting `od` to `on`, the count becomes 5 of 37. The "32 missing" figure is correct only
after that correction.

Non-visual layer distribution (from the file): climate tropical 25, semi-arid 8, arid 3, montane 1; terrain
savanna 19, forest 9, coastal 5, plateau 4.

## 4. Findings

**F1. Orphaned Ondo key (defect).** Both visual tables key Ondo as `ng:state:od`. No catalog entry, profile, or
server record uses `od`. The Ondo visual therefore reaches Ondo only by accident, through the controller's
fallback. The controller's default `region_id` export is also `ng:state:od`, so the default region is not a catalog
region.

**F2. Silent fallback in the 3D controller (defect).** `world_3d_controller.gd` looks up
`profiles.get(region_id, profiles["ng:state:od"])`. Any unknown region receives the Ondo entry with no warning.
Lagos and Kaduna are the only regions that use their own entry in that table. The class-level default variables in
`environment_config.gd` (`fog_color`, `fog_density`, `ambient_light_color`, `ambient_light_energy`, and the sky
default) equal the Ondo record exactly. So a region with no valid profile currently renders in Ondo's colours
because of the class defaults, not because of an explicit fallback rule.

**F3. Two divergent visual tables.** `environment_config.gd` holds the full visual keys (sky, fog, ambient,
building density, vegetation). `world_3d_controller.gd` holds a different subset (climate, terrain, building
density, vegetation, ambient_sound, lighting). Where both define a region, the shared values agree
(Lagos, Kaduna, Ondo). Two tables for the same concept is a maintenance risk.

**F4. Region change did not apply the visual profile (Phase A). Status after Phase C: changed in code, not reachable
from play.** At Phase A, `change_region()` called only the controller's table, and `EnvironmentConfig.apply_region_profile()`
was never called on region change. In the Phase C code, `change_region()` calls `_configure_environment()`, which calls
`apply_region_profile(region_id)`. No game code calls `change_region()` with a region, because the 2D→3D restore does not
pass `region_id` (F5). Static inspection only. Not runtime-verified.

**F5. The region is never delivered from 2D to 3D (defect in the restore path).** `scene_switcher.gd`
`_restore_3d_state()` passes `{"character": …, "world": …}` to the 3D `set_shared_state()`. The controller reads
top-level `region_id`, `time_of_day`, and `player_state`. The 2D `get_shared_state()` returns `character`, `clock`,
and `player_position`, with no region or world key. In practice the 3D world always starts on its default region.
Fixing this needs a 2D-to-state mapping, for example from `processed/akure-south-core.json` `state_id`. That is a
change to shared-state behaviour, not only to visuals, so it is **not** included in Stage 29 without a decision
(Section 9, D3).

**Status after the F5 slice (Section 15):** the code fix is implemented and statically checked. Runtime is NOT RUN
and visual is NOT DONE, so F5 is not closed.

**F6. Two region namespaces in the 2D client.** The 2D sample uses `ng:region:ondo:akure-south-core`, which is a
settlement-level region. The 3D and visual code use state-level `ng:state:<code>`. Only the sample's `state_id`
connects them. `prototype_game.gd` line 530 compares the settlement ID directly.

**F7. Unconsumed fields.** Runtime reads of profile values (verified by search across `game/`):
- Applied to `WorldEnvironment` by `_apply_to_world_environment()`: `sky_color` (written as the background colour),
  fog colour, fog density, ambient colour, ambient energy.
- Stored only, never read by any renderer or system: `climate`, `terrain`, `building_density`,
  `vegetation_density`.
- Not consumed anywhere: `ambient_sound`, `lighting` (controller table only).

These fields are not removed by this audit. The stored-only fields have no runtime reader and must not be extended
without a consumer.

**F8. Stale-profile behaviour (Phase A). Status after Phase C: resolved in code.** At Phase A, `apply_region_profile()`
on a missing region warned and returned without resetting visuals. In Phase C an unresolved region applies the complete
Forest preset with one warning, and every resolved visual is applied as one complete record, so no value from a
previous region survives. Residual case: if the default-biome record were missing, visuals would be left unchanged
with a logged error (Section 14.9). Shipped data does not trigger it. Static inspection only.

**F9. Climate disagreement for Kaduna.** The visual table says `semi-arid`. The authoritative non-visual data says
`tropical` (savanna). The visual climate value is not consumed (F7). It should be reconciled by the owner, not
silently changed by Phase C.

**F10. Generator hazards.** `scripts/update-environment-profiles.js` is **not idempotent**. It renames full IDs to
abbreviations, so running it on the current file would write an empty profiles file. **It must not be run.**
`scripts/generate-regional-catalog.js` is a one-shot generator. Its `idMapping` maps `ng:state:fc` to
`ng:fct:abuja`, which conflicts with the catalog ID `ng:state:fc`. This is an open naming inconsistency.

**F11. Godot 4.7.2 is NOT RUN.** It is not installed. The release is published on GitHub, but the asset host
`release-assets.githubusercontent.com` is unreachable from this sandbox (TLS connection failure, `curl` exit 35).
No unofficial binary was used. Client GDScript cannot be validated in this environment.

**F12. Server and client consumption.** The server's `regional-registry.ts` reads only the catalog. Its
`getEnvironmentProfile` accessor has no production callers. The profiles JSON is read only by the two generator
scripts. The 2D client loads only `processed/akure-south-core.json`. No runtime code reads
`regional-environment-profiles.json`.

## 5. Persistence boundary

- No save format, world-state serialization, database schema, or multiplayer protocol stores visual profile data
  or a visual region. Persistent region fields (`regionId` in `services/world-api/src/multiplayer/types.ts`) and
  the catalog environment blocks are read-only content.
- Changing visual profile values therefore needs no save migration, database change, or protocol change, provided
  the change stays in the GDScript visual layer and in content files.
- The 3D region is client-side presentation state. It is not written by any server mutation route.

## 6. Client load and render path (as found at Phase A)

1. `scenes/main.tscn` contains `prototype.tscn` (2D) and `world_3d.tscn` (3D) with `scene_switcher.gd`. F3 toggles
   the mode. `world_3d.tscn` declares the `environment_config.gd` ext_resource (id `5_env`). At Phase A the in-scene
   node wiring was not checked. It is now checked by reading the scene file (static only, Phase D review): `World3D`
   › `Environment` (script `environment_config.gd`) › `WorldEnvironment` (with an `Environment` sub-resource), and
   `DirectionalLight3D` also under `Environment`. Runtime not verified.
2. `EnvironmentConfig._ready()` applies the default region (`ng:state:od`, which is invalid, F1).
3. `WorldController._ready()` applies its own table through `_configure_environment()` (F2, F3).
4. Region change: `change_region()` → controller table only (F4).
5. 2D→3D restore: region not delivered (F5).

**Current path (Phase C, static inspection only; not runtime-verified):**

- `EnvironmentConfig._ready()` applies the default region `ng:state:on`, which is a valid catalog ID.
- `WorldController._ready()` calls `_configure_environment()`, which calls `apply_region_profile(region_id)`. The
  controller's own table is removed.
- Region change: `change_region()` → `_configure_environment()` → `apply_region_profile()` (F4, now in code).
- 2D→3D restore: `scene_switcher.gd` still passes only `character` and `world`. The region is not delivered (F5, open).

## 7. Existing tests

- `services/world-api/test/regional-registry.test.mjs`: 15 pass. Asserts every state has a complete environment
  block and checks diversity (at least 3 climates, at least 4 terrains) across all states.
- `services/world-api/test/geography.test.mjs`: 7 pass.
- No test reads `regional-environment-profiles.json` or any GDScript visual table.
- The statement "no GDScript test exists" applied at Phase A only. Phase C added a headless GDScript test,
  `game/tests/regional_visual_profiles.gd`. It has **NOT been executed**: Godot 4.7.2 is unavailable (F11). It is
  not claimed to pass.
- Phase C also added a static Node test, `services/world-api/test/regional-visual-profiles.test.mjs` (17 checks).
  It reads the GDScript and scene files as text. It does not execute GDScript. Its result is an automated, static
  result, not runtime evidence.

## 8. Per-region mapping table

**Phase A snapshot.** This table records the resolution before Phase C. "Silent fallback to ng:state:od" describes the
controller table that Phase C removed. Current resolution: every catalog region resolves to its explicit record or to its
mapped biome preset (Section 14.5). The controller has no fallback table.

Generated from the files by a read-only script. `Non-visual` is from `regional-environment-profiles.json`. `Visual`
columns record whether a valid entry exists for that catalog ID in each GDScript file.

| # | Catalog ID | Name | Code | Non-visual profile (climate / terrain) | Visual entry in environment_config.gd | Visual entry in world_3d_controller.gd | Controller resolution |
|---|---|---|---|---|---|---|---|
| 1 | `ng:state:ab` | Abia | AB | tropical / forest | no | no | silent fallback to ng:state:od |
| 2 | `ng:state:ad` | Adamawa | AD | semi-arid / savanna | no | no | silent fallback to ng:state:od |
| 3 | `ng:state:ak` | Akwa Ibom | AK | tropical / coastal | no | no | silent fallback to ng:state:od |
| 4 | `ng:state:an` | Anambra | AN | tropical / forest | no | no | silent fallback to ng:state:od |
| 5 | `ng:state:ba` | Bauchi | BA | semi-arid / savanna | no | no | silent fallback to ng:state:od |
| 6 | `ng:state:by` | Bayelsa | BY | tropical / coastal | no | no | silent fallback to ng:state:od |
| 7 | `ng:state:be` | Benue | BE | tropical / savanna | no | no | silent fallback to ng:state:od |
| 8 | `ng:state:bo` | Borno | BO | arid / savanna | yes | no | silent fallback to ng:state:od |
| 9 | `ng:state:cr` | Cross River | CR | tropical / forest | no | no | silent fallback to ng:state:od |
| 10 | `ng:state:de` | Delta | DE | tropical / coastal | no | no | silent fallback to ng:state:od |
| 11 | `ng:state:eb` | Ebonyi | EB | tropical / forest | no | no | silent fallback to ng:state:od |
| 12 | `ng:state:ed` | Edo | ED | tropical / forest | no | no | silent fallback to ng:state:od |
| 13 | `ng:state:ek` | Ekiti | EK | tropical / plateau | no | no | silent fallback to ng:state:od |
| 14 | `ng:state:en` | Enugu | EN | tropical / plateau | no | no | silent fallback to ng:state:od |
| 15 | `ng:state:fc` | Federal Capital Territory | FC | tropical / savanna | no | no | silent fallback to ng:state:od |
| 16 | `ng:state:go` | Gombe | GO | semi-arid / savanna | no | no | silent fallback to ng:state:od |
| 17 | `ng:state:im` | Imo | IM | tropical / forest | no | no | silent fallback to ng:state:od |
| 18 | `ng:state:ji` | Jigawa | JI | semi-arid / savanna | no | no | silent fallback to ng:state:od |
| 19 | `ng:state:kd` | Kaduna | KD | tropical / savanna | yes | yes | own entry |
| 20 | `ng:state:kn` | Kano | KN | semi-arid / savanna | no | no | silent fallback to ng:state:od |
| 21 | `ng:state:kt` | Katsina | KT | semi-arid / savanna | no | no | silent fallback to ng:state:od |
| 22 | `ng:state:ke` | Kebbi | KE | semi-arid / savanna | no | no | silent fallback to ng:state:od |
| 23 | `ng:state:ko` | Kogi | KO | tropical / savanna | no | no | silent fallback to ng:state:od |
| 24 | `ng:state:kw` | Kwara | KW | tropical / savanna | no | no | silent fallback to ng:state:od |
| 25 | `ng:state:la` | Lagos | LA | tropical / coastal | yes | yes | own entry |
| 26 | `ng:state:na` | Nasarawa | NA | tropical / savanna | no | no | silent fallback to ng:state:od |
| 27 | `ng:state:ni` | Niger | NI | tropical / savanna | no | no | silent fallback to ng:state:od |
| 28 | `ng:state:og` | Ogun | OG | tropical / forest | no | no | silent fallback to ng:state:od |
| 29 | `ng:state:on` | Ondo | ON | tropical / forest | no | no | silent fallback to ng:state:od |
| 30 | `ng:state:os` | Osun | OS | tropical / forest | no | no | silent fallback to ng:state:od |
| 31 | `ng:state:oy` | Oyo | OY | tropical / savanna | no | no | silent fallback to ng:state:od |
| 32 | `ng:state:pl` | Plateau | PL | montane / plateau | yes | no | silent fallback to ng:state:od |
| 33 | `ng:state:ri` | Rivers | RI | tropical / coastal | no | no | silent fallback to ng:state:od |
| 34 | `ng:state:so` | Sokoto | SO | arid / savanna | no | no | silent fallback to ng:state:od |
| 35 | `ng:state:ta` | Taraba | TA | tropical / plateau | no | no | silent fallback to ng:state:od |
| 36 | `ng:state:yo` | Yobe | YO | arid / savanna | no | no | silent fallback to ng:state:od |
| 37 | `ng:state:za` | Zamfara | ZA | semi-arid / savanna | no | no | silent fallback to ng:state:od |

## 9. Decisions required before Phase B

The content model is not determined by the existing data. The following decisions are required, and the audit does
not make them unilaterally.

- **D1. Visual content for the 32 regions with no entry.**
  - (a) *Biome presets derived from the authoritative climate and terrain.* The five existing visual records
    (Lagos, Ondo, Kaduna, Borno, Plateau) serve as the coastal, forest, savanna, arid, and montane presets. The design
    document `docs/ADVANCED_3D_WORLD_ARCHITECTURE.md` already defines these five biomes. No per-region copies are
    created, so this follows the rule against copying shared defaults. Regions remain biome-level approximations, not
    individually art-directed. **Recommended.** Verified coverage: 29 of 32 regions map without ambiguity under this
    rule.
  - (b) *No per-region entry.* Regions use one explicit neutral default and a warning. No biome variation.
  - (c) *Individually art-directed numeric profiles.* Requires new numeric values with no source in the repository.
    Needs art review, and is not supported by any verified data.
- **D2. Tropical plateau (Ekiti, Enugu, Taraba).** Their authoritative data is `tropical / plateau`. The biome
  rule has no entry for them: the only documented plateau biome is montane, which requires the montane climate
  (Plateau alone). Choose one: forest preset, savanna preset, or neutral default.
- **D3. Scope of the 2D-to-3D region restore (F5).** Fixing it changes what the 3D world shows after a mode switch,
  and needs a 2D-to-state mapping. Options: include in Stage 29 with that mapping, or defer as a separate slice.
  **Recommended: defer.** Stage 29 must not change player or session behaviour.

Also to be confirmed as part of Phase C, not a decision: correcting `ng:state:od` to `ng:state:on` in both GDScript
tables and the controller default. This is required by F1 and uses only the authoritative catalog ID.

## 10. Stage 29 status (updated after the owner decisions)

Current status as of this update. The superseded text from the previous update is kept in Section 14.10.

- Phase A (audit): **COMPLETE**, committed as `803fbdf`, pushed to `origin/arena/00cdea0e-naija`.
- Phase B (design): **RECORDED** in Section 12.
- Phase C (implementation): **COMMITTED SEPARATELY FROM PHASE A** as `fix: resolve regional visual profiles and validate
  mappings`, on top of `803fbdf`. The hash is in `git log`, not in this file. Static checks pass (Section 14.6).
  Node tests pass (17/17). The headless Godot test is **NOT RUN**, because Godot 4.7.2 is unavailable. Phase C
  is not runtime-verified.
- Phases D to I: **NOT COMPLETE.** Phase D (runtime loader tests) is written but NOT RUN. Phase E is covered by static
  Node tests. Phase F checks are recorded in Section 14.6. Phase G review is in Section 14.9. Phase H is this section.
  Phase I (commit and push): done as described in Section 14.11.
- Repository state: **RESOLVED for sync.** The local branch is at `803fbdf`, equal to `origin/arena/00cdea0e-naija`
  (Section 14.1). The earlier `44483b4` state in Section 13 is superseded.
- Client validation: **NOT RUN.** Godot 4.7.2 is unavailable. The release asset host is unreachable from this sandbox.
- Visual validation: **NOT DONE.**
- Stage 28: **OPEN**. Not closed by this work.
- Production: **NOT READY**.

## 11. Decisions taken (owner, this stage)

- **D1: biome presets** (option a). The five existing visual records are the coastal, forest, savanna, arid, and
  montane presets. Other regions reference a preset by ID. No numeric values are copied.
- **D2: tropical plateau uses the Forest preset as a provisional approximation** for Ekiti (`ng:state:ek`), Enugu
  (`ng:state:en`), and Taraba (`ng:state:ta`). Constraints from the owner: keep their authoritative classification
  (`tropical / plateau`) unchanged; reuse the Forest preset with no new values; do not use Montane; do not use a
  neutral default; document the approximation; a dedicated tropical-plateau preset may be considered in a future
  stage; tests must confirm the mapping and the retained classification.
- **D3: the 2D-to-3D region restore is deferred** to a separate slice. Stage 29 does not change player or session
  behaviour.

## 12. Phase B design

### 12.1 Player-visible outcome, stated plainly

With D3 deferred, the 3D world still starts on its default region. In the current build that is Ondo. By static
derivation, the Ondo values equal the class defaults, so the default startup view is not expected to change visibly.
This is not visually confirmed. What changes, as coded:

1. The WorldEnvironment lookup is corrected in code (F13). At Phase A, `_apply_to_world_environment()` never found the
   node, so no regional visual reached the scene. The scene file shows the node is a child of the script node, and the
   code now looks it up there. Static inspection only. Runtime not verified.
2. When the region changes through `change_region()`, the code applies sky, fog, and ambient light for that region's
   preset. No game code supplies a region (F5, D3 deferred), so this is not reachable from play. Not runtime-verified.
3. Regions without a direct record use their mapped biome preset (32 regions). Only a region with neither a record
   nor a mapping applies the Forest preset, with one warning. No catalog region currently reaches that path. The
   static Node test reports `fallback=0`.

### 12.2 Content model

- **Explicit records (5):** `ng:state:la` (coastal), `ng:state:on` (forest), `ng:state:kd` (savanna),
  `ng:state:bo` (arid), `ng:state:pl` (montane). Values are unchanged. The only change is the Ondo key, `od` → `on`.
- **Biome presets (5):** a constant map from preset name to the explicit record it references. Presets hold no
  numeric values of their own.
- **Region mapping (32):** a constant map from each catalog region with no explicit record to one preset.
- **Mapping rule** (verified against the authoritative non-visual data by tests, in this order): terrain `coastal` →
  coastal; climate `montane` → montane; climate `arid` → arid; terrain `forest` → forest; terrain `savanna` →
  savanna; terrain `plateau` → forest, which is the D2 approximation for the three tropical-plateau regions. Expected
  result: coastal 4, forest 11 (8 by rule plus 3 by D2), savanna 15, arid 2, total 32.
- **Visual-only fields** stay as they are: `climate` and `terrain` are copied from the authoritative data for
  reference and are never read by the renderer. The authoritative JSON is not changed.

### 12.3 Lookup

`resolve_region_profile(region_id)` is a pure function of constants. It checks the explicit record first, then the
region mapping, then returns an empty result. It does not depend on file order, timing, or previous calls.

### 12.4 Fallback and missing-profile behaviour

- An unresolved region (not in the records or the mapping) applies the **Forest preset** explicitly, sets
  `region_id`, and emits `push_warning` once per region ID. The warned set is bounded by the catalog size.
- The controller no longer falls back silently. Its silent `profiles[...]` lookup is removed.

### 12.5 Validation

- At load, each explicit record must have all nine keys with the right types. Colour values are three floats in
  [0, 1]. `fog_density` is in (0, 0.01]. `ambient_energy` is in (0, 2]. Invalid records are skipped with one warning
  each. A mapping that points to a missing or invalid preset is treated as unresolved.
- Invalid content never crashes initialization. Every lookup uses `has()` or `get()` with a default.

### 12.6 Stale-profile rule

Applying a resolved profile sets **every** visual variable from that profile. No value from the previous region can
survive, because the existing `has()`-guarded partial merge is not used on this path. The fallback path also sets
every variable.

### 12.7 Client path changes

- `environment_config.gd`: add the presets, the mapping, the resolver, validation, the complete apply, and the child
  WorldEnvironment lookup. Fix the Ondo key.
- `world_3d_controller.gd`: remove its duplicate table. `_configure_environment()` calls
  `environment_config.apply_region_profile(region_id)`. Change the default `region_id` to `ng:state:on`.
- **Removed fields, a deliberate judgement:** the controller's table held `ambient_sound` and `lighting` for three
  regions. Nothing reads them, anywhere in `game/`. They are recorded here with their values so nothing is lost
  silently: Lagos `urban`/`bright`, Ondo `suburban`/`normal`, Kaduna `semi-rural`/`bright`. They remain in git
  history at `e0c0626`. The owner may object.

### 12.8 Exclusions (not done in Stage 29)

- D3, the 2D-to-3D region restore, and the 2D-to-state mapping.
- `time_of_day.gd` (F13b, open) looks up `WorldEnvironment` and `DirectionalLight3D` on its parent, `World3D`. Both
  nodes are children of `Environment`, so both lookups return `null`. The code's null guards skip the changes silently.
  Day and night sun and ambient lighting therefore never apply today. Fixing the lookup is outside profile scope and
  needs a design first. `_update_lighting()` runs every frame from `_process()`, and `_set_ambient_light()` writes
  `ambient_light_color` and `ambient_light_energy` on the WorldEnvironment. The regional profile sets the same two
  properties. A naive fix would therefore overwrite the regional ambient values every frame. One owner for ambient light
  must be chosen before F13b is fixed.
- Kaduna's visual `semi-arid` against the authoritative `tropical` (F9). The explicit record is preserved and the
  discrepancy is reported, not changed.
- No catalog, `regional-environment-profiles.json`, server, database, save, protocol, or corpus change.
- No Godot runtime claim. Client verification is static only, through `gdtoolkit` parsing, unless Godot can run.

### 12.9 Additional finding from implementation planning

**F13. The WorldEnvironment lookup never resolves.** `world_3d.tscn` places `WorldEnvironment` under the
`Environment` node. At Phase A, `EnvironmentConfig._apply_to_world_environment()` searched `get_parent()` (the `World3D`
root) for `WorldEnvironment`, so it found nothing and returned. No regional visual reached the scene. Phase C corrects this
lookup in `environment_config.gd` (static inspection only). The same mistake remains in `time_of_day.gd` (F13b, open). That
file also looks up `DirectionalLight3D` on the same parent (Section 12.8).

## 13. Repository state incident (recorded during Phase C)

> **Superseded by Section 14.1.** At the time of writing, the local branch was at `44483b4`. The
> later state is `803fbdf`, matching origin. The text below is kept as the historical record.

- While preparing the Phase C commit, the local repository was found to differ from the reported checkpoint.
- Reflog: `44483b4 HEAD@{0}: checkout: moving from main to arena/00cdea0e-naija`, and
  `44483b4 HEAD@{1}: clone: from https://github.com/Nior122/Naija.git`. The `.git` directory was re-created at
  05:46 (Oct 11).
- Local HEAD and the local branch are at `44483b4`, the base commit. `origin/arena/00cdea0e-naija` is at `803fbdf`.
  `e0c0626` is an ancestor of `803fbdf`, and `44483b4` is an ancestor of `803fbdf`.
- The Stage 29 checkpoint and the case-access checkpoint in `/home/user/stage29-checkpoints/` and
  `/home/user/stage30-checkpoints/` no longer exist. `/home/user` now holds only `Naija`.
- Content check (read-only, `git archive` of `803fbdf` against the working tree): the working tree matches
  `803fbdf` exactly, except three files. `docs/STAGE_29_REGIONAL_VISUAL_PROFILES_AUDIT.md` (sections 11 to 13
  added after the commit), `game/3d_world/scripts/environment_config.gd`, and
  `game/3d_world/scripts/world_3d_controller.gd` (the Phase C edits). No content was lost.
- Action taken: none to git. No reset, rebase, checkout, or commit was made. No file was discarded. Fetch was run
  (exit 0). The working-tree edits are preserved, uncommitted.
- Required before any Phase C commit: the owner must authorise re-syncing the local branch to
  `origin/arena/00cdea0e-naija` (`803fbdf`). This keeps the working-tree files and moves only the branch pointer and
  index. Then the checkpoint must be recreated at `e0c0626`.

## 14. Verification and hardening update (Phase C recovery and checks)

Evidence classes used below: **verified fact** (read from repository or file content), **static analysis** (GDScript
parse and lint, source text checks), **automated test** (Node test run with recorded exit code), **runtime** (Godot
executed), **visual** (rendered output checked), **deferred** (not done in this stage).

### 14.1 Git state (verified fact, read-only)

- Branch `arena/00cdea0e-naija`. Local HEAD `803fbdf4fbead94459764991e63568b815658af0`.
- `git ls-remote origin refs/heads/arena/00cdea0e-naija` returns `803fbdf`, so local equals remote.
- `e0c0626` is an ancestor of `803fbdf`.
- The clone is no longer shallow. It was unshallowed with `git fetch --unshallow origin` (exit 0), giving 93 commits.
- The reflog contains `reset: moving to 803fbdf` at 06:06:12 UTC. This was not in the recorded action log, so the actor
  is not known from the records. The Phase C files kept their working-tree edits. The before and after tree hash lists
  (`tree-before-sync.sha256`, `tree-after-sync.sha256`) are identical. The index now matches `803fbdf`, and the
  untracked files that appeared earlier are tracked there.
- Status now: three modified files (this audit document, `environment_config.gd`, `world_3d_controller.gd`). Two
  untracked new files (`game/tests/regional_visual_profiles.gd`, `services/world-api/test/regional-visual-profiles.test.mjs`).
- An error during this update: `git add -N` (intent-to-add) was run on the two new files. It was reverted with
  `git rm --cached` on those two paths only. The index was then verified empty, and the working files are intact.

### 14.2 Recovery artifacts (verified)

- `/home/user/stage29-recovery/phase-c-20261011-060548/`: the patch applies to `803fbdf` (exit 0). The patch reproduces
  all three `working/` copies byte for byte.
- `/home/user/stage29-recovery/phase-c-post-lint-20261011-061024/`: a patch against `803fbdf` (`phase-c-post-lint.patch`)
  and working copies, with SHA256 sums. Applied to a clean `git archive` of `803fbdf`, it reproduces the three modified
  files exactly. Untracked new files are copied under `untracked/`, with `SHA256SUMS-untracked-new.txt`.
- The full-history checkpoint is in `/home/user/stage29-checkpoints/full-history-at-e0c0626-20261011-060741/`.
  It was verified by clone and by ancestry check.

### 14.3 Lint fixes (static analysis)

Baseline numbers are from the committed `803fbdf` files, checked with `gdlint` 4.5.0 in `/tmp/gdvenv`.

| File | Baseline (803fbdf) | Now | Change |
|---|---|---|---|
| `environment_config.gd` | 21 | 4 | All 4 remaining are `class-definitions-order`, which were already in the baseline. The new `max-line-length` (25) and `max-returns` (1) findings are fixed. The colour check moved to `_color_problem()`, so `validate_profile` returns at most 6 times. Pre-existing trailing-whitespace findings disappeared with the rewrite. |
| `world_3d_controller.gd` | 40 | 38 | The new line-81 `max-line-length` is fixed. The removed duplicate table also removed 2 trailing-whitespace findings. Two `max-line-length` findings (lines 94, 241) and five `class-definitions-order` findings are pre-existing and unchanged. |
| `regional_visual_profiles.gd` (new) | n/a | 0 | Clean. |

No lint rule was disabled, no config file was changed, and no lint suppression was added.

Project-wide `npm run lint` (ESLint on `services/world-api/src`): **51 errors, exit 1**. This is the same as the
baseline. It is not caused by Stage 29 and is not claimed as solved.

### 14.4 WorldEnvironment lookup (F13, fixed in working tree)

- Scene check (verified fact): `world_3d.tscn` has `World3D` > `Environment` (node with `environment_config.gd`) >
  `WorldEnvironment` (with an `Environment` sub-resource). The lookup is therefore relative to the script node.
- Change: `_apply_to_world_environment()` uses `get_node_or_null("WorldEnvironment")`, not `get_parent()`. A missing node
  logs one bounded `push_warning` (`_warned_missing_world_env`).
- The `Environment` resource is duplicated once per instance (`_owns_environment`). The shared resource is not mutated.
- Static checks confirm the lookup and the scene hierarchy (Node test). Runtime behaviour is **NOT RUN**.
- **F13b (`time_of_day.gd`) is NOT fixed.** It has the same broken lookup. It is outside profile scope (Section 12.8).

### 14.5 Mapping and counts (verified against authoritative data)

- Catalog: 37 states, each with a unique `ng:state:<code>` ID.
- Direct explicit records: **5** (`la`, `on`, `kd`, `bo`, `pl`).
- Mapped through a biome preset: **32**. Coastal 4 (`ak`, `by`, `de`, `ri`); forest 11 (`ab`, `an`, `cr`, `eb`, `ed`, `im`,
  `og`, `os`, plus D2 `ek`, `en`, `ta`); savanna 15; arid 2 (`so`, `yo`).
- Fallback (default biome): **0**. Every region resolves to a record or a mapping.
- D2 check: Ekiti, Enugu and Taraba map to forest. Their authoritative `tropical / plateau` classification is unchanged in
  the catalog and in the profiles file. The forest preset is a provisional visual approximation (Section 11).
- Kaduna (`ng:state:kd`) keeps its visual `semi-arid`, which differs from the authoritative `tropical` (F9). Not changed.

### 14.6 Automated checks (exit codes recorded this session)

| Check | Command | Exit | Result |
|---|---|---|---|
| Build | `npm run build` | 0 | Pass |
| Type check | `cd services/world-api && npx tsc --noEmit` | 0 | Pass |
| Registry | `node --test test/regional-registry.test.mjs` | 0 | 15 pass, 0 fail |
| Geography | `node --test test/geography.test.mjs` | 0 | 7 pass, 0 fail |
| Stage 29 Node | `node --test test/regional-visual-profiles.test.mjs` | 0 | 17 pass, 0 fail |
| Full Node suite | `NAIJA_ENV=test node --test test/*.test.mjs` | 0 | 1065 total, 1028 pass, 0 fail, 37 skipped |
| Whitespace | `git diff --check` | 0 | Pass |
| Lint (project) | `npm run lint` | 1 | 51 errors (baseline) |
| GDScript parse | `gdparse` on `environment_config.gd`, `world_3d_controller.gd`, `regional_visual_profiles.gd` | 0, 0, 0 | Static only |
| Headless Godot | `godot --headless --path game --script res://tests/regional_visual_profiles.gd` | not run | **NOT RUN**, Godot unavailable |
| PostgreSQL suite | not run | n/a | **NOT RUN**, no PostgreSQL or Docker in this sandbox |

The Node suite total is up by 17 from the Case-access baseline (1048 total, 1011 pass, 37 skipped). That difference is
exactly the new Stage 29 file. The suite count is not the same as runtime evidence.

The Node Stage 29 suite is static. It reads `environment_config.gd` and the scene file as text, and compares them with
the authoritative JSON. It does not run GDScript. Its `dist` build dependency is the same as the existing registry tests.

### 14.7 Headless GDScript test (written; first run in section 16: PASS 43/43 after a test-side correction)

`game/tests/regional_visual_profiles.gd` runs the real `EnvironmentConfig` script under `SceneTree`. It covers:
preservation of the five records; lookup and mapping; invalid IDs; WorldEnvironment access; missing node (no crash,
single warning); repeated application without stale values; the per-instance Environment copy; refused incomplete
records; validation rules; and catalog coverage. It has not been executed.

### 14.8 Scope protection (verified by static tests)

- The five preset values match the committed `803fbdf` baseline exactly. The only key change is `ng:state:od` to
  `ng:state:on` (F1). Values are unchanged.
- The authoritative profile file keeps only its seven non-visual keys. No visual field was added to it.
- The environment script performs no file I/O, network, RPC, or `user://` access.
- No catalog, profile JSON, database, save format, world-state serialization, protocol, route, or corpus change.
- Removed fields (a judgement recorded in Section 12.7): the controller's unread `ambient_sound` and `lighting`
  values. Nothing reads them anywhere in `game/`. The values are kept in this document, and in git history at `e0c0626`.

### 14.9 Phase G review (static)

- Parsing: profile records are parsed once at load, in `_load_regional_profiles()`. Nothing is parsed per frame.
- Filesystem: no scans and no directory access.
- Caches: the warned-key set is capped at `MAX_WARNED_KEYS` (64). The missing-node warning fires once.
- Errors: each invalid record and each mapping problem is warned once, not repeatedly.
- Determinism: lookup is a pure function of constants and records. Results do not depend on dictionary order.
- Known limitation: if the default biome record were missing, `apply_region_profile` would log `push_error` and leave the
  visuals unchanged. Shipped data does not trigger this. It is documented here, not hidden.
- Known limitation: `set_time_of_day_effects("dawn" | "dusk" | "night")` still sets colours directly. This is pre-existing
  and outside profile scope.

### 14.10 Superseded status (kept as history, previous update)

The status text in Section 10 before this update is preserved here in full:


- Phase A (audit): **COMPLETE**, committed as `803fbdf`, pushed to `origin/arena/00cdea0e-naija`.
- Phase B (design): **RECORDED** in Section 12. Uncommitted in the working tree.
- Phase C (implementation): **IN WORKING TREE ONLY, UNCOMMITTED.** `game/3d_world/scripts/environment_config.gd` and
  `game/3d_world/scripts/world_3d_controller.gd` contain the change. Parsed with `gdtoolkit` 4.5.0 (`gdparse`, exit 0).
  Not runtime-tested. `gdlint` reports new findings (25 line-length, 1 max-returns in `validate_profile`, 1 controller
  line-length). The original files already had 21 and 40 findings.
- Phases D to I: **NOT COMPLETE.** Blocked. The local git state was re-cloned at `44483b4`, not `e0c0626`/`803fbdf`
  (see Section 13). No commit was made on the wrong base, and no push was made.
- Client validation: **NOT RUN.** Godot 4.7.2 is unavailable. The release asset host is unreachable from this sandbox.
- Visual validation: **NOT DONE.**
- Stage 28: **OPEN**. Not closed by this work.
- Production: **NOT READY**.

### 14.11 Delivery

- Owner approved a local Phase C commit on top of `803fbdf`. **Not pushed.** The push waits for a separate owner
  decision. Message: `fix: resolve regional visual profiles and validate mappings`. The commit contains only the
  three modified files and two new files listed in Section 14.1.
- The branch sync is handled in Section 14.13.
- The commit does not complete Stage 29. Godot runtime is NOT RUN, visual validation is NOT DONE, and Phases D
  (runtime) and I are only partly done. Stage 28 stays OPEN, and production stays NOT READY.

### 14.12 Requirements not met or not verified

- Evidence key used in this document: *static inspection* (file reads, `gdparse`, `gdlint`, grep); *automated* (Node
  test runs with exit codes); *runtime* (Godot executed: **none**); *visual* (rendered output observed: **none**).
- Godot 4.7.2 headless run: **NOT RUN**. The headless test `game/tests/regional_visual_profiles.gd` has not executed.
  Runtime claims are not made.
- Visual validation: **NOT DONE**.
- PostgreSQL: not run.
- F13b (`time_of_day.gd`): not fixed. It covers the `WorldEnvironment` and `DirectionalLight3D` lookups, and carries a
  per-frame ambient conflict risk (Section 12.8).
- F5 (2D-to-3D restore key mismatch): deferred by D3. Static inspection: `scene_switcher.gd` still passes only
  `character` and `world`, so the region is not restored from play.
- F9 (Kaduna `semi-arid` vs `tropical`): not changed.
- F10 (generator `ng:state:fc` vs `ng:fct:abuja`): not changed. `update-environment-profiles.js` was not run.
- F11 (Godot unavailable): unchanged.
- Stage 28 remains OPEN. Production remains NOT READY.

### 14.13 Re-sync record (local branch)

- Found at the start of this step: the local branch was at `44483b4`, a fresh shallow clone (reflog `clone`, 07:34:49 UTC).
  The remote was at `803fbdf`, with parent `e0c0626`.
- `git fetch --unshallow origin` (exit 0) restored the full history: 93 commits, `e0c0626` an ancestor of `803fbdf`.
- Before the re-sync, the working tree differed from a clean `git archive` of `803fbdf` in exactly five files: the three
  Phase C files, and the two new test files. The other differences in `git status` were from the old base.
- Re-sync: `git reset --mixed` to `803fbdf`. This moves the branch and index only, and keeps every working-tree file.
  It is not a hard reset, and nothing was discarded.
- Recovery copy of the five files, verified by patch reproduction from `803fbdf`:
  `/home/user/stage29-recovery/recaptured-vs-803fbdf-20261011-074208/`.


## 15. F5: 2D-to-3D regional handoff (code implemented; runtime NOT RUN)

**Status.** The code fix is implemented in the working tree. Static and Node checks pass. Godot 4.7.2 was not available,
so the headless test has NOT run, the in-game transition has NOT been exercised, and visual validation is NOT DONE.
F5 is not closed until those are run. Evidence labels: *static* (source reading and `gdparse`/`gdlint`),
*automated* (Node test with exit code), *runtime* (Godot executed: **none**), *visual* (rendered output: **none**).

### 15.1 Verified root cause (static)

1. **The 3D payload had no region.** `scene_switcher.gd` `_restore_3d_state()` passed `{character, world}`. The 3D
   controller's `set_shared_state()` reads a top-level `region_id`. The key never arrived, so `change_region()` was
   never called from a handoff. *Static.*
2. **The 2D client could not export its character.** `prototype_game.gd` `get_shared_state()` called
   `character.to_dict()` and `clock.to_dict()`. `set_shared_state()` called `character.from_dict()` and
   `clock.from_dict()`. `CharacterState` and `WorldClock` define only `to_dictionary()` and `load_dictionary()`.
   No commit in the history defines `to_dict` or `from_dict` (`git log -S`). The character dictionary is the only
   carrier of `geographic_location`, so it was never produced. *Static.* Not verified: whether Godot rejects these calls
   when the file is parsed (typed `CharacterState` and `WorldClock` bases) or only when they run.
3. **Initialisation order.** `switch_to_3d()` calls `add_child()` before `_restore_3d_state()`. `EnvironmentConfig._ready`
   and `WorldController._ready` therefore apply the default `ng:state:on` first. The restore is the only point at which
   a located region can replace it. *Static.*
4. **The source of the region.** `character.geographic_location` is set by `geographic_region_preview.gd` from the
   processed sample. Its `state_id` is `ng:state:on`, a catalog ID. It is set only while Map data is on and the
   player is outdoors (`prototype_game.gd`, `_on_player_travelled`), and it is cleared on leaving town
   (`_change_location`). Otherwise it is `{}`. *Static.*

### 15.2 Handoff contract

- **A. Source of truth:** `character.geographic_location.state_id` in the 2D character state. No second region store
  was added. The geographic `region_id` (`ng:region:…`) is not used, because it is the settlement namespace (F6).
- **B. Format:** canonical `ng:state:<code>`, the same IDs as the catalog and the Phase C visual tables. The sample's
  `state_id` is a catalog state with a resolvable profile (checked by a static test).
- **C. Mechanism:** the existing `set_shared_state` payload, using the top-level `region_id` key that the 3D controller
  already defines. No autoload, no new signal, no new state object.
- **D. Order:** the default is applied in `_ready`. The handoff runs synchronously inside `switch_to_3d()`, before
  the next rendered frame (*static* reasoning). A valid region replaces the default. A valid region equal to the
  default does nothing.
- **E. Invalid or missing region:**
  - Valid and resolvable: applied.
  - Key missing, empty string, or no located position: keep the documented default `ng:state:on` and print a notice.
    **Owner decision needed (Section 15.7).**
  - Non-string value: treated as missing.
  - Correct format but no visual resolution (`ng:state:zz`, the retired `ng:state:od`, `not-a-region`): refused with a
    warning. The current region and its visuals are kept.
  - No `environment_config` (before ready): refused with a warning. No caller does this.

### 15.3 Implementation (production code)

- `game/scripts/prototype_game.gd`: `get_shared_state()` uses `to_dictionary()` for the character and the clock.
  `set_shared_state()` restores the clock first with `load_dictionary()`, then the character with
  `load_dictionary(data, clock.calendar_date())`. This is the order the save and online-session paths use. A `clock != null`
  guard was added to the character branch.
- `game/3d_world/scripts/scene_switcher.gd`: `_restore_3d_state()` adds `region_id`. A new `static func
  region_id_from_character()` returns the `state_id`, or `""` if it is missing or malformed.
- `game/3d_world/scripts/world_3d_controller.gd`: `change_region()` validates the region with
  `environment_config.resolve_region_profile()` before any state changes. A refusal warns and returns.
  `set_shared_state()` no longer writes `region_id` directly. A missing or empty region keeps the current one.

Not changed: `environment_config.gd`, the catalog, the profile data, the presets, the 32-region mapping, the scenes,
`time_of_day.gd` (F13b), the save format, the identity or session code, and the world-api.

**Return path (3D to 2D): corrected in the F5 acceptance review (section 16).** The earlier wording here said the
2D `set_shared_state()` now restores the clock and character. That is not true for the path the switcher uses. The
switcher instantiates a new 2D prototype and calls `set_shared_state()` straight after `add_child()`. At that point
`clock` and `character` are still `null`, because the prototype creates them only in `_start_new_game()`, in the
online-session handler, or when a save is loaded. The `clock != null` and `character != null` guards therefore skip
the restore silently. The clock, character, and the rest of the captured state are not restored on this path. The
`from_dict` calls were removed, but no restore happens. This is a pre-existing structural gap, and it is an owner
decision (section 16.4).

### 15.4 Tests

| Check | Kind | Result |
|---|---|---|
| `services/world-api/test/regional-handoff.test.mjs` (new, 9 checks) | static, automated | **9/9 pass** on the fix. Run against `HEAD`'s game files: **6 of 9 fail**, which shows it detects the defect. |
| `game/tests/regional_handoff.gd` (new, headless SceneTree) | runtime | **NOT RUN.** Covers: `region_id_from_character` cases; the switcher payload through a stub receiver; a valid handoff; refused regions keep the located region; a missing region uses the default; a repeated transition does not carry a region; a mapped region (`ng:state:ek`, forest) resolves and applies its profile; and a character and clock `to_dictionary()`/`load_dictionary()` round trip keeps the handed region (added in section 16). It does not cover the 3D-to-2D restore, which needs the full prototype scene. |
| `regional-visual-profiles.test.mjs` | automated | 17/17 pass, exit 0 |
| `regional-registry.test.mjs` | automated | 15/15 pass, exit 0 |
| `geography.test.mjs` | automated | 7/7 pass, exit 0 |
| Full Node suite (`npm test`, includes build and `tsc`) | automated | 1074 total, 1037 pass, 0 fail, 37 skipped, exit 0. The previous baseline was 1065, plus the 9 new checks. |
| `gdparse` on the four changed GDScript files | static | exit 0 each |
| `gdlint` on the three changed production scripts | static | same lint messages as `HEAD`, checked per file. The controller has its recorded 38 baseline messages. |
| `gdlint` on `regional_handoff.gd` | static | no problems, exit 0 |
| `npm run lint` (ESLint, TypeScript service) | static | 51 errors, exit 1. This is the existing baseline, and no TypeScript changed. |
| `git diff --check` | static | exit 0 |

### 15.5 What is verified and what is not

- **Verified by static inspection:** the root-cause chain in 15.1; the key mismatch; the nonexistent method names
  (their absence from every commit); the sample `state_id` in the catalog; the initialisation order.
- **Verified by automated static test:** the method-name cross-check (every `character.` and `clock.` call in the 2D
  client exists on its class); the switcher and controller wiring; the catalog link. Result: 9/9.
- **Verified at runtime:** none for F5. The handoff test is **NOT PASSING** in Godot 4.7.2 (exit 1, blocked, section 16).
  A diagnostic copy with copy-only edits passed 41 of 41 checks; that is not acceptance evidence. (The earlier line here
  said Godot was not installed. That is no longer true; see section 16.)
- **Not verified:**
  - whether the original 2D shared-state calls failed at parse time or at call time;
  - whether the scene and the 2D client load headless without errors;
  - whether `from_dict` and `to_dictionary` round-trip without loss in play;
  - the 3D-to-2D return path;
  - the in-game transition (F3 with Map data on, outdoors, then back);
  - visual output: **NOT DONE**.

### 15.6 Visible effect in the current data

Every located position in the current 2D sample resolves to `ng:state:on`, which is also the default. So this fix
changes no visible region in the current content. Its effect appears when a different state is located, which the
sample does not yet provide. The handoff is correct, but no visible change is claimed.

### 15.7 Owner decision needed: the unlocated default

The unlocated case is the common one. Map data is off unless the player turns it on outdoors. The default `ng:state:on`
is kept because the controller documents it (`# Ondo State (Akure South)`), and the only geographic sample is in Ondo.
Idera Quarter is described as fictional, so Ondo is not a real location for it. A fail-visible alternative would stop
the transition, which is a gameplay regression. Please confirm this default, or choose another.

### 15.8 Adjacent defects found and not fixed

- **A. Multiplayer client not attached in 3D.** `world_3d_controller.gd` `_ready` looks for the client on
  `get_parent()`, which is `Mode3D`, not the switcher. Static: the client is never attached. Separate slice.
- **B. Unreachable restore branches.** The switcher never supplies `time_of_day` or `player_state`, so those branches
  in the 3D `set_shared_state()` are unreachable. Separate slice.
- **C. F13b unchanged.** `time_of_day.gd` lookups and ambient ownership are not touched. This fix does not write to
  the ambient properties beyond the existing Phase C profile application.
- **D. Client-supplied location.** `geographic_location` is held by the client and is not checked by the server (the
  justice design, L3). The 3D region is presentation-only and must not be used for server decisions.
- **E. Shared-state methods never ran.** No commit defines the methods they call, and the repository records the Stage 1
  Godot runtime as unverified. The 2D client's runtime behaviour is therefore unverified in this sandbox.

### 15.9 Remaining status

- F5: code implemented; automated static checks pass; **runtime acceptance BLOCKED** (section 16). The headless
  handoff test cannot load in Godot 4.7.2 because of pre-existing production defects outside F5. Its exit code in
  the repository is 1. The in-game check (Map data on outdoors, F3 to 3D, F3 back) has not been attempted.
- F9, F10, F11, F13b, and the README gap: unchanged, still OPEN.
- Stage 29: OPEN. Stage 28: OPEN. Production: NOT READY.

## 16. F5 acceptance review (2026-10-11): result and evidence

### 16.1 Result

**F5_BLOCKED.** The region handoff passes static review. It has not passed the headless handoff test in Godot
4.7.2, because the test cannot load: production files outside the F5 change set fail to compile or load on that
engine (16.6). Separately, the 3D-to-2D return path does not restore the character or the clock (16.3). That needs an
owner decision.

- Stage 29: OPEN. Stage 28: OPEN. Production: NOT READY.
- Runtime acceptance for F5: NOT MET. The in-game check has not been attempted.
- Update (2026-10-11): the compile blockers in 16.6 are fixed, and the headless handoff and visual tests pass on the custom build. See section 17. The return path in 16.3 remains blocked.

### 16.2 Repository state at the start of the review

Branch `arena/00cdea0e-naija`, HEAD and remote tip `967729982ae8f6ee272238b46b87db14104a188b` (F5 `9677299`), parent
`21adf20098aba9adda199b0ecc46c289444345d31`, working tree clean. `git fetch origin` exit 0, ahead/behind 0/0.

### 16.3 Unlocated default and the handoff

| Check | Result | Evidence class |
|---|---|---|
| A valid authoritative region reaches the 3D controller | Pass by code trace. The switcher payload carries top-level `region_id` (`scene_switcher.gd` `_restore_3d_state`). The controller routes it through `change_region()`. | static; diagnostic engine run |
| Missing or empty region keeps the documented fallback | Pass by code trace. The controller prints "No located region handed over; keeping …". | static; diagnostic engine run |
| Invalid non-empty region is rejected and the valid region is kept | Pass. `ng:state:zz`, `ng:state:od`, and `not-a-region` are refused, and `ng:state:bo` is kept. | diagnostic engine run only |
| The default is not substituted by initialisation order | Pass by code trace: `add_child()` runs `_ready()` (default), then the restore replaces it. The engine log in the diagnostic shows "ng:state:on" then "Changing region from ng:state:on to ng:state:bo". Godot lifecycle order is runtime-observed only in the diagnostic copy. | static; diagnostic engine run |
| `ng:state:on` is not shown as a verified location | Pass for the current code. `get_performance_stats()` has no caller, and no UI shows the region. The `_ready` log line names `ng:state:on` as the region being initialised. The default still renders as Ondo's visual profile. This is documented in 15.7 and remains an owner decision. | static |
| No catalog, preset, or 32-region mapping change; no new save field; no new autoload | Pass. The F5 diff does not touch those files. | static |

**Return path (3D to 2D): defect, not fixed.** `switch_to_2d()` instantiates a new 2D prototype and calls
`set_shared_state()` straight after `add_child()`. The prototype creates `character` and `clock` only in
`_start_new_game()`, in the online-session handler, or when a save is loaded (`prototype_game.gd` 193–231, 498). At
that moment both are `null`, so the guards `clock != null` and `character != null` skip the restore without any
message. The clock, character, position, location, and playing state are therefore not restored on this path.
The pre-F5 code had the same guard and the same result. The F5 commit removed the nonexistent calls but did not
make the restore happen. Section 15.3 previously claimed otherwise. That claim is corrected above.

Options for the owner (not implemented, because each one is a wider change):
1. Keep the 2D instance alive while in 3D, instead of `queue_free()`. This changes the switcher lifecycle.
2. Create the clock and character in `set_shared_state()` when they are missing. The 2D `_ready()` shows the
   character-creation modal, so restored state would sit behind it. This is a flow decision.
3. Restore from the saved game on return through the existing continue path. Unsaved progress would be lost.

A silent skip of valid data is not acceptable under the review rules. A warning on skip would be a small follow-up,
but it does not fix the gap.

### 16.4 Serialization (D)

- No `.to_dict(` or `.from_dict(` call remains under `game/` or `services/`. The only matches are two comments in
  `regional-handoff.test.mjs`. No method was renamed.
- The clock is restored before the character at `prototype_game.gd` 230–232, 499–501, and 1247–1251. The character load
  uses `clock.calendar_date()`, as the save path does.
- The save format is unchanged. `to_dictionary()` keys are the same keys the save service writes.
- Null handling: the guards in 16.3 skip valid restoration silently on the return path. This is the defect above.

### 16.5 Handoff sequence (E)

2D character with `geographic_location.state_id` (set at `prototype_game.gd` 571 and 1178 from the located preview;
cleared to `{}` at 683 when the player enters a non-town location) → `_save_2d_state()` in `switch_to_3d()`, before
`queue_free()` → `shared_character_data` → `$Mode3D.add_child()` → `_restore_3d_state()` with top-level `region_id`
→ `set_shared_state()` → `change_region()` validates with `resolve_region_profile()` before any state change →
`_configure_environment()` → buildings reload. Empty or missing region → keep the current region.

Runtime-unverified in the repository (the test cannot load). Observed only in the diagnostic copy (16.6): the order
of `_ready()` relative to the restore, the rejection messages, and the profile application.

### 16.6 Godot 4.7.2 runtime (G)

**Binary provenance.** Built from the official tag `4.7.2-stable`, commit `ed1daf0bf001b61586d9930840f2f1394092c079`,
cloned from github.com. It is a custom build, not the official release binary. The release-assets host was already
known to be unreachable. Build options: x11, wayland, alsa, pulseaudio, speechd, dbus, udev, and fontconfig disabled;
bundled third-party libraries used. A `pkg-config` stub in `/tmp/godot-build/bin` answers `--version` only and fails
every other query. It is not a security control. No package was installed, and no dependency was changed.

**Build steps and exit codes.**

| Build | Result |
|---|---|
| Template debug, first attempt | Compiled. Link failed (BUILD_EXIT=2). The archive order put `libdrivers.a` before `libservers.a`. |
| Template debug, relinked | The same objects were linked with all archives inside `--start-group`/`--end-group` (script `/tmp/godot-build/relink_grouped.py`). LINK_EXIT=0. |
| Template debug with `disable_path_overrides=no` (needed for `--path`) | Same link problem, same relink, LINK_EXIT=0. |
| Editor (`target=editor`) | BUILD_EXIT=0. No relink needed. |

`--version` on each binary: `4.7.2.stable.custom_build.ed1daf0bf`, exit 0.

**Runs in the repository (`/home/user/Naija`).**

| Command | Exit | Result |
|---|---|---|
| `godot --headless --editor --path game --quit` (editor binary) | 0 | Generated `game/.godot/global_script_class_cache.cfg`. The 37 `.gd.uid` files it also created were moved to `/tmp/godot-uid-quarantine` and not committed. |
| `godot --headless --path game --quit` (template binary) | 0 | Load prints script errors (see 16.6, check-only). Exit 0 does not mean the project loads. |
| `regional_visual_profiles.gd`, first run | 1 | FAIL: 2 of 43. Test defect. The test captured the environment after `_ready()` had already copied it, so the "original" was the per-instance copy. |
| `regional_visual_profiles.gd`, after the test correction | **0** | **PASS: 43 Stage 29 visual profile checks.** |
| `regional_handoff.gd` | **1** | Blocked before any assertion. First error: `camera_3d_controller.gd:106` "Identifier delta not declared". Then `world_3d.tscn` fails to load. |

The visual-profiles correction changed only how the test captures the source resource. It did not change any expected
value. The fix is `_new_config()` taking an optional source `Environment` set before `add_child()`, and
`_test_repeated_application()` building its source first.

**Check-only pass on all 37 `.gd` files** (read-only, run on a copy of `game/`, `--check-only --script`). Twelve fail:

| Script | First engine error |
|---|---|
| `3d_world/scripts/camera_3d_controller.gd` | `delta` undeclared at line 106 (Stage 23 code, commit `ea2281b`) |
| `3d_world/scripts/scene_switcher.gd` | Depends on `prototype_ui.gd`, `multiplayer_client.gd`, `prototype_game.gd` |
| `scripts/domain/education_service.gd` | `get()` called with two arguments on a `CharacterState` (lines 558, 1273, 1295, 1694); Variant inference at 1091 |
| `scripts/domain/school_service.gd` | Type inference from Variant (`configured_subject`) |
| `scripts/prototype_game.gd` | Depends on the UI and multiplayer scripts; Variant inference at 98 and 292 |
| `scripts/services/multiplayer_client.gd` | "Expected indented block after match pattern block" |
| `scripts/services/performance_monitor.gd` | `Performance.TIME_PHYSICS`, `TIME_IDLE`, `MEMORY_DYNAMIC` not found in 4.7.2 |
| `scripts/ui/career_panel.gd` | Type inference from Variant |
| `scripts/ui/prototype_ui.gd` | "Expected indented block after if block" |
| `tests/persistence_notice.gd`, `tests/session_policy.gd` | Depend on `multiplayer_client.gd` |
| `tests/regional_handoff.gd` | Depends on `camera_3d_controller.gd` and `world_3d.tscn` |

Also blocking: `3d_world/scenes/world_3d.tscn` lists `[sub_resource]` blocks after the nodes that reference them. The
loader rejects that order (`resource_format_text.cpp`, "Invalid parameter … world_3d.tscn:23"). The F5 constraints
forbid changing scenes, so this was not changed.

**Diagnostic only, not acceptance.** On a copy of `game/` in `/tmp/godot-diag`, the following copy-only edits were made:
(1) camera line 106 `follow_speed * delta` → `follow_speed * 0.016`; (2) the two class-level preloads in
`scene_switcher.gd` set to `null`; (3) the `[sub_resource]` blocks of `world_3d.tscn` moved above the nodes;
(4) in `education_service.gd`, the four `character.get(k, d)` calls read the property directly, and one Variant
annotation was added. With those edits the unchanged `regional_handoff.gd` ran to **PASS: 41 of 41, exit 0**. This
shows that the handoff logic works in the engine once the blockers are cleared. It does not show that the 2D client
works. `prototype_game.gd`, `prototype_ui.gd`, `multiplayer_client.gd`, and the rest of the 2D scripts were not patched
in the copy, and the copy's `scene_switcher.gd` does not load the 2D scene. Nothing from the copy is committed.

**Correction to earlier claims.** The `gdparse` checks in sections 14 and 15 used gdtoolkit 4.5.0. It accepted
`multiplayer_client.gd` and `prototype_ui.gd`, which Godot 4.7.2 rejects. `gdparse` and `gdlint` are not engine
validation.

### 16.7 Test quality (F)

- `regional_handoff.gd` now covers, in addition to the earlier groups: a mapped region resolving through its biome
  (`ng:state:ek` → forest), and a character and clock `to_dictionary()`/`load_dictionary()` round trip that keeps the
  handed region. The round-trip group depends on `character_state.gd`, which depends on `education_service.gd`. So the
  compile blocker prevents the whole test from loading. This is consistent with the blocker, not a new defect.
- Not covered by any runtime test: the 3D-to-2D restore. It needs the full prototype scene, which is blocked.
- The Node tests are static evidence only. They read source text. They are not runtime validation.

### 16.8 Checks run in this review (exit codes)

| Check | Exit | Result |
|---|---|---|
| `regional-handoff.test.mjs` | 0 | 9 pass, 0 fail |
| `regional-visual-profiles.test.mjs` | 0 | 17 pass, 0 fail (re-run after the GDScript correction) |
| `regional-registry.test.mjs` | 0 | 15 pass, 0 fail |
| `geography.test.mjs` | 0 | 7 pass, 0 fail |
| `npm test` (build, tsc, full Node suite), run before the visual GDScript correction | 0 | 1074 total, 1037 pass, 0 fail, 37 skipped |
| `npm run lint` from the repository root | 1 | 51 errors, 0 warnings. The existing baseline, unchanged. |
| `gdparse` on the changed scripts and both tests | 0 | Static only (16.6 caveat) |
| `gdlint` controller / environment | 1 | 38 and 4 messages, the baseline |
| `gdlint` `prototype_game.gd` | 1 | 10 messages; parent commit 21adf20 measured 11 on a copy |
| `gdlint` `scene_switcher.gd` | 1 | 18 messages; parent 18 |
| `gdlint` `regional_handoff.gd` and `regional_visual_profiles.gd` | 0 | No problems |
| `git diff --check` | 0 | Clean |

### 16.9 Adjacent findings (H)

- **A. Multiplayer client not attached in 3D.** `world_3d_controller.gd` `_ready` looks for the client on
  `get_parent()`, which is `Mode3D`, a plain `Node`. The guard fails silently. It does not block the region handoff.
  Separate slice.
- **B. Unreachable restore branches.** The switcher never supplies `time_of_day` or `player_state`, and the 3D state
  that carries them is not stored. Not blocking. Separate slice.
- **C. Pre-existing 4.7.2 load failures (16.6).** These block the 2D client and the 3D scene at runtime. They are
  outside F5. This is the most important finding in this review for the project as a whole.
- **D. F13b unchanged.** `time_of_day.gd` was not touched.
- **E. F9 unchanged.** Kaduna visual `semi-arid` vs authoritative `tropical`.
- **F. Owner approval.** The F5 commit `9677299` and its push were made without fresh owner approval for those steps.
  This is reported.
- **G. Recovery list.** The 20-item recovery-prompt list is not preserved anywhere in the repository or the session
  memory. The owner should supply it again if it is still needed.

### 16.10 Status and next action (I, J)

- Stage 29 OPEN. Stage 28 OPEN. Production NOT READY.
- F5 BLOCKED. The next action is an owner decision: approve a separate slice to make the 12 failing scripts and the
  `world_3d.tscn` ordering load on Godot 4.7.2. Then rerun `regional_handoff.gd`. The return-path options in 16.3 need a
  separate decision.

## 17. Godot 4.7.2 compatibility repair (2026-10-11)

Scope: the owner's compatibility mission. It fixes the 12 scripts and the `world_3d.tscn` load failure recorded in 16.6.
It does not implement the 3D-to-2D return restore (16.3), and it adds no features, dependencies, autoloads, or data
changes.

### 17.1 Result

**COMPATIBILITY_REPAIR_PASSED_RUNTIME_CHECKS_PENDING_VISUAL_VALIDATION.**

- All 37 `.gd` files pass `--check-only` (before: 25 of 37; 12 failed).
- `3d_world/scenes/world_3d.tscn` loads.
- `tests/regional_handoff.gd` PASS 41 of 41, exit 0. `tests/regional_visual_profiles.gd` PASS 43 of 43, exit 0. Both
  on the custom engine build in 17.2.
- The 3D-to-2D return restore was **not fixed in this repair** (17.5). Section 18 fixes it.
- In-game F5 play and visual validation have **not** been run. They are pending.
- Stage 29 OPEN. Stage 28 OPEN. Production NOT READY. F13b, F9, F10, F11, and the README gap keep their status.

### 17.2 Engine provenance (verified this session)

- Binaries: `/tmp/godot-build/src/bin/godot.linuxbsd.template_debug.x86_64` and `godot.linuxbsd.editor.x86_64`.
- `--version` on both: `4.7.2.stable.custom_build.ed1daf0bf`, exit 0.
- Source: official tag `4.7.2-stable`, commit `ed1daf0bf001b61586d9930840f2f1394092c079`, built locally (16.6).
- **This is a custom build, not the official 4.7.2 release binary.** No official-release verification is claimed.

### 17.3 Failure table (reproduced in the repository before any edit)

`--check-only --script` on each file. Engine line numbers refer to the pre-edit files.

| File | Actual error (engine) | Category | Runtime impact | Fix applied |
|---|---|---|---|---|
| `3d_world/scripts/camera_3d_controller.gd:106` | `Identifier "delta" not declared in the current scope` | Scope (Stage 23 code) | Script does not parse. Blocks `world_3d.tscn` and the handoff test. | `_update_camera_position(delta: float)`. `_process` passes `delta`. `_ready` and `set_target` pass `get_process_delta_time()` (17.7). |
| `scripts/services/multiplayer_client.gd:220` | `Expected indented block after match pattern block` | Syntax (indentation) | Does not parse. Blocks `prototype_game`, `session_policy`, `persistence_notice`. | Indented the `session.logged_out` arm body under its pattern. |
| `scripts/ui/prototype_ui.gd:335` | `Expected indented block after "if" block` | Syntax (indentation) | Does not parse. Blocks `prototype_game` and the 2D scene. | Indented `append` and `break` into the `if` body. Intent: break after the first matching member. |
| `scripts/domain/education_service.gd:558, 1273, 1295, 1694` | `Too many arguments for "get()" call. Expected at most 1 but received 2.` | API (`Object.get` takes one argument) | Does not parse. Blocks education and the tertiary and family-support paths. | Direct property read: `character.academic_scores`, `character.education_record`, `character.household`. `CharacterState` declares all three as `Dictionary` vars. |
| `scripts/domain/education_service.gd:1091` | Variant inference treated as error | Typing (warning as error) | Does not parse. | `var result_status: Variant`. |
| `scripts/domain/school_service.gd:41` | `Cannot infer the type of "configured_subject"` | Typing | Does not parse. Blocks the school service. | `: Variant`. |
| `scripts/ui/career_panel.gd:625` | Variant inference treated as error | Typing | Does not parse. | `var today: Variant`. |
| `scripts/prototype_game.gd:98, 292` | Variant inference (`remote_nearest`, `restored_notice`). Latent: shown only after the preloads resolve. | Typing | Does not parse. | `: Variant` on both. |
| `scripts/services/performance_monitor.gd:66, 67, 71` | `Cannot find member "TIME_PHYSICS"`, `"TIME_IDLE"`, `"MEMORY_DYNAMIC"` in `Performance` | Removed or renamed engine constants | Does not parse. | `TIME_PHYSICS` to `TIME_PHYSICS_PROCESS`. `TIME_IDLE` to `TIME_PROCESS`. `MEMORY_DYNAMIC`: no equivalent, held at `0.0` (17.6). |
| `3d_world/scenes/world_3d.tscn:23` | `Invalid parameter` (sub-resource referenced before it is defined) | Scene format ordering | Scene does not load. Blocks the handoff test. | Moved the four `[sub_resource]` blocks above the nodes. Removed one trailing blank line. |
| `scripts/domain/character_state.gd:635` | `Invalid access to property or key 'data'` (dot access to a missing key) | Runtime strictness, not a load error | Raises during life-history restore for entries without `data`. Found by `domain_smoke`. | Read through a guarded `event_data` variable. `event.get("data", {}) is Dictionary` is true when the key is absent, so the old guard did not protect the dot access. |

Cascade only (no separate fix): `3d_world/scripts/scene_switcher.gd` (preloads `prototype_ui.gd` and `multiplayer_client.gd`),
`scripts/prototype_game.gd` (preloads, lines 14 and 15), `tests/persistence_notice.gd`, `tests/session_policy.gd`, and
`tests/regional_handoff.gd` (camera and scene).

### 17.4 Root cause

The affected scripts do not conform to the Godot 4.7.2 parser. The failures are strict indentation, `Object.get` with two
arguments, Variant-to-typed inference treated as an error, and engine constants that no longer exist. `gdparse` and
`gdlint` in sections 14 and 15 accepted these files (16.6), so they were not engine checks. I did not establish when
each line was introduced. Git history for those lines was not part of this repair.

### 17.5 Return path (3D to 2D): decision was NOT to implement the restore (blocker; superseded by section 18)

**Confirmed lifecycle (engine, read-only probe outside the repository, exit 0):**

- After `add_child()` of `scenes/prototype.tscn`: `character == null`, `clock == null`.
- `set_shared_state({"character": {...}, "world": {}})` leaves both `null`. `playing` is unchanged.
- The skip was silent. It now logs one warning (`[PrototypeGame] Shared character state not restored...`), with no change
  in behavior.

**Code path.** `_ready()` builds the world, player, multiplayer client, and UI, then calls
`ui.show_character_creation(...)` (`prototype_game.gd` 77). `character` and `clock` are created only in `_start_new_game`
(193–194), in the load and continue paths (227–231), and at 498–500. `scene_switcher.gd` `_restore_2d_state` (113–117)
passes only `character` and `world`. It never sends a `clock` key, so the clock branch of `set_shared_state` cannot run.

**Why it is not a narrow fix.** Every option changes a lifecycle or flow decision:

1. Create the character and clock inside `set_shared_state`. The creation modal still opens over restored state, which the
   mission forbids.
2. Keep the 2D instance alive while in 3D. This changes the switcher lifecycle.
3. Restore from the saved game on return. Unsaved progress is lost.
4. Define a clock handoff. The switcher does not carry clock data today.

The owner decides between these. Stage 29 cannot close until this is decided.

### 17.6 MEMORY_DYNAMIC and the performance monitor

- No exact 4.7.2 replacement exists. `MEMORY_STATIC` measures a different quantity, so it was not used as a substitute.
- `dynamic_memory_mb` is held at `0.0` and commented as not measured. `total_memory_mb` therefore equals static memory,
  with no double count. The report line `dynamic: 0.0` is **not a measurement**. The owner may remove the field.
- **Defect found here, fixed in section 18:** `process_time_ms` was computed as `TIME_FPS * 1000`. `TIME_FPS` is frames per
  second, not a frame time. It now uses `TIME_PROCESS`, and `dynamic_memory_mb` is removed.

### 17.7 Camera `delta`

- `_update_camera_position` takes `delta` as a parameter. The engine's own callback value is used, with no global and no
  suppression.
- `_process` passes its `delta`. `_ready` and `set_target` pass `get_process_delta_time()`. In those calls the last frame's
  delta can be `0`, so the lerp does not move the camera until the next `_process` frame. `look_at` still runs.
- Camera motion is not validated at runtime. The handoff test loads the world without script errors.

### 17.8 Evidence (class in brackets)

| Check | Command and exit | Result |
|---|---|---|
| Engine identity | `--version` on both binaries, exit 0 each | `4.7.2.stable.custom_build.ed1daf0bf` [engine] |
| Script parse, before | `--check-only` on 37 files | 12 failing, 25 passing [GDScript parse] |
| Script parse, after | `--check-only` on 37 files (repository) | 37 of 37 pass, exit 0 [GDScript parse] |
| `regional_handoff.gd` | `--headless --path game --script`, exit 0 | PASS 41 of 41, 0 SCRIPT ERROR [GDScript runtime, custom build] |
| `regional_visual_profiles.gd` | same, exit 0 | PASS 43 of 43, 0 SCRIPT ERROR [GDScript runtime, custom build] |
| Main project load | `--headless --path game --quit`, exit 0 | 0 SCRIPT ERROR [GDScript load] |
| `player_movement.gd` | exit 0 | PASS 4 [GDScript runtime] |
| `persistence_notice.gd` | exit 0 | PASS 11 [GDScript runtime] |
| `session_policy.gd` | exit 0 | All checks passed [GDScript runtime] |
| `domain_smoke.gd` | exit 1 | FAIL 4 of 91 to 93 (total varies by run; same 4 failing each run) [GDScript runtime, residual] |
| `save_restart.gd` | `-- write` exit 0, `-- read` exit 1 | Read fails: academic result; attendance and inventory [GDScript runtime, residual] |
| Probe: performance monitor, life-history guard, save round trip | probe outside the repository, exit 0 | 11 of 11 PASS [GDScript runtime, probe] |
| Probe: return-path lifecycle | probe outside the repository, exit 0 | Confirmed 17.5 [GDScript runtime, probe] |
| `npm test` | exit 0 | 1074 total, 1037 pass, 0 fail, 37 skipped [Node, static] |
| `npm run lint` | exit 1 | 51 errors, the existing baseline. Scope is `services/world-api/src`, which this change does not touch [static] |
| `git diff --check` | exit 0 | Clean [static] |

Not run: in-game F5 play, the 2D scene during play, and visual inspection. These remain pending.

**Correction (section 18):** the statement that "4 of 91" was not reproduced was wrong. The total varies between runs (91, 92, and 93 were observed). The same four assertions fail in every run.

### 17.9 Residual findings (not fixed in this repair)

- **`domain_smoke.gd` (4 of 92):** the morning timetable starts with Mathematics; a completed subject is repeated the same
  day; save and load does not restore academic data; save and load does not restore the authoritative DOB or life stage.
  These are logic failures in the education and life services, not compatibility failures. They need an owner decision.
- **`save_restart.gd --read` (exit 1):** academic result and attendance and inventory checks fail. Same area.
- **Load path overwrites supplied life history.** `load_dictionary` (`character_state.gd` 345) calls
  `_household_from_life_profile()`, which re-initializes life data when no valid `date_of_birth` is present. The
  supplied `life_history` is then replaced with generated `character_created` and `family_created` entries. Observed in a
  probe with no DOB. It is related to the DOB failure above.
- **`process_time_ms` used `TIME_FPS * 1000`** (17.6). Fixed in section 18.
- **`world_3d.tscn` header** `load_steps=6` does not match 5 external and 4 sub-resources. Godot tolerates this. Not changed.
- **Return path** (17.5). Fixed in section 18.

### 17.10 Scope protection

Not touched: region catalog, the five presets, the 32-region mapping, save formats, auth and session, Stage 28 persistence,
Stage 30 justice-case access, `time_of_day.gd` (F13b), and time-of-day lighting ownership. `update-environment-profiles.js`
was not run. No world-data generator was run. No dependency, autoload, or repository test file was added. The region
fallback (`ng:state:on`) and invalid-region rejection are unchanged. The handoff log confirms both.

### 17.11 Status

- F5 compile blockers (16.6): **cleared** in the repository.
- F5 headless runtime tests on the custom build: **passed** (41 of 41, 43 of 43).
- F5 in-game and visual validation: **pending**.
- 3D-to-2D return restore (16.3): **fixed in section 18** (runtime tests pass; in-game validation pending).
- Stage 29 OPEN. Stage 28 OPEN. Production NOT READY.

## 18. 3D-to-2D return repair: retained 2D session (2026-10-11)

Scope: the owner's written return-path mission. It keeps the existing 2D session alive while the 3D world is active,
suspends it, and resumes it on return. It also covers the performance-monitor fix (Phase G), which is independent and is
committed separately. It does not change save formats, auth or session, Stage 28 safeguards, Stage 30 access, the region
catalog, presets, the 32-region mapping, `time_of_day.gd`, or F13b.

### 18.1 Result

**RETURN_PATH_FIXED_RUNTIME_TESTS_PASSED**, with the limits in 18.9. Stage 29 remains OPEN. Stage 28 remains OPEN.
Production remains NOT READY.

### 18.2 Root cause (confirmed on the original code)

- `scene_switcher.gd` `switch_to_3d()` called `queue_free()` on the 2D instance, so the character and clock were destroyed.
- `switch_to_2d()` created a new `prototype.tscn` instance. Its `_ready()` opens character creation, and the
  shared-state restore was skipped because `character` and `clock` did not exist yet.
- Reproduced with a probe on a copy of the original code, outside the repository (GDScript runtime, custom build). One
  round trip with an in-memory character (money 4321, life history set) produced: the original instance freed; the
  creation screen shown again; `character == null`; the character lost.

### 18.3 Design

- `switch_to_3d()` calls `suspend_session()` on the retained 2D instance. It no longer frees it.
- `suspend_session()` sets `process_mode = DISABLED`, hides the node and its UI, and sets `ALWAYS` on the multiplayer
  client so an online socket keeps polling. It also sets a `_suspended` flag. `_process` and `_unhandled_input` return early
  while suspended.
- `switch_to_2d()` calls `resume_session()` on the retained instance. It does not create a new instance, and it does not
  call `_restore_2d_state()`. That call now runs only on first start, when no instance exists.
- The 3D instance is still released with `queue_free()`, as before.
- `set_shared_state()` no longer warns on the empty first-creation handoff. A non-empty pending character still warns.

Files changed: `game/3d_world/scripts/scene_switcher.gd`, `game/scripts/prototype_game.gd`, new `game/tests/return_path.gd`.

### 18.4 Lifecycle (verified at runtime)

| Step | Expected | Result |
|---|---|---|
| Startup | one 2D session, character creation shown once | PASS |
| New game | playing, character and clock created, creation closed | PASS |
| 2D to 3D | same 2D instance retained, suspended, hidden, not processing, one 3D world under `Mode3D` | PASS |
| While 3D | the 2D clock does not advance, the 2D player does not move, no modal input | PASS |
| Close window while 3D | the retained session is saved with its unsaved money | PASS |
| 3D to 2D | same instance resumed, 3D world released, no new instance, no creation screen, HUD shown | PASS |
| Movement after return | the 2D player moves again | PASS |
| Repeated cycles | three more round trips: one 2D session, one 3D world, same character and clock; no duplicate connections or bindings | PASS |
| Default region | a character with no located region gets the existing fallback (`ng:state:on`) | PASS |
| Continue | saved money restored; creation not opened | PASS |

### 18.5 State preservation evidence (runtime)

The test checks the live objects, not copies. After return:

- The character is the same object (`==` identity). The clock is the same object, and its dictionary is unchanged.
- Unsaved money (4321) is unchanged, and so is the geographic `state_id`.
- A life-history event added before the switch is still present.
- The player position is unchanged. The HUD shows the existing character's name.

### 18.6 Test results (custom build, exit codes are real)

| Test | Command and exit | Result | Class |
|---|---|---|---|
| Engine identity | `--version` on `godot.linuxbsd.template_debug.x86_64`, exit 0 | `4.7.2.stable.custom_build.ed1daf0bf` | engine |
| Return path | `--script res://tests/return_path.gd`, exit 0 | PASS 46 of 46, 0 SCRIPT ERROR (three repeat runs also 46 of 46) | GDScript runtime |
| Return path on original code | same test on a copy of `HEAD` outside the repository, exit 1 | Fails the retained, suspended, and cannot-process checks, then reads a freed object. The watchdog (below) ends the run | GDScript runtime |
| Original vs repaired probe | in-memory round-trip probe, exit 0 on both trees | Original: instance freed, creation shown, character lost. Repaired: same instance, no creation, character kept | GDScript runtime, probe |
| `regional_handoff.gd` (Test 9) | exit 0 | PASS 41 of 41 | GDScript runtime |
| `regional_visual_profiles.gd` (Test 9) | exit 0 | PASS 43 of 43 | GDScript runtime |
| Performance metrics (Phase G) | `--script res://tests/performance_metrics.gd`, exit 0 | PASS 11 of 11 | GDScript runtime |
| Performance metrics on original code | same test on a copy of `HEAD`, exit 1 | FAIL 7 of 11 | GDScript runtime |
| Check-only sweep | `--check-only` on 39 `.gd` files | 39 of 39 exit 0 | GDScript parse |
| `player_movement.gd` | exit 0 | PASS 4 | GDScript runtime |
| `persistence_notice.gd` | exit 0 | PASS 11 | GDScript runtime |
| `session_policy.gd` | exit 0 | All checks passed | GDScript runtime |
| Main project `--quit` | exit 0 | 0 SCRIPT ERROR | GDScript load |
| `domain_smoke.gd` | exit 1 | FAIL 4 (see 18.8) | GDScript runtime, residual |
| `save_restart.gd --write` / `--read` | exit 0 / exit 1 | Read fails with the same messages on `HEAD` and on the repaired tree | GDScript runtime, residual |
| `npm test` | exit 0 | 0 fail, 37 skipped | Node, static |
| `npm run lint` | exit 1 | 51 errors, the existing baseline (`services/world-api/src`, not touched) | static |

Tests 1–8 and 10 are covered by `return_path.gd`, which exercises the real `SceneSwitcher`, the real `main.tscn`, and the
real `toggle_3d_mode` action. Test 10 (new, load, continue): new game runs `_start_new_game()`. The Continue and Load
buttons both connect to `_continue_game()` (`prototype_game.gd` lines 66 and 71). The test calls that handler directly and
does not click the buttons.

### 18.7 Save-file safety during testing

- `return_path.gd` backs up `user://naija-stage1-save.json`, refuses to run if a backup already exists, and restores the
  file at the end.
- An interrupted baseline run left a test-written save and backup in the user data folder. Both held only test data (the
  name "Return Probe", money 5000). I removed them after checking that. No real save existed before these runs: the
  first interrupted run did not find a backup, so none had been left by an earlier run.
- The test now has a 180-second watchdog that restores the save and exits 1. It was verified by the baseline run.

### 18.8 Phase G: performance monitor (separate commit)

- `process_time_ms` now equals `TIME_PROCESS` in milliseconds. It was `TIME_FPS * 1000`. The test checks the value against
  `TIME_PROCESS` read in the same frame, and it fails on the original code (1000 ms against an expected 0).
- `dynamic_memory_mb` is removed. There is no Godot 4.7.2 monitor for it, so no value is reported.
- `idle_time_ms` is removed. It duplicated `TIME_PROCESS`, and nothing else reads it.
- `total_memory_mb` now equals static memory. The report line reads `Memory: X MB (static)`.
- **Not verified:** the magnitude of frame times. In this headless `--script` run, `TIME_PROCESS` reads 0.0 and `TIME_FPS` reads
  1.0 in every frame. A rendered run is needed to confirm live timing values.

### 18.9 Gaps and limits (stay open)

- The F3 key was driven through `InputEventAction` in the test. No rendered window or real keyboard was used.
- No visual inspection of the 3D world or the HUD after return.
- The Continue and Load buttons were not clicked. The handler they share was called directly.
- The 3D world does not write character or economy data back. Its shared state carries only `region_id`, `time_of_day`,
  and the 3D avatar's own state. So returning to 2D loses nothing, and the 2D clock stays authoritative.
- Stage 29 acceptance still needs in-game validation on a rendered run.

### 18.10 Pre-existing issues found, not fixed (out of scope)

- `3d_world/scripts/character_3d.gd:48` queries the undefined `jump` action. Every 3D frame logs an error
  (`InputMap action "jump" doesn't exist`). This is a 3D input issue, not a return-path regression. Owner decision.
- `domain_smoke.gd`: FAIL 4. The count varies by run: 91, 92, and 93 were observed. The same four assertions fail every time:
  timetable order, same-day subject repeat, academic restore, DOB and life-stage restore. The same four fail on the
  unmodified `HEAD` copy, so they do not depend on this change.
- `save_restart.gd --read`: the same academic and attendance messages on `HEAD` and on the repaired tree.
- `character_state.gd` `load_dictionary` overwrites the supplied `life_history` when the DOB is invalid (17.9). Not changed.
- `world_3d.tscn` `load_steps` (17.9). Not changed.

### 18.11 Status

- Return path (16.3, 17.5): **fixed in the repository; runtime tests pass; in-game validation pending** (18.9).
- Performance monitor (17.6): **fixed**; magnitude not verified in headless mode (18.8).
- Stage 29 OPEN. Stage 28 OPEN. Production NOT READY. F9, F10, F11, F13b, and the README gap keep their status.
