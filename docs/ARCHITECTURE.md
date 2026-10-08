# Architecture

## Current shape

Stage 0's Node/TypeScript API foundation and Stage 1's local Godot prototype remain in place. Stage 2 adds an optional WebSocket multiplayer path to the same game; online character state does not reuse or overwrite the local Stage 1 save.

```text
Godot client (game/)                                  Node world API (services/world-api/)
┌──────────────────────────────────┐                  ┌────────────────────────────────┐
│ Stage 1 local/offline life       │                  │ HTTP: /health                  │
│   └── user:// v1 local JSON save │                  │       /api/v1/world            │
│                                  │                  │                                │
│ Optional Stage 2 WebSocket client│◄──── JSON ──────►│ /ws: identity, commands, events│
│   ├── server-controlled self     │                  │ Server-authoritative rules     │
│   ├── interpolated remote players│                  │ Shared nigeria-main clock     │
│   └── local token/recovery config│                  │ One process + one JSON file   │
└──────────────────────────────────┘                  └────────────────────────────────┘
        Offline save is separate                     No database/distributed ownership
```

The single logical world is still `nigeria-main`. The current prototype does not create world shards, a second Nigeria, or full national geography.

## Implemented boundaries

### Godot client

- `game/scripts/domain/`: retained Stage 1 character, household, school, dialogue, and local clock models.
- `game/scripts/services/save_service.gd`: Stage 1 client-local, versioned save; not authoritative online storage.
- `game/scripts/services/multiplayer_client.gd`: WebSocket connection, session resume/create, reconnect attempts, JSON messages, and a local identity/session config.
- `game/scripts/player/player_actor.gd`: local keyboard movement offline; in online mode it interpolates toward server-computed position and does not simulate its own movement.
- `game/scripts/player/remote_player.gd`: draws/interpolates public presence from server snapshots.
- `game/scripts/prototype_game.gd` and `game/scripts/ui/prototype_ui.gd`: preserve offline flows and route online intent/messages through the multiplayer client.

The client may hold a local copy to render UI, but online money, inventory, needs, education records, location, position, and clock are replaced from server snapshots. It cannot write online character state to the Stage 1 save.

### Node server

- `services/world-api/src/app.ts` retains `GET /health` and `GET /api/v1/world`, adds the bounded WebSocket endpoint (`/ws` by default), enforces upgrade path/origin, and configures a WebSocket message-size cap.
- `services/world-api/src/multiplayer/world-engine.ts` owns anonymous identity creation/recovery, session validation, presence, server-tick movement, the shared world clock, prototype actions, chat/waves, payload/rate validation, and structured events/errors.
- `services/world-api/src/multiplayer/persistence.ts` validates and loads the state schema and writes snapshots by temporary file plus rename.
- `services/world-api/src/multiplayer/types.ts` defines separate shared-world, per-player, character, and public-presence records.
- `services/world-api/src/config.ts` reads the optional root `.env`, data path, port, WebSocket path, and browser-origin allowlist.

The transport is JSON over standard WebSocket (`ws` server, Godot `WebSocketPeer` client), chosen as a low-cost cross-platform prototype that also has a browser-compatible WSS path. Browser hosting must proxy `/ws` to the backend and configure its exact HTTP(S) `Origin`; the native Godot client uses `NAIJA_WS_URL` or defaults to local `ws://127.0.0.1:3000/ws`. The game export and browser runtime have not been tested in this workspace.

## State ownership and data separation

The JSON file's versioned top-level state has:

- `worldId: nigeria-main` and one `worldClock`, shared by every connected online player;
- `players`, a map of server-issued player IDs to identity hashes, bounded recent request IDs, and a server-owned `CharacterRecord`.

A character record contains personal prototype data (profile, household, balance, needs, inventory, school records, location, and authoritative position). A connected public-presence view exposes only selected profile/appearance, position, location, connection status, and last-seen values. A character snapshot is returned to that player's session. The data groups are logically distinct even though the prototype stores them in one file.

The session token and random identity-recovery key are not stored in plaintext by the server; their SHA-256 hashes are. The client stores the bearer token and recovery key in a Godot `ConfigFile` under `user://naija-multiplayer.cfg` by default; this is local plaintext configuration, not secure credential storage. `NAIJA_MULTIPLAYER_SESSION_PATH` can choose a separate config file for each local test client. This identity scheme is not account authentication, and there is no external account recovery.

The local Stage 1 `user://naija-stage1-save.json` remains separate and is only used in offline mode. A user can have an offline character and an online character; they are distinct records.

## Online command flow

1. An untrusted client connects to the configured WebSocket path and uses a client-generated identity recovery key to request a server-issued player identity, or presents its saved session token.
2. The server stores only token/key hashes, validates the selected profile, rejects duplicate live sessions, and sends that player's character, shared clock, and connected presence list.
3. The client sends intents. For movement, that is a sequenced normalized direction plus walk/run intent—not a position. Other commands include selected travel entrance, purchase item ID, consume item ID, quiz answer, chat text, or a nearby wave target.
4. Server rules decide bounds/speed, accepted locations and spawns, prices, balances, inventory changes, care/rest effects, quiz correctness, chat recipients, and interaction range. Changed characters are returned as snapshots and presence/world views are broadcast to clients.
5. Successful state-changing commands require request IDs and the server keeps a capped per-player deduplication history. Validated character/clock changes are persisted to the JSON store.

The current server ticks at 20 Hz by default; client movement input is sent about 20 times per second and presence/clock snapshots are broadcast about 10 times per second. Movement is clamped to a 1600×900 prototype map at server-owned walk/run speeds; there is no authoritative wall-collision/pathfinding simulation yet. The server validates message size/shape, movement input and sequence/rate, action range, chat length/rate, global command rate, connection attempts, and configured browser origins.

## Persistence and clock limits

The server state file defaults to `services/world-api/data/world-state.json` (ignored by Git) and is configurable with `DATA_FILE`. Relative `DATA_FILE` paths resolve from the `services/world-api/` workspace. The store validates version `1`, refuses malformed state instead of silently resetting, rejects files above 16 MiB, and atomically replaces the snapshot through a temp file and rename. Character/action changes flush immediately or through the tick's bounded persistence loop; shutdown requests a final save.

This is a single-process, single-writer local JSON prototype. It has no database transaction, journal/event log, distributed lock, migration framework, encryption, backup/restore job, or multiple-writer coordination. Do not point multiple server processes at the same file. Replacing it with a designed durable database is a future task, not part of this slice.

The shared clock starts at Day 1, 07:50 in a new world file and advances server-side at one game minute per 650 ms by default. It continues while the server is running with zero online players; it pauses while the server process is down and does not catch up after restart. Hunger/energy/health tick only for connected players. These are prototype rules, not a production offline-life simulation.

## What is not implemented

- Production account/authentication provider, fine-grained roles, encrypted client credential storage, or account recovery.
- PostgreSQL or another database, transactional ledger/event log, distributed process ownership, backups, high availability, or horizontal scaling.
- TLS termination, production WSS deployment, distributed abuse controls, moderation/reporting, or privacy settings.
- Comprehensive anti-cheat, collision/obstacle validation, server-side pathfinding, or exhaustive commands for all Stage 1 domains.
- Full Nigerian geography, large-scale NPC/civic/economic simulation, browser/mobile/desktop exports, or Stage 3.

Do not describe configured prototype limits as production capacity. See [`MULTIPLAYER_PLAN.md`](MULTIPLAYER_PLAN.md) and [`SECURITY_PLAN.md`](SECURITY_PLAN.md).

## Verification boundary

The Node build/lint and automated HTTP/WebSocket tests are executable in this environment; the backend suite exercises real two-client coexistence, server-authoritative movement, chat/wave, identity recovery, deduplication, persistence across API restart, clock rollover, payload validation, and origin rejection. GDScript formatting/lint checks are static only. Godot is unavailable here, so project import, scene loading, retained Stage 1 runtime tests/save-restart, multiplayer Godot client behavior, and exports remain unverified. Exact results are recorded in [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).
