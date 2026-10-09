# Architecture

## Current shape

The Stage 0 Node/TypeScript API and Stage 1 local Godot prototype remain in place. Stage 2 added optional multiplayer; Stage 3 extends the same project with bounded geographic data and preview/presence; Stage 4 adds a data-driven education domain; Stage 5 adds calendar-driven age/life simulation, family/relationship history and lifecycle status; Stage 6 adds a data-driven, server-authoritative careers domain. Education, life and career records integrate with the existing character, household, geography, save and multiplayer contracts. The online server owns one shared `nigeria-main` clock and timeline; offline local state remains separate from online authority. Godot 4.7.2 is unavailable, so all client UI and runtime paths—including Stage 5 and Stage 6—remain engine-unverified.

```text
Godot client (game/)                                     Node world API (services/world-api/)
┌────────────────────────────────────┐                   ┌────────────────────────────────────┐
│ Stage 1 local Idera Quarter        │                   │ HTTP: /health, /api/v1/world       │
│   └── user:// local save/load      │                   │                                    │
│ Stage 3 bounded Akure South preview│◄── processed JSON │ One nigeria-main clock/state file  │
│   └── geographic conversion        │                   │ Geography catalog + import model   │
│ Stage 4 school/campus/training UI  │                   │ Education catalog + domain rules   │
│   └── student record in character  │                   │ Server-owned student/character data│
│ Stage 5 age/family/profile UI      │                   │ Calendar + life/family aggregates  │
│   └── local DOB/history save       │                   │ One authoritative life timeline   │
│ Stage 6 careers/employment panel   │                   │ Career rules + pay adapter        │
│   └── private career profile       │                   │ Existing balance; no Stage 7 bank │
│ Optional Stage 2–6 WebSocket client│◄──── JSON /ws ───►│ Auth location / school / life / careers     │
│   ├── interpolated remote players  │                   │ 500 m chunk/nearby interest        │
│   └── local session config         │                   │ One process + one JSON file        │
└────────────────────────────────────┘                   └────────────────────────────────────┘
     Offline Stage 1 save is separate                    No DB/distributed ownership
```

There is one canonical logical world, `nigeria-main`. The processed geography catalog adds national administrative identity and one small Akure South feature sample; it does not create a second world, a shard, or full national geography.

## Implemented boundaries

### Godot client

- `game/scripts/domain/`: retains Stage 1 character, household, school, dialogue and local clock plus Stage 3 `GeographyModel` functions. Stage 4 `education_service.gd` loads the shared education catalog and applies offline enrollment, attendance, assessment, progression, exams, pathways, funding and history. Stage 5 `life_simulation_service.gd` and `world_clock.gd` load the life catalog, derive dates/ages/stages, catch up idempotent lifecycle events and manage family/relationship/marriage/childbirth/death/retirement records. `character_state.gd` persists and guards lifecycle-sensitive actions. `school_service.gd` adapts existing timetable/class actions to education.
- `game/scripts/services/save_service.gd`: client-local, versioned save; it remains separate from online authority, tolerates optional geography, reads legacy local saves, and preserves structured education plus life/DOB/family/history data.
- `game/scripts/services/multiplayer_client.gd`: WebSocket session create/resume, reconnect attempts and JSON messages.
- `game/scripts/world/geographic_region_preview.gd`: loads the small processed Akure South file, draws mapped line/polygon/POI data, displays OSM attribution and provides read-only POI markers.
- `game/scripts/world/world_map.gd`: keeps Idera Quarter as the default map, toggles the bounded geography preview only outdoors, and exposes mapped schools/health points/named buildings as generic inspect actions. Stage 4 adds same-world school/campus/training locations; Stage 5 spawns the persistent starter-family NPC records at the household home.
- `game/scripts/player/player_actor.gd`: keyboard movement offline; in online mode interpolates toward server-computed position and sends movement intent.
- `game/scripts/player/remote_player.gd`: interpolates filtered public presence and retains geographic region/chunk fields.
- `game/scripts/ui/career_panel.gd`, `game/scripts/prototype_game.gd` and `game/scripts/ui/prototype_ui.gd`: add the Stage 6 career panel and route authenticated career intents/results alongside map/geography, multiplayer, education and Stage 5 life/profile data. The panel displays private server career projections and does not implement offline fake jobs. UI rendering/client workflows have not been verified in Godot.

Online money, inventory, needs, education records, life status, career profile/work/payroll, location, position, geographic identity and clock are server-owned snapshots. Career records are online-only; the separate local save retains existing Stage 4 education and Stage 5 life data, not offline jobs or salary. The client loads the processed map-data file for rendering; it does not choose its own server-verified state/LGA/ward IDs.

### Node server and geography modules

- `services/world-api/src/app.ts` retains `GET /health` and `GET /api/v1/world`, adds the WebSocket endpoint (`/ws` by default), and enforces upgrade path/origin and a message-size cap. The world descriptor truthfully reports Stage 3's bounded geographic coverage and the Stage 4 education, Stage 5 life-simulation and Stage 6 career implementation flags/scope.
- `services/world-api/src/geography/types.ts` defines WGS84 coordinates, the one-world geographic location, administrative/region/asset structures and processed geometry types.
- `services/world-api/src/geography/coordinates.ts` implements coordinate validation/normalization, local equirectangular conversion, viewport conversion, haversine distance and a stable global 500 m chunk grid.
- `services/world-api/src/geography/importer.ts` validates the pinned source artifacts and deterministically normalizes the 37 state/FCT records, 774 LGA records, 11 ward reference points and bounded GeoJSON feature sample.
- `services/world-api/src/geography/catalog.ts` loads/validates the processed region, derives a server geographic identity from coordinates/map position and validates persisted player location fields.
- `services/world-api/src/education/catalog.ts`, `types.ts` and `service.ts` load/validate the shared fictional content/rules, define persistent student records and enforce server-side enrollment, timetable, attendance, grades/progression, examinations, tertiary admissions/semesters, vocational training/apprenticeships, scholarships and history.
- `services/world-api/src/life/calendar.ts`, `types.ts` and `service.ts` load the configurable life catalog, derive Gregorian dates/ages/life stages, process offline birthday/stage catch-up idempotently, and manage persistent people/families/households, safe relationships, marriages, child NPCs, retirement, death/history and inheritance-reference events.
- `services/world-api/src/careers/catalog.ts`, `types.ts` and `service.ts` load/validate the fictional career catalogue and own server-side eligibility, job search/application review, employer/vacancy staffing, persistent employment/work sessions, skill/performance review, payroll adapter/payment IDs, unpaid leave, promotions, resignation, internal employer-authorized termination, retirement/death closure and household NPC career fixtures. Salary uses `SalaryAccountPort` to credit the existing prototype character balance; it is not an economy or bank.
- `services/world-api/src/businesses/catalog.ts`, `types.ts` and `service.ts` load/validate the fictional business catalogue and own server-side business creation, product/service catalogues, inventory, sales, production recipes, role-based ownership, financial ledger, and daily cost processing. Businesses integrate with Stage 7 economy (cash accounts) and Stage 6 careers (employee recruitment).
- `services/world-api/src/properties/catalog.ts`, `types.ts` and `service.ts` load/validate the fictional property catalogue and own server-side property marketplace, purchase/sale, rental agreements, maintenance, furnishing, ownership transfer, and NPC seeding. Properties integrate with Stage 7 economy (cash accounts) and Stage 8 businesses (commercial property compatibility).
- `services/world-api/src/government/catalog.ts`, `types.ts` and `service.ts` load/validate the government catalogue and own server-side government organisations, offices, appointments, budgets, revenue, expenditure, projects, announcements, search, and snapshots. Government integrates with Stage 6 (careers for appointments), Stage 7 (economy for budgets/finance), Stage 8 (businesses for commercial projects), and Stage 3 (geography for project locations).
- `services/world-api/src/elections/catalog.ts`, `types.ts` and `service.ts` load/validate the elections catalogue and own server-side political parties, party memberships, political profiles, elections, candidates, campaigns, campaign events, campaign finance, debates, ballots, voter participation, disputes, and audit records. Elections integrate with Stage 10 government (office transfer after certified results), Stage 7 (economy for campaign finance), and Stage 3 (geography for jurisdiction eligibility).
- `services/world-api/src/multiplayer/world-engine.ts` owns identities, sessions, server-tick movement, the shared calendar clock, geography, education, life, player-facing career actions, businesses, properties, government and election actions. It validates locations/time, processes online characters and NPCs as the shared date advances, catches up lifecycle records on reconnect, enforces life/education restrictions, and routes career, business, property, government and election requests using authenticated character identity and bounded request IDs. Work, eligibility, promotion, resignation, retirement and payroll outcomes are server-authoritative; private career profiles are excluded from public presence. Government actions cover offices, appointments, budgets, revenue, expenditure, projects, and announcements. Election actions cover parties, candidates, campaigns, voting, results, and government office transfer. It filters geographic presence/chat/waves by local scene, region, chunks and proximity. Legacy Stage 2–5 records remain supported.
- `services/world-api/src/multiplayer/persistence.ts` validates online state schema 8, migrates supported earlier-schema state while preserving identity/character, education, geography, life, career, business, property, government and election records, and adds election maps. It writes snapshots through a temporary file plus rename and retains the 16 MiB/single-process prototype limits.
- `services/world-api/src/multiplayer/types.ts` defines the world (including persistent government and election maps), per-player character (including education/life, private career-profile projection, business ownership, government appointments and political profile) and public-presence records. `services/world-api/test/careers.test.mjs` covers Stage 6 domain, migration, multiplayer authority and privacy; `test/businesses.test.mjs` covers Stage 8; `test/properties.test.mjs` covers Stage 9; `test/government.test.mjs` covers Stage 10; `test/elections.test.mjs` covers Stage 11; life/education and retained tests cover earlier stages.
- `tools/geography/extract-osm-preview.mjs` deterministically extracts the committed bounded sample from an upstream preview file; `tools/geography/import-geography.mjs` invokes the validated TypeScript import and writes deterministic processed files plus a hash/provenance manifest.

The regional processed file is bundled with the Godot project and is also read by the server from the repository. There is no new HTTP map endpoint or remote tile fetcher. The selected area is a small bounded sample, not a complete or live map feed. Source terms and limitations are in [`DATA_SOURCES.md`](DATA_SOURCES.md).

## State ownership and data separation

The versioned JSON state (`schemaVersion: 8`) has:

- `worldId: nigeria-main` and exactly one online `worldClock`, shared by all online characters and NPC lifecycle processing. Its date/time is derived from world day, minute and millisecond remainder; `GAME_MINUTE_MS` optionally configures shared scaling.
- `players`, keyed by server-issued player ID, with identity hashes, bounded request-ID history and a server-owned `CharacterRecord`.
- `people`, `households`, `families`, `relationships`, `lifeEvents`, `marriages` and `inheritanceEvents`, keyed by durable IDs. These link players, NPCs, household membership, generations, histories and relationships without making regional timelines or independent worlds.
- `CharacterRecord.geographic_location`, nullable; older records without it normalize to `null`. A populated value includes world/region/country/state/LGA/settlement/optional ward, latitude/longitude, local metric position and stable chunk ID.
- `CharacterRecord.education_record`, a server-owned `StudentEducationRecord` with enrollment/progression, subjects, attendance, assessments, term results, exams, qualifications, applications, training, skills, scholarships and history. New records initialize from `game/data/education/catalog.json`.
- Character/NPC life fields: DOB, age snapshot derived from the current world date, life stage/status, household/family/event/relationship IDs, last processed date, retirement/death fields and inheritance-event references. New lifecycle records initialize from `game/data/life/life_catalog.json`; life-event and family aggregates remain in the versioned JSON state, not static catalogs.
- `careerEmployers`, `careerVacancies`, `careerApplications`, `employments`, `workSessions`, `careerSkills`, `careerLicenses`, `careerReviews`, `careerLeaveRequests`, `careerEvents`, `salaryPayments` and `npcCareers`: bounded prototype employment/payroll records linked by stable IDs. The catalogue stays static in `game/data/careers/careers_catalog.json`; salary payments use the existing character balance adapter, not a duplicate account/economy.
- `businesses`, `businessProducts`, `businessInventory`, `businessTransactions`, `businessSales`, `businessProductionRuns`, `businessEvents` and `businessSnapshots`: bounded business records linked by stable IDs. The catalogue stays static in `game/data/businesses/catalog.json`; financial transactions use the Stage 7 economy cash accounts, not a duplicate ledger.
- `properties`, `propertyOwnership`, `propertyListings`, `rentalAgreements`, `rentalPayments`, `propertySales`, `propertyMaintenance`, `propertyFurnishings` and `propertyEvents`: bounded property records linked by stable IDs. The catalogue stays static in `game/data/properties/catalog.json`; financial transactions use the Stage 7 economy cash accounts, not a duplicate ledger.
- `governmentOrganisations`, `governmentOffices`, `governmentAppointments`, `governmentBudgets`, `governmentRevenue`, `governmentExpenditure`, `governmentProjects`, `governmentAnnouncements` and `governmentEvents`: bounded government records linked by stable IDs. The catalogue stays static in `game/data/government/catalog.json`; financial transactions use the Stage 7 economy cash accounts, not a duplicate ledger.
- `politicalParties`, `partyMemberships`, `politicalProfiles`, `elections`, `candidates`, `campaigns`, `campaignEvents`, `campaignFinances`, `debates`, `ballots`, `voterParticipation`, `electionDisputes` and `electionAudits`: bounded election records linked by stable IDs. The catalogue stays static in `game/data/elections/catalog.json`; campaign financial transactions integrate with Stage 7 economy cash accounts, not a duplicate ledger.
- Career profiles are built per authenticated character snapshot/result. Public presence/world snapshots do not include private application, salary, employment, skill or work-session records. Schema-version-1/2 online state is migrated to version 3 while preserving identity, education, money, position, household, geography and Stage 5 lifecycle records.

A connected public-presence view exposes selected profile/appearance, current local-scene position, nullable geographic identity, region/chunk IDs, connection status and last-seen time. Geographic presence is included only for nearby observers; a character snapshot returns the complete record to that player's session. Administrative source IDs and canonical game IDs are distinct.

The geographic source and delivery path is separate from gameplay logic:

```text
game/data/geography/source/      pinned subset/source artifacts + source license notices
        │ validated deterministic import (TypeScript)
        ▼
game/data/geography/processed/   stable client/server catalog + SHA-256/provenance manifest
        │                                │
        ├── Godot preview renderer       └── server catalog/location validation
        └── map inspection data              (no map gameplay hard-coding)
```

The local `user://naija-stage1-save.json` remains separate. Offline and online characters are distinct records; the current local save schema migrates version-1 saves by translating legacy scores and attendance into an education record. The online session token and random identity-recovery key are not stored in plaintext by the server; the server stores SHA-256 hashes. The client stores its bearer token/recovery key in a local Godot `ConfigFile`—not secure credential storage or external-account authentication.

## Geographic coordinate, chunk and presence flow

1. Importer input is WGS84/CRS84. It validates range, broad country placement, geometry structure, source IDs/layers, viewport intersection, and provenance. Canonical location IDs come from normalized administrative source names/codes, not OSM IDs or uncertain Wikidata values.
2. The regional local metric frame is equirectangular about `(longitude 5.2°, latitude 7.25°)`, with 1 game unit per metre, `x` east, `y` south and 0.001 m position precision. WGS84 storage is rounded to seven decimal degrees. The sample viewport is separately mapped linearly to the 1600×900 playable map pixels.
3. The Nigeria-wide chunk grid is stable across regional origins: 500 m cells using a 9° central-latitude equirectangular x-grid and equatorial y-grid, IDs `ng:500m:{column}:{row}`. Each feature is conservatively indexed across its axis-aligned geometry bounds (some cells may not intersect the geometry). The prototype includes a helper to select data by chunk, but loads this bounded 200-feature sample as one file.
4. When a player toggles **Map data** outdoors, the client sends `geography.enter` with only the known sample-region ID. The server derives coordinates/admin IDs/chunk from the server-owned current map position and returns the authoritative snapshot. On town-map movement the server recomputes that location. `geography.leave` clears it. Travel into a Stage 2 indoor/school subscene clears the geographic position; the user can opt in again when outside.
5. Public presence and social interactions require the same local scene. If both players carry geography, the server also requires the same region, a chunk within a one-cell Chebyshev radius and distance no more than 1,500 m for presence. Chat/waves use their tighter action radii. Players with no geographic location retain the Stage 2 legacy behavior; a geographic player and legacy-only player are not mixed into unfiltered global interest lists. The client applies the same nearby filter before rendering remote avatars.

Chunks and regions organize one map and interest set; they do not own separate copies of the world. Current server/client loading is a small foundation, not an implementation of national tile streaming, route graph delivery, or production-scale player interest management.

## Online command flow

1. An untrusted client connects to the configured WebSocket path and requests a server-issued identity using a client recovery key, or presents a saved session token.
2. The server stores only token/key hashes, validates the selected profile, rejects duplicate live sessions, and sends that player's character, shared clock and filtered presence list.
3. The client sends intents: sequenced normalized movement direction/run intent (not a position), travel entrance, purchase/consume, class/course/exam answer, education/life/career action, chat, nearby wave, or optional `geography.enter`/`geography.leave`. Career operations use `career.action`; private profiles/results are scoped to the authenticated character. Employer termination and professional-registration actions are not exposed over the player protocol.
4. Server rules decide movement, accepted locations, prices, education outcomes, date/age/life stages, relationship eligibility, marriage/child/death effects, job eligibility/application decisions/work sessions/payroll/progression and server-derived geographic identity. Updated character/life/career snapshots and filtered presence are broadcast.
5. Consequential commands use request IDs and bounded per-player deduplication. Geography toggles remain reversible interest/location actions. Validated character, clock, education, life and career changes are persisted to the JSON store.

The server ticks at 20 Hz by default; client movement input is sent about 20 times per second and presence/clock snapshots are broadcast about 10 times per second. Movement is clamped to a 1600×900 prototype map with server-owned walk/run speeds; authoritative wall-collision/pathfinding is not implemented. The server validates message size/shape, movement sequence/rate, action range, chat length/rate, global command rate, connection attempts and browser origin configuration.

## Persistence and clock limits

The state file defaults to `services/world-api/data/world-state.json` (ignored by Git) and is configurable with `DATA_FILE`. The store validates schema version `3`, migrates compatible schema-version-1/2 records, refuses malformed state rather than silently resetting, rejects files above 16 MiB and atomically replaces snapshots. Legacy records without geography normalize to a null location; education, life and career fields/maps are initialized or migrated while preserving existing identity and Stage 2–5 state. There is no database transaction, journal/event log, distributed lock, full migration framework, encryption, backup/restore job or multiwriter coordination. Do not point multiple server processes at the same file.

A new online world starts at Day 1, 07:50 on 2025-01-01 and advances one game minute per 650 ms by default. `GAME_MINUTE_MS` can override the scale within the validated configuration range. The single clock runs while the API process is running (including with zero online players); it pauses during server downtime and does not catch up the world after restart. Characters/NPCs that reconnect or are reached by lifecycle processing catch up idempotently through the current shared date. The local offline save has its existing separate persisted client clock, not a parallel server timeline. Needs currently decay only for connected players. These remain prototype rules.

## Not implemented

- Complete official/state/ward administrative boundary geometry, full national detail, complete city/building coverage or all settlements.
- Port Harcourt/Rivers geographic sample, multi-region extraction service, national tile streaming or automatic online data downloads.
- Routing graph, public transport schedules, vehicle traffic, building interiors, regional environment/terrain/weather simulation or climate-driven events.
- Production authentication/account recovery, database transactions, distributed ownership/operations, encrypted credentials, backups/high availability, production WSS deployment, moderation/privacy tooling, comprehensive anti-cheat/collision/pathfinding, or full Stage 1 domain synchronization.
- Full economy/banking, education policy, official examination/accreditation integration, real employer/account/credentialing systems, property and asset transfer, legal inheritance, automatic death, a complete NPC society, production database or national institutional coverage. Stage 6 careers remain prototype fixtures, not a production job market.

Do not describe prototype scope as national coverage or production capacity. See [`MULTIPLAYER_PLAN.md`](MULTIPLAYER_PLAN.md), [`WORLD_PLAN.md`](WORLD_PLAN.md), [`DATA_SOURCES.md`](DATA_SOURCES.md), [`LIFE_SIMULATION_PLAN.md`](LIFE_SIMULATION_PLAN.md) and [`SECURITY_PLAN.md`](SECURITY_PLAN.md).

## Verification boundary

`npm run check` passes ESLint, the strict TypeScript build and 48 Node tests, including Stage 6 career domain/migration/privacy/multiplayer behavior plus retained Stage 1–5/backend, education, life, geography, and persistence regressions. `npm run geography:check` passes. `gdformat --check` parses/formats all 21 GDScript files. `gdlint` reports seven structural findings in existing Stage 1–5 files; no Godot runtime is available. Godot project import, scene loading, offline/online gameplay, rendered UI, local save/restart, career-panel behavior, Godot multiplayer UI and platform exports remain unverified. Stage 5's client/runtime limitation remains open. Exact results are in [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).
