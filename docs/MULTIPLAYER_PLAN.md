# Multiplayer and One-World Plan

## Core invariant

There is **one logical Nigeria**: one canonical world identity, one shared world clock and one coherent set of authoritative national state. Never introduce selectable `Server 1 Nigeria`, `Server 2 Nigeria`, or regional copies with independent histories, economies, laws or public events.

Many deployment processes, workers, database partitions, replicas, queues or caches may eventually support that world. Those are implementation details—not player-selectable worlds. The current Stage 2–5 prototype uses one Node process and one state file; there is no distributed ownership or multi-process consistency protocol.

## Current implementation: Stages 2–5 integrated

The existing Stage 1 Godot/GDScript offline life remains available and its local save is separate. Stage 2 adds an optional server-authoritative connection; Stage 3 adds bounded geography; Stage 4 adds persistent education; Stage 5 adds server-owned life/family records and a date-aware calendar. These extend the same online world without invalidating Stage 2–4 character state. All online players/NPC life records use one `nigeria-main` timeline; local offline saves remain separate and are not additional online worlds.

### Transport and authority

The prototype transport is **JSON over WebSocket** (`ws` on Node and `WebSocketPeer` in Godot). It is cross-platform and provides a browser WSS path without making Godot's multiplayer API authoritative. Application message types are explicit; the server assigns identity and authoritative outcomes.

| Area | Current server behavior |
|---|---|
| Identity and character | `identity.create` accepts a random recovery key and profile, applies server defaults/allowlists, generates a server ID and persists the character with education/life fields, DOB and unique starter-family records. Only hashes of the recovery key/session token are stored server-side. A recovered identity receives a replacement bearer token. This remains an anonymous prototype, not an account/login system. |
| Session and presence | `session.resume` validates the token, prevents duplicate live sessions and returns that character, world/clock and the viewer-specific nearby presence list. Public presence includes name/appearance, local scene and map position, optional geographic location, region/chunk IDs and connection state. |
| Movement | Clients send normalized movement direction, running intent and an increasing sequence number—not coordinates, money or character state. The server applies walk/run speed and bounds. If a player has opted into geographic presence and is outdoors, the server derives WGS84 location/admin/chunk fields from its authoritative 1600×900 sample-map position as it moves. |
| Geographic identity | `geography.enter` accepts only the known `ng:region:ondo:akure-south-core` region ID and only while the server location is the outdoor `town`; it derives coordinates from server position, not client-supplied coordinates/administrative IDs. A geographic profile coordinate is accepted only after region/WGS84 viewport validation. `geography.leave` clears the optional identity. Travel into a non-town subscene clears it; users may opt in again outdoors. |
| Nearby interest/social | For two geographic players, presence requires the same local scene and region, a cell within one 500 m chunk in each grid axis and at most 1,500 m geographic distance. Chat (600 m) and waves (92 m) use tighter distances. Geographic and legacy-null players are not mixed into global interest lists. Two legacy-null players retain Stage 2 map-unit proximity/chat behavior. |
| Character actions | The server resolves prototype travel, fares, purchases, consumables, care/rest, class quizzes, education actions, and Stage 5 `relationship.progress` / `family.childbirth` actions. Life rules derive age from DOB and shared date, require adult ages for romance/marriage, require mutual confirmation, and create persistent NPC children. Client-supplied age, DOB, dates, relationship outcomes, balances, marks, locations or positions are not accepted as authoritative values. Central death/status processing preserves records and blocks normal actions for deceased characters. |
| Shared clock and needs | One server clock starts at Day 1 / 2025-01-01 at 07:50, advances one game minute per 650 ms by default (`GAME_MINUTE_MS` can configure it), and persists date/minute/sub-minute remainder. Gregorian age/birthday/life-stage processing uses this shared timeline. It continues while the API runs, even with no players online, pauses during downtime and does not advance through server downtime. Disconnected characters/NPCs catch up to the current shared date when lifecycle processing resumes. Need decay remains applied to connected players only. |
| Persistence and retries | Schema-version-2 JSON state holds one `worldClock`, players and ID-keyed people/household/family/relationship/life-event/marriage/inheritance maps. Schema-version-1 records migrate without resetting existing identity, education, geography or character fields. Writes use temp-file plus rename and are limited to 16 MiB. Consequential actions use bounded request-ID deduplication. Geography is nullable presence data, not a shard; life records share the one world date. |

The server also bounds WebSocket messages to 8 KiB, defaults to 64 simultaneous sockets, limits each remote address to 30 connection attempts/minute, accepts movement input no faster than once every 40 ms, and limits non-movement commands to 20 per connection/10 seconds. After five malformed/unknown-message violations it closes the connection. Browser `Origin` values must exactly match the configured allowlist; native clients without an `Origin` header can connect without that setting. `Origin` validation is not authentication.

### Prototype protocol outline

The server path defaults to `/ws`. The client sends JSON messages including `identity.create`, `session.resume`, `movement.input`, `world.travel`, `world.bus`, `shop.purchase`, `inventory.consume`, `clinic.care`, `character.rest`, `school.begin`, `school.answer`, `education.action`, `relationship.progress`, `family.childbirth`, `chat.send`, `player.interact`, `geography.enter` and `geography.leave`. `relationship.progress` requests one age-validated, mutually confirmed friendship/romantic progression; `family.childbirth` requires an active marriage and creates an NPC child record. The server sends `identity.created`, `session.ready`, `character.snapshot` (including education/life fields and profile projection), filtered `world.snapshot`, presence events, chat/interactions, school/education/social/family results and structured errors. Outcomes remain server-owned. This protocol is not yet a versioned public compatibility contract.

### Personal character data versus shared world state

A player's name, derived age snapshot, DOB, life stage/status, household/family/event/relationship IDs, money, needs, inventory, education fields and structured `education_record` belong to the server-side character record, alongside current scene, authoritative position and optional geography. NPC/person, household, family, relationship, life-event, marriage and inheritance-hook records are ID-keyed shared-world maps. The static education and life rules live in `game/data/education/catalog.json` and `game/data/life/life_catalog.json`; mutable histories and relationships stay in world persistence. `nigeria-main` and its one clock/date are shared state. Public presence is filtered by local-scene/nearby geographic interest; the full character/profile snapshot is scoped to the session.

The geographic preview itself is bundled processed data, not per-player mutable world state. `game/data/geography/source/` holds pinned subsets/source artifacts and license notices; `game/data/geography/processed/` holds the compact catalog and import manifest. These static assets are not copied into `world-state.json`. Exact upstream sources, terms, attribution and limits are documented in [`DATA_SOURCES.md`](DATA_SOURCES.md).

The Godot client keeps a bearer token and random creation/recovery key in a local `ConfigFile` (`user://naija-multiplayer.cfg` by default); the file is not encrypted. Losing both client material and server state can make a prototype character unrecoverable; there is no external account/recovery support.

## Local setup and testing

From the repository root:

```sh
npm ci
npm run geography:check
npm run dev
```

The server listens on `0.0.0.0:3000`, serves `/health` and `/api/v1/world`, and accepts upgrades at `/ws`. `DATA_FILE` configures the JSON path. `WS_PATH` changes the WebSocket route. `ALLOWED_ORIGINS` is a comma-separated exact list of browser origins; it defaults to empty. Native Godot clients default to `ws://127.0.0.1:3000/ws`; set `NAIJA_WS_URL` to use another host. Browser deployments should use HTTPS/WSS and proxy same-origin `/ws` to the backend.

The geographic data flow can be reproduced or checked with:

```sh
npm run geography:import
npm run geography:check
```

For two local Godot clients under the same OS account, choose different `NAIJA_MULTIPLAYER_SESSION_PATH` values, e.g. `user://naija-client-a.cfg` and `user://naija-client-b.cfg`; create an online character in each. In the outdoor town, toggle **Map data** to join the bounded Akure South sample and inspect a mapped POI. Move between chunks to test nearby presence, chat or a wave. Toggle **Map data** off to leave the geographic interest view. Relaunch with the same config path to check reconnect.

The automated Node tests use real WebSocket connections and temporary files. The current `npm run check` covers lint/build, retained Stage 1–4 backend regressions, eight focused education tests and ten focused Stage 5 life tests (37 Node tests total). Life coverage includes calendar/date/age/birthday catch-up, persistent NPC family trees, age-appropriate friendship, adult restrictions, marriage/children, death/history/inheritance hooks, shared-clock multiplayer and save/restart. Education coverage retains secondary progression, assessments, exams, university/ND/HND/training, scholarships, schoolyard co-presence and persistence. Geographic coverage checks co-presence/chunk filtering, entry validation, source/data/coordinate/chunk invariants, identity recovery, chat/rates, clock and HTTP behavior. Godot two-window UI, local save/restart, profile/life UI and actual Godot runtime are not claimed as tested here.

## Security and prototype limitations

This is a controlled development foundation, not a safe public service. It does not include platform accounts, password/OAuth login, authorization roles, TLS termination, database transactions, account recovery, encrypted data-at-rest, backups, moderation/reporting, profanity filtering, ban/evasion controls, privacy settings, comprehensive audit history, distributed rate limiting, failover or production observability. Tokens are bearer secrets. Protect client session files and server data, use TLS for non-loopback exposure and set an explicit browser-origin allowlist.

Movement authority limits direction, input frequency, speed, sequence and map bounds, but does not model wall collisions or independently simulate the detailed Idera map. The online geographic mode uses only the sample viewport; it does not prove official boundaries or complete coverage. It derives an in-bounds point from the current sample display transform. Presence positions are visible only to current nearby interest sets; broader privacy controls are not implemented. Capacity numbers are guardrails, not scale guarantees. The JSON store assumes one server process owns one state file; do not run multiple writers against it.

## Later work (not implemented)

- Replace local-file persistence with a designed database/schema and recovery/backup path before production use.
- Add real account identity, secure credential/session lifecycle, privacy boundaries, abuse prevention, moderation, audit and operational controls.
- Introduce stronger world-action transactions and observability based on measured needs; define migration and protocol-version compatibility.
- Test latency, loss, reconnect storms, sustained concurrency and scale before making capacity promises.
- Extend geography only with suitable source licenses, attribution, boundaries, coverage documentation and bounded reproducible imports. No Port Harcourt region, country-scale feature import, national map streaming or geography endpoint is implemented yet.
- Full transport, terrain/environment/weather simulation and complete national feature coverage remain out of scope for this stage.

Stage 5 life/family/calendar actions are implemented and backend-tested; Godot runtime/client verification remains pending. One `nigeria-main` server clock remains authoritative online, while the existing local offline save remains separate and is not an additional online timeline. The next planned stage is **Stage 6 — Careers & Employment**, not yet started. See [`ROADMAP.md`](ROADMAP.md), [`EDUCATION_PLAN.md`](EDUCATION_PLAN.md) and [`LIFE_SIMULATION_PLAN.md`](LIFE_SIMULATION_PLAN.md).

## Longer-term one-world direction

1. Clients send intent, not trusted outcomes.
2. A responsible server module checks identity, permissions, rules, state and rate limits.
3. Consequential changes receive durable, idempotent writes; derived presence/views are published to clients.
4. Retry, duplicate delivery, disconnect, recovery, stale reads and failure behavior are explicitly specified and tested.
5. Physical scaling may partition responsibilities only behind one canonical `nigeria-main` identity and shared global invariants.

Server process IDs, deployment regions, caches, simulation workers and geographic responsibility may route work, but cannot create alternate national timelines. See [`ARCHITECTURE.md`](ARCHITECTURE.md), [`WORLD_PLAN.md`](WORLD_PLAN.md), [`SECURITY_PLAN.md`](SECURITY_PLAN.md) and [`DATABASE_PLAN.md`](DATABASE_PLAN.md).
