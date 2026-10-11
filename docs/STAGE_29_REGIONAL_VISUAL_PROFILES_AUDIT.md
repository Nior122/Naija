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

- The toggle was driven through the `toggle_3d_mode` action (`InputEventAction`) in `return_path.gd`. No rendered window or real keyboard was used. The bound key was F11, not F3 at the time (19.7). It is now F3 (section 20).
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

## 19. Stage 29 rendered validation and closure assessment (2026-10-11)

Scope: the owner's closure mission. It tries the rendered checks that section 18 left open, runs the safe headless checks
that remain, and assesses closure. It changes no game behavior, no production script, no input binding, and no data.

### 19.1 Result

**STAGE_29_RENDERED_VALIDATION_BLOCKED.** The rendered checks cannot run in this environment (19.2). Stage 29 stays OPEN.
Stage 28 stays OPEN. Production stays NOT READY. Headless checks passed (19.4–19.6). They do not replace rendered evidence.

### 19.2 Environment preflight (verified this session)

| Item | Evidence | Class |
|---|---|---|
| Engine | `godot.linuxbsd.template_debug.x86_64 --version`: `4.7.2.stable.custom_build.ed1daf0bf`, exit 0. Custom build, not the official release | engine |
| Display drivers in this build | `--help` lists only `headless` (dummy). `--display-driver x11` and `wayland` both fail: "Unknown display driver", exit 1 | engine |
| Display server | `DISPLAY` and `WAYLAND_DISPLAY` unset. No Xvfb or other X server binary. No `/dev/dri` | environment |
| Graphics libraries | No libGL, libEGL, libvulkan, or Mesa driver in `/usr/lib/x86_64-linux-gnu`. No X11 headers | environment |
| Renderer, headless | `RenderingServer` reports no adapter. `root.get_texture().get_image()` returns null. `RenderingServer.frame_post_draw` never fires (a probe waiting on it hung for 120 s) | engine, runtime |
| Mouse events | A pushed mouse click does not reach any `Button`, including a plain `Button` in an empty scene (probe, outside the repository) | runtime |
| Keyboard activation | Focusing a `Button` and pushing `ui_accept` press and release fires its `pressed` signal through its own GUI input (probe) | runtime |
| Package install | `sudo` is available, but the apt source is `deb.debian.org`, which is not on the sandbox allowlist. Nothing was installed and the host was not probed | environment |

Conclusion: no rendered window, screenshot, real mouse click, or frame-time measurement is possible here. No screenshot,
visual observation, or rendered timing value is claimed anywhere in this section.

### 19.3 Repository baseline

- Branch `arena/00cdea0e-naija`. Starting HEAD `b5430c8`, which matched `origin/arena/00cdea0e-naija`, 0 ahead and 0 behind.
- The return-path fix is present: `suspend_session` and `resume_session` in `prototype_game.gd` and `scene_switcher.gd`.
- Working tree before this task: clean.

### 19.4 Headless UI flow (`game/tests/ui_flow_headless.gd`, new)

**Class: GDScript runtime, headless, simulated input. Not a rendered test.** Buttons are activated by focusing the real
`Button` and sending `ui_accept` (19.2). F-key input is the key event that `project.godot` binds to `toggle_3d_mode`, read
from the InputMap at runtime. Mouse clicks are not used.

Result: **PASS 52 of 52**, exit 0, on two repeat runs after the final edit. Zero SCRIPT ERROR. The user save slot is
restored. The test is sensitive: on the pre-return-path code it fails "The same 2D instance is retained in 3D" and the
process then aborts with SIGABRT, exit 134. Observed values:

| Step | Real control used | Observed |
|---|---|---|
| Startup, no save | none | Creation card shown. "Begin your life" offered. No "Continue saved life" button |
| New game | "Begin your life" | Play starts. Name Ayo, money 5000, location home. Creation closed |
| Save | HUD "Save / Load" then "Save progress now" | Save file written and loadable. Holds the test value 1234 |
| Unsaved progress | none (value set in memory) | Money 999 in memory, 1234 on disk |
| Toggle to 3D | bound toggle key | 3D world present. Same 2D instance retained, suspended, `can_process()` false, HUD hidden, its HUD button not visible. No modal. Region `ng:state:on` (existing fallback) |
| Return to 2D | bound toggle key | Same 2D instance resumed. HUD visible and its button reachable. Same character and clock objects. Money 999 kept. No creation, no modal. 3D world released |
| Interactivity after return | HUD "Save / Load" then "Close" | Modal opens and closes |
| Repeated round trips (3 more) | bound toggle key | One 2D session, no 3D world at rest. No added signal connections, no added input bindings, node count unchanged |
| Load | HUD "Save / Load" then "Load saved progress" | Money 1234 (the saved value). Unsaved 999 discarded. The character is a new object. Name restored. No creation |
| Continue | startup "Continue saved life" after a fresh main scene | Play starts. Money 1234. Name Ayo. No creation |

At the time of this validation the bound key was **F11** (`project.godot`, `physical_keycode` 4194342). See 19.7. It is now F3 (section 20).

### 19.5 Rendered checks: status

| Check | Status |
|---|---|
| A. New game and baseline HUD, rendered | BLOCKED (19.2). Headless equivalent in 19.4 |
| B. Real F3 or bound key 2D to 3D, rendered: the 3D world appears | BLOCKED. Headless: the 3D world is created and the 2D is suspended (19.4) |
| C. Return to 2D, rendered: the returned HUD is visible | BLOCKED. Headless: `visible` is true and the HUD button is reachable (19.4) |
| D. Repeated transitions, rendered | BLOCKED. Headless equivalent PASS (19.4) |
| E. Continue, real UI click | BLOCKED as a click. Headless: activated through the real button with keyboard activation (19.4) |
| F. Load, real UI click | BLOCKED as a click. Headless: activated through the real button with keyboard activation (19.4) |
| Rendered frame times | BLOCKED (19.6) |

### 19.6 Performance monitor: findings and limitations

- `process_time_ms` reads `Performance.TIME_PROCESS` in milliseconds, and the code is right on that point (section 18.8).
- Rendered measurement is blocked. In this headless build `TIME_PROCESS` stayed **0.0 in every one of 60 frames**, with a
  real 5 ms busy loop per frame. `TIME_FPS` and `Engine.get_frames_per_second()` stayed **1.0** (probe, `perf_scene.gd`,
  outside the repository). These headless values are not frame times. No timing claim is made from them.
- `static_memory_mb` reads about 32 MB in this run (`MEMORY_STATIC`). This is a real Godot measurement. No dynamic-memory
  value is reported.
- Closure criterion 7 stays open until a rendered run records non-zero, varying frame times.

### 19.7 Input binding discrepancy (new finding, not changed)

- **Superseded by section 20:** the key is now F3. At the time of this finding, `project.godot` bound `toggle_3d_mode` to F11 (`physical_keycode` 4194342, confirmed by `OS.get_keycode_string`). F3 is
  4194334. The binding was introduced in commit `c50356d` (Stage 24).
- The code comment in `scene_switcher.gd` (line 33) says "Press F3". The Stage 23, 24, and 25 docs and
  `ADVANCED_3D_WORLD_ARCHITECTURE.md` say F3. The task brief says F3.
- Which key is intended is an owner decision. The binding was not changed, because a change would alter production input.
  The headless UI test reads the bound key at runtime, so it follows whichever key is chosen.
- Sections 15 to 18 use "F3" for the bound key in several places. At the time that was inaccurate (the bound key was F11). After section 20 the bound key is F3, so those references are accurate again. This note is kept as history.

### 19.8 Continue and Load: distinct controls, one handler

- **Continue saved life** is on the startup character-creation card, shown only when a save exists. It emits
  `continue_requested`.
- **Load saved progress** is in the HUD "Save / Load" modal, shown only when a save exists. It emits `load_requested`.
- Both are connected to `prototype_game.gd` `_continue_game()` (lines 66 and 71). **Two independent UI controls, one
  implementation.** The headless test exercised both controls. It did not test two independent code paths.
- `_continue_game()` reads the save file from disk and creates new character and clock objects. So Load during play
  **replaces the live session with the saved one and discards unsaved progress**. This was observed (money 999 became
  1234). Whether this is the intended meaning of "Load saved progress" is an owner decision. It is not a regression of the
  return path, because Load is a deliberate action, not a world transition.

### 19.9 Automated regression suite (exit codes and counts)

| Command | Exit | Result | Baseline |
|---|---|---|---|
| `--version` | 0 | `4.7.2.stable.custom_build.ed1daf0bf` | same |
| `return_path.gd` | 0 | PASS 46 of 46, 0 SCRIPT ERROR | same (labels corrected to `toggle_3d_mode`) |
| `ui_flow_headless.gd` (new) | 0 | PASS 52 of 52, 0 SCRIPT ERROR | new |
| `regional_handoff.gd` | 0 | PASS 41 of 41 | same |
| `regional_visual_profiles.gd` | 0 | PASS 43 of 43 | same |
| `performance_metrics.gd` | 0 | PASS 11 of 11 | same |
| `player_movement.gd` | 0 | PASS 4 | same |
| `persistence_notice.gd` | 0 | PASS 11 | same |
| `session_policy.gd` | 0 | All checks passed | same |
| Main project `--quit` | 0 | 0 SCRIPT ERROR | same |
| Check-only sweep, 40 `.gd` files | 0 each | 40 of 40 pass | was 39 (the new UI test adds one) |
| `domain_smoke.gd` | 1 | FAIL 4 of 92. Same four assertions as sections 17 and 18 | unchanged, pre-existing |
| `save_restart.gd --write` / `--read` | 0 / 1 | Read fails: academic result; attendance and inventory | unchanged, pre-existing |
| `npm test` | 0 | 1074 tests, 1037 pass, 0 fail, 37 skipped. Static | unchanged |
| `npm run lint` | 1 | 51 errors. The reported baseline; not touched | unchanged |
| `git diff --check` | 0 | clean | same |

The same four `domain_smoke` assertions fail on the unmodified `HEAD` code (section 18.10). Those failures remain
separately recorded and are not resolved here.

### 19.10 Issues and limitations found in this validation

1. The bound key was F11, not F3 (19.7). Resolved in section 20: the key is now F3, per the owner's directive.
2. Load during play discards unsaved progress (19.8). Owner confirmation.
3. Pushed mouse events never reach any `Button` in this headless build (19.2). Mouse-only UI paths are untested.
4. `return_path.gd` has no marker for a hard engine crash. `ui_flow_headless.gd` writes one (a marker when no save existed,
   otherwise a backup), so an interrupted run blocks the next run. Verified: the repaired run was refused while the marker
   remained. The `return_path.gd` gap is unchanged.
5. One interrupted run during this validation left test-written save data in the user data folder. The data was checked
   (name Ayo, money 1234) and removed. No real save existed.

### 19.11 Status

- Rendered F3 or bound-key transition, both directions: **not verified** (blocked, 19.2).
- Returned HUD visible and usable, rendered: **not verified** (blocked). Headless: verified.
- Repeated transitions, no duplicate sessions or connections: **verified headless** (19.4).
- Continue through its real UI: **verified headless** (keyboard activation), not as a mouse click.
- Load through its real UI: **verified headless** (keyboard activation). Equivalence to Continue: **not equivalent**. They are
  two controls that share one handler (19.8).
- Performance monitor, rendered measurement: **blocked** (19.6).
- Stage 29 OPEN. Stage 28 OPEN. Production NOT READY. F9, F10, F11, F13b, and the README gap keep their status.

## 20. World-switch key and in-game Load safety (2026-10-11)

Evidence labels: **headless** means Godot `--headless` with simulated input. Nothing here was rendered. **Static** means grep or file reading. The engine is the custom build `4.7.2.stable.custom_build.ed1daf0bf` (checked with `--version`, exit 0), not the official release.

### 20.1 Result

- Overall: **CONTROL_AND_LOAD_SAFETY_COMPLETE** (headless and static scope only). The rendered gap in 20.10 remains.
- Stage 29 remains **OPEN**. Stage 28 remains **OPEN**. Production remains **NOT READY**.

### 20.2 Start state

- Branch `arena/00cdea0e-naija`. HEAD and `origin/arena/00cdea0e-naija` were both `03e6611`, with 0 ahead and 0 behind. The tree was clean and there was no stash.
- The user data folder held `logs`, `naija-multiplayer.cfg`, and `objectdb_snapshots`. No `naija-stage1-save.json` existed. No save file was created, overwritten, or deleted by this section's work. Every test run restored that state.

### 20.3 Configured key and conflict check

- Before: `toggle_3d_mode` was bound to F11 (`physical_keycode` 4194342), in `game/project.godot`.
- Conflict check, **headless** (`InputMap.get_actions()` and `action_get_events()`): 92 actions in the project InputMap, read by a probe run without the scene. The test repeats the scan after the scene starts, which adds the runtime bindings. F3 (4194334) is bound to no action other than `toggle_3d_mode`. Before the change, F11 was bound only to `toggle_3d_mode`. The probe covers engine `ui_*` defaults. The test scan also covers the actions that `prototype_game.gd` binds at runtime.
- **Static**: no game script binds F3 or F11, other than the `scene_switcher.gd:33` comment ("Press F3"). The README does not mention the toggle key, so it has no reference to correct.
- Not verified: Godot's own editor shortcuts and any engine-internal key handling that `InputMap` does not list. An exported game does not use the editor's shortcuts.
- **Change**: `physical_keycode` 4194342 becomes 4194334 in `game/project.godot`. The action name and the switch implementation (`scene_switcher.gd`) are unchanged.
- No F11 alias was kept. No repository reference needed one.
- After the change, the **headless** runtime InputMap reads `toggle_3d_mode` as physical F3. The conflict scan finds no F11 binding.
- Scoped reference updates: the `scene_switcher.gd` comment already said F3, so it is now accurate. `ADVANCED_3D_WORLD_ARCHITECTURE.md`, `STAGE_24_MULTIPLAYER_INTEGRATION_PLAN.md`, and `STAGE_25_PLATFORM_AUDIT.md` already say F3, so they are unchanged and now accurate. Sections 18.9, 19.4, 19.7, and 19.10 were marked as superseded by this section. Their historical statements are kept.
- The test `ui_flow_headless.gd` still reads the bound key from the InputMap. Its comment now names F3, and the value is read at runtime rather than hard-coded.

### 20.4 Continue and Load: behaviour before this change

- **Continue** (start screen, `continue_requested`) and **Load** (in-game Save / Load menu, `load_requested`) both called `_continue_game` directly.
- No confirmation existed. A Load during play replaced the session at once.
- `_continue_game` released the multiplayer connection and cleared `_online_mode` **before** it read the save file. If the read then failed, the session had already been torn down.
- It replaced `clock` before it loaded the character. A failure part-way through left a partly replaced session.
- A save whose `character` key was missing passed the `save_service.gd` check. The check used a `{}` default, and `{} is Dictionary` is true. The direct lookup then raised a runtime error (`save_service.gd:47`). This was observed in the first run of the new test, before the fix.
- A well-formed JSON `character: {}` would have replaced the session with defaults, because the character loader fills missing fields with defaults.

### 20.5 Dirty-state reliability (static reading, plus runtime observation)

- No dirty-state tracking exists. `_save_game` writes the JSON with no revision counter or fingerprint.
- `character.updated_at` is rewritten by every save (`touch()`), so it is not a change signal.
- The clock advances continuously while the session is playing (about 0.65 s real time per game minute, from `life_calendar`). An exact comparison of the live state against the last save would therefore report a difference almost all the time during play.
- Autosaves happen on each 15-game-minute boundary, and on several gameplay actions. The gap between the last save and a Load is therefore variable and not measurable from the saved file.
- Money alone is not used as a dirty-state test.
- **Conclusion: no reliable dirty-state signal exists.** The confirmation policy in 20.6 is a protective policy. It is not dirty-state detection.

### 20.6 Confirmation policy (in-game Load)

- Continue on the start screen loads the save with **no** dialog. This was confirmed at runtime (20.8).
- An in-game Load always asks first, because the save menu only exists during play. The protective policy applies to every in-game Load, whether or not anything changed.
- The dialog is titled "Replace current session?". Its text says: "Loading replaces your current session with the last saved progress. Unsaved progress is discarded." Its buttons are "Load and discard progress" (confirm) and "Cancel".
- **Cancel** closes the modal and emits nothing. The live character, clock, and unsaved values are unchanged.
- **Confirm** closes the modal, then emits the existing `load_requested` signal. That signal goes to `_continue_game`, the one authoritative load path. No second load path was added.
- The "Load saved progress" button appears only when a save file exists.
- The modal reuses the existing `_open_modal` and `_close_modal` pattern. Movement is disabled while the modal is open, and restored when it closes (`_on_modal_changed`). This was checked at runtime, headless.

### 20.7 Failure safety

- `_continue_game` now validates the save **before** it releases the active session:
  1. `SaveService.load_state` checks JSON, the version, and that `character` and `clock` are dictionaries. The defaults are now `null`, so a missing key fails.
  2. `_is_restorable_save` requires a non-empty character `name`, and a clock with `day` and `minute_of_day`. This stops an empty but well-formed object from replacing the session with defaults.
  3. The new character and clock are built into **local** variables.
  4. **Commit point:** only then does it disconnect the multiplayer session, clear `_online_mode`, replace `clock` and `character`, and start play. Nothing is replaced before this point.
- On failure, a notice "Saved life unavailable" is shown. While a session is active, it adds "Your current session was not changed." The session objects are not touched.
- **Save-format impact:** none. The save format, the version, and the write path are unchanged. Only the read-side check changed.
- **Not runtime-tested:** the disconnect at the commit point, on an active **online** session. The sandbox has no multiplayer server. That ordering change is code-reviewed only (static).

### 20.8 Tests

- **New**: `game/tests/load_confirmation_headless.gd`, 80 checks, exit 0. **Headless, simulated input.** Buttons are activated by focus and `ui_accept`, as in `ui_flow_headless.gd`. Physical F3 and F11 events are sent to the unhandled-input path. No mouse input was used.
- **Covers**: the binding, read from `ProjectSettings` and from the runtime InputMap. The F3 and F11 conflict scans, before and after the scene starts. Physical F11 does not switch. Physical F3 switches to 3D and back. Continue restores the save and opens no dialog. In-game Load opens the confirmation and pauses movement. Cancel keeps the same character and clock objects, with unsaved money, geography and life history. Repeated Load and Cancel cycles keep the signal-connection counts, the input-binding count, the 2D child count, and the node count unchanged. Confirm creates one new character and clock, restores the saved values, and discards the unsaved life event. Six failure cases each name the check that rejects them, and each leaves the session unchanged. The session stays usable afterwards: the HUD opens, F3 toggles, and a manual save writes a loadable file. With no save file, the Load option is not offered.
- **Test isolation**: the test backs up `user://naija-stage1-save.json` under its own backup name, or writes a marker when no save existed. It refuses to run while its own backup or marker exists. It freezes the game clock (test-only), so an autosave cannot change the values under test. A watchdog restores the save file.
- **Modified**: `game/tests/ui_flow_headless.gd`, 54 checks, exit 0 (was 52). Step 8 now passes through the confirmation. It asserts that the live session is unchanged before confirm, and that confirm is required. No existing assertion was relaxed.
- **Mutation checks** (scratch copy outside the repository, each restored and verified): F11 restored as the binding gave 31 failing checks. Bypassing the confirmation gave 7 failing checks. Removing the empty-character guard gave 13 failing checks. The tests are sensitive to each protection they cover.
- **Static checks**: the `check-only` sweep covers all 41 GDScript files, 0 non-zero, including the new test. `git diff --check` is clean.

### 20.9 Regression results (exit codes are real)

| Check | Before (03e6611) | After (this change) |
|---|---|---|
| `return_path` | 46/46, exit 0 | 46/46, exit 0 |
| `ui_flow_headless` | 52/52, exit 0 | 54/54, exit 0 (step 8 extended) |
| `load_confirmation_headless` (new) | not present | 80/80, exit 0 |
| `regional_handoff` | 41/41, exit 0 | 41/41, exit 0 |
| `regional_visual_profiles` | 43/43, exit 0 | 43/43, exit 0 |
| `performance_metrics` | 11/11, exit 0 | 11/11, exit 0 |
| `player_movement`, `persistence_notice`, `session_policy` | exit 0 | exit 0 |
| main scene `--quit` | exit 0 | exit 0 |
| `check-only` sweep | 40 files, 0 non-zero | 41 files, 0 non-zero |
| `domain_smoke` | 4 failing (run: 4 of 93) | 4 failing (run: 4 of 91) |
| `save_restart --read` | exit 1 (2 error lines) | exit 1 (2 error lines) |
| `npm test` (static) | exit 0; 1074 total, 1037 pass, 0 fail, 37 skipped | exit 0; same counts |
| `npm run lint` (static) | exit 1; 51 errors | exit 1; 51 errors, same files |
| `git diff --check` | clean | clean |

- The `domain_smoke` denominator changed between runs at the same code (observed 91, 92, and 93 across earlier logs). The failing count was 4 in every run. Its failing check names are not printed, so I did not verify them one by one. I did not change `domain_smoke`.

### 20.10 Headless limitation and rendered gap

- **Not verified** (rendered or real-input): the confirmation dialog's appearance and layout. Button sizes, text wrapping, and clicks. Mouse interaction (pushed mouse events do not reach Buttons in this headless build, see 19.2). A real keyboard pressing F3 in a window. Perceived timing of the switch or the Load. Whether the modal visually blocks the world.
- **Headless evidence is**: the InputMap read, physical key events through the unhandled-input path, UI activation by focus and `ui_accept`, and the node and object state after each step.
- The engine binary is a custom build with `headless` as its only display driver. Rendered checks remain blocked (19.5).

### 20.11 Pre-existing issues found, not fixed (out of scope)

- `domain_smoke`: 4 failing checks. The denominator varies between runs (20.9). Unchanged.
- `save_restart --read`: exit 1 after a matched write. Unchanged.
- `toggle_first_person` (`camera_3d_controller.gd:46`): not defined in `project.godot` or at runtime. It logs "InputMap action ... doesn't exist" during 3D runs. This is the same class as `jump`. Not fixed.
- `jump` (`character_3d.gd:48`): undefined. Not fixed.
- `world_3d.tscn` `load_steps=6` mismatch: unchanged.
- `load_dictionary` overwrites a supplied `life_history` when the DOB is invalid: unchanged.
- **Superseded by section 21 (verified at runtime and fixed)**: `scene_switcher.gd` toggles the key without checking whether a 2D modal is open. A toggle during an open modal may therefore switch modes while the modal is shown. Fixed in section 21.
- **Superseded by section 21 (fixed)**: `ui_flow_headless.gd` does not freeze the clock. An autosave during its run could change a saved value. It has passed on every run so far, but it is not frozen the way the new test is. Not changed here.

### 20.12 Scope protection

- Not changed: the region catalog, presets, the 32-region mapping, the save format, the auth and session policy, Stage 28 and Stage 30 behaviour, `time_of_day.gd`, the F9, F10, and F11 roadmap items, F13b, and the README gap.
- Not run: any world-data generator.
- Changed beyond the key and the Load path: `save_service.gd`'s read-side validation, fixed so that a missing key fails (20.4, 20.7). It does not change the format.

### 20.13 Status

- Control and Load safety: complete for the headless and static scope above.
- Rendered validation of the confirmation dialog, mouse interaction, and the F3 key on a real display: **not done**.
- Stage 29 **OPEN** (rendered checks are still blocked). Stage 28 **OPEN**. Production **NOT READY**.

## 21. Modal safety for world switching, and deterministic UI-flow tests (2026-10-11)

Evidence labels: **headless** means Godot `--headless` with simulated input, and no rendering. **Static** means file reading or grep. The engine is the custom build `4.7.2.stable.custom_build.ed1daf0bf` (checked with `--version`, exit 0), not the official release. Nothing in this section was rendered, and no mouse input was used.

### 21.1 Result

- Overall: **MODAL_SAFETY_FIXED**, within the headless and static scope. The reported observation was verified at runtime and was a real defect. It is fixed, and it is covered by an automated test.
- The UI-flow test is now deterministic: its game clock is frozen, its save restore is verified byte for byte, and its cross-test refusal covers the other save-slot tests.
- Stage 29 remains **OPEN** until rendered validation is done. Stage 28 remains **OPEN**. Production remains **NOT READY**.

### 21.2 Start state (preflight)

- Branch `arena/00cdea0e-naija`. Local HEAD `cd1703c`, remote tip `cd1703c`, 0 ahead and 0 behind, tree clean, no stash.
- F3 is the bound key (`project.godot`, physical keycode 4194334). The save-validation guard is present. The Load confirmation is present. The 2D session is retained and resumed.

### 21.3 Findings: how a modal and the world-switch key interact (static trace, then headless runtime)

- **Creation of the Load confirmation.** The "Load saved progress" button in the save menu calls `show_load_confirmation()` (`prototype_ui.gd`). That creates a modal through `_open_modal()`, which sets `_modal_open` and emits `modal_changed(true)`. Confirm calls `_close_modal()` and then emits `load_requested`. Cancel calls `_close_modal()`.
- **Modal ownership.** The modal is represented by `PrototypeUI._modal_open`, read through `is_modal_open()`. `prototype_game.gd` uses it to block gameplay: `_unhandled_input` returns early, the clock does not advance, and `_on_modal_changed` disables movement.
- **Path of `toggle_3d_mode`.** The action reaches `scene_switcher.gd`'s `_unhandled_input`. That handler checked only `current_mode`. It did not check any modal.
- **Propagation.** The 2D session's `_unhandled_input` returned early while a modal was open, and it did not consume the event. The event therefore continued to `scene_switcher.gd`. The Button GUI does not consume F3.
- **Dialog during a transition.** `suspend_session()` hides the 2D UI, and the modal lives inside that UI. The modal therefore stayed open but hidden in 3D. Returning to 2D showed it again, still open.
- **Runtime confirmation (before the fix).** In `load_confirmation_headless.gd`, a physical F3 press while the confirmation was open switched to 3D, created a 3D world, and suspended the 2D session. The dialog's buttons were no longer visible. This produced 28 failing checks, most of them a cascade from the unexpected 3D state. The first three failures are the direct evidence. This is headless, not rendered.

### 21.4 Production change

- `game/3d_world/scripts/scene_switcher.gd`: `_unhandled_input` checks `_world_switch_blocked()` before it toggles. While the 2D session reports an open blocking modal, the handler consumes the event and returns. The switching code itself is unchanged.
- `game/scripts/prototype_game.gd`: one new query, `blocks_world_switch()`, returns `is_instance_valid(ui) and ui.is_modal_open()`. It reuses the existing modal state. No second modal framework was added.
- **Why the switcher, not the 2D session, does the check.** The switcher is the component that performs the transition. An explicit check there does not depend on the order in which `_unhandled_input` runs across the tree. The 2D session still ignores gameplay input while a modal is open, as before.
- **Direction.** The check applies in both directions. In 3D, the 2D modal cannot be opened, because the 2D UI is hidden and its process is disabled. The check therefore cannot leave the user stuck in 3D.
- **Scope.** The creation screen (`show_character_creation`) is not a modal in this framework, and F3 on that screen behaves as before. This is not changed here.

### 21.5 Tests for the modal interaction (headless)

`game/tests/load_confirmation_headless.gd`, section E2 (with a blocked F3 added to section F), 104 checks in total, exit 0. Each check runs through the real InputMap action and the real handlers:

1. Opening the Load confirmation, through the HUD and save menu, with `ui_accept` activation.
2. Physical F3 (`KEY_F3`) while the dialog is open. Also the bound `toggle_3d_mode` event, read from the InputMap and sent to the unhandled-input path.
3. No transition: the mode stays `2d`, no 3D world is created, the 2D session is not suspended, and the dialog stays open with its Confirm and Cancel buttons. The unsaved session is unchanged.
4. Cancel: the dialog closes, movement is restored, and the same character and clock objects remain, with unsaved money, geography, and life history.
5. Confirm, after a blocked F3 in section F, still goes through the validated load path (the existing `load_requested` to `_continue_game`).
6. After the modal closes, F3 switches to 3D and back to the same 2D session.
7. Repeated open, blocked F3, cancel, and switch cycles (5 times): the signal-connection counts, the input-binding count, the node count, and the child counts all stay the same.

These are headless tests. They do not show a rendered dialog, a visual lock, or a real key press in a window.

### 21.6 UI-flow determinism (`game/tests/ui_flow_headless.gd`)

- **The race was real.** A scratch copy of the previous `ui_flow_headless.gd` with the clock forced to fire 15-minute boundaries every few milliseconds failed twice in two runs. Both failures were the saved-money assertions. Load and Continue restored the unsaved value (999), not the saved one (1234). This shows the race is a real failure mode, not a theoretical one. The scratch copy was outside the repository and was discarded.
- **How the clock is controlled.** The test reuses the session's own timing field, `_seconds_per_game_minute`, the same seam that `load_confirmation_headless.gd` uses. It sets the field to `1.0e9` immediately after each session is created, before any play starts. The original rate is recorded and restored on each live session before the final checks. The test also asserts that game time does not move during the save-dependent steps, comparing the minute count recorded at unsaved state with the minute count just before the Load step. This is a test-only write. No production hook was added, and no delay or timeout was used to hide the race.
- **Save-file safety.** Before anything else, the test copies the original byte for byte to its own backup and verifies the copy. Only then does it remove the original. At the end, it writes the original back, reads it back, compares the bytes, and deletes its backup only after that comparison matches. A failed verification keeps the backup, because it may be the only copy. The test deletes only the backup and marker it created.
- **Refusal.** The test refuses to run, exit 1, and changes nothing, while any backup or marker from a save-slot test is present. The list is this test's backup and marker, the load-confirmation backup and marker, and the return-path backup.
- **Probes, outside the repository.**
  - A foreign backup named `naija-stage1-save.return-test-backup.json` was planted in the user data folder. The test refused (exit 1), and the foreign file was left unchanged. The probe file was then removed, because I had created it.
  - A valid sentinel save was planted. The test backed it up, removed it, ran (exit 0), and restored it with identical bytes. The sentinel was then removed, because I had created it, so the folder returned to its original state.

### 21.7 Save and load regression (headless, no redesign)

- The missing-character fix from section 20.7 is in the baseline. Its regression assertions are in `load_confirmation_headless.gd`, section H. They call `SaveService.load_state()` directly for a missing character key, a missing clock key, and a character that is not an object. Each must return `ok == false` with no character payload. This verifies the check itself, not the UI.
- Section G still covers the UI-level cases. Each failure leaves the session unchanged.
- No save format change. The save service's read path is unchanged except for the null fallback from section 20.7.
- The disconnect ordering in `_continue_game` is unchanged from section 20.7. **Not runtime-tested**: there is no multiplayer server in this sandbox.

### 21.8 Test counts and repeated-run evidence (exit codes are real)

| Check | Before this section (`cd1703c`) | After this section |
|---|---|---|
| `load_confirmation_headless.gd` | 80/80, exit 0 | 104/104, exit 0 (3 final repeated runs, all 104/104, exit 0; an earlier set of 5 runs at 103 checks, before the blocked F3 in section F was added, also exit 0) |
| `ui_flow_headless.gd` | 54/54, exit 0 | 57/57, exit 0 (10 repeated runs, all 57/57, exit 0, 0 script errors, no leftover save files) |
| `return_path.gd` | 46/46, exit 0 | 46/46, exit 0 |
| `regional_handoff.gd` | 41/41, exit 0 | 41/41, exit 0 |
| `regional_visual_profiles.gd` | 43/43, exit 0 | 43/43, exit 0 |
| `performance_metrics.gd` | 11/11, exit 0 | 11/11, exit 0 |
| `player_movement`, `persistence_notice`, `session_policy` | exit 0 | exit 0 |
| Main scene `--quit` | exit 0 | exit 0 |
| `check-only` sweep | 41 files, 0 non-zero | 41 files, 0 non-zero |
| `domain_smoke.gd` | exit 1; 4 failing (run: 4 of 93) | exit 1; 4 failing (run: 4 of 91) |
| `save_restart --read` (after `--write`) | exit 1; 2 error lines | exit 1; 2 error lines |
| `npm test` (static) | exit 0; 1074 total, 1037 pass, 0 fail, 37 skipped | exit 0; same counts |
| `npm run lint` (static) | exit 1; 51 errors | exit 1; 51 errors, same files |
| `git diff --check` | exit 0 | exit 0 |

- Before any change, the baseline `save_restart --read` run reported 1 error line. That was my error: I ran `--read` without the `--write` step that creates the checkpoint. The corrected baseline is 2 lines, matching the earlier record.
- The `domain_smoke` denominator varies between runs at the same code (91, 92, 93). The failing count is 4 in every run.

### 21.9 Remaining limitations

- **Rendered validation: not done.** No dialog layout, button appearance, text wrapping, visual movement lock, or fade was inspected. The custom build has only a headless display driver, so rendered checks are blocked (19.5).
- **Mouse interaction: not tested.** Pushed mouse events do not reach Buttons in this headless build (19.2). Every activation here used focus and `ui_accept`.
- **Real key press in a window: not tested.** The F3 checks send `InputEventKey` events to the viewport, not keystrokes from a keyboard.
- **Live server: not tested.** The disconnect on an active online session at the commit point of `_continue_game` could not be exercised. There is no multiplayer server in this environment.
- **Creation screen: not changed.** F3 on the character-creation screen, which is not a modal in this framework, behaves as before. This is a code observation, not a runtime test.
- **`return_path.gd`: unchanged.** It does not freeze the clock, and it has its own backup without a verified restore. It was not changed in this task, because it must keep passing as it is. Its clock assertion (resume does not catch up) is not sensitive to autosave.
- **Known failures, unchanged:** `domain_smoke.gd` (4 failing), `save_restart --read`, the 51 ESLint errors in `services/world-api`, the undefined `toggle_first_person` and `jump` actions, the `world_3d.tscn` `load_steps` mismatch, and the `load_dictionary` life-history overwrite.

### 21.10 Scope protection

- Not changed: the F3 binding, the 2D session-retention architecture, the region catalog, the 32-region mapping, visual presets, the save format, auth and session policy, Stage 28 safeguards, Stage 30 access, `time_of_day.gd`, F13b, the F9 to F11 roadmap items, the README, and the known failures listed above.
- No world-data generator was run, and no production data was modified.

### 21.11 Status

- Modal safety for world switching: fixed, and verified headless.
- UI-flow determinism: clock frozen, save restore verified, refusal widened. Verified over 10 repeated runs.
- Stage 29 **OPEN** until rendered validation is complete. Stage 28 **OPEN**. Production **NOT READY**.

## 22. Re-audit of modal safety and UI-flow determinism, with mutation checks (2026-10-11)

Evidence labels: **executed (headless)** means Godot `--headless` with simulated input, and no rendering. **Static** means file reading or grep. **Mutation** means a temporary change made only in a scratch copy under `/tmp`, never in the repository. The engine is the custom build `4.7.2.stable.custom_build.ed1daf0bf`. Its `--version` check exited 0. It is not the official release.

### 22.1 Result

- Overall: **MODAL_SAFETY_VERIFIED**. The defect in section 21 was fixed in `00f692b`. This task re-checked that protection, and it made no production change. The required tests were already present, and they fail when the guard is removed (see 22.5).
- UI-flow determinism: the game clock is frozen by the session's own timing field, and the save restore is verified. The race is confirmed only with an accelerated clock. At the real rate, bypassing the freeze did not fail in three runs (see 22.5 and 22.6). The freeze is therefore a guard against a timing-dependent race, not a fix for a race that always fails.
- Stage 29 remains **OPEN** until rendered validation is done. Stage 28 remains **OPEN**. Production remains **NOT READY**.

### 22.2 Starting state (preflight)

- Branch `arena/00cdea0e-naija`. Local HEAD `00f692be491507e1595330ba113cede5a74d6498`, the commit from section 21. Remote tip is the same commit, with 0 ahead and 0 behind.
- `cd1703c` is an ancestor of HEAD. `03e6611` is also an ancestor. The working tree was clean, with no staged changes, no untracked files, and no stash.
- The earlier report named `cd1703c` as HEAD. That was accurate for the previous task. The later commit `00f692b` is the expected successor, not a discrepancy.

### 22.3 Code inspection (static)

- **F3 binding.** `project.godot` binds `toggle_3d_mode` to one key event, physical keycode 4194334 (`KEY_F3`). F11 is not bound to that action. The only code that reads `toggle_3d_mode` is `scene_switcher.gd`, and the `return_path` and `ui_flow` tests.
- **Dispatch.** `scene_switcher.gd` `_unhandled_input` checks `event.is_action_pressed("toggle_3d_mode")`. It then calls `_world_switch_blocked()`, which asks the 2D session through `blocks_world_switch()`. That function returns `ui.is_modal_open()`. When it is blocked, the event is consumed and nothing else runs.
- **Modal.** The Load confirmation is created by `show_load_confirmation()` through `_open_modal()`. That sets `_modal_open`, emits `modal_changed(true)`, and adds a full-rect `ColorRect` with `MOUSE_FILTER_STOP`. The shade blocks mouse input to the game beneath it. Keys are not blocked by the shade, which is why the key guard is needed.
- **Dismissal.** Confirm calls `_on_load_confirmed()`, which closes the modal and emits `load_requested`. That is routed to `_continue_game()`. Cancel calls `_close_modal()` and emits nothing.
- **Validated commit.** `_continue_game()` calls `SaveServiceScript.load_state()`, then `_is_restorable_save()`, and only then replaces `clock` and `character`. A failed check returns with a notice, and the session is unchanged.
- **Save validation.** `save_service.gd` defaults the character and clock to `null`, not `{}`, so a missing key fails the `is Dictionary` test.
- **Suspension.** `suspend_session()` disables processing and hides the UI layer. `resume_session()` restores both. The 2D session is not freed.
- **Autosave.** Autosave is clock-driven. The 2D session calls `_save_game(false)` when the 15-game-minute boundary is crossed (`prototype_game.gd`, the `_process` clock block), and only when no modal is open. Other saves are event-driven, from `_save_game(false)` calls at player actions. Nothing is timer-based.
- **Rate.** `_seconds_per_game_minute` is set once in `_ready()`, from the calendar catalog (default 0.65 s). `ui_flow_headless.gd` freezes it after `_ready()` has run, so the freeze is not overwritten.
- **Save path.** Both UI-flow tests use `user://naija-stage1-save.json`, which is `DEFAULT_SAVE_PATH`. This build has no command-line flag to redirect `user://`. A project-setting override exists, but it changes production configuration, so it is not used.

Answers to the seven questions in the task:

1. Is the Load confirmation a blocking modal? Yes, for input. It is a full-rect shade with `MOUSE_FILTER_STOP`, plus `_modal_open`, which the 2D session reads.
2. Does F3 remain available while the modal is open? Yes, as a key event. The switcher ignores it while blocked.
3. Can the switcher change worlds while the dialog is visible? Not since `00f692b`. Before that fix, yes (section 21.3).
4. If it did, what happened to the dialog? Before the fix, `suspend_session()` hid the UI layer. The dialog stayed open but hidden in 3D, and it was visible again after a return to 2D. It was not orphaned.
5. Could the session be left partly changed? Before the fix, the session objects were retained, so nothing was replaced. Confirm itself was not affected.
6. Is there an established mechanism? Yes, `ui.is_modal_open()`, read by `_unhandled_input`, the movement code, and the clock block in the 2D session. `blocks_world_switch()` reuses it.
7. Do other blocking dialogs use it? Every `_open_modal()` caller sets `_modal_open`, so they share the same query. No other mechanism exists.

### 22.4 Executed evidence (headless, this run, sequential)

- `load_confirmation_headless.gd`: exit 0. 104 of 104 PASS, 0 FAIL, 0 SCRIPT ERROR. The output also shows undefined-action errors (`toggle_first_person`, `jump`), which are known and not failures. Their count changes between runs because the engine logs them per frame.
- `ui_flow_headless.gd`, three consecutive runs under identical conditions:
  - Run 1: exit 0. 57 of 57 PASS, 0 FAIL, 0 SCRIPT ERROR.
  - Run 2: exit 0. 57 of 57 PASS, 0 FAIL, 0 SCRIPT ERROR.
  - Run 3: exit 0. 57 of 57 PASS, 0 FAIL, 0 SCRIPT ERROR.
  - All three matched. The game-minute assertion passed in all three runs, which means game time did not advance during the save-dependent steps. Autosave is clock-driven, so no clock-driven autosave occurred in those windows. Event-driven saves are triggered by the test's own steps, and the test does not count them separately.
  - Real user save: the test writes `user://naija-stage1-save.json`, the same path as the real save. The user data folder was checked after the batch and after each mutation run. It held only `logs`, `naija-multiplayer.cfg`, and `objectdb_snapshots`, and no save, backup, or marker existed. The previous turn ended with the same listing. The test created its own file and removed it at the end.
- `return_path.gd`: exit 0. 46 of 46 PASS. Three further repeated runs: exit 0, 46 of 46 each.
- `regional_handoff.gd`: exit 0. 41 of 41 PASS.
- `regional_visual_profiles.gd`: exit 0. 43 of 43 PASS.
- `performance_metrics.gd`: exit 0. 11 of 11 PASS.
- `player_movement.gd`: exit 0. 4 of 4 PASS.
- `persistence_notice.gd`: exit 0. It prints no PASS summary, so it has no assertion count in its output.
- `session_policy.gd`: exit 0. It prints no PASS summary, so it has no assertion count in its output.
- `domain_smoke.gd`: exit 1. `FAIL: 4 of 92 Stage 1 domain checks`. This is the known baseline failure. The total was 91 to 93 across earlier runs.
- `save_restart.gd write`: exit 0. It writes its own file, `user://naija-stage1-restart-test.json`.
- `save_restart.gd read`: exit 1, with 2 `ERROR` lines (`academic result`, `attendance and inventory`). This is the known baseline failure. The write ran first in this sequence, so it is not a sequencing error.
- Main project load (`--quit`): exit 0.
- GDScript check-only sweep: 41 files, 0 with a non-zero exit (static parse and check).
- `npm test` (static Node tests, not Godot evidence): exit 0. 1074 total, 1037 pass, 0 fail, 37 skipped.
- `npm run lint` (static): exit 1. 51 errors, 0 warnings. The error lines match the baseline file for file.
- `git diff --check`: exit 0 on the tree before this section was added. It is rerun after the commit.

### 22.5 Mutation checks (scratch copy only, never in the repository)

- **M1: modal gate disabled** (`_world_switch_blocked()` returns `false`). Load confirmation test: exit 1, 7 of 104 checks fail. The failing checks are the expected ones: F3 does not switch to 3D while the dialog is open, no 3D world is created, the 2D session is not suspended, the dialog stays open after a blocked F3, the open-F3-cancel cycle, and the repeated node-count and session checks. The test detects removal of the guard.
- **M2: clock forced fast** (0.0005 s per game minute instead of frozen). UI-flow test, 2 runs: exit 1 both times, 3 of 57 checks fail each time. The failures are the new game-minute assertion and the two saved-money checks (Load and Continue). The test detects an accelerated clock.
- **M3: freeze bypassed at the real rate** (the freeze line is a no-op, and the default 0.65 s rate remains). UI-flow test, 3 runs: exit 0 each time, 57 of 57 PASS. The race did not reproduce at the real rate in these short runs. The game-minute assertion did not fail either, so the clock did not advance during the save-dependent steps.

Conclusion from M1 to M3: the modal test catches removal of the guard. The UI-flow test catches an accelerated clock. At the real rate, the freeze is a guard against a timing-dependent race, and this run did not reproduce that race. It should not be described as a fix for a failure that always occurs.

### 22.6 Determinism findings

- **Race (accelerated clock only).** Section 21.3 records two failing runs of the old test, with the clock forced to fire boundaries every few milliseconds. This section's M2 reproduces the same class of failure with the new assertion.
- **Real rate.** M3 did not reproduce the race in three runs. The honest claim is that the freeze removes a timing-dependent risk. It is not a demonstrated fix for a failure at the real rate.
- **Isolation.** The test uses the session's own timing field, and it does not add a production hook, a sleep, or a timeout change. The real save slot is shared, but the test backs it up, byte-verifies the backup before removing the original, and restores and byte-compares the original before removing its backup. It refuses to run while any save-slot test's backup or marker is present.
- **Limit.** The test cannot redirect `user://` in this build, so it cannot run in a separate user-data directory. The backup and refusal logic is the protection that is available.

### 22.7 Baseline comparison

- `domain_smoke`: 4 failing checks, unchanged. The total varied (91 to 93 before, 92 now).
- `save_restart --read`: exit 1, 2 `ERROR` lines, unchanged.
- ESLint: 51 errors, unchanged. The error lines match the baseline file for file (diff empty).
- `toggle_first_person` and `jump`: still undefined, and still logged. Not changed.
- `npm test`: 1074 / 1037 / 0 / 37, unchanged.
- No new failure was introduced by this task. No production code changed in this task.

### 22.8 Verification status

- **Executed (headless):** the Load confirmation test, the UI-flow test (3 consecutive runs), the return-path test (4 runs), the regional handoff, visual profile, performance, player movement, and session-policy tests, the main project load, and the mutation checks in 22.5.
- **Static:** the code inspection in 22.3, the check-only sweep, `npm test`, lint, and `git diff --check`.
- **Not verified:** the rendered dialog, its layout, and its appearance. Real keyboard input in a window. Mouse interaction with the dialog's buttons. Any rendered timing.
- **Blocked by tooling:** a separate user-data directory for the tests (see 22.6). Live-server behaviour, including the multiplayer disconnect safeguard in `_continue_game()`, which was not exercised because there is no server in this environment.

### 22.9 Remaining risks

- `return_path.gd` does not freeze the clock, and its restore is not byte-verified. It passed 4 of 4 runs in this task (the suite run and three repeats). It was not changed, because it is outside this task's scope.
- The UI-flow test's freeze writes a private field, `_seconds_per_game_minute`. This is test-only, and it follows the existing approach.
- The undefined-action log volume varies by run, because it is per frame. It is not an assertion.
- Rendered validation and live-server validation are outstanding (see 22.8).

### 22.10 Status

- Modal safety for world switching: verified headless, with the guard in `00f692b`. This section adds no production change.
- UI-flow determinism: clock frozen, save restore verified, and three consecutive runs passed. The race is confirmed only with an accelerated clock.
- Stage 29 **OPEN** until rendered validation is complete. Stage 28 **OPEN**. Production **NOT READY**.

## 23. Recovery, return-path save safety, and consolidated issue register (2026-10-11)

Evidence labels used below. **Engine-executed** means a Godot run with a verified binary. **Parse** means a third-party tree-sitter GDScript grammar (PyPI `tree-sitter-gdscript` 6.1.0), which is not Godot. **Node** means in-process Node tests, not a live server. **Static** means reading or grep. **Not verified** and **blocked** are stated where they apply.

### 23.1 Result

- Repository: **RECOVERY_COMPLETE**. The local branch was realigned to `origin/arena/00cdea0e-naija` (`c898e21`) without touching any working file. The working tree is clean.
- Return-path save safety: **FIXED_UNVERIFIED**. The data-loss path is fixed in the code. It has not been executed, because no Godot binary is available.
- Engine-dependent acceptance (all Godot tests, rendered validation, live-server behaviour): **BLOCKED — GODOT UNAVAILABLE**, and no live server.
- Node test suite and lint: **executed (Node, static)**, with results in 23.10.
- Stage 29: **OPEN**. Stage 28: **OPEN**. Production: **NOT READY**.

### 23.2 Repository recovery

- Starting state, verified at the start of this task: local branch `arena/00cdea0e-naija` at `44483b4` (the `main` tip), with no upstream. The remote branch was at `c898e21`, 96 commits ahead. Staged: 0. Modified tracked: 32. Untracked: 318. Stashes: 0. Ignored files present: 0.
- Blob check before any change: all 411 files of `c898e21` matched the working tree exactly, and no extra working-tree file existed outside that commit. The 32 modified files are the earlier fixes, and their content equals `c898e21`.
- Backup taken before any Git-state change: a copy of the `.git` directory and a tar of the working tree (excluding `.git`), with a SHA-256 checksum. Location: `/tmp/naija-recovery-backup-20261011142806`. `/tmp` did not survive an earlier environment reset, so this copy is not durable. It should be treated as temporary.
- Realignment, in two steps, both without touching a working file:
  1. `git update-ref refs/heads/arena/00cdea0e-naija c898e21 44483b4` (compare-and-swap; it would have failed if the branch had moved). This is a fast-forward, because `44483b4` is an ancestor of `c898e21`.
  2. `git read-tree c898e21` (index only, with no working-tree update), followed by `git branch --set-upstream-to=origin/arena/00cdea0e-naija`.
- Final state, verified: HEAD `c898e21`, branch `arena/00cdea0e-naija`, 0 ahead and 0 behind its upstream, no staged files, no stash. No reset, clean, or force-push was used.
- Earlier fixes are present in history (verified with `git log`): `00f692b` (modal guard, UI-flow determinism), `cd1703c` (F3 standard key, confirmed Load), `03e6611` and `7510942` (headless UI-flow evidence), `b5430c8` (3D return repair), `c898e21` (section 22).

### 23.3 Engine availability

- `/tmp/godot-build` is gone. No Godot executable exists anywhere on the machine (`find` returned nothing).
- The official 4.7.2-stable release is published on GitHub (checked through `api.github.com`). The release binary is served from a release-assets host that is not on this sandbox's allowlist (recorded as blocked earlier in this task). That host was not retried, and no other mirror was used.
- A source build from `codeload.github.com` is possible in principle, but this machine has 2 cores, 3 GB of RAM, and no `scons`. A full Godot build on this hardware would be slow and could exhaust memory (a judgment, not measured). It was not started. It would produce a custom build, not the official release.
- Consequence: no Godot test was executed in this task. The `--version` check was not run, because there is no binary to check.

### 23.4 Return-path save safety

**Save and backup paths.** Save: `user://naija-stage1-save.json`, which is `save_service.gd`'s `DEFAULT_SAVE_PATH`. Backup: `user://naija-stage1-save.return-test-backup.json`. Marker (new): `user://naija-stage1-save.return-test-no-save.marker`.

**Behaviour before this change (confirmed by reading `HEAD:game/tests/return_path.gd`):**
1. The test does not remove the original save. Its own explicit saves, and the clock's autosave, overwrite `SAVE_PATH` in place during the run. The backup is therefore the only intact copy while the test runs.
2. The backup was written with `store_buffer` and never read back or compared.
3. The restore wrote the original only `if file != null`, then removed the backup unconditionally. If reopening the save for writing failed, the backup was deleted and the user's save was lost. **This was the most serious finding.** Confirmed by code reading. Not yet confirmed by failure injection.
4. The restored save was never compared to the original bytes, and the restore result was ignored.
5. No marker recorded that no save existed. After a killed run, the test's own save would have been treated as user data on the next run, backed up, and kept.
6. The refusal check covered only the backup path, not markers or the other save-slot tests' files.

**Behaviour after this change (`game/tests/return_path.gd`):**
- The original bytes are read into memory before any write (`_original_bytes`). A missing original is recorded as absence, through the marker, and never as an empty file.
- The backup is written, read back, and compared to the in-memory original. A mismatch removes this run's own backup and stops before the save is changed.
- Restore writes the in-memory original back, reads it back, and compares the bytes. The backup is removed only after that comparison matches. If the write fails, the backup is kept. If the comparison fails, the backup is kept. If the backup cannot be removed, the failure is reported.
- If no save existed, a marker records that. Restore removes the save only if it is present, which can only be this run's save, and then removes the marker. A failure keeps the marker.
- `_restore_save()` returns a result that is checked as an assertion (`_check`). A failed restore therefore fails the run.
- Refusal: the run refuses if the backup, the marker, or any other save-slot test's backup or marker is present. Nothing is changed in that case.
- The other two save-slot tests (`ui_flow_headless.gd`, `load_confirmation_headless.gd`) now also refuse while the return-path marker is present.

**Effect on counts.** The new restore check adds one assertion. A successful run is therefore expected to print 47 return-path checks, not 46. This is expected, and it is not yet executed.

**Verification status of the change:**
- Parse: 0 error nodes in all three edited files, with a negative control that produced 2 error nodes. This shows the parser detects errors. It is not Godot compilation.
- Engine-executed: none. The new code is **FIXED_UNVERIFIED**.
- Not verified: the failure-injection tests in 23.6 (restore-write failure, backup mismatch, leftover marker).

**Crash and kill behaviour.** Ordinary cleanup does not run after a hard kill or a crash. The recovery material (backup or marker) then stays on disk, and the next run refuses to start until a person resolves it. The test does not delete that material to make a run proceed. The test cannot recover a save after a hard kill by itself.

### 23.5 Clock and autosave (return-path test)

- The 2D clock rate is `_seconds_per_game_minute` in `prototype_game.gd` (line 33, default 0.65 s per game minute, clamped at line 42).
- Autosave: `prototype_game.gd` calls `_save_game(false)` when a 15-game-minute boundary is crossed (lines 131-147), and only when no modal is open and the session is not suspended. A suspended session does not advance the clock (line 83).
- The test checks that the 2D clock is unchanged while 3D is active (`return_path.gd`, the check at line 199).
- **Not established:** a clock advance also calls `character.advance_time` and `advance_life_to_date` (lines 118-134). Those can change character state. An autosave during the test could therefore capture state that a later assertion reads. Static review could not rule this out, and the engine was not available to test it.
- No clock freeze was added in this task, and no production code changed. Status **OPEN** (TEST-6). If a flake is observed, the fix is a test-local seam (for example, suspending the clock inside the test), not a production change.

**Timing-sensitive check that remains (not changed, not verified):**
- `resume_step <= 1` (test line 308) counts game minutes advanced in the first frame after resume. At 0.65 s per game minute, a single frame with a wall-clock delta of about 1.3 s would advance two minutes (arithmetic, not an observed failure). Status **OPEN** (TEST-7).
- `moved > 1.0` after 60 held-input frames depends on physics stepping. Status **OPEN** (TEST-8), not reproduced.

### 23.6 Failure-path review

| Failure | Behaviour after this change | Verification |
|---|---|---|
| Assertion fails | Recorded. Run continues to restore, then exits 1 | Static |
| Backup cannot be opened, written, or read back identically | Run stops before the save file is changed; a mismatched backup is removed | Static |
| Backup read-back mismatch | Own backup removed; original never changed | Static |
| Original cannot be reopened for writing during restore | Backup kept; error reported; run fails | Static (**not failure-injected**) |
| Restored bytes differ from the original | Backup kept; run fails | Static |
| Backup cannot be removed after verified restore | Reported; run fails; backup kept | Static |
| No-save case, marker cannot be removed | Reported; run fails; marker kept | Static |
| Previous run's backup, marker, or other test's file present | Refuses; changes nothing | Static |
| Watchdog (180 s) | Restores (same logic), then exits 1 | Static |
| Hard kill or crash | No restore; recovery material kept; next run refuses | Documented limitation |
| GDScript runtime error inside the test coroutine | Restore waits for the watchdog. Not verified | **OPEN** |

Failure injection was not performed. It needs a working engine and a scratch copy with a fixture user-data directory. The repository's own test runner has no such isolation (see 23.10).

### 23.7 Modal, F3, and F11 (static)

- `project.godot`: `toggle_3d_mode` is bound to physical F3 (`physical_keycode` 4194334). No F11 keycode (4194342) is bound in `project.godot`.
- `load_confirmation_headless.gd` asserts that only `toggle_3d_mode` uses F3, and that F11 is not used. It passed at `00f692b` (104/104). That result is historical and was not re-executed in this task.
- `scene_switcher.gd` line 36 checks `_world_switch_blocked()` before switching. That helper (line 44) defers to `mode_2d_instance.blocks_world_switch()`, defined at `prototype_game.gd:1356`. Both are present at `c898e21`. Whether the event is consumed while a modal is open was not checked, so it is not claimed here.
- The Load confirmation, Cancel, and Confirm paths were not changed in this task.
- Status: **code present by inspection; engine re-verification BLOCKED**.

### 23.8 Time-of-day lighting ownership (TOD-1)

- `time_of_day.gd` looks up `DirectionalLight3D` and `WorldEnvironment` through `get_parent()`. In `world_3d.tscn`, the TimeOfDay node is a child of the root (line 82). The light and the environment are children of `Environment` (lines 44 and 51). So both lookups return `null`.
- Effect today: `_set_ambient_light` is guarded by `world_environment and ...`, so the lighting writes are inert. The regional profile's ambient values are not overwritten.
- Latent conflict: a naive fix that makes the lookup succeed would make `_update_lighting()` write ambient light every frame and override the regional profile's values. That is the conflict the mission warned about.
- Required design, not implemented: one owner for ambient light. Either the regional profile owns ambient light and time of day modulates only the sun, or time of day owns ambient and the regional profile supplies only the base. This needs an architectural decision, so `time_of_day.gd` was not changed.
- Status: **OPEN**, design required. Not runtime-verified.

### 23.9 Regional profiles, generators, and classification (static)

- **F9 (Kaduna climate).** `environment_config.gd` (line 141) says `semi-arid`. The regional catalog (`regional-catalog.json`) and `regional-environment-profiles.json` both say `tropical`. The mission excludes changes to catalogs and presets, so this is recorded only. Status: **OPEN**, classification.
- **GEN-1 (`ng:state:fc` generator mismatch).** `update-environment-profiles.js` line 22 maps `ng:state:fc` to `ng:fct:abuja`, which is not the catalog ID `ng:state:fc` used at runtime. `generate-regional-catalog.js` keys its region table by `ng:state:fc` (line 128), which matches the catalog ID. Its `capital: 'Abuja'` field does not change that. The generators were not run. Status: **OPEN**, excluded.
- **GEO-1 (historical table row).** The audit table row for FC (line 204) says "silent fallback to ng:state:od". The current `environment_config.gd` line 59 maps `ng:state:fc` to `savanna`. The row may be stale. Status: **NOT VERIFIED**, needs a runtime check.
- **Undefined actions.** `toggle_first_person` (`camera_3d_controller.gd:46`) and `jump` (`character_3d.gd:48`) are used, and neither is defined in `project.godot`. They log InputMap errors at runtime. Status: **OPEN** (known, unchanged, not fixed).
- **`world_3d.tscn`** declares `load_steps=6`. It has 5 external and 4 sub-resources, so Godot would expect 10. Status: **OPEN** (cosmetic, known).
- No world-data generator was run.

### 23.10 Test results (this task)

| Test | Environment | Result |
|---|---|---|
| Godot binary `--version` | None available | **BLOCKED** (not run) |
| `load_confirmation_headless.gd` | Headless, Godot | **BLOCKED** (not run) |
| `ui_flow_headless.gd` (3 runs) | Headless, Godot | **BLOCKED** (not run) |
| `return_path.gd` (3 runs) | Headless, Godot | **BLOCKED** (not run) |
| regional handoff, visual profiles, performance, player movement, persistence notice, session policy | Headless, Godot | **BLOCKED** (not run) |
| Main scene load, GDScript check-only sweep | Headless, Godot | **BLOCKED** (not run) |
| `domain_smoke.gd`, `save_restart --read` | Headless, Godot | **BLOCKED** (not run). Baseline (earlier engine runs): 4 failures and 2 errors |
| GDScript parse (three edited files) | Parse, third-party grammar | 0 error nodes; negative control 2 error nodes |
| `npm test` (world-api and root) | Node, in-process | exit 0; 1074 total, 1037 pass, 0 fail, 37 skipped |
| `npm run lint` | Static | exit 1; 51 errors, 0 warnings. Same count as baseline. Per-file comparison not possible (earlier baseline log lost) |
| `git diff --check` | Static | exit 0 |

The Node suite includes `justice-case-access.test.mjs` and the `identity-*` tests. Those are in-process checks, so they say nothing about a live server.

**Secret scan (static).** No private key, AWS key, GitHub token, or Slack token patterns were found in tracked text. Seven Postgres-style URLs with a password placeholder appear in documentation and test fixtures. They use `example.test`, `example.com`, `db.example.test`, or loopback hosts. None is a live credential. Status: **VERIFIED NOT AN ISSUE** (static).

### 23.11 Consolidated issue register

> Historical snapshot (state before the 2026-10-11 verification in section 24). Current statuses are in section 24.8.

| ID | Component | Finding | Severity | Status | Evidence | Blocks release |
|---|---|---|---|---|---|---|
| REC-1 | Git | Local branch was at `main`, not at `c898e21`, with no upstream | High | FIXED_VERIFIED | `git status`, `rev-list` 0/0, blob check 411/411 | No |
| ENV-1 | Engine | No Godot binary; official download blocked by allowlist | High | BLOCKED | `find`, download error | Yes, for any engine evidence |
| TEST-1 | return_path restore | Backup deleted even if original write fails | High (data loss) | FIXED_UNVERIFIED | Code reading; parse | Yes, until engine-tested |
| TEST-2 | return_path backup | Backup not read back or compared before use | High | FIXED_UNVERIFIED | Code reading; parse | Yes, until engine-tested |
| TEST-3 | return_path restore | Restore not compared to original bytes | High | FIXED_UNVERIFIED | Code reading; parse | Yes, until engine-tested |
| TEST-4 | return_path marker | No marker for the no-save case; leftover save treated as user data | Medium | FIXED_UNVERIFIED | Code reading | Yes, until engine-tested |
| TEST-5 | Save-slot refusal | Refusal did not cover markers or other tests' files | Medium | FIXED_UNVERIFIED | Code reading; parse | Yes, until engine-tested |
| TEST-6 | return_path clock | Autosave and clock advance run during the test and change character state; effect on assertions not established | Medium (unknown) | OPEN | 23.5 | No (flake risk) |
| TEST-7 | return_path timing | `resume_step <= 1` depends on the first frame's wall-clock delta | Medium (flaky risk) | OPEN | 23.5 | No |
| TEST-8 | return_path timing | `moved > 1.0` depends on physics stepping | Low | OPEN | 23.5 | No |
| TEST-9 | Crash recovery | Hard kill bypasses cleanup; material kept, next run refuses | Medium | KNOWN_LIMITATION | 23.4 | No |
| TEST-10 | Runtime error path | Restore waits for watchdog; unverified | Low | OPEN | 23.6 | No |
| TOD-1 | time_of_day lighting | Lookup misses light and environment; naive fix would override regional ambient | Medium | OPEN (design) | 23.8 | No (inert today) |
| F9 | Kaduna climate | `semi-arid` vs `tropical` | Low | OPEN (excluded data) | 23.9 | No |
| GEN-1 | Generators | `ng:state:fc` vs `ng:fct:abuja` mismatch | Low | OPEN (excluded) | 23.9 | No (generators not run) |
| GEO-1 | Audit history | FC row may be stale | Low | NOT_VERIFIED | 23.9 | No |
| ACT-1 | Input actions | `toggle_first_person` and `jump` undefined | Low | OPEN | 23.9 | No |
| TSCN-1 | world_3d.tscn | `load_steps` mismatch | Low | OPEN | 23.9 | No |
| LINT-1 | Lint | 51 errors | Low | OPEN (baseline, count only) | 23.10 | No |
| SMOKE-1 | domain_smoke | 4 failures (last engine run) | Medium | OPEN (not re-run) | Historical | Unknown |
| SR-1 | save_restart --read | 2 errors (last engine run) | Medium | OPEN (not re-run) | Historical | Unknown |
| SEC-1 | Secrets | Postgres placeholders in docs and fixtures | Info | VERIFIED NOT AN ISSUE | 23.10 | No |

### 23.12 Remaining blockers

1. **Must fix before safe testing:** a verified Godot 4.7.2 binary on this machine. Then run the return-path failure-injection tests (restore-write failure, backup mismatch, leftover marker) in a scratch copy, and run `return_path.gd` three times, to convert TEST-1 to TEST-5 from FIXED_UNVERIFIED to FIXED_VERIFIED.
2. **Must fix before a playable milestone:** a design decision for TOD-1 (ambient-light owner). The regional-profile and environment work depends on it.
3. **Must fix before production:** the Stage 28 persistence, deployment, and operational blockers (historical; not re-audited in this pass beyond the Node suite).
4. **Requires a rendered display:** the Load dialog, F3 blocking with a physical key, the regional visual profiles, and all lighting changes.
5. **Requires a live server or external credentials:** live-server behaviour of the multiplayer and backend, server-backed persistence, and deployment verification.
6. **Requires a human decision or action:** provision the Godot binary (or approve a long source build); the Kaduna climate value (F9); the FC generator ID (GEN-1); and approval of any generator change (GEN-1), which is out of scope until a human decides.

### 23.13 Status

- Repository: **RECOVERY_COMPLETE**.
- Return-path save safety: **FIXED_UNVERIFIED** (engine-unexecuted).
- Modal safety and UI-flow determinism: unchanged from section 22. **Engine-verified at `00f692b`**, not re-run in this task.
- Stage 29: **OPEN**. Stage 28: **OPEN**. Production: **NOT READY**.

## 24. Godot restoration, save-safety verification, and regression pass (2026-10-11)

Starting point, verified: HEAD `d788e5f` on branch `arena/00cdea0e-naija`, equal to `origin/arena/00cdea0e-naija`, clean before this task's edits. Executed-test evidence is labelled per claim. Scratch logs and harness live outside the repository in `/tmp/naija-scratch` and `/tmp/naija-harness` and are not committed.

### 24.1 Result

- Repository: unchanged history. Edits in this task are listed in 24.6 and committed on the working branch as separate commits.
- Engine: **CUSTOM BUILD** of Godot 4.7.2 from the official `4.7.2-stable` source tag. `--version` prints `4.7.2.stable.custom_build.ed1daf0bf`. The official release binary was not reachable from this sandbox. This is not a stock release and must be labelled as custom.
- Save safety: SAVE-1 (unreadable save backed up as empty, then overwritten) reproduced on HEAD and fixed. Return-path, `ui_flow_headless`, and `load_confirmation_headless` refusal and restore paths were exercised in scratch.
- UI-flow determinism: `ui_flow_headless` ran 3 consecutive times on the final tree, 57/57 each, exit 0, 0 script errors, save unchanged each run.
- Readiness: PARTIALLY_COMPLETE. Stage 28 OPEN. Stage 29 OPEN. Production NOT READY.

### 24.2 Engine provenance (executed)

- Source: `github.com/godotengine/godot`, tag `4.7.2-stable`, commit `ed1daf0bf001b61586d9930840f2f1394092c079` (matched against the GitHub API). Not verified against a signed tag or a published checksum.
- The release asset host `release-assets.githubusercontent.com` failed with `SSL_ERROR_SYSCALL` on each attempt, so the official binary and `SHA512-SUMS.txt` could not be fetched.
- Build: SCons 4.11.1 under a scratch virtualenv. `platform=linuxbsd target=editor arch=x86_64 x11=no wayland=no alsa=no pulseaudio=no dbus=no speechd=no fontconfig=no udev=no libdecor=no tests=no dev_build=no debug_symbols=no linker=gold`. Build exit code `SCONS_EXIT=0`, 54 minutes on 2 cores.
- SCons requires a `pkg-config` binary even with X11 and Wayland disabled. A scratch placeholder answering `0.0.0-shim` was used for that check only. It provides no libraries.
- Binary: `bin/godot.linuxbsd.editor.x86_64`, 160,779,792 bytes, sha256 `b7052e201ae39df716d7b870f5331807a6a89cb00aad4aac2ccc6f94b7c32a5c`. Dynamic dependencies: libc and libm only.
- Limits: fontconfig is disabled, so import logs show benign fontconfig notices. The project does not use `SystemFont`. There is no display server, so no rendered output was produced.

### 24.3 Isolation and disposable data (executed)

- Every engine run used a scratch copy with its own `HOME` and `XDG_DATA_HOME`. No engine was run against `/home/user/Naija/game`, which would write `.godot` caches and `.gd.uid` files.
- No real player save was reachable from this sandbox (earlier search of the user-data locations found none), so none was touched. Fixtures were created in scratch by `save_restart -- write`, which uses the production `SaveService` format.
- Unreadable and blocked saves were simulated with `chmod` on scratch copies only. No real save was corrupted.
- Mutations (the scratch-only edits used in FI-05, FI-08, FI-13, FI-14) were applied to scratch copies, never to the repository.

### 24.4 Save-slot failure injection (executed, scratch)

Expected outcomes were written to `/tmp/naija-harness/fi-expectations.md` before any case ran. Results are generated from `fi-results-final.json` on the final tree.

| Case | Test | Injected condition | Result | Observed |
|---|---|---|---|---|
| FI-00 | return_path | valid original save | PASS | exit 0; PASS: 47 return-path checks; save==orig True; backup None; marker None |
| FI-01 | return_path | no original save | PASS | exit 0; PASS: 47 return-path checks; save None; marker None; backup None |
| FI-02 | return_path | backup path blocked by a directory | PASS | exit 1; msg True; save==orig True; marker None |
| FI-03a | return_path | original save mode 0200 (unreadable) | PASS | exit 1; save==orig True; save bytes original; backup None |
| FI-03b | ui_flow | original save mode 0200 (unreadable) | PASS | exit 1; save==orig True; save bytes original; backup None |
| FI-03c | load_confirmation | original save mode 0200 (unreadable) | PASS | exit 1; save==orig True; save bytes original; backup None |
| FI-04 | all | backup read-back mismatch | NOT TESTED | no injection point without production hooks |
| FI-05 | return_path (scratch mutation) | assertion failure after save changed | PASS | exit 1; injected True; save==orig True; backup None; marker None |
| FI-06 | return_path | original save mode 0400 (not writable) | PASS | exit 1; save==orig True; backup==orig True; marker None; CHECK FAILED: Closing the window while suspended saves the retained session's unsaved progress |
| FI-07a | return_path | recovery backup left from FI-06 | PASS | exit 1; unchanged True; FAIL: a save-slot backup or marker from an earlier run exists: ["user://naija-stage1-save.return-test-backup.json"]. Nothing was changed. Resolve it before reru |
| FI-07b | ui_flow | recovery backup left from FI-06 | PASS | exit 1; unchanged True; FAIL: a backup or marker from an earlier save-slot run exists: ["user://naija-stage1-save.return-test-backup.json"]. Nothing was changed. Resolve it before reru |
| FI-07c | load_confirmation | recovery backup left from FI-06 | PASS | exit 1; unchanged True; FAIL: a backup or marker from an earlier save-slot run exists: ["user://naija-stage1-save.return-test-backup.json"]. Nothing was changed. Resolve it before reru |
| FI-08 | return_path (scratch mutation: restore writes wrong bytes) | restored bytes differ | PASS | exit 1; backup==orig True; save==orig False; marker None |
| FI-09a | return_path | leftover return-path no-save marker | PASS | exit 1; unchanged True; FAIL: a save-slot backup or marker from an earlier run exists: ["user://naija-stage1-save.return-test-no-save.marker"]. Nothing was changed. Resolve it before r |
| FI-09b | ui_flow | leftover return-path no-save marker | PASS | exit 1; unchanged True; FAIL: a backup or marker from an earlier save-slot run exists: ["user://naija-stage1-save.return-test-no-save.marker"]. Nothing was changed. Resolve it before r |
| FI-09c | load_confirmation | leftover return-path no-save marker | PASS | exit 1; unchanged True; FAIL: a backup or marker from an earlier save-slot run exists: ["user://naija-stage1-save.return-test-no-save.marker"]. Nothing was changed. Resolve it before r |
| FI-10 | return_path | SIGKILL after save changed (recovery material left) | PASS | reached True; exit -9; backup==orig True; save==orig False; marker None |
| FI-11a | return_path | after killed run | PASS | exit 1; unchanged True; FAIL: a save-slot backup or marker from an earlier run exists: ["user://naija-stage1-save.return-test-backup.json"]. Nothing was changed. Resolve it before reru |
| FI-11b | ui_flow | after killed run | PASS | exit 1; unchanged True; FAIL: a backup or marker from an earlier save-slot run exists: ["user://naija-stage1-save.return-test-backup.json"]. Nothing was changed. Resolve it before reru |
| FI-11c | load_confirmation | after killed run | PASS | exit 1; unchanged True; FAIL: a backup or marker from an earlier save-slot run exists: ["user://naija-stage1-save.return-test-backup.json"]. Nothing was changed. Resolve it before reru |
| FI-13 | return_path (scratch mutation: hang after save, 8 s watchdog) | hang after save changed | PASS | exit 1; elapsed 8s; watchdog msg True; save==orig True; backup None |
| FI-14 | return_path (scratch mutation: runtime error after save) | GDScript runtime error after save changed | PASS | exit 1; runtime error text True; watchdog True; save==orig True; backup None |

- FI-04 is NOT TESTED. Forcing a read-back mismatch requires a production hook or a fault point in file I/O, which was not added.
- FI-06 exits 1 because the test's own save check fails when the file is not writable. The required restore behaviour still held: the backup was kept with the original bytes.
- FI-10 is a documented limitation (KNOWN_LIMITATION). A SIGKILL cannot be caught, so recovery material stays on disk. The next run refuses (FI-11), which is the designed behaviour.
- Baseline on HEAD (`d788e5f`, before the fix): `ui_flow_headless` and `load_confirmation_headless` both exited 0 with an unreadable save (mode 0200). The save was overwritten with 0 bytes (sha256 `e3b0c442…`, the hash of empty input), and the original bytes were not recoverable. See `fi-results-base.json`.

### 24.5 Regression table (final tree, executed)

Each run used a fresh scratch copy of the working tree. "Writes saves" refers to scratch only.

| Suite | Command | Exit | Result | Writes saves | Isolation |
|---|---|---|---|---|---|
| player_movement | `--script res://tests/player_movement.gd` | 0 | PASS 4 checks | No | scratch |
| performance_metrics | same pattern | 0 | PASS 11 checks | No | scratch |
| regional_handoff | same pattern | 0 | PASS 41 checks | No | scratch |
| regional_visual_profiles | same pattern | 0 | PASS 43 checks | No | scratch |
| persistence_notice | same pattern | 0 | PASS 11 checks | No | scratch |
| session_policy | same pattern | 0 | "all checks passed" (no count printed) | No | scratch |
| domain_smoke | same pattern | 1 | FAIL 1 of 93 (academic fixture, 24.7). The total varies 91–93 between runs because household generation is random (`household_factory.gd` uses `randi_range`). | Scratch test save | scratch |
| main scene | `--quit` | 0 | 0 script errors | No | scratch |
| GDScript check-only | 41 `.gd` files | 0 | 41 of 41 exit 0 | No | scratch |
| save_restart write | `-- write` | 0 | writes restart file | Scratch | scratch |
| save_restart read | `-- read` | 1 | 2 errors: academic result, attendance and inventory (academic fixture, 24.7) | Scratch | scratch |
| return_path ×3 | `res://tests/return_path.gd` | 0 ×3 | PASS 47 each; save unchanged; no backup or marker left | Scratch | scratch, consecutive |
| ui_flow_headless ×3 | `res://tests/ui_flow_headless.gd` | 0 ×3 | PASS 57 each; 0 script errors; save unchanged | Scratch | scratch, consecutive |
| load_confirmation_headless ×1 | `res://tests/load_confirmation_headless.gd` | 0 | PASS 104; the one `Parse JSON failed` line is the test's deliberate invalid-JSON case | Scratch | scratch, fresh |
| npm test | `npm test` (in-process) | 0 | 1074 tests, 1037 pass, 0 fail, 37 skipped | No | repo `node_modules` |
| npm run lint | `npm run lint` | 1 | 29 errors (51 at HEAD) | No | repo |
| git diff --check | | 0 | clean | No | repo |

Not exercised in this task: rendered UI, physical keyboard or mouse input, a live server, and deployed Stage 28 services. These are separate claims in section G of the final report.

### 24.6 Defects and changes in this task

| ID | Finding | Change | Status | Evidence |
|---|---|---|---|---|
| SAVE-1 | `ui_flow_headless` and `load_confirmation_headless` read the original with `get_file_as_bytes`, which returns empty on failure. An unreadable save was backed up as empty and then overwritten with 0 bytes. | Read the original with `FileAccess.open(READ)`; a null handle returns false before any write. | FIXED_VERIFIED (scratch) | FI-03b/c reproduced on HEAD and PASS after the fix |
| SAVE-2 | The restore path read the backup with `get_file_as_bytes`. An unreadable backup would restore as empty bytes. | Same explicit-open change in `_restore_save`, failing before the save is opened for write. | FIXED_UNVERIFIED | Code and parse only; no injection of an unreadable backup |
| SAVE-DOB-1 | `load_dictionary` kept JSON-parsed floats in `date_of_birth`, so a saved DOB did not equal the original integer dictionary. | `_date_with_integer_fields` converts only `year`, `month`, `day` to int. | FIXED_VERIFIED | `domain_smoke` DOB check passes; probe showed equality |
| SCHED-1 | Catalog weekday lists are JSON floats, and `Array.has(int)` does not match `0.0`. `schedule_for_day` and `school_days_of_week` never matched, so no lesson was ever scheduled. The lesson prompt, class activity display, and missed-period marking never ran. | `_has_weekday` compares as integers at the two numeric call sites in `education_service.gd`. | FIXED_VERIFIED (engine). Behaviour change: lessons now appear at scheduled times. | Probe: Mathematics at 07:50 and 08:00; 6 entries on day 1; none on day 6. Rendered UI not exercised. |
| TEST-FX-1 | `domain_smoke` checked the next lesson at 07:50 (English is not in its window until 08:30) and expected the name `English`, while the catalog name is `English Language`. | Query at 08:30 and expect `English Language`. The assertion is stricter than before. | FIXED_VERIFIED | `domain_smoke` no longer reports the timetable check |
| ACT-1 | `toggle_first_person` and `jump` were used in code but absent from `project.godot`, so Godot logged `InputMap action doesn't exist` on every run. | Added `jump` (Space) and `toggle_first_person` (V). Default bindings chosen here; confirm with the owner. | FIXED_VERIFIED (input map). Not verified with physical input. | Probe: both actions exist with those keys; the errors no longer appear in any final log |
| TSCN-1 | `world_3d.tscn` header has `load_steps=6` for 5 external and 4 sub-resources. | Not edited. Godot 4.7.2 neither reads nor writes `load_steps` in its text format (grep of `scene/resources/resource_format_text.cpp` finds no match). The scene loads and re-saves without error. | NOT AN ISSUE on 4.7.2 (inert metadata) | Source grep; load and re-save probe |
| LINT-1 | 51 errors at HEAD. | Removed 22 unused import specifiers across 12 files in `services/world-api/src`. | PARTIALLY FIXED: 29 remain, OPEN | `npm run lint` 51 to 29; `npm test` 0 fail; `git diff --check` 0 |

Not changed, per scope: `time_of_day.gd` (TOD-1), regional catalogs and generators, `ng:state:fc`, Stage 28 auth and persistence, Stage 30 access, the modal-blocking implementation, dependencies, lint rules.

> Note (2026-10-11, section 25): the TSCN-1 entry in the table above is superseded. The `world_3d.tscn` header is
> now `load_steps=10`, which matches its 5 external and 4 sub-resources plus one, and the status is FIXED_VERIFIED
> (cosmetic). See 25.10.

### 24.7 Open items (not fixed)

- **Academic fixture (TEST-FX-2, OPEN).** `domain_smoke` ("Save/load restores academic data") and `save_restart --read` ("academic result", "attendance and inventory") write the legacy `academic_scores` field and attendance directly. Production never writes those fields. On load they are rebuilt from the education record (`sync_legacy_character`, `legacy_academic_scores`). A gameplay probe showed the production path keeps the data: recording a Mathematics result moved the score 72 to 84, with one attendance record, and both survived a save and load. The test needs a decision on whether to write through the education record API. It was not changed, to avoid choosing its contract.
- **Return-path timing (TEST-6, TEST-7, TEST-8, OPEN).** Not reproduced in 3 consecutive return_path runs or the 22-case matrix. A test-local clock freeze would change the test's timing model, so it needs review and was not made.
- **Domain-check denominator (TEST-11, OPEN, Low).** The total of `domain_smoke` checks varies by run (91, 92, 93) because the generated households differ. The failing set does not vary.
- **TOD-1** (time-of-day lighting ownership, OPEN, design). **F9** (Kaduna `semi-arid` vs `tropical`), **GEN-1** (`ng:state:fc` mapping), **GEO-1** (FC audit row), unchanged. Excluded by scope.
- **LINT-1 remainder (OPEN).** 24 unused variables and 5 `no-explicit-any` (in `database/connection.ts`). These need API or design decisions.
- Not run: `ui_flow` with rendered UI, physical input, and any live backend.

### 24.8 Consolidated issue register (current)

> Superseded by section 25.12 (2026-10-11). The statuses below are those at the section 24 verification. Kept for history.

| ID | Component | Finding | Severity | Status | Evidence | Blocks release |
|---|---|---|---|---|---|---|
| REC-1 | Git | Local branch was not at the recovered commit; no upstream | High | FIXED_VERIFIED | 23.2; `git status`, ancestry | No |
| ENV-1 | Engine | No official Godot binary reachable | High | FIXED_VERIFIED (custom build) | 24.2 | Label as custom |
| TEST-1 | return_path restore | Backup deleted even if original write fails | High | FIXED_VERIFIED | FI-06, FI-08 | No |
| TEST-2 | return_path backup | Backup not read back and compared | High | FIXED_UNVERIFIED | Read-back mismatch not injected (FI-04 NOT TESTED) | Until FI-04 is run |
| TEST-3 | return_path restore | Restore not compared to original bytes | High | FIXED_VERIFIED | FI-08 | No |
| TEST-4 | return_path marker | No marker for the no-save case | Medium | FIXED_VERIFIED | FI-01, FI-09a | No |
| TEST-5 | Save-slot refusal | Refusal did not cover other tests' files | Medium | FIXED_VERIFIED | FI-07, FI-09, FI-11 (all three tests refuse) | No |
| TEST-6 | return_path clock | Autosave and clock advance during test | Medium | OPEN | 23.5; not reproduced | No |
| TEST-7 | return_path timing | `resume_step <= 1` depends on frame delta | Medium | OPEN | 23.5; not reproduced | No |
| TEST-8 | return_path timing | `moved > 1.0` depends on physics stepping | Low | OPEN | 23.5 | No |
| TEST-9 | Crash recovery | Hard kill leaves recovery material; next run refuses | Medium | KNOWN_LIMITATION (verified) | FI-10, FI-11 | No |
| TEST-10 | Runtime error path | Restore depends on watchdog | Low | FIXED_VERIFIED (watchdog path) | FI-13, FI-14 | No |
| TEST-11 | domain_smoke | Check total varies by run (randomised households) | Low | OPEN | 24.5 | No |
| SAVE-1 | UI-flow and load-confirmation | Unreadable save backed up as empty and overwritten | High (data loss) | FIXED_VERIFIED | FI-03b/c (base reproduced) | No |
| SAVE-2 | Restore read of backup | Unreadable backup restored as empty | Medium | FIXED_UNVERIFIED | Code and parse | No |
| SAVE-DOB-1 | Save load, DOB | Float fields broke equality | Medium | FIXED_VERIFIED | `domain_smoke` DOB check | No |
| SCHED-1 | Education schedule | Weekday lists never matched; no lessons ever scheduled | High (gameplay) | FIXED_VERIFIED (engine) | Probe; `domain_smoke` timetable checks pass | Rendered UI not verified |
| TEST-FX-1 | domain_smoke timetable check | Wrong clock time and subject name in fixture | Medium | FIXED_VERIFIED | `domain_smoke` | No |
| TEST-FX-2 | Academic fixture (domain_smoke, save_restart) | Writes legacy field directly | Medium | OPEN (test decision) | 24.7; production path verified | Yes, for those two suites |
| TOD-1 | time_of_day lighting | Lookup misses light and environment | Medium | OPEN (design) | 23.8 | No (inert today) |
| F9 | Kaduna climate | `semi-arid` vs `tropical` | Low | OPEN (excluded data) | 23.9 | No |
| GEN-1 | Generators | `ng:state:fc` vs `ng:fct:abuja` | Low | OPEN (excluded) | 23.9 | No |
| GEO-1 | Audit history | FC row may be stale | Low | NOT_VERIFIED | 23.9 | No |
| ACT-1 | Input actions | `jump` and `toggle_first_person` undefined | Low | FIXED_VERIFIED (input map) | Probe; logs clean | No |
| TSCN-1 | world_3d.tscn | `load_steps` header | Low | NOT AN ISSUE (4.7.2) | Source grep; re-save | No |
| LINT-1 | Lint | 51 errors | Low | PARTIALLY FIXED (29 OPEN) | `npm run lint` | No |
| SMOKE-1 | domain_smoke | Failures in the earlier run | Medium | OPEN (1 remaining, TEST-FX-2) | 24.5 | Yes, until TEST-FX-2 |
| SR-1 | save_restart --read | Two errors, same cause as TEST-FX-2 | Medium | OPEN (TEST-FX-2) | 24.5 | Yes, until TEST-FX-2 |
| SEC-1 | Secrets | Placeholder Postgres URLs only | Info | VERIFIED NOT AN ISSUE (static) | 23.10 | No |

### 24.9 Readiness by claim (section G)

- Repository recovery: RECOVERY_COMPLETE (23.2).
- Save safety: VERIFIED IN SCRATCH on this engine for the refusal and restore paths in 24.4, except FI-04 (NOT TESTED), SAVE-2 (code only), and the hard-kill limitation (documented).
- Core engine stability: all non-save suites pass; `domain_smoke` has one known fixture failure. This is not a full playthrough.
- Gameplay: school lessons are now scheduled (engine probe). Input actions exist. Neither is verified with rendered UI or physical input.
- Stage 29: OPEN. It closes only with rendered validation, which has not been exercised.
- Stage 28: OPEN. It closes only with the production criteria. Not re-audited here.
- Production: NOT READY.

### 24.10 Single most important blocker

No rendered UI or physical input has been exercised on this machine: there is no display server and no GPU. Stage 29 cannot close without that evidence, and the lesson and control changes in this task are not visually confirmed.

## 25. Save-test recovery, input and Load verification, and reconciliation (2026-10-11)

### 25.1 Result

- Repository: history verified and not rewritten. Work is committed on `arena/00cdea0e-naija` only, as a fast-forward (25.2).
- Engine: a custom build of Godot 4.7.2-stable from the tag source, not the official binary. Headless only. There is no display server and no GPU, so rendered output, real key presses, mouse input and window close are BLOCKED (25.3).
- Save-writing tests: `return_path`, `ui_flow_headless`, `load_confirmation_headless`, `domain_smoke` and `save_restart` write through the recovery guard in `game/tests/support/save_slot_guard.gd` (25.4). Failure-injection matrix in scratch: 41 of 41 on the final guard (runs f4a, f4b, f4c, f5a). Real-save runs on the final guard: t10, t11, t12 and t13, consistent.
- Two guard defects were found in this round and fixed (25.5): a race in stale-file cleanup that could make two concurrent runs both refuse, and a refusal message missing the "nothing was changed" statement. One comment that described the cleanup wrongly was also corrected.
- Input: F3 kept for the world switch, with no binding change (25.8). A configured-binding check was added: 23 of 23 checks pass. `ui_accept` and `jump` both use Space. That is an open design question, not a test failure.
- Continue and in-game Load: verified headless (25.9). Rendered and physical-key checks remain BLOCKED.
- TSCN-1 (`world_3d.tscn` `load_steps`): FIXED_VERIFIED, cosmetic only (25.10).
- Stage 29: OPEN. Stage 28: OPEN. Production: NOT READY.

### 25.2 Repository state

- Start: HEAD `a627aa4`, equal to `origin/arena/00cdea0e-naija`. Local `main` = `44483b4` = `origin/main`.
- `origin/arena/f48b6f8e-naija` (`02dd67c`) has unrelated history. It is preserved and was not merged.
- Recovery backup outside the repository: `/tmp/naija-recovery-backup-20261011142806/` (may not persist between sessions).
- Changes in this round, committed in four groups (25.12 lists the files): guard and save tests; input check; scene header; this audit.
- No save, backup or lock file was created in the repository. Every save-writing run used a scratch copy under `/tmp/naija-scratch` with its own `HOME` and `XDG_DATA_HOME`. No real user save was reachable from the sandbox.
- Ignored artifact `services/world-api/dist/` existed before this round. It is not staged.

### 25.3 Engine and display (executed, with limits)

- Binary: `/tmp/godot-src/src/bin/godot.linuxbsd.editor.x86_64`, built with SCons from the `4.7.2-stable` tag source (source commit `ed1daf0`). It reports `4.7.2.stable.custom_build.ed1daf0bf`. sha256 `b7052e20…`. A scratch-only pkg-config shim was used for the build.
- Not verified: the official signed release binary and its checksum. The release-assets host is not on the sandbox allow-list. Every result in this section is a custom-build result.
- Headless only (`--headless`). There is no display server and no GPU. Rendered output, real keyboard and mouse input, and the window-close path are BLOCKED.
- "Simulated input" in `ui_flow_headless` and `load_confirmation_headless` means events injected through the engine. It does not mean physical key presses.

### 25.4 Save-test recovery protocol (design and limits)

Applies to `return_path`, `ui_flow_headless`, `load_confirmation_headless`, `domain_smoke` and `save_restart`. The tests that write the save slot call the guard. The production save code is not changed.

Files, all in `user://`:

- Lock: `naija-save-test.lock.d/owner.json` (run id, pid, test name). The lock directory is created with `make_dir`, which only one caller can succeed at.
- Manifest: `naija-save-test-recovery.json` (schema 1). It holds the run id, the slot path, whether a save existed, the original hash, the last observed hash, and the state.
- Backup: `naija-save-test-backup.bin`. A byte copy of the original save, written and read back equal before the slot is touched.

States, in order: `locked` (lock and manifest written, slot not touched), `backed_up` (backup verified, the test may change the slot), `restoring` (the backup is authoritative from here), `restored` (the slot verified equal to the original, or absent if none existed). Removal order: backup, then manifest, then lock.

Invariants:

1. The slot is changed only in state `backed_up`, and only after the backup has been read back and matched.
2. The original bytes are written back and read back before any protocol file is removed. A mismatch keeps the backup.
3. A save that did not exist before the run is removed on recovery only when the manifest proves the test created it (K2).
4. A refusal happens before any change. Every refusal message says so, or says that the save was not changed.

Refusal at start (nothing changed): legacy artifacts from an earlier version; a backup with no manifest (provenance unknown); a manifest that refers to another slot; an unknown state; an unreadable or inconsistent manifest; a manifest whose pid is alive or cannot be checked; a lock whose owner record is unreadable; a lock held by a live pid; an unreadable save.

Recovery at start (only when provable): a stale lock whose owner is dead is removed. A manifest in `backed_up` or `restoring` with a matching backup restores the original, verifies it, and removes the protocol files.

Limits: a hard kill is recovered only when the manifest proves the state. Unprovable states refuse and need a human to review them. The guard protects test saves only. The sandbox cannot reach real user data, so none was touched.

### 25.5 Failure-injection matrix (scratch only)

Method: `/tmp/naija-harness/s29/s29_fi.py`, 41 cases, each in its own scratch copy with its own `HOME` and `XDG_DATA_HOME`. Expectations are written in the harness before each case runs. A refusal counts as PASS only when its expected message is present. Fault injection uses a test-only subclass (`faulty_guard.gd`) and is not committed. The mutation and fault-injection harness stays in `/tmp/naija-harness/s29`.

Runs and results:

| Run | Guard state | Result |
|---|---|---|
| r1 | first version (`669cf6f3b305`) | 40 of 41. K2 expectation listed a backup, but the guard writes a backup only when the original save exists. The expectation was corrected to match the code. |
| r2 | first version | 40 of 41. C1 (two concurrent starts): both runs refused in trial 1. This is GUARD-RACE-1 below. |
| r3 | first version | 41 of 41 |
| r4 | first version | 40 of 41. C1 refusal message wording checked against an older, stricter check. Both runs behaved correctly: one holder in every trial. |
| r5 to r8 | `841857e007b2` (before the ordering fix) | 41 of 41 each |
| f3a, f3c | after the ordering fix, before the message fix | 41 of 41 each |
| f3b | after the ordering fix, before the message fix | 40 of 41. C1 trial 2: the losing run's message did not say "nothing was changed". This is C1-MSG-1 below. |
| f4a, f4b, f4c | with the message fix (before the comment correction) | 41 of 41 each |
| f5a | final file (`0bfbf7d580c2`, after the comment correction) | 41 of 41 |

GUARD-RACE-1 (found in r2, fixed in this round):

- Observed: r2, C1 trial 1. Both concurrent runs refused, with the save unchanged and no protocol files left.
- Cause: the first version removed leftover `owner.json.tmp` and `manifest.json.tmp` files without checking the lock. A second starter could therefore delete a live holder's temporary file during its write. The holder's rename then failed and it refused, so neither run proceeded.
- Reproduced with the first version: 3 of 40 trials under CPU load. Both runs refused, with messages such as "Could not write the lock owner. Nothing was changed." and "Could not record the backed-up state." Under the same load, the current version gave 60 of 60 trials with exactly one holder.
- Fix: the owner temporary file is no longer removed. The manifest temporary file is removed only when no lock is held. The check order also changed: the temporary file is checked first, then the lock. A holder creates its lock before any temporary file, so a temporary file seen first implies the lock is seen second. Before this change, the `841857` version had a narrow window in which this could still happen. That window was reasoned from the code, not observed. The version with the fix passed 120 of 120 concurrent trials in the earlier run on `841857` (not on the final file).

C1-MSG-1 (found in f3b, fixed in this round):

- Observed: a losing run was refused with "Refusing to run: another save test (pid N) holds the lock." This path returns before any change, but the message did not say so.
- Fix: the message now ends with "Nothing was changed." The C1 check is unchanged. It requires one holder, and every refusal that reports a lock refusal with "Nothing was changed".

Note on the C1 check: its wording was changed after r2 and r4. The behaviour recorded in those runs is listed above. The current wording is the one used in f3b through f5a.

Matrix table (final run f4a, 41 cases; expected and actual values from the harness):

| Case | Injected condition | Expected | Actual | Result |
|---|---|---|---|---|
| N1_orig_no_change | Pre-existing save, test makes no change. Save byte-identical, protocol files removed. | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | PASS |
| N2_orig_test_write | Pre-existing save; test overwrites it. Original restored byte for byte. | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | PASS |
| N3_none_test_write | No save at start; test creates one. The created save is removed, protocol files removed. | rc=0, begin=ok, finish=ok, save=changed (ABSENT), protocol=none, recovered=no | rc=0, begin=ok, finish=ok, save=changed (ABSENT), protocol=none, recovered=no | PASS |
| N4_none_no_write | No save at start and none written. Nothing left behind. | rc=0, begin=ok, finish=ok, save=changed (ABSENT), protocol=none, recovered=no | rc=0, begin=ok, finish=ok, save=changed (ABSENT), protocol=none, recovered=no | PASS |
| N5_orig_test_delete | Test deletes the pre-existing save and observes the deletion. Original restored. | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | PASS |
| N6_empty_original | A zero-byte save counts as existing (not absent) and is restored as zero bytes. | rc=0, begin=ok, finish=ok, save=changed (EMPTY), protocol=none, recovered=no | rc=0, begin=ok, finish=ok, save=changed (e3b0c442), protocol=none, recovered=no | PASS |
| N7_three_clean_runs | Three consecutive clean runs on the same data dir. Each restores the original; no residue between runs. | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | PASS |
| F1_backup_creation_fail | Backup write fails. Save untouched; the test does not start; protocol files removed. | rc=3, begin=refused, finish=refused, save=original, protocol=none, recovered=no | rc=3, begin=refused, finish=refused, save=original, protocol=none, recovered=no | PASS |
| F2_backup_readback_mismatch | Backup reads back different bytes. Save untouched; the bad backup is removed because the save was never changed. | rc=3, begin=refused, finish=refused, save=original, protocol=none, recovered=no | rc=3, begin=refused, finish=refused, save=original, protocol=none, recovered=no | PASS |
| F3_restore_write_fail_after_test_write | Test save written, then the restore write fails. Backup and manifest kept. The next run restores the original. | rc=4, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=4, begin=ok, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| F4_restore_byte_mismatch | Restore writes wrong bytes; the read-back check fails. Backup kept. The next run restores the original. | rc=4, begin=refused, finish=refused, save=changed (WRONG), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=4, begin=ok, finish=refused, save=changed (e2247e2d), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| K1_kill_after_test_write | SIGKILL after the test write. Next run restores the original; a third run finds nothing to recover. | rc=-9, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=-9, begin=ok, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| K2_kill_after_test_write_no_save | SIGKILL after the test created a save that did not exist before. Next run removes it (proven test-created). | rc=-9, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json'], recovered=no | rc=-9, begin=ok, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json'], recovered=no | PASS |
| K3_kill_during_restore_write | SIGKILL just before the restore write. Save still the test content; next run restores. | rc=-9, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=-9, begin=ok, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| K4_kill_after_restore_before_cleanup | SIGKILL after the verified restore and the 'restored' record, before cleanup. Next run only finishes cleanup. | rc=-9, begin=refused, finish=refused, save=original, protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=-9, begin=ok, finish=refused, save=original, protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| K5_kill_after_begin_orig | SIGKILL after backup verified, before any test write. Next run recovers without change. | rc=-9, begin=refused, finish=refused, save=original, protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=-9, begin=ok, finish=refused, save=original, protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| K6_kill_after_begin_no_save | SIGKILL after the manifest was written, no save existed. Next run recovers without creating or removing anything. | rc=-9, begin=refused, finish=refused, save=changed (ABSENT), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json'], recovered=no | rc=-9, begin=ok, finish=refused, save=changed (ABSENT), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json'], recovered=no | PASS |
| K7_kill_during_recovery | Recovery itself is killed during its restore write. A further run completes the recovery. | rc=-9, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=-9, begin=ok, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| K8_kill_during_recovery_cleanup | Recovery is killed after its restore, before cleanup. A further run finishes the cleanup. | rc=-9, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=-9, begin=ok, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L1_stale_lock_only | Lock with a dead owner and no manifest. Removed; the save is untouched. | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=yes | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=yes | PASS |
| L2_partial_backup_locked_state | Dead run stopped while writing its backup (state locked). The slot is provably the original; the partial backup is removed. | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=yes | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=yes | PASS |
| L3_legacy_artifact | Pre-protocol backup present. Refused; the legacy file is kept for human review. | rc=3, begin=refused, finish=refused, save=original, protocol=none, recovered=no | rc=3, begin=refused, finish=refused, save=original, protocol=none, recovered=no | PASS |
| L4_backup_without_manifest | Backup with no manifest: provenance unknown. Refused; backup kept. | rc=3, begin=refused, finish=refused, save=original, protocol=['naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=original, protocol=['naija-save-test-backup.bin'], recovered=no | PASS |
| L5_manifest_without_lock | Manifest with no lock. Refused; nothing changed. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L6_lock_run_id_mismatch | Lock belongs to a different run id than the manifest. Refused; all files kept. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L7_manifest_other_slot_path | Manifest names a different save path. Refused. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L8_unknown_schema | Manifest schema 2 is unknown. Refused. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L9_invalid_json_manifest | Manifest is not valid JSON. Refused. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L10_incomplete_manifest | Manifest is missing save_existed (incomplete metadata). Refused. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L11_lock_dir_without_owner | Lock directory with no owner file. Refused (may be a run starting now); nothing removed. | rc=3, begin=refused, finish=refused, save=original, protocol=['naija-save-test.lock.d'], recovered=no | rc=3, begin=refused, finish=refused, save=original, protocol=['naija-save-test.lock.d'], recovered=no | PASS |
| L12_live_lock_holder | Lock owned by a live process. Refused; lock kept. | rc=3, begin=refused, finish=refused, save=original, protocol=['naija-save-test.lock.d'], recovered=no | rc=3, begin=refused, finish=refused, save=original, protocol=['naija-save-test.lock.d'], recovered=no | PASS |
| L13_unknown_content_backed_up | Save holds content this run never recorded. Refused; that content and the backup are kept. | rc=3, begin=refused, finish=refused, save=changed (UNEXPECT), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (f0927891), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L14_unknown_file_where_none_expected | No save existed at start, but an unknown file is at the path. Not deleted; refused. | rc=3, begin=refused, finish=refused, save=changed (UNEXPECT), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (f0927891), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json'], recovered=no | PASS |
| L15_backup_mismatch_backed_up | Backup does not match the recorded hash. Refused; backup kept. | rc=3, begin=refused, finish=refused, save=original, protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=original, protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L16_restoring_without_backup | Restore was recorded but the backup is gone. Refused; the test save is kept. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json'], recovered=no | PASS |
| L17_manifest_from_live_pid | Manifest names a live process. Refused rather than treated as dead. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L18_manifest_pid_unprovable | Pid 1 cannot be shown dead (no permission to signal it, or it is alive). Refused. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L19_stray_temp_file | A temp file from an interrupted atomic write is not authoritative. It is removed; the run proceeds. | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | rc=0, begin=ok, finish=ok, save=original, protocol=none, recovered=no | PASS |
| L20_restored_state_but_slot_wrong | Manifest says restored, but the slot is not the original. Refused. | rc=3, begin=refused, finish=refused, save=changed (TEST), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | rc=3, begin=refused, finish=refused, save=changed (94ae336c), protocol=['naija-save-test.lock.d', 'naija-save-test-recovery.json', 'naija-save-test-backup.bin'], recovered=no | PASS |
| L21_unreadable_save | Save exists but cannot be read. Refused before any change. | rc=3, begin=refused, finish=refused, save=none, protocol=none, recovered=no | rc=3, begin=refused, finish=refused, save=changed (UNREADAB), protocol=none, recovered=no | PASS |
| C1_two_runs_overlap | Two drivers start at once on the same data dir. The first holds the lock for 1.5 s; the second must refuse. Repeated 3 times. | per trial: exactly one driver begins, the other is refused with a lock refusal that says nothing was changed; save=original; protocol=none | t1: begun=1 refused=1 save=original protocol=none; t2: begun=1 refused=1 save=original protocol=none; t3: begun=1 refused=1 save=original protocol=none | PASS |

### 25.6 Earlier cases from the older harness (`fi.py`), re-run on the final guard

The older harness (`/tmp/naija-harness/fi_cases.py`) was written for the protocol before the guard migration. Its FI-04 and FI-07/09/11 cases were re-run in fresh scratch copies. Run tag `final3`, with a copy of the final `game/` folder. Its FI-06 and FI-09 steps were re-run. Its FI-10/11 step cannot run, as explained below.

| Old case | Re-run result | Classification |
|---|---|---|
| FI-04 backup read-back mismatch | NOT TESTED in the old harness, because there is no production fault hook | Covered in scratch by s29 F2: a test-only subclass, through the production read-back check. PASS in f4a, f4b, f4c, f5a. |
| FI-06 original save mode 0400 (not writable) | Exit 1. Save unchanged. No backup, no marker. The run's own check fails, because the injected read-only save cannot be written. | Safety holds. The old expectation "backup kept" is superseded. The restore was verified identical, so the protocol files are removed, as in s29 F2. |
| FI-07 refusal after the FI-06 residue | No residue was produced. return_path exits 1 on its own check. ui_flow and load_confirmation exit 0. Save unchanged in all three. | Superseded as written. The refusal intent was re-tested with a manufactured residue (below). |
| Refusal intent, manufactured residue | Backup file present, no manifest, no lock. All three tests exit 1 with "a backup exists without a recovery manifest". Save and backup unchanged. | PASS (`residual_refusal.py`, final3). |
| FI-09 leftover legacy no-save marker | Exit 1 in all three tests, "legacy test artifacts" refusal. Marker and save unchanged. | PASS |
| FI-10/11 SIGKILL, then refusal | The step cannot run, because the mutation anchor is absent after the migration. | Superseded. The design now recovers provable kill states: s29 K1 and K2 PASS. Refusal remains for unprovable states: s29 L4, L11 and L18 PASS. |
| FI-08 restore writes wrong bytes | Not re-run in the old harness | Equivalent s29 F4: PASS in f4a, f4b, f4c, f5a. |
| FI-13 watchdog, FI-14 runtime error | Not re-run in this round | No s29 equivalent. Verified before the guard migration only. Status in 25.12 is FIXED_UNVERIFIED on the current code. |

### 25.7 Real save-writing runs (scratch, final tree)

Runs t10, t11, t12 and t13, each with a fresh tag. t13 ran on the final file, after the last comment change. Earlier runs t7 to t9 are consistent with them.

| Test (suite) | Result in each run (t10 to t13) |
|---|---|
| return_path a, b, c (seeded) | exit 0, 47 checks, 0 script errors, save unchanged |
| return_path d (no save) | exit 0, 47 checks, 0 script errors |
| ui_flow a, b, c (seeded) | exit 0, 57 checks, 0 script errors, save unchanged |
| ui_flow d (no save) | exit 0, 57 checks, 0 script errors |
| load_confirmation a (seeded) | exit 0, 104 checks, 0 script errors, save unchanged |
| load_confirmation b (no save) | exit 0, 104 checks, 0 script errors |
| domain_smoke | exit 1 in every run, 1 failing check: "Save/load restores academic data". The total was 92 or 93 checks in t10 to t12 (TEST-11). This is the academic fixture issue, TEST-FX-2. |
| save_restart write | exit 0 |
| save_restart read | exit 1, two errors: "academic result" and "attendance and inventory". Same cause as TEST-FX-2. |

- UI-flow determinism: three consecutive equivalent runs (t10, t11, t12), and a fourth (t13). Exit 0, 57 checks each, no script errors, no autosave messages in the logs checked (ui_flow a and return_path a, t10 to t12), and no protocol file left behind.
- In-game Load confirmation: exit 0 in each of the four runs.
- Save touched: scratch only. The seeded runs restored the original bytes.

### 25.8 Input bindings and the world-switch key

Check: `game/tests/input_bindings_headless.gd` (new). It checks:

1. The configured key for `toggle_3d_mode` (F3), `jump` (Space) and `toggle_first_person` (V), read from `project.godot` and from the InputMap.
2. Every literal action name used in `game/**/*.gd` resolves to the InputMap, either from `project.godot` or from a `_bind_action("name", ...)` call.
3. No key conflicts among the non-`ui_` actions in `project.godot`.

Result: PASS, 23 of 23 checks. 10 action names are referenced: 4 are defined in `project.godot`, and 6 are bound in code by `_bind_action` in `scripts/prototype_game.gd` (`_setup_input_actions`, lines 574 to 580: the four move actions, `run` and `interact`). These are not defects.

Mutation checks (scratch only): removing the `jump` binding gives exit 1 with 2 of 22 checks failing. Changing F3 to another key (physical 4194337) gives exit 1 with 1 of 23 failing.

Decision on F3 versus F11 (from evidence only):

- `c50356d` (Stage 24) bound `toggle_3d_mode` to F11 (physical 4194342).
- `cd1703c` (2026-10-11) standardised the key on F3 (physical 4194334). That commit states that no other runtime action uses F3 or F11, and that no F11 alias is kept.
- The documents refer to F3: `ADVANCED_3D_WORLD_ARCHITECTURE.md:40,74`; `STAGE_24_MULTIPLAYER_INTEGRATION_PLAN.md:30,32,51,72`; `STAGE_25_PLATFORM_AUDIT.md:119,185,193`; `scene_switcher.gd:33`.
- Decision: keep F3, with no binding change. This task has no requirement to change it. The conflict check and the configured-binding check are both kept.
- Not verified: a physical F3 press. The `ui_flow` steps 5 and 6 use an injected F3 event. This is BLOCKED by the lack of a display.

Action references (re-checked on the final tree):

- `jump`: `game/3d_world/scripts/character_3d.gd:48` (`Input.is_action_just_pressed("jump")`), defined in `project.godot` line 32.
- `toggle_first_person`: `game/3d_world/scripts/camera_3d_controller.gd:46`, defined in `project.godot` line 36.
- The check header notes that `jump` and `toggle_first_person` are defaults the owner has not yet confirmed.

Open design question (not a test failure, no change made): `ui_accept` uses Space, the same key as `jump`. The intended behaviour is not established, so no binding was changed. The owner needs to decide.

### 25.9 Continue and in-game Load

Continue (start screen), `ui_flow_headless` steps 1 and 9:

- With no save, there is no "Continue saved life" button.
- With a save, the button is offered. Pressing it starts play with the saved character, restores the saved money, and does not open character creation.

In-game Load (save menu), `load_confirmation_headless`, sections A to H, 104 checks, all PASS:

- A: the configured key, read from project settings and from the InputMap before the scene starts.
- B: start a new life, save known values, then add unsaved values.
- C: F11 does nothing. F3 switches to 3D and back. (Injected events, not physical keys.)
- D: Cancel leaves everything unchanged.
- E: repeated Load and Cancel cycles add nothing.
- F: Confirm replaces the session with the saved copy.
- G: failed loads leave the active session intact and usable.
- H: save-service validation. A missing character key, a missing clock key and a non-object character are each rejected without returning a character.

The confirmation dialog ("Load and discard progress" / "Cancel", from `cd1703c`) is kept.

Not verified: the rendered dialog, real key presses, and mouse clicks on the modal. All BLOCKED by the lack of a display.

### 25.10 Defects and changes in this round

| ID | Change | Evidence |
|---|---|---|
| TSCN-1 | `game/3d_world/scenes/world_3d.tscn` line 1: `load_steps=6` changed to `load_steps=10`. The count is 5 external resources, 4 sub-resources and 1 (the scene itself). | Probe `tscn_probe.gd` (scratch) with the custom build: loads and instantiates with 6 children, before and after. Regression run g5 and g6: PASS. The header change has no behaviour effect. FIXED_VERIFIED (cosmetic). The earlier NOT AN ISSUE entry in 24.6 and 24.8 is superseded. |
| GUARD-RACE-1 | Stale-file cleanup in `save_slot_guard.gd`: owner temporary file no longer removed; manifest temporary file removed only when no lock is held; the temporary file is checked before the lock. | 25.5. Old version 3 of 40 stressed failures; current version 60 of 60 stressed trials with one holder. |
| C1-MSG-1 | Losing run's refusal message now ends with "Nothing was changed." | f3b failure, then f4a, f4b, f4c, f5a: 41 of 41. |
| Guard comment | Header comment corrected: a leftover manifest temporary file is removed only when no lock is held, and is never read. | Comment only. Matrix f5a, regression g6 and real run t13 ran on the final file. |
| INPUT-1 | New test `game/tests/input_bindings_headless.gd`. | 23 of 23. Mutation checks in scratch: exit 1 each. |
| ACT-1 | `jump` and `toggle_first_person` are defined in `project.godot`. No change. | 25.8 references re-checked. |
| TEST-6, TEST-7 | No change. Not reproduced, and no failure occurred. No test-local control was added. | 28 real return_path runs (t7 to t13), all exit 0 with 47 checks. 16 of them (t10 to t13) after the last behavioural change to the guard. |
| TEST-10 | No change. Status lowered to FIXED_UNVERIFIED on the current code, because its evidence predates the guard migration. | 25.6. |

### 25.11 Regression (final tree)

Node (on the final tree, rerun at the end of this round):

- `npm test`: 1074 tests, 1037 pass, 0 fail, 37 skipped, 0 todo. Exit 0. Baseline 1074 / 1037 / 0 / 37 unchanged.
- `npm run lint`: 29 problems (29 errors, 0 warnings). Exit 1. Same as the baseline after the previous mission: no change this round.
- `git diff --check`: clean.

Godot (run g6, final guard and final files, fresh scratch copy):

| Suite | Result |
|---|---|
| player_movement | PASS 4 checks, exit 0 |
| performance_metrics | PASS 11 checks, exit 0 |
| regional_handoff | PASS 41 checks, exit 0 |
| regional_visual_profiles | PASS 43 checks, exit 0 |
| persistence_notice | PASS 11 checks, exit 0 |
| session_policy | "all checks passed", exit 0 |
| input_bindings_headless | PASS 23 checks, exit 0 |
| world_3d.tscn probe | PASS, 6 children, exit 0 |
| main scene quit | exit 0, 0 script errors |
| check-only sweep | 43 `.gd` files, 0 failures |

Save-writing suites: the matrix (f5a, 41 of 41), real runs t10 to t13, and the old-harness and residual checks in 25.6 and 25.7.

### 25.12 Consolidated issue register (current; supersedes 24.8)

| ID | Component | Finding | Severity | Status | Evidence | Blocks release |
|---|---|---|---|---|---|---|
| REC-1 | Git | Local branch not at recovered commit; no upstream | High | FIXED_VERIFIED | 23.2 | No |
| ENV-1 | Engine | No official Godot binary reachable | High | FIXED_VERIFIED (custom build; official binary not verified) | 25.3 | Label as custom |
| ENV-2 | Display | No display server or GPU | High | BLOCKED | 25.3 | Yes, for Stage 29 close |
| TEST-1 | return_path restore | Backup deleted if the original write fails | High | FIXED_VERIFIED | s29 F3, F1, K3 | No |
| TEST-2 | backup read-back | Backup not read back and compared | High | FIXED_VERIFIED (guard) | s29 F2 (scratch fault injection through the production check) | No |
| TEST-3 | restore compare | Restore not compared to the original bytes | High | FIXED_VERIFIED | s29 F4 | No |
| TEST-4 | no-save case | No marker for the no-save case | Medium | FIXED_VERIFIED (manifest replaces the marker) | s29 N3, N4, K2 | No |
| TEST-5 | save-slot refusal | Refusal did not cover other tests' files | Medium | FIXED_VERIFIED | s29 L-cases; residual refusal in all three tests; FI-09a to c | No |
| TEST-6 | return_path clock | Autosave and clock advance during the test | Medium | OPEN | 25.10; not reproduced in 28 runs | No |
| TEST-7 | return_path timing | `resume_step <= 1` depends on frame delta | Medium | OPEN | 25.10; not reproduced | No |
| TEST-8 | return_path timing | `moved > 1.0` depends on physics stepping | Low | OPEN | 25.10; not reproduced | No |
| TEST-9 | hard kill | Recovery material left by a kill | Medium | KNOWN_LIMITATION (updated) | s29 K1 to K8 PASS: provable states recover. L4, L11, L18 PASS: unprovable states refuse. | No |
| TEST-10 | runtime error, watchdog | Restore depends on the watchdog | Low | FIXED_UNVERIFIED (current code) | Verified before the guard migration only (FI-13, FI-14) | No |
| TEST-11 | domain_smoke | Check total varies by run (92 or 93) | Low | OPEN | 25.7 | No |
| GUARD-RACE-1 | save_slot_guard | Stale-file cleanup could remove a live holder's temporary file, so both runs refuse | Medium | FIXED_VERIFIED | 25.5 | No |
| C1-MSG-1 | save_slot_guard | Losing run's refusal did not say "nothing was changed" | Low | FIXED_VERIFIED | 25.5 | No |
| UI-DET-1 | ui_flow determinism | Three consecutive equivalent runs required | Medium | VERIFIED (t10 to t12, plus t13) | 25.7 | No |
| SAVE-1 | UI-flow and load-confirmation | Unreadable save backed up as empty and overwritten | High (data loss) | FIXED_VERIFIED (guard L21; FI-03b/c before migration) | 25.4, 25.6 | No |
| SAVE-2 | Restore read of backup | Unreadable backup restored as empty | Medium | FIXED_UNVERIFIED | Code and guard L15, L16 only | No |
| SAVE-DOB-1 | Save load, DOB | Float fields broke equality | Medium | FIXED_VERIFIED | domain_smoke DOB check | No |
| SCHED-1 | Education schedule | Weekday lists never matched | High (gameplay) | FIXED_VERIFIED (engine) | Probe; domain_smoke timetable checks pass | Rendered UI not verified |
| TEST-FX-1 | domain_smoke timetable | Wrong clock time and subject name in fixture | Medium | FIXED_VERIFIED | domain_smoke | No |
| TEST-FX-2 | Academic fixture (domain_smoke, save_restart) | Writes a legacy field directly | Medium | OPEN (test decision, owner) | 25.7; production path verified | Yes, for those two suites |
| KEY-1 | World-switch key | F3 or F11 | Low | DECIDED: F3 kept (cd1703c). Physical key not verified. | 25.8 | Yes, for Stage 29 rendered validation |
| KEY-2 | Input | `ui_accept` and `jump` both use Space | Low | OPEN (design, owner) | 25.8 | No |
| INPUT-1 | Input bindings | Configured keys and action references | Low | VERIFIED (23 of 23) | 25.8 | No |
| ACT-1 | Input actions | `jump` and `toggle_first_person` defined | Low | FIXED_VERIFIED (input map) | 25.8 | No |
| CONT-1 | Continue (start screen) | Continue loads the save | Medium | VERIFIED headless | 25.9 (ui_flow step 9) | Rendered not verified |
| LOAD-1 | In-game Load | Confirmation, cancel, confirm, failure safety, validation | High | VERIFIED headless | 25.9 (sections A to H) | Rendered not verified |
| TSCN-1 | world_3d.tscn | `load_steps` header | Low | FIXED_VERIFIED (cosmetic) | 25.10 | No |
| TOD-1 | time_of_day lighting | Lookup misses light and environment | Medium | OPEN (design) | 23.8 | No (inert today) |
| F9 | Kaduna climate | `semi-arid` vs `tropical` | Low | OPEN (excluded data) | 23.9 | No |
| GEN-1 | Generators | `ng:state:fc` vs `ng:fct:abuja` | Low | OPEN (excluded) | 23.9 | No |
| GEO-1 | Audit history | FC row may be stale | Low | NOT_VERIFIED | 23.9 | No |
| LINT-1 | Lint | 51 errors at the start of the mission | Low | PARTIALLY FIXED (29 open, unchanged) | 25.11 | No |
| SMOKE-1 | domain_smoke | One failing check | Medium | OPEN (TEST-FX-2) | 25.7 | Yes, until TEST-FX-2 |
| SR-1 | save_restart read | Two errors, same cause as TEST-FX-2 | Medium | OPEN (TEST-FX-2) | 25.7 | Yes, until TEST-FX-2 |
| SEC-1 | Secrets | Placeholder Postgres URLs only | Info | VERIFIED NOT AN ISSUE (static) | 23.10 | No |

### 25.13 Readiness by claim (section G)

- Repository recovery: RECOVERY_COMPLETE (23.2). No history was rewritten in this round.
- Save safety: VERIFIED IN SCRATCH on this custom build, for the refusal and restore paths in 25.5 and 25.6. Not verified against the official binary. The guard protects test saves only.
- Core engine stability: every non-save suite passes. `domain_smoke` and `save_restart` fail on the academic fixture issue (TEST-FX-2). This is not a full playthrough.
- Continue and in-game Load: VERIFIED headless (25.9). Not verified with rendered UI or physical keys.
- Input: keys defined and configured; F3 kept; not physically verified. The `ui_accept` / `jump` overlap is an open design question.
- Stage 29: OPEN. It closes only with rendered validation, which has not been possible.
- Stage 28: OPEN. It closes only with the production criteria. Not re-audited here.
- Production: NOT READY.

### 25.14 Single most important blocker, and decisions needed

- Blocker: no display server and no GPU on this machine. Rendered UI, physical keys and the modal dialog cannot be verified here. Stage 29 cannot close without that evidence.
- Blocker for two suites: the academic fixture check (TEST-FX-2) fails in `domain_smoke` and `save_restart`. The production path is verified, but the fixture writes a legacy field directly. Owner decision needed on how the fixture should be built.
- Decisions needed from the owner: `ui_accept` and `jump` both on Space (KEY-2); whether the `jump` and `toggle_first_person` defaults are confirmed (25.8).

### 25.15 Not tested, and limits

- Physical keys, rendered UI, mouse input and window close: BLOCKED (no display).
- Official Godot release binary: not verified. All results are from the custom build.
- FI-13 and FI-14 (watchdog, runtime error) were not re-run in this round, and they have no s29 equivalent. The status is FIXED_UNVERIFIED on the current code.
- The matrix and fault-injection harness, and the mutation harness, are scratch-only and are not committed.
- Real user data: not reachable from this sandbox. Not touched.
- Production save code is not changed by this round. Hard-kill and read-only cases apply to test saves only.

## 26. Academic fixtures, input context, and save-guard self-test (2026-10-11)

### 26.1 Result

- TEST-FX-2 (academic fixtures in `domain_smoke` and `save_restart`) is a test defect. It is fixed in the test code. Production code is unchanged. Both suites pass on commit `9e0532d`.
- KEY-2 (Space for `jump` and `ui_accept`) is NOT AN ISSUE in the current contexts. A structural test now checks this. Revisit it if a GUI control is added to the 3D world.
- Save recovery: each required behaviour group has a permanent, deterministic test (`game/tests/save_guard_headless.gd`, 77 checks). Three guard mutations were each caught.
- FI-13 (hang after save) and FI-14 (runtime error after save) were re-run on the current code in scratch, twice each. Both pass. This coverage is temporary only and is not committed.
- Stage 29 remains OPEN (rendered validation BLOCKED: graphical display unavailable). Stage 28 remains OPEN and was not re-audited here. Production is NOT READY. No claim is made for any of these.

### 26.2 Repository state (verified before editing)

- Branch `arena/00cdea0e-naija`. HEAD, upstream, and `origin/arena/00cdea0e-naija` were all `f95eeb5`. The working tree was clean.
- `origin/arena/f48b6f8e-naija` = `02dd67c` (preserved, not touched). `origin/main` = `44483b4`.
- Commits this round: `2936d61` (academic fixtures), `dff5a5c` (input context check), `9e0532d` (save-guard self-test and README). This section is committed after them.
- No saves, backups, locks, harness files, or generated artifacts are tracked. The Godot user-data directories under `~/.local/share/godot` were not created or modified by this round's runs.

### 26.3 Toolchain (executed today)

- Godot `4.7.2.stable.custom_build.ed1daf0bf`, built from source at `/tmp/godot-src` (editor binary sha256 prefix `b7052e20`). The official release binary is not reachable from this sandbox, so it is NOT VERIFIED.
- Node v22.22.3, npm 10.9.8.
- Isolation: every Godot run copied `game/` into a fresh scratch directory with `HOME` and `XDG_DATA_HOME` pointed at scratch paths. The repository was never a test working directory. Two-process `save_restart` runs share one scratch base.

### 26.4 Academic fixtures (TEST-FX-2)

Failing assertions on `f95eeb5` (run today, custom build):

- `domain_smoke`: `Save/load restores academic data`. Restored Biology = 64, expected 88. Exit 1; 1 failing check.
- `save_restart --read`: `academic result` (64, expected 88) and `attendance and inventory` (attendance size 0, expected 1). Exit 1.

Trace:

1. The fixtures set `character.academic_scores["Biology"] = 88` and append a legacy `attendance` entry.
2. `save_state` writes the legacy views and `education_record`.
3. `CharacterState.load_dictionary` ends with `advance_life_to_date`, which reaches `ensure_life_data`, and it also calls `EducationService.sync_legacy_character` itself. The sync rebuilds `academic_scores` and `attendance` from `education_record`, so the direct writes are discarded.
4. Scratch probe P1 confirmed it: after load, Biology = 64 (the record value) and the attendance view is empty. Probe P2 confirmed the production route: `EducationService.record_result(character, 3, "Biology", true, "11:30")` writes the record, the attendance record, and the derived view. After save and load the view equals the record-derived view (80 in the day-3 probe) and attendance has 1 entry.

Intended invariant (documented, not inferred): `docs/EDUCATION_PLAN.md` (line 22), `docs/ARCHITECTURE.md` (line 111), and `docs/DATABASE_PLAN.md` (line 24) place the academic record in `CharacterRecord.education_record`. The legacy score and attendance fields are input only for version-1 saves, which are migrated when the record is absent or invalid (`migrate_legacy_record`).

Classification: broken fixture. The test wrote a derived view. It is not a serialization defect, a validation defect, or missing data. The cause is shared by both suites.

Fix (test code only, smallest responsible component):

- `domain_smoke` and `save_restart` record the Biology result through `record_result`. The expected value is the record-derived value, not the hard-coded 88. `save_restart --read` also requires a value that differs from the starting score (64), so the check cannot pass on the starting record alone.
- `domain_smoke` gains a permanent regression check, `_test_legacy_academic_view_is_rebuilt_on_load`. It asserts that a direct write to the legacy views does not survive save and load, and that the restored view matches the record.
- No assertions were removed or weakened.

Evidence:

- `f95eeb5` (before): `domain_smoke` exit 1; `save_restart --read` exit 1 with two failures.
- `9e0532d` (after): `domain_smoke` exit 0, 98 checks (97 to 99 across runs); `save_restart` write exit 0, read exit 0.
- Mutation (scratch only): the three `sync_legacy_character(self)` calls in `character_state.gd` were disabled. `domain_smoke` exit 1, with exactly the three new projection checks failing. So the regression check detects the defect it guards against.

Owner decision: not needed. The rule is set by the documents above. Observation, not a defect: the save file also persists the derived legacy views. They are rebuilt on load, so this is harmless.

Status: TEST-FX-2, SMOKE-1, and SR-1 are FIXED_VERIFIED (fixture side; custom build).

### 26.5 Input policy (KEY-1, KEY-2, ACT-1)

Configured bindings (`game/project.godot`, `[input]`): `toggle_3d_mode` = physical F3 (4194334); `jump` = physical Space (32); `toggle_first_person` = physical V (86). `ui_accept` is not overridden, so it uses the engine default, which includes Space (observed true by the test).

Context proof (code and test):

- `jump` is read only at `3d_world/scripts/character_3d.gd:48`. That character is attached only in `world_3d.tscn`.
- `world_3d.tscn` has no `Control` or `CanvasLayer` node (the test counts 0).
- While 3D is active, the 2D session is suspended (`process_mode` DISABLED). Switching to 3D is refused while a modal is open. A modal also disables player movement.

Result: Space jump and Space UI activation are not live in the same context. KEY-2 is NOT AN ISSUE for the current contexts. Residual risk: if a `Control` is added to the 3D world, the overlap becomes live and must be decided again.

Test: `input_bindings_headless.gd` now runs `_check_space_contexts` (2 checks: only `character_3d.gd` reads `jump`; `world_3d.tscn` has no GUI node). Scratch mutation (a `Control` added to the 3D scene): exit 1, 1 of 26 checks failing. The 2D modal gate is not covered by a test. Its evidence is code reading only.

- KEY-1 (F3 for `toggle_3d_mode`): confirmed by commit `cd1703c` ("Standardize world-switch key on F3") and the Stage 23 documents. Configured and tested. Physical keypress: BLOCKED (graphical display unavailable).
- `jump` = Space: documented ("Space to jump", `docs/ADVANCED_3D_WORLD_ARCHITECTURE.md`). Kept unchanged.
- `toggle_first_person` = V: no documented key in docs or history. Commit `e6ff46c` says "These are default bindings; confirm them with the owner." Left unchanged. OWNER DECISION.
- Touch controls: `create_action_button` has no caller that passes `"jump"`, so no touch jump control exists.

No binding was changed in this round.

### 26.6 Save recovery (guard)

Permanent test: `game/tests/save_guard_headless.gd` (77 checks, exit 0, 0 skipped on Linux as non-root). It uses only the test slot `user://naija-guard-selftest-slot.json`, never the player's save. It uses no timing. A crash is simulated by abandoning a guard instance after `begin` and `observe`, then rewriting the recorded pid of that run to a process that has already exited. The guard then has proof that no run is active. The test refuses to start if any protocol file exists, so it never deletes another run's material.

Coverage (scenario, status):

| Required behaviour | Scenario | Status |
|---|---|---|
| Backup verified before modification | S01 | Permanent |
| Existing save restored | S01 | Permanent |
| Originally absent save | S02 | Permanent |
| Refusal on ambiguous recovery state | S03 | Permanent |
| Recovery-marker handling (observed change, stale lock, stray backup, unreadable manifest) | S04, S08, S09 | Permanent |
| Byte mismatch | S05 | Permanent |
| Restore failure, material kept, then recovery | S06 (chmod 444; skipped as root) | Permanent |
| Repeated recovery attempts | S03, S06, S10 | Permanent |
| Concurrent test starts | S07 | Permanent for the held-lock case. The true simultaneous race cannot be forced deterministically: NOT_VERIFIED |
| Successful cleanup after verified restoration | S01, S04, S06 | Permanent |
| No mutation when a run refuses to start | S03, S05, S07, S08 | Permanent |
| FI-13 hang after save (watchdog restores) | scratch `run_fi.py`, 2 runs | Temporary only (timing; not committed) |
| FI-14 runtime error after save (watchdog restores) | scratch `run_fi.py`, 2 runs | Temporary only (not committed) |

Integration suites that use the guard, `return_path`, `ui_flow_headless`, and `load_confirmation_headless`, remain permanent and passed.

FI-13 and FI-14 (this round, scratch copy, injected after the save point, watchdog set to 8 s): hang run, exit 1 at 8.5 s, watchdog message present, save restored byte for byte to the seed, no protocol file left. Runtime-error run, exit 1 at 8.5 s, `SCRIPT ERROR: Cannot call method` logged, same restore result. Both repeated. The original FI harness (`/tmp/naija-harness/fi_cases.py`) targets the pre-guard protocol and was not run. Its intent was taken from the watchdog comments in `return_path.gd` and TEST-10.

Guard mutations (scratch only, one change each):

- M1, ambiguous-state refusal removed: 7 of 75 checks fail.
- M2, backup byte check removed during recovery: 3 fail.
- M3, atomic lock check disabled (the `make_dir` call is kept): 2 fail (the two held-lock checks).
- M3-broad, lock call removed entirely: 29 fail. This shows only that the lock is required. It is not counted as evidence for the atomic check.

Limits:

- A hard kill cannot be caught. TEST-9 remains KNOWN_LIMITATION (previously verified in 25.5).
- The guard's protocol files are fixed under `user://`. The self-test must not run at the same time as another save-writing test. It refuses if any protocol file exists.
- The restore-failure case needs a non-root user on Linux or macOS. Root ignores file permissions, so the case is skipped with a message.
- The pid check uses `kill -0` on Linux and macOS only. On other platforms the guard treats a pid as active and refuses.
- The unreadable-manifest case prints one expected engine line, `Parse JSON failed`, and the run is refused.
- Production save code is not changed.

### 26.7 Test results (tested commit `9e0532d`, executed 2026-10-11)

| Suite | Exit | Result this run |
|---|---|---|
| domain_smoke | 0 | PASS, 98 checks (range 97 to 99 across runs) |
| input_bindings_headless | 0 | PASS, 26 checks |
| save_guard_headless | 0 | PASS, 77 checks, 0 skipped |
| return_path | 0 | PASS, 47 checks |
| ui_flow_headless | 0 | PASS, 57 checks |
| load_confirmation_headless | 0 | PASS, 104 checks |
| regional_handoff | 0 | PASS, 41 checks |
| regional_visual_profiles | 0 | PASS, 43 checks |
| performance_metrics | 0 | PASS, 11 checks |
| persistence_notice | 0 | PASS, 11 checks |
| player_movement | 0 | PASS, 4 checks |
| session_policy | 0 | "all checks passed" (no count printed) |
| save_restart (two processes) | 0 / 0 | write PASS, read PASS |

Before (HEAD `f95eeb5`, run today): `domain_smoke` exit 1 (1 failing check, 92 or 93 total). `save_restart --read` exit 1 (2 failing checks).

Counts vary between runs. `domain_smoke` ran 92 or 93 checks on HEAD and 97 to 99 on the working tree. The varying count does not change pass or fail, which was stable across all runs. Cause identified (not fully traced loop by loop): the actor ID includes a millisecond timestamp and a random number. `life_simulation_service.gd:216` derives the birthday offset from that ID, which changes the life-history loops that run. TEST-11 stays OPEN (Low). Counts are reported as ranges.

Node: `npm test` exit 0. 1074 tests, 1037 pass, 0 fail, 37 skipped, 0 cancelled, 30 suites.

Lint: `npm run lint` exit 1, 29 errors and 0 warnings. Breakdown: 24 `@typescript-eslint/no-unused-vars` and 5 `@typescript-eslint/no-explicit-any`, across 9 TypeScript files under `services/world-api/src`. This matches the 29-error baseline. No error was introduced, and this round changed no TypeScript. Not fixed (no sweeping changes).

Historical results from earlier rounds (for example, 93 checks and the earlier academic failure) are superseded by the results above.

### 26.8 Readiness by claim

- Repository integrity: VERIFIED. The branch is clean, `origin/arena/f48b6f8e-naija` is preserved, and the remote tip is confirmed after the push (26.11).
- Save-test safety: VERIFIED IN SCRATCH on the custom build, for the paths in 26.6. Test saves only. The official binary is not verified.
- Core engine stability: all 13 Godot test files pass on `9e0532d` (exit 0). This is not a full playthrough.
- Gameplay readiness: NOT ESTABLISHED. Rendered UI and physical input are blocked.
- Stage 29: OPEN. Rendered validation is BLOCKED (graphical display unavailable).
- Stage 28: OPEN. Not re-audited in this round. Not claimed.
- Production: NOT READY. No claim is made.

### 26.9 Consolidated issue register (supersedes 25.12 for the entries below; all other 25.12 entries stand)

| ID | Component | Finding | Severity | Status | Evidence | Blocks release |
|---|---|---|---|---|---|---|
| TEST-FX-2 | Academic fixtures | Direct write to legacy views, discarded on load | Medium | FIXED_VERIFIED (fixture; production unchanged) | 26.4 | No |
| SMOKE-1 | domain_smoke | Academic failure | Medium | FIXED_VERIFIED | 26.4 | No |
| SR-1 | save_restart read | Academic and attendance failures | Medium | FIXED_VERIFIED | 26.4 | No |
| TEST-2 | Backup read-back | Backup not read back and compared | High | FIXED_VERIFIED (guard); coverage permanent (S01, S05) | 25.12; 26.6 | No |
| TEST-3 | Restore compare | Restore not compared to original | High | FIXED_VERIFIED; coverage permanent (S01, S04, S06) | 26.6 | No |
| TEST-5 | Save-slot refusal | Refusal did not cover other tests' files | Medium | FIXED_VERIFIED; coverage permanent (S03, S07, S08) | 26.6 | No |
| TEST-9 | Hard kill | Recovery material left by a kill | Medium | KNOWN_LIMITATION (unchanged) | 25.5; 26.6 | No |
| TEST-10 | Runtime error, watchdog | Restore depends on the watchdog | Low | FIXED_VERIFIED (scratch, temporary only; FI-13 and FI-14, 2 runs each) | 26.6 | No |
| TEST-11 | domain_smoke | Check total varies by run | Low | OPEN (cause identified, not fixed) | 26.7 | No |
| GUARD-LOCK-1 | Atomic lock (`make_dir`) | Simultaneous start race cannot be forced; held-lock case covered | Low | NOT_VERIFIED (race window) | 26.6 | No |
| SELFTEST-1 | Save-guard self-test | Must not run concurrently with other save tests | Low | KNOWN_LIMITATION (the test refuses in that case) | 26.6 | No |
| KEY-1 | World-switch key | F3 | Low | DECIDED (cd1703c). Physical keypress BLOCKED | 26.5 | Yes, for Stage 29 rendered validation |
| KEY-2 | Input | `ui_accept` and `jump` both use Space | Low | NOT AN ISSUE (current contexts; structural test) | 26.5 | No (revisit if GUI added to 3D world) |
| ACT-1 | Input actions | `toggle_first_person` = V has no documented key | Low | OPEN (OWNER DECISION) | 26.5 | No |
| LINT-1 | Lint | 29 errors, baseline unchanged | Low | OPEN (unchanged baseline, not fixed) | 26.7 | No |
| ENV-2 | Display | No display server or GPU | High | BLOCKED | 25.3 | Yes, for Stage 29 close |
| STAGE-29 | Rendered validation | Not performed | High | OPEN (BLOCKED: graphical display unavailable) | 26.1 | Yes |

### 26.10 Owner decisions and next action

- Owner decision: the `toggle_first_person` default (V) is not documented. Confirm it or choose another key. No change was made.
- Owner note: `jump` = Space is documented and kept. Re-decide KEY-2 if a GUI control is added to the 3D world.
- Single most important blocker: a graphical display and GPU for rendered validation. Stage 29, physical F3, and the modal dialog depend on it. Status: BLOCKED (GRAPHICAL DISPLAY UNAVAILABLE). No further attempts at screenshots or physical input were made in this round.

### 26.11 Delivery

- Commits on `arena/00cdea0e-naija`: `2936d61`, `dff5a5c`, `9e0532d`, and this audit commit. Pushed as a normal fast-forward. The remote tip is verified after the push.
- Not staged: saves, backups, locks, harness files, probes, and fault-injection scripts. These remain in `/tmp/naija-harness/m2/` (scratch only, not committed).
- Changed files: `game/tests/domain_smoke.gd`, `game/tests/save_restart.gd`, `game/tests/input_bindings_headless.gd`, `game/tests/save_guard_headless.gd` (new), `README.md` (test list), and this document. No production code, data, catalogs, climate, regional, `ng:state:fc`, environment-profile, time-of-day, authentication, Stage 28, or Stage 30 file was changed.

### 26.12 Not tested, and limits

- Physical keys, rendered UI, mouse input, and window close: BLOCKED (no display).
- Official Godot release binary: not verified. All results are from the custom build.
- FI-13 and FI-14 run in scratch only. They are timing-based and are not committed.
- The simultaneous lock race (GUARD-LOCK-1) is not forced. NOT_VERIFIED.
- The 2D modal gate that blocks switching to 3D is covered by code reading only.
- Real user data: not reachable from this sandbox and not touched.


## 27. Pre-release audit: integrity, TEST-11, input, save guard, regression, Stage 29 and Stage 28 classification (2026-10-11)

Evidence labels: **verified** means the stated command or probe ran and its result is recorded here. **Headless** means
Godot `--headless` with simulated input, or Node tests. **Local** means a disposable database or private CA on this
sandbox. Nothing here was rendered. **Static** means reading or grep. The Godot engine is the custom build
`4.7.2.stable.custom_build.ed1daf0bf` (checked with `--version`). It is not the official release, so official-release
compatibility is **not verified**. Scratch harnesses live in `/tmp/naija-harness/m2/` and `/tmp/naija-scratch/`, outside the
repository. They are not committed. The Godot runs used isolated HOME and XDG directories, so none touched real user data.

### 27.1 Result

- Tested code commit: `30bfcd4`. Test commits in this section: `40b93a6` (TEST-11) and `30bfcd4` (save-guard self-test).
  This documentation commit follows them. The remote tip is verified after the push.
- Stage 29: **OPEN (BLOCKED: no graphical display in this sandbox, `DISPLAY` unset, no X server).** Stage 28: **OPEN**.
  Production: **NOT READY**. Each is discussed in the sections below.
- Corrections to section 26: see 27.3 (TEST-11 cause) and 27.4 (2D modal gate coverage).

### 27.2 Repository integrity (phase 1)

- Branch `arena/00cdea0e-naija`. Before this section: HEAD, upstream, and remote tip all at `e1c6cf5`, tree clean. The other
  remote refs were unchanged: `origin/arena/f48b6f8e-naija` at `02dd67c`, and `main` at `44483b4`. All four series commits
  were ancestors of HEAD. Nothing was rewritten, force-pushed, or merged.
- Tracked files: no saves, backups, locks, harnesses, or generated artifacts. `.env` is absent. The only tracked env-like file is
  `.env.example`. Its keys were checked with values redacted. It contains placeholders and no secrets.
- Tracked evidence: the 25 `docs/evidence/stage28-capacity/*.json` files are benchmark summaries (shape checked, no save content).

### 27.3 TEST-11: `domain_smoke` check-count variation (phase 2)

**Root cause (corrects the earlier hypothesis in section 26.7).** The check total varied because the starter household is chosen
at random from `game/data/life/life_catalog.json` (`family_generation.starter_household_profiles`). The four profiles have
2, 3, 3, or 4 relatives. `HouseholdFactoryScript._starter_profile` picks one with `randi_range` (household_factory.gd:31). The
`for relative in relatives` loop in `domain_smoke.gd` adds one check per relative. The total before the fix was therefore
`95 + relatives`. The earlier hypothesis that the time-seeded actor ID changes the count was wrong. It changes the DOB offset,
but the count does not depend on it.

Controlled runs (scratch copies, instrumentation only, same repository content):

| Variant | Relatives per run | Total checks | Result |
|---|---|---|---|
| Control, 5 runs (print only) | 4, 3, 4, 3, 3 | 99, 98, 99, 98, 98 | PASS each |
| Profile forced to index 0, 3 runs | 2, 2, 2 | 97, 97, 97 | PASS each |
| IDs made deterministic (process-wide sequence), profile random, 4 runs | 2, 3, 2, 3 | 97, 98, 97, 98 | PASS each. Count still follows the profile, so IDs do not drive it |
| Profile forced and IDs deterministic, 3 runs | 2, 2, 2 | 97, 97, 97 | PASS each |
| Constant IDs (first attempt, 2 runs) | 3, 4 | 98, 99 | 2 FAIL each: "New characters receive different households", "Starter NPCs receive distinct stable person IDs". Caused by my mutation (identical IDs), not product code. Discarded |

**Intended or accidental?** The random profile choice is the code's design, and the catalog exists to give family variety. It is
intended. Accidental was only the test: it counted a random input as a fixed total. The docs do not state the selection rule,
so the owner should confirm uniform random choice (OWNER-TEST-11, Low, does not block).

**Fix (`40b93a6`, test only).** The test sweeps 40 seeded samples and asserts that each has 2 to 4 relatives. It then pins the
random stream for the household it checks (`STARTER_HOUSEHOLD_SEED = 1`, which gives 3 relatives). Production randomness is not
changed. The total is now 99 (96 base + 3 relatives).

**Verification.** Five unmodified runs of the edited test gave 99 each (5 of 5 identical). One run on `30bfcd4` also gave 99 PASS.

**Effect of the variation.** It changes only the count of per-relative checks and the household composition. It does not change
any outcome checked. In all variants with unique IDs, no check failed, and the save round-trip checks passed. Each suite runs in
its own process and HOME, so there is no cross-suite effect. Status: **FIXED_VERIFIED** (test reproducibility). Production behaviour is unchanged.

### 27.4 Input policy (phase 3)

Verified (static reading, plus headless tests):

- **Actions defined.** `game/project.godot` defines `toggle_3d_mode` (F3, physical 4194334), `jump` (Space, physical 32), and
  `toggle_first_person` (V, physical 86). `prototype_game._setup_input_actions()` defines `move_up/down/left/right` (W/S/A/D and
  arrows), `run` (Shift), and `interact` (E) at runtime, using logical keycodes. All 10 action names referenced in scripts are
  defined. `_bind_action` skips any action that already has events, so bindings cannot be duplicated. `input_bindings_headless`: 26 checks, PASS.
- **F3 and modal safety.** `SceneSwitcher.switch_to_3d` has one caller, the guarded F3 handler. The handler refuses the switch
  and consumes the event while a blocking modal is open (`blocks_world_switch`). Headless evidence: `load_confirmation_headless`
  presses the bound F3 event while the Load confirmation is open. The switch is refused, the modal stays open, Cancel closes it,
  and F3 works again afterwards. The same suite checks that the F3 binding is used only by `toggle_3d_mode`.
- **2D suspended while 3D is active.** Headless (`ui_flow_headless` section 5): the 2D session is suspended and not processing, the
  HUD is hidden, and exactly one 3D world exists.
- **Space.** `jump` is read only at `character_3d.gd:48`. `world_3d.tscn` has no GUI nodes. The structural test
  `_check_space_contexts` (committed `dff5a5c`) fails if a Control is added to the 3D world (mutation: 1 of 26 failed). Scratch probe
  (simulated key via `push_input`): with 3D active, Space did not activate the focused 2D "Begin your life" button (0 presses,
  mode stayed 3D). The same Space in 2D activated it (1 press). The probe is a positive control.
- **Duplicate and stale bindings.** `toggle_3d_mode` has exactly one binding, and round trips add none (`ui_flow_headless`).

Gaps and findings:

- **INPUT-START-1 (OPEN, OWNER DECISION).** The character-creation card is not a modal, so `blocks_world_switch()` is false
  there. Pressing F3 on it switches to 3D. The 3D world loads with `region_id = ng:state:on` (a default, since no character exists).
  F3 then returns to the same creation card. No error was logged. Scratch probe, real main scene, bound key. No existing test
  covers this, since `ui_flow` presses F3 only after "Begin your life". I did not add a guard, because whether world switching should
  be allowed before a life begins is a control policy decision for the owner.
- **MODAL-GATE-1 (NOT AN ISSUE; corrects 26.12).** Section 26.12 said the 2D modal gate was covered by code reading only. That is
  no longer true. `load_confirmation_headless` covers it headless (see above).
- **INPUT-MIX-1 (KNOWN_LIMITATION).** Project actions use physical keys (F3, Space, V). Runtime actions use logical keycodes
  (WASD, Shift, E), which can change with keyboard layout. Not changed. A binding change needs an owner decision.
- **TOUCH-1 (KNOWN_LIMITATION).** `game/scripts/services/touch_controls.gd` is not instantiated or referenced anywhere in the
  project, so its `_input` cannot run in this build. Touch controls are not verified.
- **KEY-1 (BLOCKED).** Physical keypress verification needs a keyboard and display. Not available here. Simulated keycodes were used throughout.
- **ACT-1 (OPEN, OWNER DECISION).** `toggle_first_person` = V has no documented key. It is kept as a **provisional technical default**.
  This is not owner approval.

### 27.5 Save guard (phase 4)

Self-test coverage (`save_guard_headless.gd`, 77 checks, 0 skipped, uid 1001, not root). It covers: existing save backed up and
restored; absent save; ambiguous state refused without change; observed interrupted change recovered; backup byte mismatch refused
and kept; restore failure keeps the material, then recovers (the chmod case runs because the sandbox is not root); held-lock
concurrent start refused; refusal before start changes nothing; stale lock without manifest removed; repeated finish is stable.
Refusals leave the save, backup, manifest, and lock as they were. The self-test uses only a test-only slot.

Real-save suites (`ui_flow_headless`, `return_path`, `load_confirmation_headless`): they call `begin()` first. On refusal they call
`quit(1)` and return before any access to the save path. Confirmed by reading the code.

**Concurrency, two OS processes on one shared user directory (scratch):**

| Round | Setup | Outcome |
|---|---|---|
| Plain start, 3 rounds, before the fix | Both start with no barrier | One PASS (77), one refused by the precheck ("protocol or self-test slot files already exist; nothing was changed"). No leftover files |
| Barrier, before the fix (`rb-b1`) | Both pass the precheck and wait for a shared start time, then reach the lock together | **Defect.** The refused run did not stop. A: 30 of 77 failed. B: 29 of 77 failed. Both ran scenarios that wrote the test slot and the shared protocol files |
| Barrier, after the fix (`rb-b2`, `b3`, `b4`) | Same | Each round: one PASS (77), one BLOCKED with exit 1 ("another save-guard run holds the protocol; this run was refused at start and changed nothing"). No leftover files |

**Defect and fix (`30bfcd4`, self-test only, production guard unchanged).** The self-test kept running after a refused start that
had to succeed. Its later scenarios wrote the shared backup and manifest paths, and `_s02` removed the slot. A fixed slot name also let
the pre-`begin()` fixture write land in another instance's slot. The fix:

1. Each start that must succeed goes through `_start_expected`. It counts one check, as before, and a refusal stops the run.
2. The slot name includes the process id, so one instance never writes another instance's slot.
3. A refused run removes only its own slot and reports BLOCKED with exit 1.

The normal run is unchanged: 77 checks, exit 0.

**Protection invariants checked.** No test destroys the only valid copy of a save. Ambiguous states are refused, not overwritten.
A refusal leaves the save and recovery material unchanged. A stale lock is removed only when its owner process has exited.

**Limits.** The simultaneous lock race was observed in 3 barrier rounds, not forced to a chosen interleaving, so it is
**NOT_VERIFIED** as a forced race (GUARD-LOCK-1). The barrier harness is scratch-only, so the two-process result is not a committed
regression test. Real process kill and hard-kill recovery are **NOT_VERIFIED**. The crash-recovery cases simulate an abandoned run in
one process. A crash that leaves protocol files behind blocks later runs until a person resolves them. That is deliberately conservative.

### 27.6 Regression results (phase 5)

Commit `30bfcd4`. Engine `4.7.2.stable.custom_build.ed1daf0bf`. Each Godot suite ran on a fresh scratch copy of `game/`, with its
own HOME and XDG directories. None touched real user data. Node was run from the repository, with the variables listed below.

| Suite | Exit | Assertions | Status | Save writing |
|---|---|---|---|---|
| domain_smoke | 0 | 99 PASS (96 base + 3 relatives) | PASS | Writes its own test save in the scratch HOME |
| input_bindings_headless | 0 | 26 PASS | PASS | No |
| save_guard_headless | 0 | 77 PASS, 0 skipped | PASS | Test-only slot in the scratch HOME |
| return_path | 0 | 47 PASS | PASS | Scratch save slot |
| ui_flow_headless | 0 | 57 PASS (headless, simulated input) | PASS | Scratch save slot, under the guard |
| load_confirmation_headless | 0 | 104 PASS (headless, simulated input) | PASS | Scratch save slot, under the guard |
| regional_handoff | 0 | 41 PASS | PASS | No direct save calls. Scene autosave not excluded (scratch HOME) |
| regional_visual_profiles | 0 | 43 PASS | PASS | No direct save calls. Scene autosave not excluded (scratch HOME) |
| performance_metrics | 0 | 11 PASS | PASS | No direct save calls. Scene autosave not excluded (scratch HOME) |
| persistence_notice | 0 | 11 PASS | PASS | No direct save calls. Scene autosave not excluded (scratch HOME) |
| player_movement | 0 | 4 PASS | PASS | No direct save calls. Scene autosave not excluded (scratch HOME) |
| session_policy | 0 | "all checks passed" (no count printed) | PASS | No direct save calls. Scene autosave not excluded (scratch HOME) |
| save_restart, two-phase | write 0, read 0 | Write: "Wrote a checkpoint". Read in a new process: "saved character state survived a fresh Godot process" | PASS | Scratch restart file |
| Scene load (all 3 `.tscn`) | 0 | 3 of 3 loaded and instantiated | PASS | No |
| GDScript check-only | 0 | 45 files, 0 failed (44 project scripts plus one scratch probe copy) | PASS | No |

Startup: the import and main-scene instantiation ran in every suite. The main scene is covered by `ui_flow_headless`.

Node (repository, `npm`, Node v22.22.3):

| Run | Configuration | Total | Pass | Fail | Skipped |
|---|---|---|---|---|---|
| `npm test` | Default, no database | 1074 | 1037 | 0 | 37 (live DB and TLS suites) |
| `npm test` | Disposable local PostgreSQL 18.4 (127.0.0.1, scratch data directory, trust auth), `NAIJA_ALLOW_DB_TESTS=true` | 1166 | 1162 | 0 | 4 (TLS only) |
| `npm test` | Same, plus `ssl=on` with a private test CA (scratch CA, not public) | 1166 | 1166 | 0 | 0 |

`npm run lint`: **29 errors** (24 `no-unused-vars`, 5 `no-explicit-any`), exit 1. This matches the baseline in section 26.
Not chased, per the rules. `git diff --check`: clean.

Not run: anything on Neon (no network route, no credentials). No production-like database. No rendered tests.

### 27.7 Stage 29 checklist (phase 6)

Acceptance: a headless equivalent does not count as a rendered result. The rendered items below stay BLOCKED until a display exists.

| # | Item | Required evidence | Available evidence | Gap | Required environment or human action | Status |
|---|---|---|---|---|---|---|
| 1 | New game and HUD | Rendered screen after Begin, HUD visible | `ui_flow` section 1–2: Begin through the real button (keyboard activation), HUD present (57 checks) | Rendered output; mouse click | Display and GPU; a person checks the screenshot | Headless VERIFIED. Rendered BLOCKED |
| 2 | F3 2D to 3D | Rendered 3D world appears after the real key | `ui_flow` section 5: bound key → 3D, 2D suspended. Simulated keycode only | Rendered; physical keypress | Display; physical keyboard | Headless VERIFIED. Rendered and physical BLOCKED |
| 3 | Return to the same 2D session | Rendered HUD back, same session | `ui_flow` section 6: same instance, HUD visible, no creation screen | Rendered | Display | Headless VERIFIED. Rendered BLOCKED |
| 4 | Character and clock continuity | Same character and time across switches, rendered | Same live objects; unsaved money preserved across round trips (`ui_flow` 4–6). The test freezes the clock by design | Live clock while rendering; the clock is frozen in this test | Display; a run with the clock running | Headless VERIFIED (frozen clock). Rendered NOT VERIFIED |
| 5 | Modal safety during switches | F3 refused while a modal is open | `load_confirmation_headless`: refused, modal stays, Cancel, F3 works again | **INPUT-START-1**: F3 on the creation card switches (not a modal) | Owner decision on INPUT-START-1 | Modal case headless VERIFIED. Creation-card case OPEN (owner decision) |
| 6 | Continue through the real UI | Real Continue activated and played | `ui_flow` / `return_path`: keyboard activation of the real button | Mouse click; rendered | Display; mouse | Headless VERIFIED (keyboard). Click BLOCKED |
| 7 | In-game Load: confirm and cancel | Rendered confirm and cancel dialog, real clicks | `load_confirmation_headless`: 104 checks, keyboard activation | Rendered; mouse | Display; mouse | Headless VERIFIED. Rendered BLOCKED |
| 8 | Regional visual differences | Rendered difference between regions | `regional_visual_profiles`: 43 checks on profile data and logic | No rendering, so no visual evidence | Display and GPU | Data VERIFIED (headless). Visual NOT VERIFIED |
| 9 | Lighting ownership | One owner for ambient light, with a design | TOD-1 is OPEN (design, section 23.8). `time_of_day.gd` is not changed | Design decision not made | Owner decision on TOD-1. No new design is proposed here | OPEN (design, owner decision) |
| 10 | Frame-time measurements | Non-zero, varying frame times, rendered | Headless `TIME_PROCESS` stayed 0.0 (section 19.6). Not a valid measurement | Rendered measurement | Display and GPU | BLOCKED |
| 11 | No duplicate nodes, signals, or bindings after repeated transitions | Counts stable after repeated switches | `ui_flow` section 6–7: one 2D and one 3D child, no extra `create_requested` connections, binding count unchanged. `load_confirmation`: no extra `load_requested` connections | Rendered node count is not checked | Nothing beyond the display for the rendered view | Headless VERIFIED |

Protected areas were not changed: Kaduna classification, regional catalogs, presets, `ng:state:fc` mapping, the environment-profile
generator, and `time_of_day.gd` ambient ownership.

### 27.8 Stage 28 and production audit (phase 7)

Stage 28 criteria (from `STAGE_28_AUDIT.md` section 3) classified below. Classifications come from the audit's recorded statuses,
except criteria 5, 44, 45, and 46. Those four were re-checked this session and are shown with that evidence. **VERIFIED (local)** means
a local test ran. It is not production evidence.

Counts over the 54 criteria: 28 VERIFIED (local), 5 PARTIALLY VERIFIED, 18 NOT VERIFIED, 3 BLOCKED.

Area summary:

- **A. Identity and auth.** Authority model: DESIGN only, and most consequential mutations are suspended. Government and election
  writes: containment only (refused with `government_writes_suspended` and `election_writes_suspended`, tested in
  `government-authorization.test.mjs`, passing in the 1166 run). Permanent rules R-a to R-f are NOT IMPLEMENTED. Case access:
  implemented and tested locally. Creation-key recovery: key-only recovery refused by the server (status D-05). Credential lifecycle
  (R7/R8): DESIGN only. Metrics token rules: verified locally by config reader. Secret handling: no secret in the repository.
  Arena secret store: BLOCKED (question 3 in the audit). Classification: PARTIALLY VERIFIED (containment), NOT VERIFIED (permanent rules, lifecycle).
- **B. Persistence and database.** Verified locally on PostgreSQL 18.4, including TLS with a private CA: migrations, fencing,
  money concurrency and rollback, world snapshot, graceful shutdown, health. NOT VERIFIED: real process kill, two OS processes writing
  one world, the down migration, refusal of an unmigrated schema, inventory. Backup and restore: a library exists and passes locally.
  There is no operator tool, no encryption, no retention, no scheduling, and no `pg_dump` run (`STAGE_28_BACKUP_RESTORE_STATUS.md`).
  The JSON importer is DEFERRED by owner decision.
- **C. Deployment and operations.** No deployment, ingress, load-balancer, or trusted-proxy configuration exists in the repository.
  BLOCKED. Health endpoints (`/live`, `/health`) are tested locally but not wired to any probe. CI (`.github/workflows/ci.yml`) runs
  `npm run check` only: lint and `npm test`, with no live database, no TLS suite, and no Godot suites. Neon: BLOCKED, because the sandbox
  has no route to Neon and no credentials were supplied. No secret was read or printed in this audit.
- **D. Multiplayer and gameplay integrity.** Fencing was tested within one process only. Multi-instance operation is NOT
  IMPLEMENTED. Two OS processes: NOT VERIFIED. 3D multiplayer: NOT VERIFIED (Godot multiplayer display not checked). Money
  integrity: verified locally under concurrency. Record validation: PARTIALLY VERIFIED. Life simulation in Godot: `domain_smoke` PASS
  headless (custom build). Gameplay rendering: BLOCKED.
- **E. Testing and operational readiness.** Node: 1166 of 1166 locally with PostgreSQL and TLS; 1074 of 1074 pass with 37 skipped
  without a database. Godot: all 13 suites plus scene and check-only sweeps pass (custom build). Lint: 29 errors, baseline unchanged.
  Load test: NOT IMPLEMENTED. Prometheus: unit-tested, not scraped by a real server. Grafana, alerts, log aggregation, tracing: NOT
  IMPLEMENTED. Platform testing: BLOCKED.

Criterion table (generated from `STAGE_28_AUDIT.md` section 3, with the four re-checked rows):

| # | Area | Criterion (from STAGE_28_AUDIT section 3) | Classification | Basis |
|---|---|---|---|---|
| 1 | E | DATABASE_URL investigation answered with no credential printed | VERIFIED (local) | Audit record; not re-run this session |
| 2 | C | Secure DATABASE_URL configured in Arena | BLOCKED | Audit record; not re-run this session |
| 3 | B | TLS: certificate verification ON by default | VERIFIED (local) | Audit record; not re-run this session |
| 4 | B | TLS: `sslmode=disable` and `DB_SSL=false` require explicit opt-in; `prefer`, `allow`, `no-verify` rejected | VERIFIED (local) | Audit record; not re-run this session |
| 5 | B | TLS handshake verified against a real CA-signed server | PARTIALLY VERIFIED | Local ssl=on server with a private test CA (disposable PG 18.4, 30bfcd4): TLS live tests pass. Not a public CA, not Neon. |
| 6 | C | Startup refuses when DATABASE_URL is missing (postgres mode) | VERIFIED (local) | Audit record; not re-run this session |
| 7 | C | Startup refuses when the database is unreachable, and the error contains no password | VERIFIED (local) | Audit record; not re-run this session |
| 8 | B | Startup refuses an unmigrated or outdated schema | NOT VERIFIED | Audit record; not re-run this session |
| 9 | B | File mode is labeled as development only, and never as PostgreSQL | VERIFIED (local) | Audit record; not re-run this session |
| 10 | E | Live DB tests run only against an explicitly allowed database | VERIFIED (local) | Audit record; not re-run this session |
| 11 | B | Migration v2: idempotency keys scoped per character (not global) | VERIFIED (local) | Audit record; not re-run this session |
| 12 | B | Migration v2 down-migration | NOT VERIFIED | Audit record; not re-run this session |
| 13 | B | Migration CLI `status` and `migrate`; re-running is a no-op | VERIFIED (local) | Audit record; not re-run this session |
| 14 | D | Concurrent debits cannot overdraw a balance | VERIFIED (local) | Audit record; not re-run this session |
| 15 | D | Same idempotency key applied exactly once under concurrency | VERIFIED (local) | Audit record; not re-run this session |
| 16 | B | Failed transaction rolls back balance and ledger together | VERIFIED (local) | Audit record; not re-run this session |
| 17 | B | Database rejects a negative balance (check constraint) | VERIFIED (local) | Audit record; not re-run this session |
| 18 | B | Inventory integrity | NOT VERIFIED | Audit record; not re-run this session |
| 19 | B | World snapshot: first open creates, later opens load the same version | VERIFIED (local) | Audit record; not re-run this session |
| 20 | B | Stale writer is fenced; its data is not stored; health reports failure | VERIFIED (local) | Audit record; not re-run this session |
| 21 | B | Fenced instance cannot shut down cleanly (refuses to overwrite) | VERIFIED (local) | Audit record; not re-run this session |
| 22 | B | Two real processes writing the same world | NOT VERIFIED | Audit record; not re-run this session |
| 23 | B | Recovery after a simulated crash (final save skipped) | VERIFIED (local) | Audit record; not re-run this session |
| 24 | B | Recovery after a real process kill | NOT VERIFIED | Audit record; not re-run this session |
| 25 | B | Graceful shutdown saves final state; recovered on restart | VERIFIED (local) | Audit record; not re-run this session |
| 26 | B | Known limitation: a save committed but whose acknowledgement is lost is reported as failure | PARTIALLY VERIFIED | Audit record; not re-run this session |
| 27 | B | `/health` reports persistence status (200 healthy, 503 fenced) | VERIFIED (local) | Audit record; not re-run this session |
| 28 | B | Account and character repository persistence | PARTIALLY VERIFIED | Audit record; not re-run this session |
| 29 | B | JSON → PostgreSQL importer: dry-run writes nothing | NOT VERIFIED (deferred by owner) | Audit record; not re-run this session |
| 30 | B | Importer: create, no-op re-run, refuse different world, `--replace` with backup, rollback on interruption, ... | NOT VERIFIED (deferred by owner) | Audit record; not re-run this session |
| 31 | B | Importer: source is never modified; backup has a verified checksum | NOT VERIFIED (deferred by owner) | Audit record; not re-run this session |
| 32 | B | Importer: JSON → PostgreSQL → resumed session | NOT VERIFIED (deferred by owner) | Audit record; not re-run this session |
| 33 | B | Importer run against real player data | NOT VERIFIED | Audit record; not re-run this session |
| 34 | B | Importer kept in this commit | NOT VERIFIED (deferred by owner) | Audit record; not re-run this session |
| 35 | C | Prometheus endpoint (`/metrics/prometheus`, text format 0.0.4) | VERIFIED (local) | Audit record; not re-run this session |
| 36 | C | Prometheus scrape by a real server; alerting rules | NOT VERIFIED | Audit record; not re-run this session |
| 37 | C | Grafana dashboards, alert rules, log aggregation, distributed tracing | NOT VERIFIED (not implemented) | Audit record; not re-run this session |
| 38 | C | Load test (throughput, latency, persistence under load) | NOT VERIFIED (not implemented) | Audit record; not re-run this session |
| 39 | C | Platform testing (#10) | BLOCKED | Audit record; not re-run this session |
| 40 | D | 3D multiplayer testing (#11) | NOT VERIFIED | Audit record; not re-run this session |
| 41 | D | Cross-region events, advanced sync, anti-cheat (from Stage 25 list) | NOT VERIFIED (not implemented) | Audit record; not re-run this session |
| 42 | E | Stage 27 documentation corrections (table count, TLS claim) | VERIFIED (local) | Audit record; not re-run this session |
| 43 | E | Stage 27 report files (infrastructure, load test, security and recovery, launch readiness) | PARTIALLY VERIFIED | Audit record; not re-run this session |
| 44 | E | Lint: no new errors compared with the baseline | VERIFIED (local) | 30bfcd4: 29 errors, same breakdown as the baseline in STAGE_29 section 26 (24 unused-vars, 5 explicit-any). No new errors. |
| 45 | E | Full test suite, default configuration (no database) | VERIFIED (local) | 30bfcd4, no database: 1074 total, 1037 pass, 0 fail, 37 skipped. |
| 46 | E | Full test suite, against local PostgreSQL 18.4 | VERIFIED (local) | 30bfcd4, disposable local PostgreSQL 18.4 with TLS: 1166 total, 1166 pass, 0 fail, 0 skipped. Local only, not Neon or production. |
| 47 | C | Live Neon validation | BLOCKED | Audit record; not re-run this session |
| 48 | C | Production deployment readiness | NOT VERIFIED (not implemented) | Audit record; not re-run this session |
| 49 | D | Record-level validators for property, government, election, and justice maps | PARTIALLY VERIFIED | Audit record; not re-run this session |
| 50 | D | Record validator diagnostics do not expose values | VERIFIED (local) | Audit record; not re-run this session |
| 51 | D | Valid schema-18 world round-trips with no loss and stable IDs | VERIFIED (local) | Audit record; not re-run this session |
| 52 | D | Health test is deterministic about the contract | VERIFIED (local) | Audit record; not re-run this session |
| 53 | D | Integration tests use an isolated state file; live file unchanged | VERIFIED (local) | Audit record; not re-run this session |
| 54 | E | Stage 28 complete | NOT VERIFIED | Audit record; not re-run this session |

### 27.9 Blockers, owner decisions, and external capabilities (phases 7 and 9)

Owner decisions (none were made in this work):

1. **INPUT-START-1.** Should F3 switch worlds while the character-creation card is shown? Options: allow, or refuse like a modal.
2. **ACT-1.** Confirm V for `toggle_first_person`, or choose another key.
3. **OWNER-TEST-11.** Is uniform random choice of the starter household intended? The test now pins one case and does not change production.
4. **Authorization rules R-a to R-f** (`STAGE_28_GOVERNMENT_AUTHORIZATION.md`), needed before government and election writes can be re-enabled.
5. **CI scope.** Should CI run the live-database and TLS suites (needs a database service) and the Godot suites?
6. **Importer.** Keep deferred, or schedule it, given that Stage 28 criterion 29 to 34 depend on it.

External capabilities needed:

- A graphical display and GPU, and a physical keyboard, for rendered Stage 29 checks and physical key verification.
- A network route to a Neon development database, and its connection string supplied by the operator through a git-ignored
  `.env` on the test host. Never through chat or the repository.
- A deployment platform, its ingress or load-balancer rules (blocking `/metrics`), and the trusted-proxy list.
- A public CA-signed TLS PostgreSQL server for the verified-handshake criterion (criterion 5). The private test CA covers only the local mechanism.
- Two OS processes against one production-like database, and a hard-kill harness (criteria 22 and 24).
- A Prometheus server, for scraping, if monitoring is to be claimed.

**Single most important blocker (based on evidence).** Consequential actions are not authorized by a finished model. The
authority model is a design, and government and election writes are contained by suspension rather than authorized. The permanent
rules are NOT IMPLEMENTED (`STAGE_28_GOVERNMENT_AUTHORIZATION.md`, `STAGE_28_AUTHORITY_MODEL.md`). Deployment topology and Neon evidence are also
missing, but they can be resolved with infrastructure. The authorization gap needs design and implementation decisions.

### 27.10 Register updates

| ID | Area | Issue | Severity | Status | Section | Owner decision? |
|---|---|---|---|---|---|---|
| TEST-11 | domain_smoke | Check total varied by run (random starter profile) | Low | FIXED_VERIFIED (test reproducibility). Cause corrected: profile, not ID | 27.3 | Confirm intent (OWNER-TEST-11) |
| GUARD-SELFTEST-1 | save_guard_headless | Refused start did not stop the run; shared slot | Medium | FIXED_VERIFIED (`30bfcd4`). Before and after shown with barrier harness, not committed | 27.5 | No |
| GUARD-LOCK-1 | Atomic lock | Simultaneous `make_dir` race not forced | Low | NOT_VERIFIED (forced race). Observed in 3 barrier rounds | 27.5 | No |
| INPUT-START-1 | F3 on creation card | F3 switches with no character; not a modal | Medium | OPEN (OWNER DECISION) | 27.4 | Yes |
| ACT-1 | Input | `toggle_first_person` = V, no documented key | Low | OPEN (OWNER DECISION). Kept as provisional technical default | 27.4 | Yes |
| KEY-1 | World-switch key | Physical F3 keypress | Low | BLOCKED (no keyboard or display) | 27.4 | No |
| KEY-2 | Input | Space: `jump` and `ui_accept` | Low | NOT AN ISSUE (scratch probe plus structural test) | 27.4 | Revisit if GUI added to 3D |
| MODAL-GATE-1 | 2D modal gate | Section 26.12 said code reading only | Low | NOT AN ISSUE (covered headless by `load_confirmation_headless`) | 27.4 | No |
| INPUT-MIX-1 | Bindings | Physical keys for F3, Space, V; logical keys for WASD, Shift, E | Low | KNOWN_LIMITATION (not changed) | 27.4 | Yes, if binding policy changes |
| TOUCH-1 | touch_controls.gd | Not instantiated; `_input` cannot run | Low | KNOWN_LIMITATION | 27.4 | No |
| GOV-1 | Government and election writes | Contained by suspension; permanent rules R-a to R-f not implemented | High | OPEN | 27.8 | Yes (rules) |
| MULTI-1 | Multi-instance | Not implemented; fencing tested in one process only | High | OPEN | 27.8 | Yes |
| BACKUP-1 | Backup and restore | Library only; no operator tool, encryption, retention, or scheduling | Medium | OPEN | 27.8 | No |
| IMPORT-1 | JSON importer | Deferred by owner decision | Low | KNOWN_LIMITATION | 27.8 | Yes |
| CI-1 | CI scope | No live DB, TLS, or Godot suites in CI | Medium | OPEN | 27.8 | Yes |
| DEPLOY-1 | Deployment and ingress | No configuration in repository | High | BLOCKED | 27.8 | No (needs platform) |
| NEON-1 | Neon | No route, no credentials | High | BLOCKED | 27.8 | No (needs operator) |
| LINT-1 | Lint | 29 errors, baseline unchanged | Low | OPEN (not chased) | 27.6 | No |
| ENV-2 | Display | No display or GPU | High | BLOCKED | 25.3 | No |
| STAGE-29 | Rendered validation | Not performed | High | BLOCKED (graphical display unavailable) | 27.7 | No |
| STAGE-28 | Stage 28 | Criteria open; 54 criteria in 27.8 | High | OPEN | 27.8 | Yes |

### 27.11 Delivery and limits

- Commits on `arena/00cdea0e-naija`: `40b93a6` (TEST-11, `domain_smoke.gd`), `30bfcd4` (save-guard self-test, `save_guard_headless.gd`),
  and this documentation commit. Pushed as normal fast-forward pushes. The remote tip is verified after the push.
- Not staged: saves, backups, locks, harnesses, probes, barrier scripts, and the disposable PostgreSQL data directory. All of these
  are in `/tmp` (scratch, not committed).
- Production code changed: none. Protected areas (regional, climate, catalogs, `ng:state:fc`, environment-profile generator,
  `time_of_day.gd`, authentication, Stage 28, Stage 30) were not modified.
- Not tested, or limited: rendered output, mouse input, and physical keys (no display). Official Godot release (custom build only).
  Neon and any production or deployed environment. Real process kill. Two OS processes against one production-like database.
  Forced lock race. FI-13 and FI-14 remain scratch-only (section 26). The disposable PostgreSQL run used trust authentication on
  loopback and was stopped afterwards.
