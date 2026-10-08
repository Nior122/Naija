# Multiplayer and One-World Plan

## Core invariant

There is **one logical Nigeria**: one canonical world identity, one shared world clock, and one coherent set of authoritative national state. Never introduce selectable `Server 1 Nigeria`, `Server 2 Nigeria`, or regional copies with independent histories, economies, laws, or public events.

Many deployment processes, workers, database partitions, replicas, queues, or caches may eventually support that world. Those are implementation details—not player-selectable worlds. The current prototype uses one Node process and one state file; it has no distributed ownership or multi-process consistency protocol.

## Current implementation: Stage 2 foundation

The existing Stage 1 Godot/GDScript offline life is retained. Stage 2 adds an optional client connection to a server-authoritative multiplayer slice while keeping the Stage 1 local save separate. The shared world identifier remains `nigeria-main`; all online players connect to the same bounded prototype world.

### Transport and authority

The selected prototype transport is **JSON over WebSocket** (`ws` on Node and `WebSocketPeer` in Godot). It is cross-platform and gives browser clients a standard WSS path without making Godot's multiplayer API the authority. Application message types are explicit, and the server assigns player identity and authoritative outcomes.

| Area | Current server behavior |
|---|---|
| Identity and character | `identity.create` accepts a random recovery key and a profile, applies server defaults/allowlists, generates a server ID, and persists the character. Only a hash of the recovery key and session token is stored server-side. A recovered identity receives a replacement bearer session token. This is an anonymous prototype identity, not an account/login system. |
| Session and presence | `session.resume` validates the token, prevents a second live connection for the same player, returns that player's character and shared world/clock, and emits connected/disconnected/moved presence. Public presence contains the character's name, appearance, map location, position, and connection state. |
| Movement | Clients send a normalized movement direction, running intent, and increasing sequence number—not coordinates, money, or character state. The server enforces input/rate bounds, applies walk/run speed, clamps positions to map bounds, and broadcasts server-computed state. The map is a small prototype with no authoritative obstacle/collision pathfinding. |
| Character actions | The server resolves prototype travel entrances and their destinations/spawns, bus fares, shop prices/items, consumables, clinic care, rest, class quizzes, attendance, and score changes. Client-supplied prices, balances, health, inventory contents, quiz correctness, locations, and positions are not accepted as outcomes. |
| Shared clock and needs | A single server clock starts at Day 1, 07:50 for a new file, advances one game minute per 650 ms by default, is sent to all connected players, and is persisted with the world. It advances while the server is running, even when no player is online; it pauses during server downtime (there is no offline catch-up). Need decay is applied to connected players during clock ticks. |
| Nearby social play | Server-relayed chat is limited to 200 characters, controls are rejected, and only players in the same prototype location and within 600 map units receive the message. Chat is limited to 5 messages per connection per 10 seconds. A wave requires another connected player within 92 units and is limited to once per second. |
| Persistence and retries | One JSON state file holds the shared `worldClock` and per-player records as distinct fields. Writes use a temporary file and rename; the file is limited to 16 MiB. Successful state-changing commands require request IDs, with a bounded recent-ID set (up to 256 per player) to prevent replay. The file is local, single-process prototype persistence—not PostgreSQL, a transaction log, encrypted storage, or safe multi-process coordination. |

The server also bounds WebSocket messages to 8 KiB, defaults to 64 simultaneous sockets, limits each remote address to 30 connection attempts per minute, accepts movement input no faster than once every 40 ms, and limits non-movement commands to 20 per connection per 10 seconds. After five malformed/unknown-message violations it closes the connection. Browser `Origin` values must exactly match the configured allowlist; native clients without an `Origin` header can connect without that setting. `Origin` validation is not authentication.

### Prototype protocol outline

The server path defaults to `/ws`. The client sends JSON messages including `identity.create`, `session.resume`, `movement.input`, `world.travel`, `world.bus`, `shop.purchase`, `inventory.consume`, `clinic.care`, `character.rest`, `school.begin`, `school.answer`, `chat.send`, and `player.interact`. The server sends `identity.created`, `session.ready`, `character.snapshot`, `world.snapshot`, presence events, chat/interactions, school results, and structured errors. See `services/world-api/src/multiplayer/world-engine.ts` for the concrete prototype rules; this protocol is not yet a versioned public compatibility contract.

### Personal character data versus shared world state

A player's name, age, appearance, household, money, needs, inventory, education, attendance, current location, and position belong to that player's server-side character record. `nigeria-main` and its world clock are shared state. Connected presence is a transient public view of connected characters; a full character snapshot (including household data) is sent to that player's session. The current single JSON file contains both aggregates, but they are distinct schema fields and have different visibility/authority semantics.

The Godot client keeps only a bearer session token and random creation/recovery key in a local `ConfigFile` (`user://naija-multiplayer.cfg` by default). The file is not encrypted. Losing both client identity material and the server state can make that prototype character unrecoverable; there is no external account or recovery support.

## Local setup and testing

From the repository root:

```sh
npm ci
npm run dev
```

The server listens on `0.0.0.0:3000`, serves `/health` and `/api/v1/world`, and accepts WebSocket upgrades at `/ws`. `DATA_FILE` configures the JSON path. `WS_PATH` changes the WebSocket route. `ALLOWED_ORIGINS` is a comma-separated exact list of browser origins; the default is empty. Native Godot clients default to `ws://127.0.0.1:3000/ws`; set `NAIJA_WS_URL` to use another host. Browser deployments should use HTTPS/WSS and proxy the same-origin `/ws` path to the backend.

To run two local Godot clients under the same OS account without reusing one identity, give each process a different `NAIJA_MULTIPLAYER_SESSION_PATH`, for example `user://naija-client-a.cfg` and `user://naija-client-b.cfg`. Create an online character in each, test movement/chat/waves, then relaunch one with its same config path and select **Continue online life** to check reconnect.

The backend integration tests use actual WebSocket connections and temporary files. Run them with:

```sh
npm run check
```

The current verified suite covers two simultaneous players, presence and authoritative movement, nearby chat and wave, payload validation, request-ID deduplication, identity recovery, character/session persistence through disconnect and API restart, shared clock rollover, HTTP regression behavior, and `Origin` rejection. The Godot two-window UI flow, Godot engine behavior, browser exports, and manual play still require Godot and have not been verified in the current workspace.

## Security and prototype limitations

This is a controlled development foundation, not a safe public service. It does not include platform accounts, password/OAuth login, authorization roles, TLS termination, database transactions, account recovery, data encryption at rest, backups, moderation/reporting, profanity filtering, ban/evasion controls, privacy settings, comprehensive audit history, distributed rate limiting, failover, or production observability. Tokens are bearer secrets. Protect client session files and server data, use TLS for any non-loopback exposure, and set an explicit browser-origin allowlist.

Movement authority currently limits direction, input frequency, speed, sequence, and map bounds, but does not model wall collisions or independently simulate the detailed Idera map. Presence positions are visible to all connected prototype players. Capacity numbers are guardrails, not scale guarantees. The JSON store assumes one server process owns one state file; do not run multiple writers against it.

## Later work (not implemented here)

- Replace local file persistence with a designed database/schema and recovery/backup path before production use.
- Add real account identity, secure credential/session lifecycle, privacy boundaries, abuse prevention, moderation, audit, and operational controls.
- Introduce stronger world-action transactions and observability based on measured needs; define migration and protocol-version compatibility.
- Test latency, loss, reconnect storms, sustained concurrency, and scale before making capacity promises.
- Add geography or systems only in their planned roadmap stage. **Stage 3 geography has not been started.**

## Longer-term one-world direction

1. Clients send intent, not trusted outcomes.
2. A responsible server module checks identity, permissions, rules, state, and rate limits.
3. Consequential changes receive durable, idempotent writes; derived presence/views are published to clients.
4. Retry, duplicate delivery, disconnect, recovery, stale reads, and failure behavior are explicitly specified and tested.
5. Physical scaling may partition responsibilities only behind one canonical `nigeria-main` identity and shared global invariants.

Server process IDs, deployment regions, caches, simulation workers, and geographic responsibility may route work, but cannot create alternate national timelines. See [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SECURITY_PLAN.md`](SECURITY_PLAN.md), and [`DATABASE_PLAN.md`](DATABASE_PLAN.md).
