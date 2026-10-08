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

The future clock is a server-owned service with an explicit calendar and configured game-time rate. It should support:

- second, minute, hour, day, week, month and year units;
- birthdays, age progression, school years, terms and institutional schedules;
- elections, office terms, business cycles and economic events;
- day/night and weather/season inputs;
- scheduled world events and player-history timestamps.

Use a monotonic/process-safe time source for measuring elapsed server time and UTC timestamps for real-world audit records. Model the in-world calendar explicitly; do not equate a player's local device clock with authoritative game time. Keep Nigeria's civil-time zone (`Africa/Lagos`) distinct from the game's calendar and time multiplier.

## Offline progression and catch-up

For the eventual shared simulation, world time and selected systems should progress while an individual player is offline. The Stage 1 local prototype is an explicit exception: its simple day/minute clock advances only during active play, pauses with menus, is stored in the local save and does not progress while the app is closed. Stage 2/3 add a bounded server-owned clock shared among online players; it continues while the single server process is running, pauses during server downtime and does not catch up offline. Needs currently decay only for connected players. This is not the full offline-progression design. A future service should define canonical time anchors/configuration and process scheduled work in bounded, resumable batches.

Do not simulate every NPC every second. Use event scheduling and aggregate/cohort updates for low-priority populations, while preserving exact rules for important player-facing deadlines and economic/legal transactions. Define idempotency, ordering, pause/maintenance behavior, maximum catch-up work and recovery checkpoints so a long outage does not duplicate or skip irreversible events.

## Time and world design decisions still open

Before full simulation, specify and test:

- How much in-world time passes per real-world interval and whether the rate can ever change.
- Calendar month/weekday rules, leap handling, naming/localization, birthdays and cross-time-zone presentation.
- Which future environmental inputs need simulation, how regional variation works and which sourced data/license terms apply.
- Which updates are exact events versus aggregate approximations, and which require player notification.
- Clock ownership, failover, snapshots, ordering and acceptable drift between physical workers.
- Boundary-authoritative administrative datasets and expansion beyond the current reference-point catalog/sample.

Stage 1 implements a local prototype clock and fictional locations. Stage 2/3 retain one shared server clock for the bounded multiplayer prototype. Full calendar, weather, real-world boundaries, national visual detail and offline catch-up/progression remain future systems.
