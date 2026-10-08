# Architecture

## Current shape

Stage 0 is intentionally a small, modular foundation rather than a distributed system.

```text
Godot client (game/)  ── future HTTPS / WSS commands and snapshots ──>  World API (services/world-api/)
        │                                                                    │
        └── presentation only                                      Stage 0: read-only metadata
                                                                             │
                                                                  Future authoritative modules
                                                                             │
                                                                  Future durable database
```

Implemented today:

- `game/` is a Godot 4.7 project with one static title/foundation scene.
- `services/world-api/` exposes a health check and an immutable descriptor for the one logical Nigeria. It accepts no commands and stores no state.
- The API uses TypeScript/Node.js, strict compiler checks, ESLint, and Node integration tests.
- There is no database, account system, client-to-server gameplay connection, simulation clock, or multiplayer transport.

## Principles

1. **One logical world, many possible processes.** Nigeria has one canonical logical identity and one authoritative state. Regions, servers, workers, shards, or replicas are infrastructure allocations, not separate countries/worlds.
2. **Server authority.** Clients send intent; trusted server-side code validates authorization, rules, and state changes. A client never decides money, inventory, election outcomes, legal outcomes, or other authoritative state.
3. **Modular monolith first.** Keep domain boundaries explicit inside a small deployable backend until measured load, team ownership, or reliability needs justify extraction. Do not create microservices merely because a future system is listed.
4. **Contracts before coupling.** API and event contracts should be versioned, validated, documented, and independent of Godot scene structure.
5. **Durable facts and derived views.** Preserve important world/player history and auditable transactions; treat caches, client scenes, and read models as rebuildable or non-authoritative.
6. **Small vertical slices.** Each roadmap phase should introduce only the code, data, tests, and operational burden needed for its feature.
7. **No premature scale claims.** Capacity, consistency, and latency targets require workload assumptions and tests before they become promises.

## Planned domain boundaries

These are future areas, not Stage 0 modules. Add a boundary when a roadmap phase begins and define its owner, inputs/outputs, invariants, persistence, and tests.

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

Avoid a single universal `GameManager`, a giant shared mutable state object, or direct cross-module database writes. Prefer explicit application services and domain-owned rules; choose a more formal domain-driven design only as real complexity warrants it.

As the project grows, these boundaries should be able to separate into focused modules for player, character, world, geography, education, careers, economy, businesses, property, vehicles, transportation, family, relationships, government, elections, laws, courts, police, military, crime, religion, culture, entertainment, social media, NPC simulation, events, weather, time, multiplayer, authentication, persistence, analytics, moderation, and anti-cheat. These are planning labels, not Stage 0 code or empty directories.

## Suggested repository growth

```text
game/                         Godot scenes, scripts, and client assets
services/world-api/           HTTP/API boundary (currently metadata-only)
packages/                      Optional shared protocol/schema packages when justified
docs/                          Plans, decisions, status, agent guidance
```

Future modules should be added in small slices with tests and docs, not pre-created as empty directories. The client must not connect directly to the database or own shared-world state.

## One-world deployment model

- Keep a stable canonical world key (Stage 0 descriptor: `nigeria-main`). It identifies the logical Nigeria, not a physical server.
- Use separate deployment/region/process identifiers for routing and operations. Never expose those identifiers as selectable national world copies.
- Define ownership and consistency boundaries for state. A player's local character data can be owned/routed independently from national state, but shared invariants (for example, one national office holder or one election result) need a single coordinated authoritative write path.
- Scale read traffic with replicas/caches where safe. Replicas are not writable alternate histories; define freshness and conflict behavior explicitly.
- Partition geographic or simulation workloads only behind shared IDs, versioned contracts, and global event/state coordination. A partition cannot invent its own election, laws, or economy.
- Define recovery and failover so a replacement owner resumes the same logical state from durable records/snapshots, rather than starting a new Nigeria.

This describes the intended model; none of these distributed services exist yet.

## Time and offline progression

The future clock should be a world service, not a per-client timer. Persist a canonical world-time anchor and clock configuration; advance on the authoritative backend; use scheduled events and bounded catch-up for offline intervals. Details, calendar choices, consistency, and testing requirements are in [`WORLD_PLAN.md`](WORLD_PLAN.md).

## Security boundary

Treat all client payloads, local saves, and network timing as untrusted. Validate identity, permissions, state transitions, limits, and economic transactions server-side. Require auditable changes for high-impact actions. Authentication, rate limits, anti-cheat, moderation, backups, and incident recovery are planned—not implemented. See [`SECURITY_PLAN.md`](SECURITY_PLAN.md).

## Architecture decision record (Stage 0)

**Decision:** use Godot/GDScript for the cross-platform game client, with a separately testable TypeScript/Node backend boundary; begin the backend as a modular service and plan PostgreSQL as a future persistence candidate.

**Reason:** balances open-source tooling, prototype speed, 3D evolution, desktop/mobile export, web as a constrained option, low operating cost, typed API work, and straightforward testing in the available environment.

**Revisit when:** a playable slice reveals rendering/platform needs; multiplayer prototypes define real consistency and latency requirements; load tests reveal Node bottlenecks; or a researched data/provider decision requires a different persistence or geography stack. Record any change in the docs and status file rather than silently replacing the architecture.
