# Development Status

> **Future agents: read this file before changing the project.** It distinguishes implementation from verification; source code and test files are not proof of engine/runtime behavior.

## Current stage and verification gate

**Stage 6 — Careers & Employment: backend implementation and Node tests pass; the careers UI is source-integrated and gdtoolkit-parsed/formatted; Godot client/runtime verification is blocked.** Stages 0–5 remain preserved on the same `nigeria-main` world. The server still owns one shared online timeline. The earlier Stage 5 Godot limitation is still open; Stage 6 does not resolve it.

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
| `npm run check` | **Passed** — ESLint, TypeScript build and 48 Node tests, 0 failures. Includes 11 Stage 6 career tests and retained Stage 1–5/backend/geography regressions. |
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
5. Stage 6 pay credits the existing balance through a prototype idempotent adapter. Stage 7 must replace it with the canonical ledger; no taxes, banks, transfers, businesses or estate wage settlement are implemented.
6. Godot 4.7.2 client/runtime verification for Stages 1–6 remains blocked. Node tests and gdformat do not substitute for engine/runtime checks.
7. Preserve Stage 5 life status and age as the sole authority for death and retirement; do not enable work or future wages for deceased characters.
8. **Next planned stage: Stage 7 — Full Nigerian Economy.** Keep it inside the same world and connect to the existing salary adapter seam rather than introducing a duplicate economy.
