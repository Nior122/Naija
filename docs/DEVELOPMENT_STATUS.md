# Development Status

> **Future agents: read this file before changing the project.** It distinguishes implementation from verification; source code and test files are not proof of engine/runtime behavior.

## Current stage and verification gate

**Stage 15 — Crime & Consequences: backend implementation and Node tests pass; crime integrates with Stage 6 (careers), Stage 7 (economy), Stage 10 (government), Stage 12 (justice), and Stage 13 (police); Godot client/runtime verification is blocked.** Stages 0–14 remain preserved on the same `nigeria-main` world. The server still owns one shared online timeline. The earlier Stage 5 Godot limitation is still open; Stages 6–15 do not resolve it.

Godot 4.7.2 is not installed (`godot: command not found`). Project import, engine type-checking, scenes, rendered careers UI, clicks through work/application flows, offline client journeys, and Godot multiplayer/reconnect/save runtime behavior have not been run. Do not infer client success from Node tests or gdtoolkit.

## Stages 0–5 preserved

- **Stage 0:** Node HTTP API (`/health`, `/api/v1/world`), strict TypeScript service, canonical world ID `nigeria-main`.
- **Stage 1:** Offline Godot Idera Quarter, character/household/home, movement/interactions, school/community actions, basic needs/money/inventory, local clock and separate local save. Godot runtime is unverified here.
- **Stage 2:** Optional WebSocket server, sessions, online character snapshots, presence/actions, shared clock and JSON persistence. Backend regressions pass; Godot runtime is unverified.
- **Stage 3:** Administrative geography catalog, bounded Akure South source/preview pipeline, opt-in and server-derived presence. The sample is not a complete map/boundary. `npm run geography:check` passes; rendering/client integration is unverified.
- **Stage 4:** Fictional/configurable JSS/SS education progression, attendance/results/exams, tertiary/ND/HND/training paths, scholarships, history and multiplayer persistence. Backend regressions pass; Godot education UI/save/gameplay remains unverified. See [`EDUCATION_PLAN.md`](EDUCATION_PLAN.md).
- **Stage 5:** Gregorian online clock, DOB-derived age/life status, persistent families/relationships/events, marriage/child NPCs, retirement/death and inheritance-reference foundations. Backend tests pass; Godot project import, profile UI, offline saves and lifecycle runtime remain unverified. See [`LIFE_SIMULATION_PLAN.md`](LIFE_SIMULATION_PLAN.md).

Existing local client saves remain separate from online server authority. Online state schema version 3 migrates supported schema versions 1 and 2 while preserving identity, character, education, geography, lifecycle and balance data; new career maps are initialized from repository catalogue fixtures. The JSON store remains single-process prototype persistence, not a database.

## Stage 6 implementation

### Catalogue, eligibility, and employment

- `game/data/careers/careers_catalog.json` configures 12 industry categories, 63 occupation definitions, schedules and progression rules, 12 fictional employer fixtures and 10 starting vacancy fixtures. Future-stage-only occupations are placeholders and are not recruited from.
- Eligibility uses Stage 5 DOB-derived age and life status plus Stage 4 qualification/skill history. Regulated roles require prototype registration IDs; the server-only registration helper is not a real licensing authority. Under-18 hour/type limits are catalogue-validated.
- The server processes bounded search and character-owned applications in deterministic due-date/score order, rechecks eligibility and capacity, and creates one active employment at most per character. Employer staffing and vacancy counts are persisted.
- Work sessions use the shared world clock, server-held location, configured schedule, unique employment/date ID, and server-calculated duration, performance, skill experience and gross amount. Performance reviews, unpaid leave, promotion, resignation, retirement and an internal employer-authorized termination service record persistent events.
- Death closes active employment, invalidates any in-progress shift, and blocks future work/payroll. The prototype does not add estate payments or inherit/transmit wages/assets.

### Payroll, authority, and data privacy

`SalaryAccountPort` is the integration seam for Stage 7. The current prototype adapter credits the existing `CharacterRecord.money`; it creates an idempotent payment record and links completed sessions to the payment ID in the same JSON snapshot. It is not a second economy, bank, tax service, or production ledger. Stage 7 must replace this adapter with an atomic canonical Naira ledger before wages become valuable state.

Player commands use `career.action` with the existing authenticated session and request-ID deduplication. Character identity, age, qualifications, licence state, work dates/location/duration, performance, salary and employment outcomes are server-derived. Private career profiles are returned only in the owning authenticated character snapshot/result; they are absent from public presence/world snapshots. Employer termination and professional registration remain internal because the prototype has no employer/credentialing identity or authorization workflow.

### Schema and client integration

`services/world-api/src/careers/` contains typed catalogue validation and server rules. `services/world-api/src/multiplayer/persistence.ts` validates/migrates schema version 3 and stores career employers, vacancies, applications, employments, work sessions, skills, licences, reviews, leave, events, salary payments and household-NPC career foundations. `services/world-api/src/multiplayer/world-engine.ts` integrates the actions, private profile, shared-clock processing, and Stage 5 retirement/death hooks.

`game/scripts/ui/career_panel.gd` provides vacancy search/application, current employment/work-session, unpaid leave, promotion/resignation/retirement, skills/history and balance displays. `prototype_ui.gd` and `prototype_game.gd` route requests and refresh the career profile/context. The panel uses server responses; offline mode has no fake jobs or successes. These client statements describe source code only; Godot import/runtime has not been verified.

See [`CAREERS_AND_EMPLOYMENT_PLAN.md`](CAREERS_AND_EMPLOYMENT_PLAN.md) for full catalogue, contract, payroll, NPC, persistence and scope details.

## Stage 7 implementation

### Canonical Naira ledger and banking

- `game/data/economy/catalog.json` configures six progressive PAYE tax bands, three bank products (savings/current/fixed-deposit), three loan products (personal/student/business), and 12 market goods across food, health, transport, utilities, and clothing categories.
- The `economyAccountPort` replaces the Stage 6 `prototypeSalaryAccountPort` as the career-to-economy integration seam. Salary credits from payroll flow into the character's cash-ledger account with idempotent deduplication.
- Bank accounts support deposits, withdrawals, inter-account transfers, interest accrual, monthly fees, and daily withdrawal limits. Each transaction is an atomic ledger entry with before/after balances and idempotency keys.
- Market goods purchases deduct from the cash account, restore hunger for food items, and record transactions against the good's location availability.

### Credit, loans, and tax estimation

- Per-character credit scores (300–850 range) are initialized at 500 and adjusted on loan approval, repayment, and default events.
- Loan requests validate credit score, employment status (for personal/business loans), active-loan limits, and term constraints. Origination fees are deducted at disbursement.
- Progressive PAYE income tax estimation uses configurable bands but does not auto-deduct — it is display-only.

### Schema and client integration

`services/world-api/src/economy/` contains typed catalogue validation, the economy service, and the canonical ledger. `services/world-api/src/multiplayer/persistence.ts` validates/migrates schema version 4 and stores economy accounts, transactions, loans, credit scores, and events. `services/world-api/src/multiplayer/world-engine.ts` integrates `economy.action` commands, the economy profile in private character snapshots, and the shared-clock economy processing (interest, fees, loan payments).

The Godot client path has not been engine-tested in this workspace. See [`docs/ECONOMY_PLAN.md`](ECONOMY_PLAN.md) for full catalogue, contract, persistence, and scope details.

## Stage 8 implementation

### Business catalogue and creation

- `game/data/businesses/catalog.json` configures 10 categories, 13 active business templates across retail, food, tech, trades, agriculture, transport, creative, professional, and manufacturing, 22 business products, and 5 production recipes.
- Business creation validates character age (18+), template eligibility, location compatibility, and available funds. Setup costs are deducted from the owner's personal cash account; initial capital is contributed to the business ledger through an atomic transaction.
- Ownership is recorded with role-based permissions (owner, co-owner, manager, accountant, inventory-manager, employee). All sensitive actions require server-side authorization.

### Products, inventory, sales, and production

- Businesses add catalogue products with custom pricing within configured markup bounds. Both product-based (inventory) and service-based sales are supported.
- Persistent stock records support restocking, sale deductions, production outputs/inputs, and movement history. No negative stock, no free stock, no client-side creation.
- Configurable recipe system consumes input inventory, charges operating costs, and produces output inventory. Atomic production runs with idempotent deduplication.

### Finance and operating costs

- Business financial accounts are separate from the owner's personal wallet. Capital contributions, owner withdrawals, sales revenue, operating expenses, rent, salary, and production costs are all recorded in the business ledger.
- Daily operating and premises costs are charged on world-date rollover through `processBusinessWorldDate`. Insufficient funds lead to business insolvency status.

### Schema and client integration

`services/world-api/src/businesses/` contains typed catalogue validation and server rules. `services/world-api/src/multiplayer/persistence.ts` validates/migrates schema version 5 and stores business records, ownership, products, inventory, transactions, sales, production runs, and events. `services/world-api/src/multiplayer/world-engine.ts` integrates `business.action` commands and business profiles in private character snapshots.

The Godot client path has not been engine-tested in this workspace. See [`docs/PLAYER_BUSINESSES_PLAN.md`](PLAYER_BUSINESSES_PLAN.md) for full catalogue, contract, persistence, and scope details.

## Stage 9 implementation

### Property catalogue and locations

- `game/data/properties/catalog.json` configures 4 categories (residential, commercial, land, public), 19 property types, 10 locations across Nigerian cities, 10 seed properties with NPC owners, and 10 furniture items.
- Property creation validates character age (18+), listing availability, affordability, and ownership limits. Atomic purchase flow with funds deduction and ownership transfer.
- Public/government properties cannot be purchased by players.

### Ownership, listings, and marketplace

- Property ownership types: player, NPC, business, government, community, joint. Server-side authorization on every sensitive action.
- Configurable marketplace with filtering by location, category, listing type, price range, bedrooms, and condition.
- Owners can list properties for sale or rent. Rental agreements include deposits and payment periods.

### Rental system

- Atomic rental agreement creation with rent + deposit deducted from tenant, credited to landlord.
- Rent payment processing through Stage 7 economy. Idempotent against duplicate requests.
- Rental termination by tenant or landlord, with automatic re-listing.

### Maintenance, furnishing, and development

- Property condition system (excellent, good, fair, poor, requires_repair) with maintenance records.
- Furniture purchasing and placement with quantity tracking and per-property limits.
- Foundation for land development (undeveloped, reserved, under_construction, developed status).

### Schema and client integration

`services/world-api/src/properties/` contains typed catalogue validation and server rules. `services/world-api/src/multiplayer/persistence.ts` validates/migrates schema version 6 and stores property records, ownership, listings, rental agreements, payments, sales, maintenance, furnishings, and events. `services/world-api/src/multiplayer/world-engine.ts` integrates `property.action` commands and property/rental profiles in private character snapshots.

The Godot client path has not been engine-tested in this workspace. See [`docs/HOUSING_AND_PROPERTY_PLAN.md`](HOUSING_AND_PROPERTY_PLAN.md) for full catalogue, contract, persistence, and scope details.

## Stage 10 implementation

### Government structure and offices

- `game/data/government/catalog.json` configures 3 government levels (federal, state, local), 15 federal ministries, 10 office types, 14 project categories, 12 budget categories, 7 revenue categories, and 8 expenditure categories.
- Federal Government of Nigeria is seeded on initialization with ministries, offices, and an initial approved budget.
- Government offices enforce unique occupancy — only one active occupant per unique office at a time.

### Appointments, budgets, and finance

- Appointments validate character age (18+), life status, unique-office occupancy, and per-character appointment limits. Historical appointments preserved after removal.
- Budgets created with fiscal year, category, and approved amount. Spending validated against budget availability — overspending rejected.
- Revenue and expenditure recorded with categories, amounts, and references. Idempotent against duplicate requests.

### Projects and announcements

- Government projects follow a validated lifecycle (proposed → under_review → approved → funded → in_progress → completed, with suspended/cancelled paths).
- Projects are location-linked via Stage 3 geography. Project funding updates status from approved to funded.
- Published announcements with scope level and jurisdiction. Searchable by organisation, location, category, status.

### Schema and client integration

`services/world-api/src/government/` contains typed catalogue validation and server rules. `services/world-api/src/multiplayer/persistence.ts` validates/migrates schema version 7 and stores government organisations, offices, appointments, budgets, revenue, expenditure, projects, announcements, and events. `services/world-api/src/multiplayer/world-engine.ts` integrates `government.action` commands and appointment profiles in private character snapshots.

The Godot client path has not been engine-tested in this workspace. See [`docs/GOVERNMENT_SYSTEM_PLAN.md`](GOVERNMENT_SYSTEM_PLAN.md) for full catalogue, contract, persistence, and scope details.

## Stage 11 implementation

### Political parties and membership

- `game/data/elections/catalog.json` configures 6 election types, 10 election phases, eligibility rules per office, voter eligibility (18+), party rules (founder age 21+, member age 18+), campaign rules, and dispute rules.
- Political parties support creation, registration, joining, leaving, leadership assignment, and status management (proposed, pending_registration, active, suspended, dissolved).
- One active party membership per character enforced on the server.
- Political profiles track party affiliation, public statement, and public service history.

### Elections and voting

- Elections follow a validated lifecycle: scheduling → candidate_registration → screening → campaign → voting → counting → certification → completed (with dispute and cancellation paths).
- Candidate registration validates minimum age per office type (40 presidential, 35 governorship/senatorial, 30 house/assembly/local), party affiliation requirements, and duplicate candidacy prevention.
- Voter eligibility checks age (18+), life status, and geographic jurisdiction on the server.
- Ballot casting prevents duplicate voting through voter participation records.
- Vote counting is deterministic from persisted ballots. Configurable winning rules.
- Results progress through preliminary → certified → published. Certification prevents duplicate finalization.

### Government integration

- Certified election results transfer the winner to the corresponding Stage 10 government office.
- Previous officeholders' appointments are preserved in history.
- Election source is recorded with the appointment.

### Schema and client integration

`services/world-api/src/elections/` contains typed catalogue validation and server rules. `services/world-api/src/multiplayer/persistence.ts` validates/migrates schema version 8 and stores party, election, candidate, campaign, ballot, dispute, and audit records. `services/world-api/src/multiplayer/world-engine.ts` integrates `election.action` commands with 28 actions and political profiles in character snapshots.

The Godot client path has not been engine-tested in this workspace. See [`docs/ELECTIONS_AND_POLITICS_PLAN.md`](ELECTIONS_AND_POLITICS_PLAN.md) for full catalogue, contract, persistence, and scope details.

## Stage 12 implementation

### Legal framework and courts

- `game/data/justice/catalog.json` configures 14 law categories, 8 court levels, 11 case categories, 7 legal professional roles, 11 law statuses, 16 case statuses, 8 judgment outcomes, 6 sentence types, 5 appeal outcomes, and 5 seed laws with provisions.
- 7 seed courts (Supreme Court, Court of Appeal, Federal High Court, National Industrial Court, FCT Magistrate Court, FCT High Court, FCT Customary Court) with jurisdiction-based case assignment.
- Laws are versioned, with amendment tracking and status lifecycle management.
- Legislative proposals flow through draft → submitted → approved/rejected, with approved proposals creating new laws automatically.

### Case management and judicial workflow

- Civil and criminal cases with validated status transitions (draft → submitted → accepted → ... → judgment_issued → eligible_for_appeal → closed).
- Court jurisdiction validation — cases must be filed in a court that handles the case category.
- Evidence submission and admissibility management with version preservation.
- Hearing scheduling by assigned judges.
- Judicial decisions with outcomes, reasoning, remedies, and appeal eligibility.
- Appeals with appellate court validation (Court of Appeal or Supreme Court).

### Fines and economy integration

- Fine creation with idempotency (linked to case, judgment, sentence, and character).
- Payment tracking with partial/full payment, duplicate transaction prevention.
- Integration with Stage 7 economy transaction references.

### Schema and client integration

`services/world-api/src/justice/` contains typed catalogue validation and server rules. `services/world-api/src/multiplayer/persistence.ts` validates/migrates schema version 9 and stores all justice records. `services/world-api/src/multiplayer/world-engine.ts` integrates `justice.action` commands with 16 actions and legal profiles in character snapshots.

The Godot client path has not been engine-tested in this workspace. See [`docs/LAWS_COURTS_AND_JUSTICE_PLAN.md`](LAWS_COURTS_AND_JUSTICE_PLAN.md) for full catalogue, contract, persistence, and scope details.

## Stage 12 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue bounds, law categories, court levels, case categories | `services/world-api/test/justice.test.mjs` | **Passed (Node)** |
| Seed laws, provisions, and courts | Justice service tests | **Passed (Node)** |
| Law creation and status transitions | Justice service tests | **Passed (Node)** |
| Law amendment with version tracking | Justice service tests | **Passed (Node)** |
| Law search and filtering | Justice service tests | **Passed (Node)** |
| Legislative proposal lifecycle | Justice service tests | **Passed (Node)** |
| Court listing and details | Justice service tests | **Passed (Node)** |
| Case filing and jurisdiction validation | Justice service tests | **Passed (Node)** |
| Case status transitions | Justice service tests | **Passed (Node)** |
| Evidence submission | Justice service tests | **Passed (Node)** |
| Judgment issuance | Justice service tests | **Passed (Node)** |
| Fine creation, payment, and idempotency | Justice service tests | **Passed (Node)** |
| Appeal filing and decision | Justice service tests | **Passed (Node)** |
| WebSocket search_laws, list_courts | WebSocket test | **Passed (Node)** |
| WebSocket legal_profile, my_cases | WebSocket test | **Passed (Node)** |
| Schema-v8 to v9 migration preserving all records | Persistence test | **Passed (Node)** |
| Godot project import, engine typing, client justice UI | Godot unavailable | **Blocked / not run** |

## Stage 13 implementation

### Police organizations and stations

- `game/data/police/catalog.json` configures 4 police levels, 10 ranks (Constable through Commissioner), 14 incident categories, 4 dispatch priorities, 9 misconduct categories, 8 training modules, 9 complaint outcomes, and 4 seed stations.
- Police organizational hierarchy: national → state → division → station.
- Seed stations created automatically on world initialization (idempotent).

### Recruitment and officer management

- Recruitment eligibility enforced server-side: minimum age 18, minimum education secondary.
- Application lifecycle: submitted → under_review → accepted/rejected → training → completed.
- Officer enrollment with badge number generation.
- Rank promotion requiring strictly higher rank level.

### Incident reporting and dispatch

- Incident reports with reference numbers (NPF-{CAT}-{YEAR}-{SEQ}).
- Duplicate detection within configurable time window.
- Triage: accept (assign to station) or reject with reason.
- Dispatch workflow: awaiting_dispatch → acknowledged → en_route → at_location → resolved.

### Investigations and evidence

- Investigation opening linked to incidents, with max active investigations per officer (20).
- Timeline tracking for all investigation actions.
- Evidence collection with chain-of-custody tracking.
- Evidence integrity status: unverified → verified → challenged → rejected.

### Wanted records and arrests

- Wanted records require reason and legal basis (not mere accusations).
- Authorization by higher-ranking officer required before activation.
- Arrests linked to incidents, investigations, and wanted records.
- Arrest processing: release or referral to justice system.

### Misconduct accountability

- Complaints filed against officers with 9 misconduct categories.
- Resolution outcomes: no_finding through legal_referral (9 options).
- Officer status changes: suspension or dismissal on complaint resolution.

### Schema and integration

Schema version advanced to 10 with 11 new persistent maps. `services/world-api/src/police/` contains typed catalogue, service, and exports. `services/world-api/src/multiplayer/world-engine.ts` integrates `police.action` commands with 18 actions and police profiles in character snapshots.

See [`docs/POLICE_AND_SECURITY_SYSTEM_PLAN.md`](POLICE_AND_SECURITY_SYSTEM_PLAN.md) for full details.

## Stage 13 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue structure, ranks, categories | `services/world-api/test/police.test.mjs` | **Passed (Node)** |
| Empty maps and initialization | Police service tests | **Passed (Node)** |
| Station seeding and idempotency | Police service tests | **Passed (Node)** |
| Recruitment eligibility (age, education) | Police service tests | **Passed (Node)** |
| Officer enrollment and badge generation | Police service tests | **Passed (Node)** |
| Rank promotion validation | Police service tests | **Passed (Node)** |
| Incident reporting and reference numbers | Police service tests | **Passed (Node)** |
| Incident triage (accept/reject) | Police service tests | **Passed (Node)** |
| Investigation lifecycle | Police service tests | **Passed (Node)** |
| Evidence chain-of-custody | Police service tests | **Passed (Node)** |
| Wanted record authorization hierarchy | Police service tests | **Passed (Node)** |
| Arrest with/without wanted records | Police service tests | **Passed (Node)** |
| Misconduct complaints and resolution | Police service tests | **Passed (Node)** |
| Police profile snapshots | Police service tests | **Passed (Node)** |
| Audit trail creation | Police service tests | **Passed (Node)** |
| WebSocket list_stations, submit_incident | WebSocket test | **Passed (Node)** |
| WebSocket police_profile, error handling | WebSocket test | **Passed (Node)** |
| Schema-v9 to v10 migration with police maps | Persistence test | **Passed (Node)** |
| Godot project import, engine typing, client police UI | Godot unavailable | **Blocked / not run** |

## Stage 14 implementation

### Military organizations and bases

- `game/data/military/catalog.json` configures 3 service branches (Army, Navy, Air Force), 16 ranks per branch, 8 base categories, 14 unit categories, 18 training courses, 10 assignment types, 10 equipment categories, 8 national security event categories, 9 disciplinary outcomes, 7 seed organizations, and 4 seed bases.
- Organizational hierarchy: Defence HQ → Service HQs → Commands → Units.
- Cycle detection prevents invalid parent-child relationships.

### Recruitment and service

- Recruitment eligibility enforced server-side: minimum age 18, minimum education secondary.
- Application lifecycle: submitted → under_review → approved/rejected.
- Service enrollment with unique service numbers (NA/NN/NAF prefix).
- Double enlistment prevention.

### Training and ranks

- 18 configurable training courses with prerequisites.
- Promotion requires minimum time in rank (180-1095 days depending on category).
- Full rank history preserved.
- Command appointments separate from rank.

### Assignments, leave, and assets

- Configurable assignment types with max 2 active per person.
- Leave request/approval workflow.
- Equipment asset management with custody chain tracking.

### National security events and discipline

- 8 national security event categories with authorization and resolution workflow.
- Disciplinary cases with 9 outcome types.
- Disciplinary outcomes automatically affect service status.
- Legal referral bridge to justice system.

### Schema and integration

Schema version advanced to 11 with 14 new persistent maps. `services/world-api/src/military/` contains typed catalogue, service, and exports. `services/world-api/src/multiplayer/world-engine.ts` integrates `military.action` commands with 24 actions and military profiles in character snapshots.

See [`docs/MILITARY_SYSTEM_PLAN.md`](MILITARY_SYSTEM_PLAN.md) for full details.

## Stage 14 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue structure, branches, ranks, categories | `services/world-api/test/military.test.mjs` | **Passed (Node)** |
| Empty maps and initialization | Military service tests | **Passed (Node)** |
| Organization seeding and idempotency | Military service tests | **Passed (Node)** |
| Base creation and snapshots | Military service tests | **Passed (Node)** |
| Unit creation | Military service tests | **Passed (Node)** |
| Recruitment eligibility (age, education) | Military service tests | **Passed (Node)** |
| Service enrollment and service numbers | Military service tests | **Passed (Node)** |
| Double enlistment prevention | Military service tests | **Passed (Node)** |
| Training enrollment and completion | Military service tests | **Passed (Node)** |
| Promotion with time-in-rank | Military service tests | **Passed (Node)** |
| Assignments and completion | Military service tests | **Passed (Node)** |
| Asset management and custody chain | Military service tests | **Passed (Node)** |
| National security events | Military service tests | **Passed (Node)** |
| Disciplinary cases and outcomes | Military service tests | **Passed (Node)** |
| Military profile snapshots | Military service tests | **Passed (Node)** |
| WebSocket list_branches, military_profile | WebSocket test | **Passed (Node)** |
| WebSocket error handling | WebSocket test | **Passed (Node)** |
| Schema-v10 to v11 migration with military maps | Persistence test | **Passed (Node)** |
| Godot project import, engine typing, client military UI | Godot unavailable | **Blocked / not run** |

## Stage 15 implementation

- `game/data/crime/catalog.json` configures 14 crime categories, 4 severity levels, 12 crime definitions, 7 incident statuses, valid transitions, anti-exploit rules, and consequence rules.
- Crime definitions reference police incident categories and justice case categories for integration without duplication.
- Crime action resolution is server-authoritative with seeded detection rolls, evidence generation, and notoriety tracking.
- Incident lifecycle: created → reported → under_review → investigation_open → referred_to_court → resolved → closed.
- Criminal records are distinct from allegations; convictions require justice system outcomes.
- Financial consequences via restitution records integrate with economy system transactions.
- Rehabilitation programs allow reputation recovery over time.
- Anti-exploit: age checks (15+), victim targeting cooldown (48h), daily limits, offline protection, new-player protection.
- Integration: links to police incidents/investigations, justice cases, economy ledger.

Schema version advanced to 12 with 9 new persistent maps. `services/world-api/src/crime/` contains typed catalogue, service, and exports. `services/world-api/src/multiplayer/world-engine.ts` integrates `crime.action` commands with 17 actions and criminal profiles in character snapshots.

## Stage 15 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue structure, categories, severities, definitions | `services/world-api/test/crime.test.mjs` | **Passed (Node)** |
| Crime action resolution with detection | Crime service tests | **Passed (Node)** |
| Age enforcement | Crime service tests | **Passed (Node)** |
| Victim cooldown enforcement | Crime service tests | **Passed (Node)** |
| Incident lifecycle transitions | Crime service tests | **Passed (Node)** |
| Evidence management | Crime service tests | **Passed (Node)** |
| Police/Justice integration links | Crime service tests | **Passed (Node)** |
| Criminal records with expiry | Crime service tests | **Passed (Node)** |
| Restitution creation and payment | Crime service tests | **Passed (Node)** |
| Rehabilitation start and completion | Crime service tests | **Passed (Node)** |
| Notoriety tracking and decay | Crime service tests | **Passed (Node)** |
| Criminal profile queries | Crime service tests | **Passed (Node)** |
| Error messages | Crime service tests | **Passed (Node)** |
| Schema-v11 to v12 migration with crime maps | Persistence test | **Passed (Node)** |
| WebSocket crime actions | WebSocket test | **Passed (Node)** |
| Godot project import, engine typing, client crime UI | Godot unavailable | **Blocked / not run** |

## Stage 11 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue bounds, election types, eligibility, party rules | `services/world-api/test/elections.test.mjs` | **Passed (Node)** |
| Party creation, registration, membership, leadership | Election service tests | **Passed (Node)** |
| Election creation and schedule validation | Election service tests | **Passed (Node)** |
| Phase transitions | Election service tests | **Passed (Node)** |
| Candidate registration and age eligibility | Election service tests | **Passed (Node)** |
| Candidate approval, rejection, withdrawal | Election service tests | **Passed (Node)** |
| Voter eligibility (age, phase, geography) | Election service tests | **Passed (Node)** |
| Ballot casting and duplicate prevention | Election service tests | **Passed (Node)** |
| Vote counting and winner determination | Election service tests | **Passed (Node)** |
| Result certification and publication | Election service tests | **Passed (Node)** |
| Government office transfer after election | Election service tests | **Passed (Node)** |
| Dispute submission | Election service tests | **Passed (Node)** |
| WebSocket list_parties, list_elections, political_profile | WebSocket test | **Passed (Node)** |
| WebSocket my_history | WebSocket test | **Passed (Node)** |
| Schema-v7 to v8 migration preserving all records | Persistence test | **Passed (Node)** |
| Godot project import, engine typing, client election UI | Godot unavailable | **Blocked / not run** |

## Stage 10 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue bounds, levels, ministries, offices, categories | `services/world-api/test/government.test.mjs` | **Passed (Node)** |
| Government seeding with federal structure, ministries, offices, budget | Government service tests | **Passed (Node)** |
| Appointment with age eligibility and unique-office enforcement | Government service tests | **Passed (Node)** |
| Appointment rejection for underage, duplicate unique-office | Government service tests | **Passed (Node)** |
| Removal with history preservation | Government service tests | **Passed (Node)** |
| Budget creation with category and amount validation | Government service tests | **Passed (Node)** |
| Revenue and expenditure recording | Government service tests | **Passed (Node)** |
| Expenditure rejection for overspending | Government service tests | **Passed (Node)** |
| Project creation and status transition validation | Government service tests | **Passed (Node)** |
| Project funding updates status | Government service tests | **Passed (Node)** |
| Announcement publishing | Government service tests | **Passed (Node)** |
| Federal government snapshot | Government service tests | **Passed (Node)** |
| Project search with filters | Government service tests | **Passed (Node)** |
| Announcement browsing | Government service tests | **Passed (Node)** |
| Character appointment history | Government service tests | **Passed (Node)** |
| Error messages for standard codes | Government service tests | **Passed (Node)** |
| WebSocket view_federal and announcements | WebSocket test | **Passed (Node)** |
| Government appointments in character snapshots | WebSocket snapshot test | **Passed (Node)** |
| Schema-v6 to v7 migration preserving all records | Persistence test | **Passed (Node)** |
| Godot project import, engine typing, client government UI | Godot unavailable | **Blocked / not run** |

## Stage 9 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue bounds, categories, types, locations, seed data | `services/world-api/test/properties.test.mjs` | **Passed (Node)** |
| Property seeding with NPC ownership and listings | Property service tests | **Passed (Node)** |
| Market search with location/category/type/price/bedroom filters | Property service tests | **Passed (Node)** |
| Property purchase with atomic ownership transfer | Property service tests | **Passed (Node)** |
| Purchase rejection for insufficient funds, underage, unavailable | Property service tests | **Passed (Node)** |
| Listing creation for sale and rent | Property service tests | **Passed (Node)** |
| Unauthorized listing rejection | Property service tests | **Passed (Node)** |
| Rental agreement creation with deposit | Property service tests | **Passed (Node)** |
| Rental rejection for unavailable, insufficient funds | Property service tests | **Passed (Node)** |
| Rental termination and re-listing | Property service tests | **Passed (Node)** |
| Maintenance with condition update and cost deduction | Property service tests | **Passed (Node)** |
| Furniture purchase and placement | Property service tests | **Passed (Node)** |
| Ownership transfer | Property service tests | **Passed (Node)** |
| Property profile building | Property service tests | **Passed (Node)** |
| Character property and rental retrieval | Property service tests | **Passed (Node)** |
| Error messages for standard codes | Property service tests | **Passed (Node)** |
| WebSocket market and view actions | WebSocket test | **Passed (Node)** |
| Property profiles in character snapshots | WebSocket snapshot test | **Passed (Node)** |
| Schema-v5 to v6 migration preserving all records | Persistence test | **Passed (Node)** |
| Godot project import, engine typing, client property UI | Godot unavailable | **Blocked / not run** |

## Stage 8 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue bounds, categories, templates, products, recipes | `services/world-api/test/businesses.test.mjs` | **Passed (Node)** |
| Business creation eligibility, setup cost, ownership | Business service tests | **Passed (Node)** |
| Creation rejection for age, funds, template, location | Business service tests | **Passed (Node)** |
| Products, restocking, sales, insufficient stock rejection | Business service tests | **Passed (Node)** |
| Service-based sales without inventory | Business service tests | **Passed (Node)** |
| Capital contributions and owner withdrawals | Business service tests | **Passed (Node)** |
| Expense recording and deduction | Business service tests | **Passed (Node)** |
| Production consuming inputs and creating outputs | Business service tests | **Passed (Node)** |
| Business closure preserving history | Business service tests | **Passed (Node)** |
| Unauthorized access rejection | Business service tests | **Passed (Node)** |
| Business discovery by location | Business service tests | **Passed (Node)** |
| Daily operating costs and insolvency detection | Business service tests | **Passed (Node)** |
| WebSocket discover and business actions | Two-client WebSocket test | **Passed (Node)** |
| Age eligibility enforcement through WebSocket | WebSocket test | **Passed (Node)** |
| Business profiles in character snapshots | WebSocket snapshot test | **Passed (Node)** |
| Schema-v4 to v5 migration preserving all records | Persistence test | **Passed (Node)** |
| Godot project import, engine typing, client business UI | Godot unavailable | **Blocked / not run** |

## Stage 7 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue bounds, tax bands, bank/loan products, market goods | `services/world-api/test/economy.test.mjs` | **Passed (Node)** |
| Cash account initialization from character money | Economy service tests | **Passed (Node)** |
| Bank account opening, deposits, withdrawals, transfers | Economy service tests | **Passed (Node)** |
| Market purchase, hunger restoration, location filtering | Economy service tests | **Passed (Node)** |
| Loan request, repayment, credit-score adjustments | Economy service tests | **Passed (Node)** |
| Loan rejection for low credit score or no employment | Economy service tests | **Passed (Node)** |
| Interest accrual, monthly fees, loan default processing | Economy service tests | **Passed (Node)** |
| economyAccountPort salary credit with idempotency | Economy service tests | **Passed (Node)** |
| Income tax estimation across progressive bands | Economy service tests | **Passed (Node)** |
| Schema-v3 to v4 migration preserving career/lifecycle records | Persistence test | **Passed (Node)** |
| WebSocket economy commands (profile, purchase) | Two-client WebSocket test | **Passed (Node)** |
| Private economy profile in character snapshot | WebSocket snapshot test | **Passed (Node)** |
| Godot project import, engine typing, client economy UI | Godot unavailable | **Blocked / not run** |

## Stage 6 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Catalogue bounds, employer/vacancy data, schedules and salary constraints | `services/world-api/test/careers.test.mjs` | **Passed (Node)** |
| Stage 4 qualifications/skills, Stage 5 age, regulated-role registration and under-18 limits | Career eligibility tests | **Passed (Node)** |
| Application review ordering, capacity, duplicate/concurrent employment and owner identity | Career service and WebSocket tests | **Passed (Node)** |
| Work schedule/location, session records, performance/skills and payroll idempotency | Career service tests | **Passed (Node)** |
| Leave, promotion, resignation, employer-authorized internal termination, retirement and death | Career/life tests | **Passed (Node)** |
| Schema-v2 to v3 migration preserving family/NPC records | Persistence test | **Passed (Node)** |
| Private career profile versus public presence/world snapshots | Two-client WebSocket test | **Passed (Node)** |
| Godot project import, engine typing, client panel actions/rendering and Godot reconnect/save | Godot unavailable | **Blocked / not run** |

## Checks run (2026-10-09)

| Check | Result |
|---|---|
| `npm run check` | **Passed** — ESLint, TypeScript build and 64 Node tests, 0 failures. Includes 16 Stage 7 economy tests, 11 Stage 6 career tests, and retained Stage 1–5/backend/geography regressions. |
| `npm run geography:check` | **Passed** — 3 processed geography files match pinned sources. |
| `./.venv/bin/gdformat --check $(find game -name '*.gd' -print)` (gdtoolkit 4.5.0) | **Passed** — all 21 GDScript files parse and would be left unchanged by gdformat. This is not a Godot engine check. |
| `./.venv/bin/gdlint $(find game -name '*.gd' -print)` | **Not clean** — 7 structural findings in existing Stage 1–5 files, listed below; `career_panel.gd` has no gdtoolkit lint findings. |
| `godot --version` / project import/tests | **Blocked** — executable is unavailable. |
| Database/runtime operations | No production DB; one-process JSON state file remains limited to 16 MiB. |

The seven existing `gdlint` findings are:

- `max-public-methods`: `game/scripts/domain/character_state.gd` and `game/scripts/ui/prototype_ui.gd`.
- `max-file-lines`: `game/scripts/domain/education_service.gd`, `game/scripts/domain/life_simulation_service.gd`, `game/scripts/prototype_game.gd`, and `game/scripts/ui/prototype_ui.gd`.
- `max-returns`: `game/scripts/prototype_game.gd` function `_on_education_action_requested`.

No Godot engine check or in-game regression is claimed. gdtoolkit parsing/formatting cannot establish GDScript static typing, scene resource validity, input/rendering, UI behavior, or client persistence correctness.

## Reproduction commands

From repository root:

```sh
npm ci
npm run check
npm run geography:check
node --test services/world-api/test/careers.test.mjs  # after build, focused Stage 6 suite
node --test services/world-api/test/economy.test.mjs  # after build, focused Stage 7 suite
node --test services/world-api/test/life.test.mjs     # after build, focused Stage 5 suite
# If gdtoolkit is installed:
gdformat --check $(find game -name '*.gd' -print)
gdlint $(find game -name '*.gd' -print)
```

When Godot 4.7.2 is available, run the import check and retained client tests in [`README.md`](../README.md), including `domain_smoke.gd`, `player_movement.gd`, and both separate-process `save_restart.gd` phases. Verify the Stage 1–5 journeys and then careers character creation/search/application, hiring, travel/work shifts, balance/payroll, promotion, leave, resignation/retirement, career profile privacy and client reconnect. Record exact engine version/output before marking client behavior verified.

## Known limits and next gates

1. The online world clock runs while the API process runs; it pauses during API downtime. Server-downtime catch-up is not implemented.
2. Offline Godot mode keeps its existing local save/clock and does not synchronize to online server time or accrue elapsed time while closed.
3. The current online JSON store is single-process, atomically replaced and limited to 16 MiB; it has no database transaction isolation, multi-writer coordination, backups, or production recovery.
4. Career employers, salaries, leave, licences, and eligibility rules are fictional configurable fixtures, not official Nigerian economic/legal data. No real employer identity, role authorization, job marketplace, professional credentialing, or labor-law system is implemented.
5. Stage 7 replaces the Stage 6 prototype salary adapter with the canonical Naira ledger. Tax estimation is display-only; no automatic tax deduction, inter-player transfers, businesses, property, or estate wage settlement are implemented.
6. Godot 4.7.2 client/runtime verification for Stages 1–12 remains blocked. Node tests and gdformat do not substitute for engine/runtime checks.
7. Preserve Stage 5 life status and age as the sole authority for death and retirement; do not enable work or future wages for deceased characters.
8. **Next planned stage: Stage 10 — Government System.** Keep it inside the same world and use Stage 9 for government property and public facilities.
