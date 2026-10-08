# Development Status

> **Future AI agents: read this file before modifying the project.** It separates implementation from verification; source code and test files are not proof of runtime behavior.

## Current stage and verification gate

**Stage 2 — Multiplayer Foundation: implementation is present and the Node backend checks pass. The Godot runtime gate remains blocked.** Stage 0 and Stage 1 code are preserved. Godot is not installed in the current workspace, so the Stage 1 game was not imported/launched or tested in-engine, and the new Stage 2 Godot client was not run. Therefore neither Stage 1 runtime behavior nor the Godot multiplayer/reconnect UI is claimed as verified.

The requested Stage 1 verification-before-Stage 2 gate could not be completed because the engine is unavailable. The Stage 2 implementation was continued as far as possible under the explicit request; the missing Stage 1/runtime verification remains a known limitation and should be completed when Godot 4.7.2 is available. No Stage 3 geography has been started.

## Stage 0 foundation retained

- `services/world-api/` preserves the original Node.js/TypeScript HTTP foundation and `nigeria-main` logical world identity.
- `GET /health` and `GET /api/v1/world` remain available. The world descriptor now reports Stage 2's bounded prototype state; it does not claim a complete national simulation.
- HTTP write methods remain rejected. The backend adds a separate WebSocket multiplayer route without moving game authority into the HTTP metadata endpoint.

## Stage 1 implementation retained (runtime verification pending)

- `game/project.godot` starts the existing Godot 4.7.2-targeted first-playable scene; the earlier Stage 0 scene remains in the project.
- The offline prototype still supports character creation, generated family/household and home, fictional Idera Quarter locations, keyboard movement/interactions, NPC dialogue, school timetable/activities, money, needs, inventory, local clock, and local versioned JSON save/load.
- Local Stage 1 data remains separate from the online server character and world file.
- `game/tests/` includes domain, movement, and two-process local-save/restart harnesses. They have not run in Godot in this workspace.

## Stage 2 implementation present

### Backend (`services/world-api/`)

- Optional JSON WebSocket transport at `/ws` using Node's `ws` library; the existing HTTP routes remain intact.
- A single in-memory server process owns canonical world ID `nigeria-main`, one shared ticking clock, connected presence, and per-player server-authoritative character records.
- Anonymous prototype identity creation/recovery with server-issued player IDs, random bearer session tokens, a client-held recovery key, and server-side hashes of both secrets. Duplicate live sessions are rejected. This is not an external account/authentication system.
- The server accepts sequenced movement direction/run intent rather than client coordinates, computes position/speed, and clamps movement to the bounded prototype map.
- The server validates and resolves prototype travel/spawns, bus fare, shop purchases, consumption, clinic care, rest, school quiz answers/attendance/scores, nearby chat, and wave interactions. Online values are not taken from the client as outcomes.
- Payload-size/schema/range checks, connection and command rate limits, chat limits, request-ID deduplication, WebSocket heartbeat handling, structured errors, and useful connection/persistence logs are implemented.
- Versioned JSON persistence stores `worldClock` and player records in logically separate fields, validates loaded data, rejects state files above 16 MiB, writes via a temporary file plus rename, and flushes on commands/shutdown. The default data file is Git-ignored. This is a single-process local persistence prototype, not a database or a safe multi-writer design.

### Godot client (implementation present, not engine-verified)

- Optional online mode preserves the offline game; `WebSocketPeer` connects to the backend and client profile data is initialized/updated from server responses.
- Local session token/recovery key persistence and retry/backoff reconnection are implemented. The config defaults to `user://naija-multiplayer.cfg`; `NAIJA_MULTIPLAYER_SESSION_PATH` permits independent local test identities.
- Online local movement is disabled; the local player follows authoritative server positions. Remote characters are interpolated from public presence.
- Online nearby chat, server wave interaction, server-backed travel/education/shop/needs actions, and the shared clock/character snapshots are connected to the prototype UI.
- The client session config contains bearer/recovery secrets as local plaintext configuration; it is not encrypted and must not be treated as account security.

## Persistence, world, and current limits

- One `nigeria-main` identity is shared. The world clock and each personal character are distinct state aggregates in the file; presence is a public view of connected players. The Stage 1 `user://` save does not sync online.
- The clock starts at Day 1, 07:50 for a new file and advances at one game minute per 650 ms by default while the server is running. It pauses during server downtime; there is no offline catch-up. Needs decay for connected players during clock ticks.
- The JSON store has no database transaction log, encryption, backups, migration framework, distributed lock, or multi-process coordination. Do not run multiple server writers against one state file.
- Movement currently enforces direction/speed/input limits/map bounds but does not simulate server-side wall collisions or pathfinding. Presence location/position and basic profile fields are visible to connected prototype players.
- There are no production accounts, TLS termination, durable database, moderation/reporting, profanity filtering, comprehensive anti-cheat, detailed privacy controls, or operational recovery. Configure an exact browser `ALLOWED_ORIGINS` list; Origin checks are not authentication. Use TLS/WSS before any non-loopback exposure.
- No real Nigerian geography or Stage 3 content is present.

## Technology baseline

| Component | Baseline | Verification state |
|---|---|---|
| Node.js | 22.22.3 workspace runtime; declared `>=22.13 <23` | `npm run check` passed. |
| npm | 10.9.8 | Root workspace commands used. |
| TypeScript | 5.9.x | Strict project build passed as part of `npm run check`. |
| ESLint | Configured for `services/world-api/src` | Passed as part of `npm run check`. |
| WebSocket | `ws` 8.22.x | Two-client WebSocket integration tests passed. |
| Godot | 4.7.2 stable project target | Engine unavailable; import, launch, scene, and runtime tests not run. |
| GDScript tools | `gdtoolkit` 4.5.0 in `/tmp/naija-gdtoolkit` | Formatter and linter passed for 16 scripts; static checks only. |
| Database | None configured; PostgreSQL is a future candidate | No database connectivity or schema. |

## Run server and clients

From the repository root, with Node.js 22.13+ and npm:

```sh
npm ci
cp .env.example .env   # optional local configuration
npm run dev
```

The process listens on `0.0.0.0:3000`. The default data file is `services/world-api/data/world-state.json`, ignored by Git. `DATA_FILE` paths in `.env` are resolved from the `services/world-api/` workspace; `WS_PATH` defaults to `/ws`. Browser origins must be listed exactly in `ALLOWED_ORIGINS`; the empty default accepts clients without an Origin header but rejects browser-origin WebSocket upgrades.

To launch the offline Godot client when Godot is installed:

```sh
godot --path game
```

For a desktop online client, start the server and use its native WebSocket address (default `ws://127.0.0.1:3000/ws`; override with `NAIJA_WS_URL`). To run two Godot instances under one OS account, use different session files, such as `NAIJA_MULTIPLAYER_SESSION_PATH=user://naija-client-a.cfg` and `...-b.cfg`. Create a different online life in each. Relaunch one with its same session file to exercise its UI reconnect path. This manual Godot flow is documented but not run here.

For browser clients, host the Godot web export behind HTTPS/WSS and proxy same-origin `/ws` to the server. No browser export/proxy is bundled or verified.

## Verification performed for Stage 2 changes

- `npm run check` — **passed**: ESLint, TypeScript compilation, and all 9 Node HTTP/WebSocket integration tests.
- `npm run dev` — **started successfully** on `0.0.0.0:3000`; live `GET /health` and `GET /api/v1/world` returned the expected JSON, and `GET /ws` returned `426 websocket_upgrade_required`.
- Backend test 1 — **passed**: retained health/world metadata, 404, and read-only method behavior.
- Backend test 2 — **passed**: two actual WebSocket clients share presence; server-computed movement is observed by the other client; nearby chat and wave work; invalid movement is rejected.
- Backend test 3 — **passed**: untrusted creation fields do not override server-owned money, health, inventory, or location; malformed chat/unknown writes are rejected.
- Backend test 4 — **passed**: unauthenticated command rate limits apply, and one connection cannot create a second identity.
- Backend test 5 — **passed**: state-changing travel requires a request ID and a successful duplicate is not applied twice.
- Backend test 6 — **passed**: retrying identity creation with the same recovery key returns the same player without duplicating records.
- Backend test 7 — **passed**: character/session state survives disconnect and API process restart; stored file contains no plaintext session token.
- Backend test 8 — **passed**: clients observe one shared clock and midnight rollover.
- Backend test 9 — **passed**: WebSocket upgrades reject an unconfigured browser `Origin`.
- `gdformat --check $(find game -name '*.gd' -print)` — **passed**: all 16 scripts unchanged by formatter.
- `gdlint $(find game -name '*.gd' -print)` — **passed**: no GDScript lint findings.
- `git diff --check` — **passed** on the final source and documentation changes.
- Secret-pattern scan — **passed** for private-key headers, GitHub token patterns, and AWS access-key patterns; local state and `.env` remain ignored, and no credentials were added.
- `godot --version` / launch checks — **blocked**: no Godot executable is installed (`godot` unavailable). No engine import, scene launch, Stage 1 GDScript test, local save/restart, Godot two-client test, or manual play was run.
- Browser/desktop/mobile exports and deployment checks — **not run**.

## Stage 1 tests to run when Godot is available

From the repository root:

```sh
godot --headless --editor --path game --quit
godot --headless --path game --quit
godot --headless --path game --script res://tests/domain_smoke.gd
godot --headless --path game --script res://tests/player_movement.gd
```

Then run the local save test in two separate processes, waiting for the writer to exit:

```sh
godot --headless --path game --script res://tests/save_restart.gd -- write
godot --headless --path game --script res://tests/save_restart.gd -- read
```

After these checks, manually review offline character creation, movement, interactions, school records, needs, menus, local persistence, and the opening layout. Then launch two Godot clients using separate session-config files and verify online identity creation, movement synchronization, nearby chat/wave, server restart, and character reconnect. Update this document only with observed results.

## Next steps and release gates

1. Re-run the Stage 1 Godot import/launch, domain, movement, and two-process save/restart checks; fix any engine issues before treating Stage 1 as verified.
2. Run and visually review the Stage 2 Godot two-client/reconnect flow when Godot is available; validate the web URL bridge/proxy if browser play is pursued.
3. Before public exposure, design authentication, TLS/WSS deployment, data protection, database transactions/backups, abuse controls/moderation, privacy, rate-limit operations, and recovery.
4. Keep the one-logical-Nigeria invariant. Do not start Stage 3 geography in this change.
