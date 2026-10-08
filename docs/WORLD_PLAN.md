# World and Time Plan

## Geographic hierarchy

The world model should be able to represent:

```text
Nigeria
└── States and the Federal Capital Territory
    └── LGAs
        └── Cities / towns / villages
            └── Districts / neighborhoods
                └── Roads / paths / public places
                    └── Buildings
                        └── Interiors / rooms
```

Names, administrative boundaries, and jurisdiction may change over time. Preserve source, effective dates, aliases, and provenance rather than assuming every place is a timeless string. A building can have multiple entrances/uses; not every playable interior needs a full 3D representation.

## Coordinates and imported data

- Choose a documented coordinate reference system and units before importing real geographic data; keep conversions at import/API boundaries.
- Support point, line, polygon, and hierarchy references conceptually. Keep gameplay identity separate from source-dataset identifiers.
- Build a repeatable import pipeline with source URL/provider, license/attribution, retrieval date, version, validation, transformation, and reconciliation logs.
- Validate jurisdiction nesting, invalid geometries, duplicate/renamed places, missing coordinates, and coverage before publishing an import.
- Use datasets whose terms permit the intended commercial/non-commercial use and modification. Review local geography and legal constraints with appropriate experts.
- Stage 1 uses a small bounded fictional area, Idera Quarter, drawn procedurally; it is not real geographic data. Keep this prototype scope small. Do **not** download or process all Nigerian geography for Stage 1, and do not commit country-scale datasets or generated map tiles to Git.

A spatial database extension may later help with geographic queries, but it is a technology decision for a real import/query prototype, not a current dependency.

## Rendered world versus simulation world

Keep authoritative geography and simulation data independent from scene meshes and client asset paths. The client may stream visual chunks, simplify distant geometry, and load interiors as needed. The server may represent large populations and places as aggregates rather than individual rendered objects. Stable IDs and versioned content links connect the representations.

## Persistent world clock

The future clock is a server-owned service with an explicit calendar and configured game-time rate. It should support:

- second, minute, hour, day, week, month, and year units;
- birthdays, age progression, school years, terms, and institutional schedules;
- elections, office terms, business cycles, and economic events;
- day/night and weather/season inputs;
- scheduled world events and player history timestamps.

Use a monotonic/process-safe time source for measuring elapsed server time and UTC timestamps for real-world audit records. Model the in-world calendar explicitly; do not equate a player's local device clock with authoritative game time. Keep the civil-time zone for Nigeria (`Africa/Lagos`) distinct from the game's calendar and time multiplier.

## Offline progression and catch-up

For the eventual shared simulation, world time and selected systems should progress while an individual player is offline. The Stage 1 local prototype is an explicit exception: its simple day/minute clock advances only during active play, pauses with menus, is stored in the local save, and does not progress while the app is closed. Stage 2 adds a bounded server-owned clock shared among online players; it continues while the single server process is running, pauses during server downtime, and does not catch up offline. Needs currently decay only for connected players. This is not the full offline-progression design. A future service should define canonical time anchors/configuration and process scheduled work in bounded, resumable batches.

Do not simulate every NPC every second. Use event scheduling and aggregate/cohort updates for low-priority populations, while preserving exact rules for important player-facing deadlines and economic/legal transactions. Define idempotency, ordering, pause/maintenance behavior, maximum catch-up work, and recovery checkpoints so a long outage does not duplicate or skip irreversible events.

## Time design decisions still open

Before implementation, specify and test:

- How much in-world time passes per real-world interval and whether the rate can ever change.
- Calendar month/weekday rules, leap handling, naming/localization, birthdays, and cross-time-zone presentation.
- Whether seasons/weather follow real Nigerian climate patterns and how regional variation works; avoid importing four-season assumptions without research.
- Which updates are exact events versus aggregate approximations, and which require player notification.
- Clock ownership, failover, snapshots, ordering, and acceptable drift between physical workers.

Stage 1 implements a local prototype clock and procedural fictional locations. Stage 2 adds one shared server clock for the bounded multiplayer prototype. There is no full calendar, weather, real geography, or offline catch-up/progression; those remain future systems.
