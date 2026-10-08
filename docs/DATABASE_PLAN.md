# Database Plan

## Status

No production database, migration framework or database connection is part of the current Stage 3 implementation. The Node server stores the bounded multiplayer prototype's shared clock and player records in one versioned local JSON file. It is server-authoritative within one process, but has no transactions, multi-writer coordination, encryption, backup or production recovery. Geographic source/processed catalogs are immutable repository assets, separate from that online player-state file. The separate Godot Stage 1 local save remains client-local and is not online authority.

PostgreSQL remains a leading future candidate because relational constraints fit authoritative records and a geospatial extension can support geographic queries. PostGIS is not installed or selected yet. Confirm version, hosting, extension, retention, migration and backup design before adopting it. Do not create hundreds of tables from this plan; add a small schema slice only when a roadmap feature needs it, with constraints, tests, ownership and rollback/recovery notes.

## Conceptual entity families

Names below are illustrative concepts, not a prescribed one-table-per-bullet schema.

| Domain | Potential entities |
|---|---|
| Accounts and identity | `users`, authentication identities, access roles, privacy/consent settings, moderation state |
| People and households | `player_characters`, NPC/person records, `households`, `families`, life events, `relationships`, guardianship |
| Geography and places | `countries`, `admin_units`, canonical states/FCT/LGAs/wards, settlements, `geographic_regions`, `geographic_features`, stable chunks, `buildings`, entrances, roads, reusable POIs, schools and other institutions |
| Education and work | `education_records`, enrollments, courses, skills, `jobs`, employment, apprenticeships |
| Economy and commerce | `bank_accounts` (virtual game accounts only), `transactions`, balances/ledger entries, taxes, loans, investments, `businesses`, inventory |
| Assets and mobility | `properties`, ownership/tenancy, `vehicles`, transport routes and journeys |
| Civic and justice | governments, agencies, `political_parties`, offices, `elections`, laws and versions, `court_cases`, judgments, police/security records, criminal records where lawful and game-appropriate |
| Social and history | `world_events`, `social_posts`, `messages`, `player_history`, `world_history`, audit records |

Geographic tables should distinguish canonical game IDs from source IDs and identify `world_id = nigeria-main` as the one logical world. Store normalized source/provenance/license/version references, source-coordinate semantics, geometry CRS, import timestamp, transformation version and geometry validation status. A point-only registry must not be represented as an official boundary catalog. Region/chunk IDs are spatial indexing/content IDs, not alternate world IDs.

Sensitive systems such as identity, messages, police records and criminal records need explicit data minimization, access control, retention, safety review and separation from public profile data. Avoid using real financial account data; the envisioned economy is an in-game Naira-denominated simulation.

## High-level relationships

- A user account may control one or more player characters subject to product rules; a character belongs to a household and has life events, relationships, education, work, assets and history.
- NPCs and player characters exist in the same geographic hierarchy, but identity, privacy and ownership rules differ.
- Geographic locations parent buildings and institutions; a school is a specialized institution associated with a location, not an isolated coordinate system. A location may have an optional geometry, a source reference point, or both; do not infer a boundary or centroid from a point-only record.
- A geographic feature has one or more source references, a normalized feature kind, geometry and zero or more chunk-index records. Buildings, roads and POIs are data entities; gameplay actions are separate code/rule definitions.
- A business may have owners, employees, a location, inventory and a virtual ledger/account relationship.
- Transactions reference authorized parties/accounts and immutable entries. A displayed balance should be derived or reconciled against ledger facts, not edited by a client.
- Government offices, parties, elections, laws and court cases refer to the same canonical world and relevant jurisdiction/time period.
- World and player history should reference stable entity IDs and event IDs so changes can be audited and replayed or explained where appropriate.
- Social posts and messages belong to identities and require visibility, retention, deletion/appeal and moderation rules.

These relationships will be refined by actual gameplay and data-protection requirements. Avoid circular ownership and cross-domain write access.

## Data and consistency direction

- Use stable, globally unique IDs for durable entities. Select UUID/ULID or another identifier format with the first real schema based on indexing, offline creation and privacy constraints. Stage 3's canonical admin keys are deterministic state-code/name IDs; OSM IDs remain source references, not gameplay IDs.
- Use database constraints and transactions for high-impact invariants: ownership, transfers, inventory consumption, election finalization and other one-time or limited resources.
- Favor append-only audit/ledger facts for consequential changes; define correction/reversal procedures rather than silently rewriting history.
- Store geographic positions as WGS84 or a clearly declared CRS, with explicit coordinate order/axis semantics and precision. Keep projection/origin transforms versioned; do not use a local equirectangular frame for country-scale geodesic calculations.
- Store timestamps in UTC; separately store locale, time zone and in-world calendar values when needed.
- Preserve provenance, source license, attribution, retrieval/snapshot date and transformation version for geographic/institutional datasets.
- Use migrations with review, backups, forward/rollback strategy and tests against representative data. Never make production schema changes only by editing a live database.
- Decide retention, deletion, export, encryption and data-access policy before collecting personal data.

## Geography and scale

Stage 3 currently stores a canonical JSON catalog for `NG`, 36 states plus FCT and 774 LGA reference-point records, and one bounded 200-feature Akure South sample. Source inputs are pinned under `game/data/geography/source/`; deterministic processed assets and their manifest are under `game/data/geography/processed/`. The online server loads the small processed sample and persists only each player's optional geographic identity; it does not copy all static geography into `world-state.json`.

The importer validates the WGS84/CRS84 assumption, coordinate ranges, source and normalized IDs, approved layer mapping, GeoJSON geometry/ring structure, viewport intersection, a safety margin and chunk IDs. `npm run geography:import` regenerates outputs and `npm run geography:check` fails on stale/unreproducible files. Data terms/attributions are source-specific and documented in [`DATA_SOURCES.md`](DATA_SOURCES.md); no component's license is claimed to erase another's terms. The current OSM viewport is not an administrative boundary or complete extract.

A geospatial PostgreSQL extension such as PostGIS may later suit coordinates, authoritative boundaries, chunk indexes and spatial queries. It is not a current dependency. First identify boundary-appropriate sources/licenses, prototype spatial query and streaming patterns, compare self-hosted/managed costs, and define dataset versioning. Use external object storage for large static assets/bulk data only after a storage/retention policy exists; do not commit country-scale data or generated map tiles to Git.

## One-world storage topology

Physical partitioning must preserve one logical world. Any regional/partition key describes placement or ownership and must not become a user-selected alternate `world_id`. Shared national invariants need a coordinated write path and recovery plan. Replicas and caches serve performance/read availability; define stale-read tolerance and do not allow them to commit conflicting authoritative histories.

## Current reality check

The Node API serves the world descriptor over HTTP and a WebSocket prototype that creates anonymous player identities, persists character records, manages geographic presence/chunk interest and advances one shared clock in a local JSON file. Node tests cover retained HTTP behavior, legacy and geographic two-client interactions, nearby filtering, source/data invariants, coordinates, import reproducibility, validation, reconnect/persistence, chat/rate limits and clock behavior. The JSON store is not a production database. Separately, the Stage 1 client has a local JSON save/load implementation and restart-test harness; Godot is unavailable in this workspace, so those client runtime paths have not been engine-tested.
