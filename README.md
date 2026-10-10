# Naija: One World

> **One country. One persistent world. Millions of lives. Players create the history.**

Naija: One World is a long-term Nigerian life-simulation game project. The intended game will let players begin as secondary-school students and shape lives across education, work, family, community, culture, public life, and future generations in **one shared logical Nigeria**.

## Current status

The repository implements **Stages 0–9** on the same `nigeria-main` world. Offline local saves remain separate from the server-owned online character/world state; there is one shared authoritative online timeline, not regional or player-specific online clocks.

Stage 3 includes a canonical registry for 36 states plus FCT and 774 LGAs, a reproducible geographic import pipeline, and a small 200-feature OpenStreetMap preview sample for Akure South, Ondo State. The sample is not full city, LGA, state, or national coverage. Stage 4 includes configurable secondary schooling, subjects/timetable/attendance, assessment/progression, fictional exams and post-secondary/trade pathways. Stage 5 adds a configurable Gregorian calendar/time scale, DOB-derived age and life stages, birthday/offline catch-up, persistent family/relationship/history records, safe adult relationship progression, marriage/child NPCs, retirement/death records and inheritance-reference hooks. Stage 6 adds a configurable career catalogue, server-checked eligibility and job applications, persistent employers/vacancies/employment/work history, scheduled work sessions, performance/skills, idempotent salary postings to the existing prototype balance, leave, progression, resignation/termination/retirement and deterministic household-NPC career foundations. Stage 7 replaces the Stage 6 prototype salary adapter with an atomic canonical Naira-denominated ledger, adds configurable bank accounts (savings/current/fixed-deposit), deposits/withdrawals/transfers, market goods with hunger restoration, progressive PAYE income tax estimation, credit scoring, and personal/student/business loan products with origination fees and repayment tracking. Stage 8 adds configurable business templates across retail, food, tech, trades, agriculture, transport, creative, professional, and manufacturing categories with product/service catalogues, inventory, sales, production recipes, business financial accounts, operating expenses, role-based ownership, branch expansion, ownership transfer, employee hiring/firing, NPC business seeding, and daily cost processing. Stage 9 adds configurable property types (residential, commercial, land, public), property locations across Nigerian cities, property marketplace with filtering, property purchase/sale with atomic ownership transfer, rental agreements with deposits and payments, property maintenance with condition tracking, furniture purchasing and placement, ownership transfer, and NPC property seeding. Stage 10 adds a configurable government system with federal/state/local hierarchy, 15 federal ministries, government offices with unique-office enforcement, character appointments with age/eligibility validation, budgets with revenue and expenditure, government projects with lifecycle management, published announcements with searchable scope, and Federal Government of Nigeria seeding — all integrated with the existing economy, careers, and geography systems. Stage 11 adds a configurable elections and politics system with political parties (create, register, join, leave), election lifecycle management (scheduling, candidate registration, screening, campaign, voting, counting, certification), voter eligibility verification, secure ballot casting with duplicate prevention, deterministic vote counting, result certification and publication, election disputes, and automatic transfer of certified election winners into Stage 10 government offices. Stage 12 adds a configurable laws, courts and justice system with a versioned legal framework, court hierarchy (8 court levels with 7 seed courts), legislative proposals, legal professional appointments, case management (civil and criminal), evidence submission, judicial hearings and judgments, fines integrated with the Stage 7 economy, appeals, and a comprehensive audit trail. Stage 13 adds a configurable police and security system with police organizational hierarchy, officer recruitment and promotion, incident reporting with reference numbers, dispatch management, investigations with evidence chain-of-custody, wanted records with authorization controls, arrests with processing workflows, misconduct complaints with accountability outcomes, and audit trails. Stage 14 adds a configurable military system with three service branches (Army, Navy, Air Force), organizational hierarchy with cycle prevention, military bases linked to geography, recruitment with eligibility enforcement, 18 training courses with prerequisites, configurable rank structures (16 ranks per branch), promotion with time-in-rank requirements, command appointments, duty assignments, leave management, equipment/asset accountability, national-security events, and disciplinary processes with justice system integration. Stage 15 adds a configurable crime and consequences system with 14 crime categories, 12 crime definitions across 4 severity levels, server-authoritative crime action resolution with detection rolls, incident lifecycle management, evidence tracking, criminal records distinct from allegations, notoriety tracking with decay, restitution integrated with the Stage 7 economy, rehabilitation programs, and anti-exploit protections — all integrated with Stage 6 careers, Stage 10 government, Stage 12 justice, and Stage 13 police without duplicating their functionality.

Backend lint/build and all 105 Node tests pass; the deterministic geography check and GDScript formatting/parser check pass. Static GDScript lint retains seven structural findings in existing large files. **Godot 4.7.2 is not installed in the current workspace**, so project import, offline/online client gameplay, UI and local save/restart behavior—including the career panel and economy services—remain unverified. Stage 5's earlier Godot verification limitation remains open. See [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md), [`docs/LIFE_SIMULATION_PLAN.md`](docs/LIFE_SIMULATION_PLAN.md), [`docs/CAREERS_AND_EMPLOYMENT_PLAN.md`](docs/CAREERS_AND_EMPLOYMENT_PLAN.md), and [`docs/ECONOMY_PLAN.md`](docs/ECONOMY_PLAN.md) for evidence and limits.

Education, life-simulation and career content are configurable fictional prototype data—not official guidance, real-world demographic/pay claims, professional licensing, or employment law. Stage 5 has no sexual content, automatic old-age death, asset transfer, or legal inheritance. Stage 6 has no real employer accounts or production service. Stage 7 economic data (prices, tax rates, interest rates, bank/loan products) is fictional and game-balanced—not official Nigerian economic data, tax guidance, or banking regulation.

## Stage 1 — first playable slice (retained)

The local, offline Godot prototype lets a player:

- Create a named 15–16-year-old secondary-school student, choose a character type and appearance, and receive a generated family/guardian household and home.
- Explore the fictional **Idera Quarter** and travel between a home, streets, school yard/classroom, market, clinic, police station, and community hall.
- Walk/run with **WASD** or **arrow keys**, hold **Shift** to run, and press **E** or the HUD button to interact.
- Talk to family, neighbours, students, teachers, and service NPCs; visit the small shop, school, bus stop, clinic, and bed.
- Track Naira, hunger, energy, health, inventory, attendance, academic averages, household/home, and location. Reputation is a placeholder field without progression rules.
- Attend short activities for Mathematics, English, Computer Studies, Biology, and Civic Education; use a local day/time clock.
- Save/load a local versioned JSON character through Godot's `user://` storage. The save/restart harness exists but is **not engine-verified here**.

The 2D prototype uses original procedural placeholder drawings. It has no real map data or third-party game art; see [`docs/ASSETS.md`](docs/ASSETS.md).

## Stage 2 — multiplayer foundation

Online play is optional and uses the same Godot project. It connects to one shared prototype world over JSON WebSocket (`/ws`); the server assigns identity and owns the saved online character, position, actions, and world clock. The client sends movement intent rather than coordinates, renders other connected characters from server presence, and exposes nearby chat and a wave interaction.

The current server also validates and applies the prototype's location travel, bus fare, purchases, item consumption, clinic care, rest, and classroom answers. State-changing requests use bounded request-ID deduplication. The server checks message size, schemas/ranges, interaction distance, connection/command/chat rates, and browser `Origin` configuration.

Player records and the shared clock are separate logical fields in one local JSON file (`world-state.json`), written through a temporary file and rename. The Stage 1 local save remains separate from online character state. The session token and identity-recovery key are kept on the client in a Godot `user://` config file; this is **not** account authentication or encrypted credential storage. The JSON file is a single-process prototype persistence mechanism, not a database or a multi-server coordination layer.

## Stage 3 — Nigerian geography expansion

Stage 3 extends the existing Idera/Stage 2 architecture; it does not split Nigeria into shards or replace the playable prototype.

- **One world/admin catalog:** `NG` → 36 states plus FCT → 774 canonical LGA records. Source IDs are preserved for provenance; stable game IDs derive from state code and normalized names. Three duplicated optional Wikidata IDs are reported and omitted. LGA and ward coordinates remain reference points—not claimed boundaries or centroids.
- **Playable sample:** press **Map data** while outside in Idera Quarter to toggle a small Akure South, Ondo sample preview. It draws roads, building footprints, waterways, land use, schools and health points; named buildings and mapped education/health features can be inspected. Turning it off restores the original Idera map and interactions. This is a viewport sample, **not an LGA/settlement boundary or a complete Akure map**. Port Harcourt was preferred but no suitable bounded sample with verified terms/provenance was available during this pass.
- **Data pipeline:** raw pinned-source artifacts live in `game/data/geography/source/`; validated, normalized client data and provenance live separately in `game/data/geography/processed/`. Run `npm run geography:import` to regenerate, and `npm run geography:check` to verify that outputs match pinned inputs. Both commands validate the source CRS, country ranges, administrative hierarchy, feature IDs/geometries, and chunk metadata. Do not treat the embedded OSM preview as a complete or live extract.
- **Coordinates/chunks:** input/storage uses WGS84 decimal latitude/longitude (GeoJSON coordinates are `[longitude, latitude]`, CRS84). The Akure regional frame uses origin `(longitude 5.2°, latitude 7.25°)`, local equirectangular projection, `x` east/`y` south, 1 game unit/metre for metric local coordinates, millimetre local precision, and `1e-7°` stored geographic precision. The 1600×900 preview separately maps the selected viewport bounds to pixels. Stable Nigeria-wide 500 m chunks use the documented 9° central-latitude grid; chunks are loading/interest identifiers inside the same world, not separate worlds.
- **Online presence:** optional geographic identity is derived by the server from the existing outdoor map position or validated sample coordinate. Presence carries region/chunk/admin IDs; geographic players are filtered to the same local scene and neighboring chunks (plus a 1.5 km distance cap), and chat/waves use geographic distance. Legacy Stage 2 players without geography remain supported. No national streaming service, routing simulation, transport, weather, or regional environment simulation is added; extension fields are placeholders.

Data provenance, exact upstream commits, license treatment, attribution and coordinate caveats are recorded in [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md). The processed assets are small; the full upstream preview and any country-scale extracts are not committed.

## Stage 4 — Complete Nigerian Education System

Education is a persistent progression in the existing world, not a detached menu. A student's record connects secondary enrollment, school-year and term progression, chosen subjects, timetable, classroom attendance, original assessments, results, final-secondary exam eligibility, tertiary/trade study, skill history, funding and qualifications to the existing character, clock, family/money, school/campus locations, geography, saves and online multiplayer authority.

The shared fictional catalog lives at [`game/data/education/catalog.json`](game/data/education/catalog.json). It configures the six JSS/SS years, twelve subjects, fictional assessments/schools/institutions, separate ND/HND pathways, fees, scholarships and vocational/apprenticeship trades. The offline Godot UI/domain and online TypeScript server use the catalog; online education outcomes are server-owned and part of the existing character snapshot/persistence. The Godot client path has not been engine-tested in this workspace.

Read [`docs/EDUCATION_PLAN.md`](docs/EDUCATION_PLAN.md) for detailed implemented scope, persistence/migration contracts, test evidence, data boundaries and remaining runtime verification. Stage 4 itself does not include full employment/careers, banking/economy, government education policy, official examination/admission rules, or protected examination content.

## Stage 5 — Age & Life Simulation

The online API owns one calendar clock for `nigeria-main`. DOB is authoritative for age; the current age is a synchronized gameplay snapshot. The shared life catalog configures the epoch, time scale, stages, adult restrictions, family-generation bounds, retirement and old-age review thresholds. New characters normally start at 15 or 16. Lifecycle processing is idempotent and catches disconnected player/NPC records up to the current shared server date; the prototype clock pauses while the server process is down.

Persistent people, households, families, relationships, life events, marriages and inheritance-event foundations are linked by IDs. Configurable starter-family profiles vary caregiver roles/count and sibling groups; relatives are unique NPC records, not a universal parent pair. Friendship remains non-romantic and age-appropriate; romantic progression and marriage are adult-only and mutually confirmed. Children are NPC records, not separately controlled players. Deceased records/history/relationships are retained and normal active actions are blocked. Inheritance events carry references only; no property/legal transfer is implemented. Accident, violence/crime-related and poisoning/exposure are abstract narrative cause labels only.

The local profile/save and Godot world/NPC paths are source-implemented but **not engine-verified**. See [`docs/LIFE_SIMULATION_PLAN.md`](docs/LIFE_SIMULATION_PLAN.md) for the model, exact persistence boundaries, tests and known limitations.

## Stage 6 — Careers & Employment

The configurable career catalogue and server service integrate with Stage 4 education/skill/qualification records and Stage 5 DOB, age, retirement and death state. Authenticated players can search prototype vacancies, apply/withdraw, clock in and complete server-timed shifts, record unpaid leave, request eligible promotions, resign and retire. Employers/vacancies, applications, employment history, work sessions, career skills, reviews, leave, salary payments and NPC career fixtures persist in the shared server state. Career-profile data is returned to the owning session, not public player presence.

Payroll uses an idempotent payment ID and the existing server-owned character balance through a narrow adapter; this is not a bank or general economy. Employer termination and professional registration are internal server foundations only because the prototype has no authenticated employer/credentialing role system. Career employers, salaries and rules are fictional fixtures, not verified real-world data. The Godot career UI is source-integrated and format/parser checked, but not engine-tested because Godot is unavailable. See [`docs/CAREERS_AND_EMPLOYMENT_PLAN.md`](docs/CAREERS_AND_EMPLOYMENT_PLAN.md).

## Stage 7 — Full Nigerian Economy

Stage 7 replaces the Stage 6 prototype salary adapter with an atomic canonical Naira ledger and adds banking, market goods, tax estimation, credit scoring, and loans — all inside the same `nigeria-main` world.

- **Canonical Naira ledger:** Every character's cash balance is owned by a persistent `economyAccounts` cash-account record. The `economyAccountPort` credits Stage 6 payroll salary into this ledger with idempotent deduplication.
- **Banking:** Configurable savings, current, and fixed-deposit products with interest rates, monthly fees, withdrawal/transfer fees, daily withdrawal limits, and minimum balances. Deposits, withdrawals, and inter-account transfers are atomic ledger entries.
- **Market goods:** 12 configurable items across food, health, transport, utilities, and clothing. Food purchases restore hunger; each good has location availability.
- **Tax estimation:** Six progressive PAYE income tax bands for display-only monthly income tax estimation.
- **Credit scoring:** Per-character credit score (300–850) initialized at 500, adjusted on loan approval/repayment/default.
- **Loans:** Personal, student, and business loan products with configurable interest rates, terms, origination fees, late-payment penalties, credit-score requirements, and employment checks.
- **Schema v4:** `PersistentWorldState` upgraded from schema 3 to schema 4 with five new economy maps. Older schemas auto-migrate.

`services/world-api/src/economy/` contains typed catalogue validation and server rules. `services/world-api/src/multiplayer/persistence.ts` validates/migrates schema version 4 and stores economy accounts, transactions, loans, credit scores, and events. The economy profile is included in the private `character.snapshot` — it is not part of public presence or world snapshots.

The Godot client path has not been engine-tested in this workspace. The economy catalogue and all rules are fictional and game-balanced — no real Nigerian bank, tax authority, employer, or financial-regulation data is referenced. See [`docs/ECONOMY_PLAN.md`](docs/ECONOMY_PLAN.md).

## Technology

- **Game client:** Godot 4.7.2 + GDScript. Offline play remains available; optional multiplayer uses Godot's `WebSocketPeer`.
- **World API/server:** Node.js 22.x + strict TypeScript, HTTP endpoints, and the `ws` WebSocket library.
- **Prototype persistence:** atomically replaced single-process online JSON state file (schema version 3), configurable with `DATA_FILE`, plus a separate versioned local Godot save. Online education, life and career records persist with character/world maps; Stage 4/5 offline education/life records remain local-save data, while Stage 6 career actions are online-only. Static catalogs remain repository data. No database is configured; PostgreSQL remains a future candidate only.
- **Canonical logical world:** `nigeria-main`; this is not a player-selectable shard.

See [`docs/TECH_STACK.md`](docs/TECH_STACK.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`docs/MULTIPLAYER_PLAN.md`](docs/MULTIPLAYER_PLAN.md).

## Requirements

- Node.js **22.13 or newer in the 22.x line** and npm for the API.
- Godot **4.7.2 stable** to import, run, or test the game; it is not bundled.
- Optional `gdtoolkit` for `gdformat`/`gdlint` checks. These static tools do not replace Godot engine validation.

## Run the server

From the repository root:

```sh
npm ci
cp .env.example .env   # optional; edit only the settings you need
npm run dev
```

The server listens on `0.0.0.0:3000` by default. Its default state file is `services/world-api/data/world-state.json` (ignored by Git). If you set `DATA_FILE` in the root `.env`, a relative path is resolved from `services/world-api/`; for example, `DATA_FILE=data/world-state.json`. `GAME_MINUTE_MS` optionally overrides the default 650 real milliseconds per in-game minute; it must be an integer from 1 to 60000 and affects the single shared online world clock.

HTTP endpoints:

- `GET /health` — process health.
- `GET /api/v1/world` — canonical world descriptor and bounded-prototype status.
- `GET /ws` — returns `426`; upgrade this path to a WebSocket connection for multiplayer.

Desktop Godot clients normally omit the browser `Origin` header. Browser WebSocket connections require an exact HTTP(S) origin in the comma-separated `ALLOWED_ORIGINS` setting; leaving it empty rejects browser-origin connections. For a production browser deployment, serve the game over HTTPS, use WSS, and proxy the same-origin `/ws` route to this server.

For a compiled start:

```sh
npm run build
npm run start
```

Protect the state file and client session config as personal data/credentials. The prototype does not provide TLS termination, a user account provider, backups, moderation, or production operations.

## Run the game

Open `game/project.godot` with Godot 4.7.2, or start the local/offline prototype from the repository root:

```sh
godot --path game
```

For desktop online play, run the server first. The default native URL is `ws://127.0.0.1:3000/ws`; override it when needed:

```sh
NAIJA_WS_URL=ws://127.0.0.1:3000/ws godot --path game
```

In the character-creation screen, select **Create online life**. The server creates an online character separate from the local Stage 1 save. Reuse that client identity by launching with the same session config and selecting **Continue online life**. Native clients on another host should use that server's reachable address. Do not expose the prototype over an untrusted network without a TLS-terminating proxy and additional security controls.

## Local two-client and reconnect test

1. Start the server with `npm run dev` in one terminal.
2. Start two Godot clients in separate terminals with different session-config paths (this avoids both windows sharing one identity). On macOS/Linux:

   ```sh
   NAIJA_MULTIPLAYER_SESSION_PATH=user://naija-client-a.cfg godot --path game
   NAIJA_MULTIPLAYER_SESSION_PATH=user://naija-client-b.cfg godot --path game
   ```

   In PowerShell, set the variable separately in each terminal before launching: `$env:NAIJA_MULTIPLAYER_SESSION_PATH = 'user://naija-client-a.cfg'` (use `naija-client-b.cfg` for the other client).
3. Create a different online character in each window. Move them around; use **Nearby chat** and move close enough to use **E** to wave.
4. Close one client and launch it again with the same session-config path. Choose **Continue online life**. The server should restore the same character from the same `DATA_FILE`.

These are manual client instructions, **not a claim that Godot's two-window flow was run in this workspace**. The automated Node integration suite independently opens two real WebSocket clients, checks coexistence, server movement, chat/wave, and persisted reconnect after API restart.

## Development checks

From the repository root:

```sh
npm run build  # compile TypeScript
npm run lint   # ESLint
npm test       # build and run Node HTTP/WebSocket, education, life, and geography tests
npm run check  # lint plus the complete test suite
node --test services/world-api/test/education.test.mjs  # focused Stage 4 education tests (build first)
node --test services/world-api/test/life.test.mjs       # focused Stage 5 life tests (build first)
node --test services/world-api/test/careers.test.mjs    # focused Stage 6 career tests (build first)
node --test services/world-api/test/economy.test.mjs    # focused Stage 7 economy tests (build first)
npm run geography:import  # regenerate the deterministic processed geography catalog
npm run geography:check   # verify that processed outputs match pinned source files
```

When Godot is installed, run its import smoke check and retained Stage 1 tests:

```sh
godot --headless --editor --path game --quit
godot --headless --path game --quit
godot --headless --path game --script res://tests/domain_smoke.gd
godot --headless --path game --script res://tests/player_movement.gd
```

The local-save persistence check requires two separate Godot processes, with the writer exiting before the reader starts:

```sh
godot --headless --path game --script res://tests/save_restart.gd -- write
godot --headless --path game --script res://tests/save_restart.gd -- read
```

If `gdtoolkit` is installed, run static GDScript checks:

```sh
gdformat --check $(find game -name '*.gd' -print)
gdlint $(find game -name '*.gd' -print)
```

The automated tests cover Stage 6 catalogue/eligibility, Stage 4 qualification and skill reuse, regulated-role registration, ordered applications/hiring/capacity, work schedules/sessions/performance, payroll idempotency, leave, promotion, authorized internal termination, resignation, Stage 5 retirement/death, NPC career fixtures, schema migration, authenticated multiplayer actions, and privacy boundaries. They also cover the Stage 5 calendar/DOB/age/birthday/offline catch-up, persistent families, relationships, marriage/child NPCs and history; Stage 4 education progression, exams, university/ND/HND/vocational/apprenticeship, scholarships and co-presence; plus retained HTTP, geographic multiplayer, movement/chat/interaction, importer/coordinate/chunk, payload/rate-limit, identity recovery, API restart, shared clock and WebSocket-origin regressions. They do not exercise Godot rendering/input, browser exports, offline client save/load, career/profile UI behavior, or the actual Godot reconnect flow.

## Repository layout

```text
game/                       Godot prototype, geography, education, life and career data/UI
services/world-api/         HTTP/WebSocket authority, geography, education/life/career domains, tests
tools/geography/            Deterministic bounded-feature extraction/import tools
docs/                       Vision, plans, architecture, status, and agent guidance
.github/workflows/          Node/TypeScript foundation checks
```

## Project documents

- [Game vision](docs/GAME_VISION.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development status](docs/DEVELOPMENT_STATUS.md)
- [Technology stack](docs/TECH_STACK.md)
- [Database plan](docs/DATABASE_PLAN.md)
- [Stage 4 education plan](docs/EDUCATION_PLAN.md)
- [Stage 5 life simulation plan](docs/LIFE_SIMULATION_PLAN.md)
- [Stage 6 careers and employment plan](docs/CAREERS_AND_EMPLOYMENT_PLAN.md)
- [Stage 7 economy plan](docs/ECONOMY_PLAN.md)
- [Stage 8 player businesses plan](docs/PLAYER_BUSINESSES_PLAN.md)
- [Stage 9 housing and property plan](docs/HOUSING_AND_PROPERTY_PLAN.md)
- [Stage 10 government system plan](docs/GOVERNMENT_SYSTEM_PLAN.md)
- [Stage 11 elections and politics plan](docs/ELECTIONS_AND_POLITICS_PLAN.md)
- [Stage 12 laws courts and justice plan](docs/LAWS_COURTS_AND_JUSTICE_PLAN.md)
- [Stage 13 police and security system plan](docs/POLICE_AND_SECURITY_SYSTEM_PLAN.md)
- [Stage 14 military system plan](docs/MILITARY_SYSTEM_PLAN.md)
- [Stage 15 crime and consequences plan](docs/CRIME_AND_CONSEQUENCES_PLAN.md)
- [Multiplayer plan](docs/MULTIPLAYER_PLAN.md)
- [World and time plan](docs/WORLD_PLAN.md)
- [Geographic data sources and licenses](docs/DATA_SOURCES.md)
- [Asset and licensing notes](docs/ASSETS.md)
- [Security plan](docs/SECURITY_PLAN.md)
- [Contributing](docs/CONTRIBUTING.md)
- [AI agent guide](docs/AI_AGENT_GUIDE.md)

## Scope boundary

Stage 3 provides a national administrative registry and one bounded Akure South map-data sample, not full national geography or simulation. Stages 4–15 implement fictional education, age/life, career/employment, economy, business, housing, government, elections, legal/justice, police/security, military, and crime/consequences foundations; backend checks pass, but Godot runtime/UI/save integration remains unverified until Godot 4.7.2 is available. Preserve one logical Nigeria and one shared online timeline; do not split the prototype into separately authoritative regional or player worlds. **Next roadmap stage: Stage 16 — Religion, Culture & Community.** Full national visual detail, account services, production database/operations, comprehensive anti-cheat/moderation, advanced NPC society, transport/weather simulation, and cross-platform client exports remain future work. Stage 7's canonical Naira ledger is the economic authority for any future property, mortgage, or financial simulation.
