# Multiplayer and One-World Plan

## Core invariant

There is **one logical Nigeria**: one canonical world identity, one shared national history, and one coherent set of authoritative national state. Do not introduce selectable `Server 1 Nigeria`, `Server 2 Nigeria`, or regional copies with independent elections, laws, economies, or public events.

The eventual infrastructure may use many processes, regions, simulation workers, database partitions, queues, replicas, and caches. Those are slices of one implementation, not separate game worlds.

## Current prototype state (Stage 1)

- No accounts, authentication, online player sessions, client/server game connection, multiplayer transport, synchronization, server persistence, or anti-cheat exists.
- The read-only API returns a static descriptor with logical ID `nigeria-main`; it does not host or simulate Nigeria.
- The Godot client is a local single-player prototype and does not call the API. Its versioned JSON save is client-local, non-authoritative, and not runtime-verified; it is not shared-world persistence.

## Future authority and command flow

1. A client authenticates and requests a session using a platform-neutral protocol.
2. It sends intent/commands, not trusted outcomes (for example, request to buy an item, not a client-chosen balance).
3. The responsible authoritative module checks identity, permissions, current state/version, rate limits, game rules, and global invariants.
4. A durable transaction/event is recorded for consequential actions; derived views and other clients receive validated updates.
5. Reconnect, retry, duplicate delivery, timeout, and conflict behavior are specified and tested.

Godot scenes, client clocks, local saves, and client-supplied coordinates never decide authoritative shared state.

## Logical world versus physical infrastructure

- **Logical:** one permanent `nigeria-main` world identity; shared rules, world time, history, and national state.
- **Physical:** deployment region, API process, simulation worker, geographic partition, database placement, queue, or replica. Physical identifiers are operational routing metadata, not selectable worlds.
- **Session/instance:** temporary routing or a private activity may be used for technical reasons, but any lasting effect must reconcile to the same canonical world under explicit authority. An instance must not become a persistent alternate national timeline.

When scaling, partition by a measured ownership boundary (for example, simulation responsibility for an area) and define cross-boundary transactions/events. Global systems require coordination and idempotency. Avoid synchronous global locks for ordinary movement; reserve strong coordinated writes for genuinely global invariants.

## Transport direction

Keep application commands/events independent of transport. HTTPS/WSS is a practical initial cross-platform API direction; native transports may be evaluated later for latency-sensitive movement, with a browser-compatible path. Select protocol, tick rate, interest management, interpolation, reconciliation, and session model only after a playable multiplayer prototype and measured network tests.

Do not treat Godot's built-in multiplayer API as the world authority or persistence system. It may help with a transport/prototype, but it does not replace server-side validation and shared durable state.

## Persistence and global consistency

- Define ownership for each aggregate/entity and where its authoritative writes occur.
- Use unique/idempotency keys for retryable player actions and transactions.
- Keep a durable audit/event trail for high-impact actions and a recovery/snapshot strategy.
- Specify consistency and stale-read expectations per domain. Currency, ownership, election finalization, and legal outcomes need stronger protections than cosmetic movement state.
- Replicas and caches cannot independently accept authoritative writes.
- Failover must resume the same world history and clock, not fork a new world.

## Capacity path

Begin with a small controlled multiplayer prototype; test many simulated clients and failure modes before estimating millions of lives. Measure bandwidth, tick work, database contention, queue delay, hot locations, global event fan-out, and operational cost. Introduce regional routing or partitions only as implementation detail with correctness tests and observability.

## Security and safety

Authentication, authorization, server validation, anti-cheat, economy protection, abuse controls, moderation, reporting, audit logs, privacy boundaries, backups, and disaster recovery are mandatory design work before public multiplayer. See `SECURITY_PLAN.md`. They are not implemented for online play in Stage 1.
