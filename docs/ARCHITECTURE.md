# Architecture

## Current shape

The Stage 0 Node/TypeScript API and Stage 1 local Godot prototype remain in place. Stage 2 added optional multiplayer; Stage 3 extends the same project with a bounded geographic data pipeline and geographic preview/presence; Stage 4 adds a data-driven education domain integrated into offline play, online authority, the shared clock, geography, existing character money/family, and persistence. Offline local state remains separate from online state.

```text
Godot client (game/)                                     Node world API (services/world-api/)
┌────────────────────────────────────┐                   ┌────────────────────────────────────┐
│ Stage 1 local Idera Quarter        │                   │ HTTP: /health, /api/v1/world       │
│   └── user:// local save/load      │                   │                                    │
│ Stage 3 bounded Akure South preview│◄── processed JSON │ One nigeria-main clock/state file  │
│   └── geographic conversion        │                   │ Geography catalog + import model   │
│ Stage 4 school/campus/training UI  │                   │ Education catalog + domain rules   │
│   └── student record in character  │                   │ Server-owned student/character data│
│ Optional Stage 2/4 WebSocket client│◄──── JSON /ws ───►│ Authoritative location/education   │
│   ├── interpolated remote players  │                   │ 500 m chunk/nearby interest        │
│   └── local session config         │                   │ One process + one JSON file        │
└────────────────────────────────────┘                   └────────────────────────────────────┘
     Offline Stage 1 save is separate                    No DB/distributed ownership
```

There is one canonical logical world, `nigeria-main`. The processed geography catalog adds national administrative identity and one small Akure South feature sample; it does not create a second world, a shard, or full national geography.

## Implemented boundaries

### Godot client

- `game/scripts/domain/`: retained Stage 1 character, household, school, dialogue, local clock and Stage 3 `GeographyModel` conversion/chunk functions; Stage 4 `education_service.gd` loads the shared catalog and applies offline enrollment, attendance, assessment, progression, exam, pathway, funding and history rules. `school_service.gd` adapts the existing timetable/class interface to this education domain.
- `game/scripts/services/save_service.gd`: client-local, versioned save; it remains separate from online authority, tolerates optional geography, and reads version-1 local saves into the current record, migrating legacy scores/attendance to structured education data.
- `game/scripts/services/multiplayer_client.gd`: WebSocket session create/resume, reconnect attempts and JSON messages.
- `game/scripts/world/geographic_region_preview.gd`: loads the small processed Akure South file, draws mapped line/polygon/POI data, displays OSM attribution and provides read-only POI markers.
- `game/scripts/world/world_map.gd`: keeps Idera Quarter as the default map, toggles the bounded geography preview only outdoors, and exposes mapped schools/health points/named buildings as generic inspect actions. Stage 4 adds same-world schoolyard/classroom and fictional university/polytechnic/skills-centre locations and education NPC anchors.
- `game/scripts/player/player_actor.gd`: keyboard movement offline; in online mode interpolates toward server-computed position and sends movement intent.
- `game/scripts/player/remote_player.gd`: interpolates filtered public presence and retains geographic region/chunk fields.
- `game/scripts/prototype_game.gd` and `game/scripts/ui/prototype_ui.gd`: preserve Stage 1–3 actions and route map/geography/multiplayer interactions alongside Stage 4 education summary, timetable, subject, attendance, result, exam, application, scholarship, fee, training and progression UI. UI rendering/client workflows have not been verified in Godot.

Online money, inventory, needs, education records, location, position, geographic identity and clock are server-owned snapshots. The client loads the processed map-data file for rendering; it does not choose its own server-verified state/LGA/ward IDs.

### Node server and geography modules

- `services/world-api/src/app.ts` retains `GET /health` and `GET /api/v1/world`, adds the WebSocket endpoint (`/ws` by default), and enforces upgrade path/origin and a message-size cap. The world descriptor truthfully reports Stage 3's bounded geographic coverage and Stage 4's education implementation flag/scope.
- `services/world-api/src/geography/types.ts` defines WGS84 coordinates, the one-world geographic location, administrative/region/asset structures and processed geometry types.
- `services/world-api/src/geography/coordinates.ts` implements coordinate validation/normalization, local equirectangular conversion, viewport conversion, haversine distance and a stable global 500 m chunk grid.
- `services/world-api/src/geography/importer.ts` validates the pinned source artifacts and deterministically normalizes the 37 state/FCT records, 774 LGA records, 11 ward reference points and bounded GeoJSON feature sample.
- `services/world-api/src/geography/catalog.ts` loads/validates the processed region, derives a server geographic identity from coordinates/map position and validates persisted player location fields.
- `services/world-api/src/education/catalog.ts`, `types.ts` and `service.ts` load/validate the shared fictional content/rules, define persistent student records and enforce server-side enrollment, timetable, attendance, grades/progression, examinations, tertiary admissions/semesters, vocational training/apprenticeships, scholarships and history.
- `services/world-api/src/multiplayer/world-engine.ts` owns identities, sessions, server-tick movement, shared clock, geography and education actions. It validates education locations/time and keeps lesson/course/final-exam scores, attendance, fees, awards and progression server-authoritative. It filters presence/chat/waves for geographic players by same local scene, region, neighboring chunks and metric proximity. Legacy Stage 2/3 records remain supported.
- `services/world-api/src/multiplayer/persistence.ts` validates/migrates older character records that lack `geographic_location` or `education_record`, and writes state snapshots through a temp file plus rename.
- `services/world-api/src/multiplayer/types.ts` defines the world, per-player character (including `StudentEducationRecord`) and public-presence records. `services/world-api/test/education.test.mjs` exercises online education action, attendance, co-presence and persistence behavior.
- `tools/geography/extract-osm-preview.mjs` deterministically extracts the committed bounded sample from an upstream preview file; `tools/geography/import-geography.mjs` invokes the validated TypeScript import and writes deterministic processed files plus a hash/provenance manifest.

The regional processed file is bundled with the Godot project and is also read by the server from the repository. There is no new HTTP map endpoint or remote tile fetcher. The selected area is a small bounded sample, not a complete or live map feed. Source terms and limitations are in [`DATA_SOURCES.md`](DATA_SOURCES.md).

## State ownership and data separation

The JSON persistence file's versioned top-level state has:

- `worldId: nigeria-main` and one `worldClock`, shared by connected online players;
- `players`, keyed by server-issued player ID, with identity hashes, bounded request-ID history and a server-owned `CharacterRecord`;
- `CharacterRecord.geographic_location`, nullable; older Stage 2 records without it are normalized to `null`. A populated value includes world/region/country/state/LGA/settlement/optional ward, latitude/longitude, local metric position and stable chunk ID.
- `CharacterRecord.education_record`, a per-character server-owned `StudentEducationRecord` containing enrollment/progression, subjects, attendance, assessments, term results, final-exam attempts, qualifications, applications, tertiary/vocational/apprenticeship records, skills, scholarships and ordered bounded history. New records initialize from `game/data/education/catalog.json`; legacy Stage 2/3 education fields are normalized into the structured form without replacing player identity, money, household, position or geography. Static education rules/content remain outside the player file.

A connected public-presence view exposes selected profile/appearance, current local-scene position, nullable geographic identity, region/chunk IDs, connection status and last-seen time. Geographic presence is included only for nearby observers; a character snapshot returns the complete record to that player's session. Administrative source IDs and canonical game IDs are distinct.

The geographic source and delivery path is separate from gameplay logic:

```text
game/data/geography/source/      pinned subset/source artifacts + source license notices
        │ validated deterministic import (TypeScript)
        ▼
game/data/geography/processed/   stable client/server catalog + SHA-256/provenance manifest
        │                                │
        ├── Godot preview renderer       └── server catalog/location validation
        └── map inspection data              (no map gameplay hard-coding)
```

The local `user://naija-stage1-save.json` remains separate. Offline and online characters are distinct records; the current local save schema migrates version-1 saves by translating legacy scores and attendance into an education record. The online session token and random identity-recovery key are not stored in plaintext by the server; the server stores SHA-256 hashes. The client stores its bearer token/recovery key in a local Godot `ConfigFile`—not secure credential storage or external-account authentication.

## Geographic coordinate, chunk and presence flow

1. Importer input is WGS84/CRS84. It validates range, broad country placement, geometry structure, source IDs/layers, viewport intersection, and provenance. Canonical location IDs come from normalized administrative source names/codes, not OSM IDs or uncertain Wikidata values.
2. The regional local metric frame is equirectangular about `(longitude 5.2°, latitude 7.25°)`, with 1 game unit per metre, `x` east, `y` south and 0.001 m position precision. WGS84 storage is rounded to seven decimal degrees. The sample viewport is separately mapped linearly to the 1600×900 playable map pixels.
3. The Nigeria-wide chunk grid is stable across regional origins: 500 m cells using a 9° central-latitude equirectangular x-grid and equatorial y-grid, IDs `ng:500m:{column}:{row}`. Each feature is conservatively indexed across its axis-aligned geometry bounds (some cells may not intersect the geometry). The prototype includes a helper to select data by chunk, but loads this bounded 200-feature sample as one file.
4. When a player toggles **Map data** outdoors, the client sends `geography.enter` with only the known sample-region ID. The server derives coordinates/admin IDs/chunk from the server-owned current map position and returns the authoritative snapshot. On town-map movement the server recomputes that location. `geography.leave` clears it. Travel into a Stage 2 indoor/school subscene clears the geographic position; the user can opt in again when outside.
5. Public presence and social interactions require the same local scene. If both players carry geography, the server also requires the same region, a chunk within a one-cell Chebyshev radius and distance no more than 1,500 m for presence. Chat/waves use their tighter action radii. Players with no geographic location retain the Stage 2 legacy behavior; a geographic player and legacy-only player are not mixed into unfiltered global interest lists. The client applies the same nearby filter before rendering remote avatars.

Chunks and regions organize one map and interest set; they do not own separate copies of the world. Current server/client loading is a small foundation, not an implementation of national tile streaming, route graph delivery, or production-scale player interest management.

## Online command flow

1. An untrusted client connects to the configured WebSocket path and requests a server-issued identity using a client recovery key, or presents a saved session token.
2. The server stores only token/key hashes, validates the selected profile, rejects duplicate live sessions, and sends that player's character, shared clock and filtered presence list.
3. The client sends intents: sequenced normalized movement direction/run intent (not a position), selected travel entrance, purchase/consume item, class/course/final-exam answer, education action, chat, nearby wave, or optional `geography.enter`/`geography.leave` request. Online education uses `school.begin`/`school.answer` and `education.action`; answer payloads do not include trusted marks or balances.
4. Server rules decide bounds/speed, accepted locations and spawns, prices, balances, inventory changes, care/rest effects, quiz correctness, education attendance/results/progression/fees, chat recipients, interaction range and server-derived geographic identity. Updated characters (including education records) are returned as snapshots and filtered presence/world views are broadcast.
5. Consequential state-changing commands use request IDs and bounded per-player deduplication. Geography enter/leave are reversible interest/location toggles. Validated character/clock/education changes are persisted to the JSON store.

The server ticks at 20 Hz by default; client movement input is sent about 20 times per second and presence/clock snapshots are broadcast about 10 times per second. Movement is clamped to a 1600×900 prototype map with server-owned walk/run speeds; authoritative wall-collision/pathfinding is not implemented. The server validates message size/shape, movement sequence/rate, action range, chat length/rate, global command rate, connection attempts and browser origin configuration.

## Persistence and clock limits

The state file defaults to `services/world-api/data/world-state.json` (ignored by Git) and is configurable with `DATA_FILE`. The store validates schema version `1`, refuses malformed state rather than silently resetting, rejects files above 16 MiB and atomically replaces snapshots. Older records without geography normalize to a null location; older character records without the structured education field initialize it from legacy education level, scores and attendance while preserving player identity and other Stage 2/3 state. There is no database transaction, journal/event log, distributed lock, full migration framework, encryption, backup/restore job or multiwriter coordination. Do not point multiple server processes at the same file.

The shared clock starts at Day 1, 07:50 for a new world file and advances one game minute per 650 ms by default. It continues while the server process is running (including with zero online players); it pauses during downtime and does not catch up after restart. Needs currently decay only for connected players. These remain prototype rules.

## Not implemented

- Complete official/state/ward administrative boundary geometry, full national detail, complete city/building coverage or all settlements.
- Port Harcourt/Rivers geographic sample, multi-region extraction service, national tile streaming or automatic online data downloads.
- Routing graph, public transport schedules, vehicle traffic, building interiors, regional environment/terrain/weather simulation or climate-driven events.
- Production authentication/account recovery, database transactions, distributed ownership/operations, encrypted credentials, backups/high availability, production WSS deployment, moderation/privacy tooling, comprehensive anti-cheat/collision/pathfinding, or full Stage 1 domain synchronization.
- Stage 5 age progression, births/deaths/generations and full family-life simulation; full careers/employment, banking/economy, education policy, official examination/accreditation integration, production database or national institutional coverage.

Do not describe prototype scope as national coverage or production capacity. See [`MULTIPLAYER_PLAN.md`](MULTIPLAYER_PLAN.md), [`WORLD_PLAN.md`](WORLD_PLAN.md), [`DATA_SOURCES.md`](DATA_SOURCES.md) and [`SECURITY_PLAN.md`](SECURITY_PLAN.md).

## Verification boundary

Node lint/build and all 26 backend tests pass in this environment, including education enrollment/progression, attendance, grading, exams, university/ND/HND/vocational/apprenticeship routes, scholarship/history persistence, two-client schoolyard co-presence, online attendance/action replication, save/restart and retained Stage 1–3 backend/geography regressions. The deterministic geography check passes for all three processed files. GDScript formatting passes for 19 scripts; GDScript lint still reports three file-length limits and one public-method-count limit. Godot is unavailable here, so project import, scene loading, offline/online education gameplay, rendered UI, local save/restart runtime tests, multiplayer Godot UI and platform exports remain unverified. Exact results are in [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).
