# Database Plan

## Status

No production database, migration framework, or database connection is part of the current Stage 2 foundation. The Node server stores the bounded multiplayer prototype's shared clock and player records in one versioned local JSON file; it is server-authoritative within one process but has no transactions, multi-writer coordination, encryption, backup, or production recovery. The separate Godot Stage 1 local save remains client-local and is not online authority. PostgreSQL remains the leading future candidate because it is open source, relational constraints fit many authoritative records, and it can evolve toward geospatial needs. Confirm version, hosting, extensions, retention, and backup design before adopting it.

Do not create hundreds of tables from this plan. Add a small schema slice only when a roadmap feature needs it, with migrations, constraints, tests, ownership, and rollback/recovery notes.

## Conceptual entity families

Names below are illustrative concepts, not a prescribed one-table-per-bullet schema.

| Domain | Potential entities |
|---|---|
| Accounts and identity | `users`, authentication identities, access roles, privacy/consent settings, moderation state |
| People and households | `player_characters`, NPC/person records, `households`, `families`, life events, `relationships`, guardianship |
| Places and buildings | `locations`, geographic/admin units, districts, `buildings`, interiors, roads, `schools`, universities, polytechnics, training providers |
| Education and work | `education_records`, enrollments, courses, skills, `jobs`, employment, apprenticeships |
| Economy and commerce | `bank_accounts` (virtual game accounts only), `transactions`, balances/ledger entries, taxes, loans, investments, `businesses`, inventory |
| Assets and mobility | `properties`, ownership/tenancy, `vehicles`, transport routes and journeys |
| Civic and justice | governments, agencies, `political_parties`, offices, `elections`, laws and versions, `court_cases`, judgments, police/security records, criminal records where lawful and game-appropriate |
| Social and history | `world_events`, `social_posts`, `messages`, `player_history`, `world_history`, audit records |

Sensitive systems such as identity, messages, police records, and criminal records need explicit data minimization, access control, retention, safety review, and separation from public profile data. Avoid using real financial account data; the envisioned economy is an in-game Naira-denominated simulation.

## High-level relationships

- A user account may control one or more player characters subject to product rules; a character belongs to a household and has life events, relationships, education, work, assets, and history.
- NPCs and player characters exist in the same geographic hierarchy, but identity, privacy, and ownership rules differ.
- Geographic locations parent buildings and institutions; a school is a specialized institution associated with a location, not an isolated coordinate system.
- A business may have owners, employees, a location, inventory, and a virtual ledger/account relationship.
- Transactions reference authorized parties/accounts and immutable entries. A displayed balance should be derived or reconciled against ledger facts, not edited by a client.
- Government offices, parties, elections, laws, and court cases refer to the same canonical world and relevant jurisdiction/time period.
- World and player history should reference stable entity IDs and event IDs so changes can be audited and replayed or explained where appropriate.
- Social posts and messages belong to identities and require visibility, retention, deletion/appeal, and moderation rules.

These relationships will be refined by actual gameplay and data-protection requirements. Avoid circular ownership and cross-domain write access.

## Data and consistency direction

- Use stable, globally unique identifiers for durable entities. Select UUID/ULID or another identifier format with the first real schema based on indexing, offline creation, and privacy constraints.
- Use database constraints and transactions for high-impact invariants: ownership, transfers, inventory consumption, election finalization, and other one-time or limited resources.
- Favor append-only audit/ledger facts for consequential changes; define correction/reversal procedures rather than silently rewriting history.
- Store timestamps in UTC; separately store locale, time zone, and in-world calendar values when needed.
- Preserve provenance, source license, import date, and transformation version for geographic and institutional datasets.
- Use migrations with review, backups, forward/rollback strategy, and tests against representative data. Never make production schema changes only by editing a live database.
- Decide retention, deletion, export, encryption, and data-access policy before collecting personal data.

## Geography and scale

A geospatial PostgreSQL extension such as PostGIS may be appropriate for coordinates, boundaries, and spatial queries; it is not installed or selected yet. First identify data sources and licenses, prototype query patterns, and compare self-hosted/managed costs. Use external object storage for large static assets or bulk datasets only after a storage and retention policy exists; do not commit country-scale data to Git.

## One-world storage topology

Physical partitioning must preserve one logical world. Any regional/partition key describes placement or ownership and must not become a user-selected alternate `world_id`. Shared national invariants need a coordinated write path and recovery plan. Replicas and caches serve performance/read availability; define stale-read tolerance and do not allow them to commit conflicting authoritative histories.

## Current reality check

The Node API serves a static world descriptor over HTTP and a Stage 2 WebSocket prototype that creates anonymous player identities, persists character records, and advances one shared clock in a local JSON file. Nine Node integration tests cover HTTP regressions and selected WebSocket authority, coexistence, validation, reconnect/persistence, chat, rate limits, and clock behavior. The JSON store is not a production database. Separately, the Stage 1 client has a local JSON save implementation and restart-test harness, but neither has been runtime-tested in Godot.
