# Development Status

> **Future AI agents: read this file before modifying the project.** It separates implementation from verification; source code and test files are not proof of runtime behavior.

## Current stage and verification gate

**Stage 3 — Nigerian Geography Expansion: implementation present; Node/source-data checks are available; Godot runtime verification remains blocked.** Stage 0, Stage 1 and Stage 2 code/features remain in the project. Stage 3 adds one canonical Nigerian administrative catalog and a bounded Akure South map-data/player-presence foundation; it does not create another world or a national visual build.

Godot is not installed in this workspace. Therefore the Stage 1/2 client and Stage 3 renderer have not been imported, launched, visually reviewed or tested in-engine. Local save/load, controls, rendering, and the Godot two-client/reconnect flow remain unverified. The code preserves the prior default Idera experience, but an engine-level Stage 1/2 regression pass still needs Godot 4.7.2. Backend tests do not prove client runtime behavior.

The next roadmap stage is **Stage 4 — Complete Education System**. It has not started.

## Stage 0/1/2 preserved

- The Node HTTP foundation, existing `/health` and `/api/v1/world` routes and one logical world ID `nigeria-main` remain.
- The local Godot life retains character creation, household/home, fictional Idera Quarter map, travel/interactions, NPC dialogue, school activities, money/needs/inventory, local clock and client-local JSON save/load implementation.
- Stage 2's optional WebSocket multiplayer remains on the same Godot project and the server remains authoritative for online character actions/clock. Local Stage 1 saves remain separate.
- `CharacterState` gained an optional geographic-location dictionary for Stage 3; Stage 2 server records without that field are migrated to `null`. Geography preview is opt-in; the default town scene stays Idera.
- Stage 1/2 UI and server behavior were not deliberately removed. Engine regression status is **unknown/unverified**, not passed, because Godot is unavailable.

## Stage 3 geography implementation

### Administrative hierarchy and source boundary

- One `NG` country record and one `nigeria-main` world identity.
- 36 state records plus FCT and 774 canonical LGA records in `game/data/geography/processed/nigeria-admin.json`.
- Optional source Wikidata identifiers with three duplicate values reported and omitted; stable IDs derive from source state code/name and normalized LGA name.
- Eleven Akure South ward reference-point records. LGA/ward points are not mislabeled as administrative polygons, boundaries, survey-grade points or centroids.
- Akure is a settlement name/capital record without an authoritative coordinate; its association with this sample is explicitly a prototype association.

### Bounded playable sample

- Selected fallback region: **Akure South, Ondo State**. Port Harcourt/Rivers was preferred but no suitably bounded Port Harcourt data sample with clear provenance/terms was available for this implementation.
- Map viewport: west 5.188°, south 7.238°, east 5.212°, north 7.262°. It is a deterministic preview selection—not an LGA, ward or settlement boundary and not a completeness claim.
- 200 retained OSM preview features: 72 roads, 108 buildings, 13 waterways, 2 land-use features, 3 health facilities and 2 schools. Source layer, OSM source ID, available names and GeoJSON geometry are retained; original tags were not present in the upstream preview HTML.
- The data-driven Godot preview is toggled through the existing HUD **Map data** action outdoors. It draws mapped line/polygon/point content and exposes health/school features and named buildings as generic read-only inspect markers. Default Idera layout/interactions return when preview is turned off. This feature is implemented in source but has not been observed in Godot.
- Terrain, routing, transport schedules/traffic, full city/building/interior coverage, weather/climate and national streaming are not implemented. Processed region data reserves empty transport/environment extension IDs and stable chunk indexes.

### Import, provenance and coordinates

- Raw/pinned artifacts are in `game/data/geography/source/`; deterministic outputs and `import-manifest.json` are in `game/data/geography/processed/`.
- `tools/geography/extract-osm-preview.mjs` reproduces the bounded feature selection from the upstream preview artifact; the large upstream preview HTML is not committed. The OSM preview selection declares OGC:CRS84 longitude/latitude, source snapshot time, layer mapping, deterministic viewport/grid caps and the no-boundary caveat.
- `services/world-api/src/geography/importer.ts` validates pinned data and generates canonical records/features; `npm run geography:import` regenerates and `npm run geography:check` checks deterministic output. The import manifest records input/output SHA-256 hashes, pinned commits, source terms, counts and coordinate assumptions.
- WGS84 is stored to seven decimal degrees. The Akure local equirectangular frame is centered on longitude 5.2°, latitude 7.25°, with `x` east/`y` south, 1 game unit per metre and 0.001 m metric rounding. Preview pixels use a separate linear transform of the declared 1600×900 viewport. Stable geographic chunks are 500 m on a Nigeria-wide 9° central-latitude grid; chunks organize data/interest inside one world.
- No nationwide boundaries or OSM country dump are included. Exact source licenses/attribution/terms are in [`DATA_SOURCES.md`](DATA_SOURCES.md).

### Multiplayer foundation

- Online `CharacterRecord.geographic_location` is nullable and includes world/region/country/state/LGA/settlement/optional ward, WGS84 coordinates, local metric position and chunk ID.
- `geography.enter` is outdoor-only and takes a known region ID; the server derives geography from its authoritative map position. `geography.leave` clears it. The server updates location during outdoor movement and clears it when traveling to Stage 2 indoor/school subscenes.
- Public presence carries region/chunk identity and is filtered by same local scene, same region, neighboring 500 m chunks and a 1.5 km cap. Geographic chat/waves use metric distance. Legacy Stage 2 records/players without geography remain accepted and Stage 2-style nearby checks remain for two legacy players.
- Automated two-WebSocket-client tests exercise same-chunk synchronization and removal from nearby interest after movement to a distant chunk. Godot's real player/map/UI synchronization has not been tested.

## Technology and verification status

| Component | Baseline / check | Status |
|---|---|---|
| Node.js/npm | Node `v22.22.3`; npm `10.9.8` | `npm run check` passed on the current Stage 3 tree. |
| TypeScript API | Strict build, ESLint, HTTP/WebSocket/geography tests | `npm run check` passed: build/lint and 18 Node tests. |
| Geography import | `npm run geography:import` / `npm run geography:check` | Import succeeded; deterministic check passed for three processed files. |
| GDScript formatting/lint | `gdtoolkit` 4.5.0 (`/tmp/naija-gdtoolkit`) | `gdformat --check` passed for 18 scripts; `gdlint` passed. Static-only; does not replace engine import. |
| Godot | Project targets Godot 4.7.2 | Executable unavailable (`godot: command not found`); import, render, scene and client/runtime tests not run. |
| Database | None configured | JSON single-process prototype only; Postgres/PostGIS remain future candidates. |

### Executed Stage 3 checks (2026-10-08)

- `npm run check` — **passed**: ESLint, strict TypeScript build, and 18 Node tests (11 HTTP/WebSocket/world tests plus 7 geography importer/coordinates/catalog tests).
- `npm run geography:import` — **passed**: generated the national admin, Akure South region and provenance manifest from pinned source artifacts.
- `npm run geography:check` — **passed**: all three processed files reproducibly matched the importer output.
- `/tmp/naija-gdtoolkit/bin/gdformat --check $(find game -name '*.gd' -print)` — **passed**: 18 GDScript files unchanged by formatter.
- `/tmp/naija-gdtoolkit/bin/gdlint $(find game -name '*.gd' -print)` — **passed**: no static lint findings.
- Godot engine/import/client/runtime checks — **blocked/not run**: `godot` is not installed. The Node tests do not verify client rendering, input, save/load or two-window UI behavior.

## Commands and manual checks

From the repository root:

```sh
npm ci
npm run geography:import
npm run geography:check
npm run check
```

When Godot 4.7.2 is available, run retained Stage 1 domain/movement/save-restart scripts from the README, launch a local offline life, and verify that default Idera creation/movement/interactions/save/load still work. Then toggle **Map data** in the outdoor map; inspect road/building/school/health features; verify attribution and viewport caveat; toggle back and check Idera interactions. Finally test two online clients in the same sample chunk, move one out of interest, test map enter/leave and verify old clients/saves without geographic identity still load.

## Known limits and next gates

1. Continue running the TypeScript lint/build/tests and deterministic import check after changes; the current run passed as recorded above.
2. When Godot becomes available, run Stage 1/2 runtime regression and Stage 3 map/POI render/toggle/client integration; fix import/runtime errors before calling the client path verified.
3. Keep official boundary sources, data terms, attribution and source coordinate semantics under review before expanding the catalog. Do not imply Akure South coverage is complete or treat reference points as boundaries.
4. Before production multiplayer, design account security, database transactions/backups, privacy, abuse controls, distributed ownership and operations.
5. The next roadmap stage, after this Stage 3 implementation/test gate, is **Stage 4 — Complete Education System**; no Stage 4 work is included here.
