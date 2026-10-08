# Architecture

## Current shape

Stage 0 remains a deliberately small TypeScript/Node backend boundary. Stage 1 adds a local, single-player Godot slice without replacing Stage 0 or claiming server authority.

```text
Godot client (game/)                           Node world API (services/world-api/)
┌─────────────────────────────┐                ┌─────────────────────────────┐
│ Prototype UI / player/world │                │ GET /health                 │
│ domain services             │                │ GET /api/v1/world            │
│      │                      │                │                             │
│      └── local JSON save    │                │ static nigeria-main metadata│
│          user:// (v1)       │                └─────────────────────────────┘
└─────────────────────────────┘
            No client/API connection or shared gameplay state yet

Future: server-authoritative gameplay services + durable storage (not implemented)
```

**Implemented today:**

- `game/` is a Godot 4.7 project that launches a first-playable-prototype scene. The earlier Stage 0 scene remains in the repository.
- GDScript is separated into character/clock/household/school/dialogue domain scripts, a save service, procedural world entities/map, player controller, UI, and a scene coordinator.
- The prototype is a local 2D student life slice in fictional Idera Quarter. It has no networking or authentication and does not connect to the backend.
- `game/scripts/services/save_service.gd` contains a versioned JSON local save/load implementation at `user://naija-stage1-save.json`. Autosave/manual save/load hooks and restart test code are present, but Godot runtime/persistence checks have **not** been run in the current workspace.
- `services/world-api/` exposes a health check and an immutable descriptor for the one logical Nigeria. It accepts no gameplay commands and stores no state.
- The API uses TypeScript/Node.js, strict compiler checks, ESLint, and Node integration tests. The API test suite passes; it is independent from the unverified Godot client.
- There is no database, account system, client-to-server gameplay connection, server simulation clock, or multiplayer transport.

## Stage 1 client boundaries

The prototype keeps simple responsibilities separate rather than putting simulation and dialogue into one movement script:

- `game/scripts/domain/`: character data and rules, household generation, school records/timetable, dialogue, and world clock.
- `game/scripts/services/`: local save/load boundary. This is a prototype-local implementation, not a future server persistence interface guarantee.
- `game/scripts/world/`: fictional starter locations, procedural drawing, entities, focus/interaction targeting, and simple NPC roaming.
- `game/scripts/player/`: movement, camera, and drawn avatar.
- `game/scripts/ui/`: creation form, HUD, menus, dialogue, school activities, and emitted intents.
- `game/scripts/prototype_game.gd`: connects UI intent to prototype domain/world actions.

The `CharacterState` model is local client state in this phase. It includes a basic reputation field but not a reputation simulation. The local balance is prototype currency, not an authoritative ledger. The household and neighbourhood are generated/fixed prototype data, not persisted world entities in the backend.

## Principles

1. **One logical world, many possible processes.** Nigeria has one canonical logical identity and one authoritative state. Regions, servers, workers, shards, or replicas are infrastructure allocations, not separate countries/worlds. The Idera Quarter prototype is one small fictional setting; it is not a second world or a shard.
2. **Server authority for online play.** Clients send intent; trusted server-side code validates authorization, rules, and state changes. A client never decides money, inventory, election outcomes, legal outcomes, or other authoritative shared-world state. Stage 1's offline demo state is intentionally local and is not evidence of multiplayer authority.
3. **Modular monolith first.** Keep domain boundaries explicit inside a small deployable backend until measured load, team ownership, or reliability needs justify extraction. Do not create microservices merely because a future system is listed.
4. **Contracts before coupling.** API and event contracts should be versioned, validated, documented, and independent of Godot scene structure.
5. **Durable facts and derived views.** Preserve important world/player history and auditable transactions; treat caches, client scenes, and non-authoritative prototype saves as rebuildable/untrusted.
6. **Small vertical slices.** Each roadmap phase should introduce only the code, data, tests, and operational burden needed for its feature.
7. **No premature scale claims.** Capacity, consistency, and latency targets require workload assumptions and tests before they become promises.

## Planned domain boundaries

These are future areas, not all Stage 1 modules. Add a boundary when a roadmap phase begins and define its owner, inputs/outputs, invariants, persistence, and tests.

- **Identity and account:** authentication, authorization, player profile, account safety.
- **Character and life:** player characters, skills, age, needs, relationships, family, legacy.
- **World and geography:** administrative places, coordinates, buildings, interiors, travel, world clock, weather, events.
- **Education and work:** institutions, education records, jobs, careers, training.
- **Economy:** Naira ledger, accounts, transactions, taxes, loans, investments, business finance.
- **Property and transport:** ownership, housing, vehicles, road/transit networks.
- **Civic and justice:** institutions, elections, law, courts, policing, security, justice records.
- **Culture and media:** religion, community, entertainment, journalism, content, social features, moderation.
- **Society simulation:** NPC cohorts, schedules, events, and derived population activity.
- **Platform services:** persistence, networking, analytics, operations, backups, moderation, anti-cheat.

Avoid a universal `GameManager`, a giant shared mutable state object, or direct cross-module database writes. Prefer explicit application services and domain-owned rules; choose a more formal domain-driven design only as real complexity warrants it.

As the project grows, these boundaries should be able to separate into focused modules for player, character, world, geography, education, careers, economy, businesses, property, vehicles, transportation, family, relationships, government, elections, laws, courts, police, military, crime, religion, culture, entertainment, social media, NPC simulation, events, weather, time, multiplayer, authentication, persistence, analytics, moderation, and anti-cheat. These are planning labels, not commitments to pre-create empty directories.

## Suggested repository growth

```text
game/                         Godot scenes, scripts, and client assets
services/world-api/           HTTP/API boundary (currently metadata-only)
packages/                      Optional shared protocol/schema packages when justified
docs/                          Plans, decisions, status, agent guidance
```

Future modules should be added in small slices with tests and docs, not pre-created as empty directories. The client must not connect directly to the database or own shared-world state.

## One-world deployment model

- Keep a stable canonical world key (`nigeria-main` in the Stage 0 descriptor). It identifies the logical Nigeria, not a physical server.
- Use separate deployment/region/process identifiers for routing and operations. Never expose those identifiers as selectable national world copies.
- Define ownership and consistency boundaries for state. A player's local character data can be owned/routed independently from national state, but shared invariants (for example, one national office holder or one election result) need a single coordinated authoritative write path.
- Scale read traffic with replicas/caches where safe. Replicas are not writable alternate histories; define freshness and conflict behavior explicitly.
- Partition geographic or simulation workloads only behind shared IDs, versioned contracts, and global event/state coordination. A partition cannot invent its own election, laws, or economy.
- Define recovery and failover so a replacement owner resumes the same logical state from durable records/snapshots, rather than starting a new Nigeria.

This is the intended future model; the Node API currently serves static metadata and no distributed services exist.

## Time and offline progression

The Stage 1 `WorldClock` is a local prototype clock. It advances during active play, pauses while a modal is open, and is stored in the local save. The clock does not progress while the app is closed. It is not a shared or authoritative world clock. The future clock should be a world service with a canonical time anchor and bounded offline catch-up. Further planning is in [`WORLD_PLAN.md`](WORLD_PLAN.md).

## Security boundary

Treat all client payloads, local saves, and network timing as untrusted. Validate identity, permissions, state transitions, limits, and economic transactions server-side before online use. The Stage 1 save is local JSON, is not encrypted or authoritative, and is not an account credential. Authentication, rate limits, anti-cheat, moderation, backups, and incident recovery are planned—not implemented. See [`SECURITY_PLAN.md`](SECURITY_PLAN.md).

## Architecture decision record (Stage 0, retained)

**Decision:** use Godot/GDScript for the cross-platform game client, with a separately testable TypeScript/Node backend boundary; begin the backend as a modular service and plan PostgreSQL as a future persistence candidate.

**Reason:** balances open-source tooling, prototype speed, 3D evolution, desktop/mobile export, web as a constrained option, low operating cost, typed API work, and straightforward testing in the available environment.

**Stage 1 adaptation:** implement a small local single-player slice in the existing Godot project and preserve the Node API untouched as a separate read-only boundary. This local client state is for prototyping only; it does not replace the future server-authority rule.

**Revisit when:** a playable slice reveals rendering/platform needs; multiplayer prototypes define real consistency and latency requirements; load tests reveal Node bottlenecks; or a researched data/provider decision requires a different persistence or geography stack. Record any change in the docs and status file rather than silently replacing the architecture.
