# Architecture

## Current shape

The Stage 0 Node/TypeScript API and Stage 1 local Godot prototype remain in place. Stage 2 added optional multiplayer; Stage 3 extends the same project with a bounded geographic data pipeline and a geographic preview/presence foundation. Offline local state remains separate from online state.

```text
Godot client (game/)                                     Node world API (services/world-api/)
┌────────────────────────────────────┐                   ┌────────────────────────────────────┐
│ Stage 1 local Idera Quarter        │                   │ HTTP: /health, /api/v1/world       │
│   └── user:// local save/load      │                   │                                    │
│                                    │                   │ One nigeria-main clock/state file  │
│ Stage 3 bounded Akure South preview│◄── processed JSON │ Geography catalog + import model   │
│   ├── OSM roads/buildings/POIs     │                   │ Canonical NG/state/LGA identities  │
│   └── local geographic conversion  │                   │                                    │
│ Optional Stage 2/3 WebSocket client│◄──── JSON /ws ───►│ Authoritative player/location rules│
│   ├── interpolated remote players  │                   │ 500 m chunk/nearby interest        │
│   └── local session config         │                   │ One process + one JSON file        │
└────────────────────────────────────┘                   └────────────────────────────────────┘
     Offline Stage 1 save is separate                    No DB/distributed ownership
```

There is one canonical logical world, `nigeria-main`. The processed geography catalog adds national administrative identity and one small Akure South feature sample; it does not create a second world, a shard, or full national geography.

## Implemented boundaries

### Godot client

- `game/scripts/domain/`: retained Stage 1 character, household, school, dialogue, local clock and Stage 3 `GeographyModel` conversion/chunk functions.
- `game/scripts/services/save_service.gd`: Stage 1 client-local, versioned save; it remains separate from online authority and now tolerates an optional geographic-location record.
- `game/scripts/services/multiplayer_client.gd`: WebSocket session create/resume, reconnect attempts and JSON messages.
- `game/scripts/world/geographic_region_preview.gd`: loads the small processed Akure South file, draws mapped line/polygon/POI data, displays OSM attribution and provides read-only POI markers.
- `game/scripts/world/world_map.gd`: keeps Idera Quarter as the default map, toggles the bounded geography preview only outdoors, and exposes mapped schools/health points/named buildings as generic inspect actions.
- `game/scripts/player/player_actor.gd`: keyboard movement offline; in online mode interpolates toward server-computed position and sends movement intent.
- `game/scripts/player/remote_player.gd`: interpolates filtered public presence and retains geographic region/chunk fields.
- `game/scripts/prototype_game.gd` and `game/scripts/ui/prototype_ui.gd`: preserve Stage 1/2 actions and route the map toggle, geography enter/leave, POI inspection and multiplayer interactions.

Online money, inventory, needs, education records, location, position, geographic identity and clock are server-owned snapshots. The client loads the processed map-data file for rendering; it does not choose its own server-verified state/LGA/ward IDs.

### Node server and geography modules

- `services/world-api/src/app.ts` retains `GET /health` and `GET /api/v1/world`, adds the WebSocket endpoint (`/ws` by default), and enforces upgrade path/origin and a message-size cap. The world descriptor truthfully reports the Stage 3 bounded coverage.
- `services/world-api/src/geography/types.ts` defines WGS84 coordinates, the one-world geographic location, administrative/region/asset structures and processed geometry types.
- `services/world-api/src/geography/coordinates.ts` implements coordinate validation/normalization, local equirectangular conversion, viewport conversion, haversine distance and a stable global 500 m chunk grid.
- `services/world-api/src/geography/importer.ts` validates the pinned source artifacts and deterministically normalizes the 37 state/FCT records, 774 LGA records, 11 ward reference points and bounded GeoJSON feature sample.
- `services/world-api/src/geography/catalog.ts` loads/validates the processed region, derives a server geographic identity from coordinates/map position and validates persisted player location fields.
- `services/world-api/src/multiplayer/world-engine.ts` owns identities, sessions, server-tick movement, shared clock, actions and geographic enter/leave/location updates. It filters presence/chat/waves for geographic players by same local scene, region, neighboring chunks and metric proximity. Legacy Stage 2 players with no geographic location remain supported.
- `services/world-api/src/multiplayer/persistence.ts` validates/migrates Stage 2 character records that do not yet have `geographic_location`, and writes state snapshots through a temp file plus rename.
- `services/world-api/src/multiplayer/types.ts` defines the world, per-player character and public-presence records.
- `tools/geography/extract-osm-preview.mjs` deterministically extracts the committed bounded sample from an upstream preview file; `tools/geography/import-geography.mjs` invokes the validated TypeScript import and writes deterministic processed files plus a hash/provenance manifest.

The regional processed file is bundled with the Godot project and is also read by the server from the repository. There is no new HTTP map endpoint or remote tile fetcher. The selected area is a small bounded sample, not a complete or live map feed. Source terms and limitations are in [`DATA_SOURCES.md`](DATA_SOURCES.md).

## State ownership and data separation

The JSON persistence file's versioned top-level state has:

- `worldId: nigeria-main` and one `worldClock`, shared by connected online players;
- `players`, keyed by server-issued player ID, with identity hashes, bounded request-ID history and a server-owned `CharacterRecord`;
- `CharacterRecord.geographic_location`, nullable and optional in older Stage 2 files. A Stage 2 record is migrated to `null` at load; a populated value includes world/region/country/state/LGA/settlement/optional ward, latitude/longitude, local metric position and stable chunk ID.

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

The local Stage 1 `user://naija-stage1-save.json` remains separate. Offline and online characters are distinct records. The session token and random identity-recovery key are not stored in plaintext by the server; the server stores SHA-256 hashes. The client stores its bearer token/recovery key in a local Godot `ConfigFile`—not secure credential storage or external-account authentication.

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
3. The client sends intents: sequenced normalized movement direction/run intent (not a position), a selected travel entrance, purchase/consume item, class answer, chat, nearby wave, or optional `geography.enter`/`geography.leave` request.
4. Server rules decide bounds/speed, accepted locations and spawns, prices, balances, inventory changes, care/rest effects, quiz correctness, chat recipients, interaction range and server-derived geographic identity. Updated characters are returned as snapshots and filtered presence/world views are broadcast.
5. Successful Stage 2 state-changing commands require request IDs and use bounded per-player deduplication. Geography enter/leave are reversible interest/location toggles. Validated character/clock changes are persisted to the JSON store.

The server ticks at 20 Hz by default; client movement input is sent about 20 times per second and presence/clock snapshots are broadcast about 10 times per second. Movement is clamped to a 1600×900 prototype map with server-owned walk/run speeds; authoritative wall-collision/pathfinding is not implemented. The server validates message size/shape, movement sequence/rate, action range, chat length/rate, global command rate, connection attempts and browser origin configuration.

## Persistence and clock limits

The state file defaults to `services/world-api/data/world-state.json` (ignored by Git) and is configurable with `DATA_FILE`. The store validates schema version `1`, refuses malformed state rather than silently resetting, rejects files above 16 MiB and atomically replaces snapshots. Optional geography migrates old Stage 2 records to a null location without resetting local/online identity. There is no database transaction, journal/event log, distributed lock, full migration framework, encryption, backup/restore job or multiwriter coordination. Do not point multiple server processes at the same file.

The shared clock starts at Day 1, 07:50 for a new world file and advances one game minute per 650 ms by default. It continues while the server process is running (including with zero online players); it pauses during downtime and does not catch up after restart. Needs currently decay only for connected players. These remain prototype rules.

## Not implemented

- Complete official/state/ward administrative boundary geometry, full national detail, complete city/building coverage or all settlements.
- Port Harcourt/Rivers geographic sample, multi-region extraction service, national tile streaming or automatic online data downloads.
- Routing graph, public transport schedules, vehicle traffic, building interiors, regional environment/terrain/weather simulation or climate-driven events.
- Production authentication/account recovery, database transactions, distributed ownership/operations, encrypted credentials, backups/high availability, production WSS deployment, moderation/privacy tooling, comprehensive anti-cheat/collision/pathfinding, or full Stage 1 domain synchronization.
- Stage 4 — Complete Education System; it has not started.

Do not describe prototype scope as national coverage or production capacity. See [`MULTIPLAYER_PLAN.md`](MULTIPLAYER_PLAN.md), [`WORLD_PLAN.md`](WORLD_PLAN.md), [`DATA_SOURCES.md`](DATA_SOURCES.md) and [`SECURITY_PLAN.md`](SECURITY_PLAN.md).

## Verification boundary

Node build/lint/tests and deterministic geography import checks run in this environment. The backend suite exercises real two-client legacy and geographic synchronization, movement, filtering, chat/wave, identity recovery, deduplication, persistence across API restart, clock rollover, payload validation and origin rejection. Geography tests validate source and processed-data invariants. GDScript formatting/lint tools are static only. Godot is unavailable here, so project import, scene loading, rendered geography, retained Stage 1 runtime/save-restart tests, multiplayer Godot UI and platform exports remain unverified. Exact results are in [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).
