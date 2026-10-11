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

**F4. Region change never applies the visual profile.** `change_region()` calls the controller's
`_configure_environment()`, which reads the controller's table. `EnvironmentConfig.apply_region_profile()` is never
called on region change. Switching region therefore changes the stored `region_id` but not sky, fog, or ambient.

**F5. The region is never delivered from 2D to 3D (defect in the restore path).** `scene_switcher.gd`
`_restore_3d_state()` passes `{"character": …, "world": …}` to the 3D `set_shared_state()`. The controller reads
top-level `region_id`, `time_of_day`, and `player_state`. The 2D `get_shared_state()` returns `character`, `clock`,
and `player_position`, with no region or world key. In practice the 3D world always starts on its default region.
Fixing this needs a 2D-to-state mapping, for example from `processed/akure-south-core.json` `state_id`. That is a
change to shared-state behaviour, not only to visuals, so it is **not** included in Stage 29 without a decision
(Section 9, D3).

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

**F8. Stale-profile behaviour.** `apply_region_profile()` on a missing region calls `push_warning` and returns
without resetting visuals, so the previous region's visuals remain. This is a stale-profile risk, but it is not
reachable from the current runtime, because `apply_region_profile` is never called on region change (F4).

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

## 6. Client load and render path (as found)

1. `scenes/main.tscn` contains `prototype.tscn` (2D) and `world_3d.tscn` (3D) with `scene_switcher.gd`. F3 toggles
   the mode. `world_3d.tscn` declares the `environment_config.gd` ext_resource (id `5_env`). Node wiring for the
   `$Environment` node was checked in the scene file only as an ext_resource; the in-scene node reference was not
   separately verified in this audit.
2. `EnvironmentConfig._ready()` applies the default region (`ng:state:od`, which is invalid, F1).
3. `WorldController._ready()` applies its own table through `_configure_environment()` (F2, F3).
4. Region change: `change_region()` → controller table only (F4).
5. 2D→3D restore: region not delivered (F5).

## 7. Existing tests

- `services/world-api/test/regional-registry.test.mjs`: 15 pass. Asserts every state has a complete environment
  block and checks diversity (at least 3 climates, at least 4 terrains) across all states.
- `services/world-api/test/geography.test.mjs`: 7 pass.
- No test reads `regional-environment-profiles.json` or any GDScript visual table.
- No GDScript test exists for `environment_config.gd` or `world_3d_controller.gd` region behaviour. Godot is not
  available (F11), so none can be run.

## 8. Per-region mapping table

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

With D3 deferred, the 3D world still starts on its default region. In the current build that is Ondo, and the Ondo
values equal the class defaults, so **the default startup view does not visibly change.** What changes:

1. The WorldEnvironment lookup is fixed. Today `_apply_to_world_environment()` never finds the node (F13 below), so
   no regional visual reaches the scene, including the default. After the fix, values reach the scene.
2. When the region changes through `change_region()`, sky, fog, and ambient light change to that region's preset.
   The player cannot trigger a region change yet, because D3 is deferred. This is a precondition for the player
   outcome, not the outcome itself.
3. Regions without a record show the Forest preset explicitly, with a warning, instead of Ondo's values by accident.

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
- `time_of_day.gd` uses the same broken `get_parent().get_node_or_null("WorldEnvironment")` lookup (F13). It controls
  day and night, so fixing it changes the day/night presentation, which is outside the profile scope. Reported as
  outstanding.
- Kaduna's visual `semi-arid` against the authoritative `tropical` (F9). The explicit record is preserved and the
  discrepancy is reported, not changed.
- No catalog, `regional-environment-profiles.json`, server, database, save, protocol, or corpus change.
- No Godot runtime claim. Client verification is static only, through `gdtoolkit` parsing, unless Godot can run.

### 12.9 Additional finding from implementation planning

**F13. The WorldEnvironment lookup never resolves.** `world_3d.tscn` places `WorldEnvironment` under the
`Environment` node. `EnvironmentConfig._apply_to_world_environment()` searches `get_parent()` (the `World3D` root)
for `WorldEnvironment`, so it finds nothing and returns. No regional visual has reached the scene. The same mistake
appears in `time_of_day.gd` (F13b, outstanding).

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

### 14.7 Headless GDScript test (written, NOT RUN)

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

- Godot 4.7.2 headless run: not done. Runtime claims are not made.
- Visual validation: not done.
- PostgreSQL: not run.
- F13b (`time_of_day.gd`): not fixed.
- F5 (2D-to-3D restore key mismatch): deferred by D3.
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
