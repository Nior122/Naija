# World and Time Plan

## One persistent Nigeria

The product has one canonical logical world, `nigeria-main` (country ID `NG`). Geographic regions, administrative units and chunks are spatial/content organization inside that world; they are not player-selectable shards or separately authoritative worlds.

```text
Nigeria (NG) · nigeria-main
└── 36 states + Federal Capital Territory
    └── Local government areas (LGAs)
        └── Cities / towns / villages
            └── Districts / neighborhoods / wards
                └── Roads / paths / public places / reusable POIs
                    └── Buildings
                        └── Optional interiors / rooms
```

Administrative names, boundaries and jurisdiction can change. Preserve source IDs, effective dates where known, aliases and provenance rather than treating a source name as timeless truth. Gameplay identity is separate from upstream dataset identifiers. A building can have multiple entrances/uses; not every playable interior needs full visual detail.

## Stage 3 — implemented bounded geography

The processed registry contains one country, 37 state/FCT records and 774 LGA records. The source LGA coordinates are published reference points; they are **not** relabeled as surveyed points, centroids or boundaries. Stable canonical state/LGA IDs use source code and normalized names, not optional Wikidata IDs. Three duplicate optional Wikidata values are retained as import warnings and omitted from normalized external IDs.

The selected visual/data prototype is a small **Akure South, Ondo State** sample because a suitably bounded Port Harcourt source with clear provenance and reusable terms was not available for this pass. Its map viewport is `[5.188, 7.238, 5.212, 7.262]` (west, south, east, north) in WGS84. This is a deterministic OSM-preview selection window only—not an official Akure South LGA boundary, a settlement boundary, or a completeness claim. The sample retains 200 mapped features: 72 roads, 108 buildings, 13 waterways, two land-use features, three health facilities and two schools. It is not a national map build, full city survey, route graph, or complete feature inventory.

The sample settlement record says Akure is Ondo's capital/town but provides no coordinate/boundary. Eleven Akure South ward rows are retained as published reference points with unspecified coordinate semantics; none is presented as a polygon or centroid. Ijomu/Obanla is a convenient prototype spawn/reference only. See [`DATA_SOURCES.md`](DATA_SOURCES.md) before redistributing or extending these datasets.

## Coordinates, import and precision

- Input and stored geographic coordinates are WGS84 decimal degrees. GeoJSON coordinate arrays follow the CRS84 order `[longitude, latitude]`; named records use `latitude` and `longitude` fields.
- The regional conversion is `local-equirectangular-v1`, centered for the sample at `(longitude 5.2°, latitude 7.25°)`. One game unit represents one local metre; `x` is east-positive and `y` is south-positive. The earth radius constant is 6,371,008.8 m. Metric local positions round to 0.001 m; geographic values round to seven decimal degrees. This local approximation is intended for a small region, not country-scale distance/area analysis.
- The national chunk grid is independent of each region's local origin: a stable 500 m equirectangular grid uses a 9° central latitude and IDs `ng:500m:{column}:{row}`. Chunk identity stays stable as maps load; chunks are spatial/content identifiers, not worlds or server shards. Feature indexes conservatively cover each geometry's axis-aligned coordinate bounds, so a feature may be indexed into cells it does not physically touch; this avoids dropping edge-spanning content and is not exact per-cell clipping.
- The 1600×900 geographic preview maps the declared viewport linearly to game-screen coordinates. This is a display transform, separate from metric local coordinates. Server-authored player geography is derived from the authoritative outdoor map position; a client does not supply administrative IDs.
- Import validation checks WGS84 ranges, a broad Nigeria window, layer mappings, unique source IDs, geometry structure/ring closure, sample-window intersection, a conservative geometry safety margin, and per-feature chunk IDs. Failures stop the import rather than silently dropping or reinterpreting source rows.
- Run `npm run geography:import` to regenerate processed assets, and `npm run geography:check` to compare deterministic outputs with pinned source inputs. Source artifacts, processed game data, code and gameplay actions are kept separate.

## Playable preview, content model and streaming foundation

Stage 1/2 remain playable in their original fictional Idera Quarter by default. In the outdoor town map, the HUD **Map data** toggle swaps in the bounded Akure South feature preview. Mapped schools, health features and named building records can be inspected as read-only data POIs. Turning the preview off restores the original Idera scene/interactions. No map feature creates a curriculum, business, route, interior or other gameplay rule merely by appearing in the data.

Roads, settlements, buildings and POIs are normalized geographic records with source IDs, layer/kind, geometry, administrative references and chunk indexes. Roads are map geometry only: no traffic, routing, bus network, navigation or ownership simulation is implemented. Building footprints do not imply complete buildings or interiors. Regional environment and transport extension IDs are explicitly empty; they provide attachment points for later terrain/biome/environment profiles and transport-network data without simulating those systems now.

The prototype keeps the current small regional asset in one client file; the processed records index assets by stable chunk IDs, and the server filters geographic presence by a neighboring-chunk interest window. This is a streaming/interest-management foundation, not runtime fetching of individual tiles, a national streaming service, or a claim that all features in a chunk are complete. Future clients can request visible chunks from the same `nigeria-main` world and load only the needed content.

## Terrain, regional variation, transport and weather (future extension points)

Do not treat one sample as a model of all Nigeria. A later sourced expansion can attach terrain elevation, land cover, hydrology, locally appropriate environment/vegetation, settlement density and sourced regional variation to bounded regions. Transportation should distinguish map geometry from routable road graphs, transit stops, schedules and simulated traffic. Climate/weather design should be based on Nigerian regional/climatic evidence, seasonal rainfall, temperature and flooding considerations—not imported four-season assumptions. Stage 3 adds only data slots and preparation notes; it does not implement full terrain, environment, transport, routing, weather or climate simulation.

## Persistent world clock

Stage 5 implements a server-owned calendar for the online `nigeria-main` world. A new world begins on 2025-01-01 (world day 1) at 07:50. One game minute advances every 650 real milliseconds by default; `GAME_MINUTE_MS` can configure one shared rate for the server/world. The persisted clock carries day, minute, millisecond remainder, calendar date and an update timestamp; seconds are derived from the remainder. The calendar supports Gregorian leap years, dates, weekdays/weeks, months and years. Client ages derive from DOB and the shared world date.

Birthday/life-stage events are recorded idempotently, and disconnected online characters/NPC records catch up to the current world date when server lifecycle processing runs. The clock continues while the server process is running, even with no connected players, but pauses during server downtime; downtime world-time catch-up is not implemented. Need decay remains limited to connected players.

The Stage 1 local/offline prototype retains its saved local clock and is not synchronized with the online server. Do not equate a player's device wall-clock with authoritative online game time. Keep Nigeria's civil-time zone (`Africa/Lagos`) distinct from the game's calendar and time multiplier. School scheduling currently consumes the existing game clock; elections, office terms, business cycles, weather/season systems, and long-term scheduled world events remain future systems.

## Offline progression and catch-up

Online life progression catches disconnected characters and household NPCs up to the current server date when lifecycle processing runs (including reconnect). Birthday and life-stage events are idempotent. The one world clock advances while the server process runs and pauses during server downtime; the current prototype does not advance world time over an API outage. Needs currently decay only for connected players.

Offline Godot mode remains client-local: its saved clock is not connected to the server clock and does not accrue wall-clock time while the game is closed. When local world dates advance through gameplay, the client lifecycle service can process missed birthdays/events from its saved `last_life_processed_date`. No separate region/player timeline is introduced to online play.

This remains bounded prototype catch-up, not the full offline-progression design. Do not simulate every NPC every second. Use event scheduling and aggregate/cohort updates for low-priority populations, while preserving exact rules for important player-facing deadlines and economic/legal transactions. Future services need bounded resumable batches, event ordering, maximum catch-up work and recovery checkpoints so outages do not duplicate or skip irreversible events.

## Time and world design decisions still open

Before full simulation, specify and test:

- How much in-world time passes per real-world interval and whether the rate can ever change.
- Localization and presentation of the implemented Gregorian calendar, cross-time-zone/device display, and any future calendar-specific school/community scheduling rules.
- Which future environmental inputs need simulation, how regional variation works and which sourced data/license terms apply.
- Which updates are exact events versus aggregate approximations, and which require player notification.
- Clock ownership, failover, snapshots, ordering and acceptable drift between physical workers.
- Boundary-authoritative administrative datasets and expansion beyond the current reference-point catalog/sample.

Stage 1 retains a local prototype clock and fictional locations. Stages 2–5 retain one shared server clock for the bounded multiplayer prototype; Stage 5 adds its calendar, DOB-based age and idempotent life catch-up. Weather, authoritative real-world boundaries, national visual detail, downtime catch-up and comprehensive offline progression remain future systems.
