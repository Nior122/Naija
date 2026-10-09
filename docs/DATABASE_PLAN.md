# Database Plan

## Status

No production database, production migration framework or database connection is part of the current Stage 6 implementation. The Node server stores the bounded multiplayer prototype's one shared clock, player records, education records, life/family aggregates and career/employment/payroll maps in a versioned local JSON file. The state is authoritative within one process, but has no transactions, multi-writer coordination, encryption, backup or production recovery. Geographic, education and life-simulation catalogs are static repository assets, separate from the online state file. The Godot local save remains client-local and separate from online authority.

PostgreSQL remains a leading future candidate because relational constraints fit authoritative records and a geospatial extension can support geographic queries. PostGIS is not installed or selected yet. Confirm version, hosting, extension, retention, migration and backup design before adopting it. Do not create hundreds of tables from this plan; add a small schema slice only when a roadmap feature needs it, with constraints, tests, ownership and rollback/recovery notes.

## Conceptual entity families

Names below are illustrative concepts, not a prescribed one-table-per-bullet schema.

| Domain | Potential entities |
|---|---|
| Accounts and identity | `users`, authentication identities, access roles, privacy/consent settings, moderation state |
| People and households | `player_characters`, NPC/person records, `households`, `families`, life events, `relationships`, guardianship |
| Geography and places | `countries`, `admin_units`, canonical states/FCT/LGAs/wards, settlements, `geographic_regions`, `geographic_features`, stable chunks, `buildings`, entrances, roads, reusable POIs, schools and other institutions |
| Education and work | Student education profiles/history, school and program enrollments, subject choices, attendance, assessments, term results, examinations/qualifications, scholarships, education/career skills, vocational training/apprenticeships, `jobs`, employers, vacancies, applications, employments, work sessions, performance reviews, leave, salary payments and NPC occupations |
| Economy and commerce | `bank_accounts` (virtual game accounts only), `transactions`, balances/ledger entries, taxes, loans, investments, `businesses`, inventory |
| Assets and mobility | `properties`, ownership/tenancy, `vehicles`, transport routes and journeys |
| Civic and justice | governments, agencies, `political_parties`, offices, `elections`, laws and versions, `court_cases`, judgments, police/security records, criminal records where lawful and game-appropriate |
| Social and history | `world_events`, `social_posts`, `messages`, `player_history`, `world_history`, audit records |

Stage 4 keeps the player's bounded education aggregate inside `CharacterRecord.education_record` (online JSON) or the local character JSON save. Its conceptual subrecords include stable student/character IDs, school/class/year/term/progression, selected subjects, attendance and assessment facts, published results, final-exam registrations/attempts, qualifications, applications, tertiary/vocational/apprenticeship enrollment, skill levels, scholarship balances and education-history events. Static rules/content live in `game/data/education/catalog.json`, not per-player rows or saves. This is a prototype aggregate contract, not a normalized schema or database migration.

Stage 5 stores DOB, derived age/life stage, life status, household/family IDs, processed-through date, event/relationship references and inheritance hooks on each online person/character. At the Stage 5 handoff, `world-state.json` schema version 2 introduced ID-keyed `people`, `households`, `families`, `relationships`, `lifeEvents`, `marriages` and `inheritanceEvents` maps beside `players` and one shared `worldClock`. Stage 6 advances online persistence to schema version 3; its migration supports both schema versions 1 and 2 while preserving character, education, geography, money and lifecycle data. The local save keeps lifecycle data in its character/household record. Configurable life rules remain in `game/data/life/life_catalog.json`. These aggregates/references are prototype persistence, not normalized production tables; deaths retain records, inheritance events hold asset-reference IDs only, and no assets transfer.

Stage 6 stores career data in schema-version-3 ID-keyed maps: `careerEmployers`, `careerVacancies`, `careerApplications`, `employments`, `workSessions`, `careerSkills`, `careerLicenses`, `careerReviews`, `careerLeaveRequests`, `careerEvents`, `salaryPayments` and `npcCareers`. Job/employer/vacancy definitions are static data in `game/data/careers/careers_catalog.json`; per-character records link to the existing Stage 4 qualifications/skills and Stage 5 life status. `salaryPayments` carries an idempotent `payment_id`, employee/employer/employment references, Naira amount, world pay period, related session IDs and posting time. In the current prototype the salary adapter credits existing character money and persists the payment/session markers in the same JSON snapshot; this is not an atomic ledger or a separate account. Stage 7 must replace the adapter with the canonical Naira ledger and a transactionally enforced idempotency key before wages become valuable state. These maps are aggregate/prototype contracts, not production-normalized table prescriptions.

Stage 7 advances online persistence to schema version 4; its migration supports both schema versions 1–3 while preserving character, education, geography, lifecycle, career and economy data. Stage 7 stores economy data in ID-keyed maps: `accounts`, `transactions`, `loans`, `loanPayments`, `marketGoods`, `creditScores` and `economyEvents`. Bank accounts carry an idempotent transaction record. `transactions` is append-only with double-entry bookkeeping. Loans carry origination fees, repayment schedules, and event history. Market goods are configurable static data in `game/data/economy/market_goods.json`. These maps are aggregate/prototype contracts, not production-normalized table prescriptions.

Stage 8 advances online persistence to schema version 5; its migration supports both schema versions 1–4 while preserving character, education, geography, lifecycle, career, economy and business data. Stage 8 stores business data in ID-keyed maps: `businesses`, `businessProducts`, `businessInventory`, `businessTransactions`, `businessSales`, `businessProductionRuns`, `businessEvents` and `businessSnapshots`. Business templates are configurable static data in `game/data/businesses/catalog.json`. Financial transactions integrate with Stage 7 cash accounts. These maps are aggregate/prototype contracts, not production-normalized table prescriptions.

Geographic tables should distinguish canonical game IDs from source IDs and identify `world_id = nigeria-main` as the one logical world. Store normalized source/provenance/license/version references, source-coordinate semantics, geometry CRS, import timestamp, transformation version and geometry validation status. A point-only registry must not be represented as an official boundary catalog. Region/chunk IDs are spatial indexing/content IDs, not alternate world IDs.

Sensitive systems such as identity, messages, police records and criminal records need explicit data minimization, access control, retention, safety review and separation from public profile data. Avoid using real financial account data; the envisioned economy is an in-game Naira-denominated simulation.

## High-level relationships

- A user account may control one or more player characters subject to product rules; a character belongs to a household and has life events, relationships, education, work, assets and history.
- NPCs and player characters exist in the same geographic hierarchy, but identity, privacy and ownership rules differ.
- A character's education aggregate belongs to that character/student and references stable institution, school-year, program, subject, qualification and skill IDs from versioned static catalogs; attendance, assessments, exams, fee awards and progression events stay attached to the education history. Education writes are server-owned online, while a separate offline save owns its own local record.
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

The Node API serves the world descriptor over HTTP and a WebSocket prototype that creates anonymous player identities, persists character records, manages geographic presence/chunk interest, advances one shared calendar clock, and owns online education, life/family, and career/employment/payroll maps in a local JSON file. Stage 4 education, Stage 5 life, and Stage 6 career records are normalized/migrated without replacing existing identity, geography or character state. Education/life/career catalogues are static repository data, not copied into player state. `npm run check` passes 48 Node tests, including 11 career tests for catalogue/eligibility, applications, work/payroll idempotency, leave, promotion, termination, retirement/death, migration, multiplayer authority and privacy, alongside earlier-stage regressions. The JSON store and salary adapter are not production database/economy designs. The Godot client source includes the career panel, but Godot is unavailable in this workspace, so project import, offline client behavior, career UI, save/restart and multiplayer runtime paths remain engine-unverified; Stage 5's earlier Godot caveat remains open.
