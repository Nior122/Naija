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

## 10. Stage 29 status

- Phase A: **COMPLETE** (this document).
- Phase B to I: **NOT STARTED**. Blocked on D1 and D2.
- Client validation: **NOT RUN** (Godot unavailable, F11).
- Visual validation: **NOT DONE**.
- Stage 28: **OPEN**. Not closed by this audit.
- Production: **NOT READY**.
