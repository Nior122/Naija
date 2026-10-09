# Development Status

> **Future agents: read this file before changing the project.** It distinguishes implementation from verification; source code and test files are not proof of engine/runtime behavior.

## Current stage and gate

**Stage 5 — Age & Life Simulation: backend implementation and tests present; GDScript formatting/parser checks pass; Godot client/runtime verification is blocked.** Stages 0–4 remain in the repository and were extended, not replaced. Stage 5 uses the same canonical `nigeria-main` world and one shared authoritative online clock.

Godot 4.7.2 is not installed (`godot: command not found`). Project import, engine type-checking, scenes, local play/profile UI, save/restart runtime, and Godot multiplayer/client paths have not been run. Do not infer client success from Node or gdtoolkit tests.

The next planned roadmap stage is **Stage 6 — Careers & Employment**, but Stage 6 has not started. The remaining Stage 5 client-runtime tests are a known limitation; do not claim those checks passed or add Stage 6 implementation as part of this work.

## Stages 0–4 preserved

- **Stage 0:** Node HTTP API (`/health`, `/api/v1/world`), strict TypeScript service, canonical world ID `nigeria-main`.
- **Stage 1:** Offline Godot Idera Quarter, character/household/home, movement/interactions, school/community actions, basic needs/money/inventory, local clock and separate local save. Godot runtime is unverified here.
- **Stage 2:** Optional WebSocket server, sessions, online character snapshots, presence/actions, shared clock and JSON persistence. Backend regressions pass; Godot runtime is unverified.
- **Stage 3:** Administrative geography catalog, bounded Akure South source/preview pipeline, opt-in and server-derived presence. The sample is not a complete map/boundary. `npm run geography:check` passes; rendering/client integration is unverified.
- **Stage 4:** Fictional/configurable JSS/SS education progression, attendance/results/exams, tertiary/ND/HND/training paths, scholarships, history and multiplayer persistence. The backend regression suite passes; Godot education UI/save/gameplay remains unverified. See [`EDUCATION_PLAN.md`](EDUCATION_PLAN.md).

Existing local client saves remain separate from online server authority. Online records without geography and schema-version-1 records continue through the supported migration path; Stage 5 adds lifecycle fields/maps without replacing prior identity, money, location, geography or education data.

## Stage 5 implementation

### Calendar, age and offline progression

- `game/data/life/life_catalog.json` defines the `nigeria-main` Gregorian calendar, 2025-01-01 epoch, starting time, week/month labels, 650 ms/game-minute default, valid starting ages, life-stage ranges, adult/friendship constraints, family-size/history bounds, and retirement/old-age-review thresholds. The server accepts optional `GAME_MINUTE_MS` from 1–60,000 ms.
- Online `worldClock` stores one date/time state for all players and NPC records. DOB is authoritative for age; the numeric age is synchronized for existing gameplay compatibility. New characters start at 15 or 16. February 29 birthdays are observed on February 28 in non-leap years.
- Birthday, life-stage and history event IDs are retry-safe. Server lifecycle processing advances people and NPCs as the shared date moves and catches disconnected characters/household NPCs up on reconnect/reload. The shared clock pauses when the API process is stopped; downtime catch-up is **not** implemented. In local offline mode, the client clock advances during play and processes lifecycles to its saved date, but does not accrue real elapsed time while the app is closed.
- `services/world-api/src/life/` owns server calendar rules, person/family/relationship/event records and profile snapshots. `game/scripts/domain/life_simulation_service.gd`, `world_clock.gd`, and `character_state.gd` provide the offline client counterpart. The local offline clock/save is not another online/server timeline.

### Family, social, lifecycle and profile

- Catalog-driven starter-family profiles vary caregiver roles/count and sibling-group size; unique caregiver and sibling records persist as NPC/person records with DOB, life stage/status, home/location, relationships and history. No universal parent pair is imposed. Generic households, families, family generations and typed relationship edges use stable IDs.
- Friendship is age-appropriate and non-romantic. Romance/marriage is restricted to configured adults and requires mutual confirmation. No sexual content is modeled.
- Marriage records spouse/date/household/family links. Childbirth is request-idempotent and adds a child NPC with DOB, parents, household/family/home/location and life state; it does not create a separately controlled player.
- Retirement is an age-gated status. Death is centralized, idempotent, preserves character/NPC and relationship/history records, records abstract cause/date/age, and creates a pending inheritance-event/asset-reference hook without transfers. Old age does not trigger automatic death. Normal active actions by deceased characters are guarded client-side and server-side.
- The profile/save path carries age, DOB, configured life stage/status, family, relationships, education and recorded history. Starter-family NPCs are spawned at home. Local client save/UI behavior has not been engine-verified.

Detailed scope and contracts are in [`LIFE_SIMULATION_PLAN.md`](LIFE_SIMULATION_PLAN.md).

## Stage 5 acceptance coverage

| Area | Evidence | Result |
|---|---|---|
| Gregorian dates, calendar units, scale configuration, start age and leap-year behavior | `services/world-api/test/life.test.mjs` calendar test | **Passed (Node)** |
| DOB-derived age, birthday/stage changes, idempotency and offline catch-up | Node life tests; assertions in `game/tests/domain_smoke.gd` | **Passed (Node); client test source only** |
| Unique persistent parent/guardian/sibling records and family tree | Node life/persistence tests; local smoke/save-restart assertions | **Passed (Node); client test source only** |
| Friendship, mutual confirmation, minor/adult restrictions | Node life and online WebSocket tests | **Passed (Node)** |
| Adult progression, marriage, spouse/household/tree links, child NPCs and generations | Node life test | **Passed (Node)** |
| Death/status/history preservation, family events and inheritance references without transfer | Node life test | **Passed (Node)** |
| Multiplayer, persisted online lifecycle data, reconnect/offline catch-up, Stage 1–4 backend regressions | `npm run check` | **Passed: 37 Node tests** |
| Local Godot project import, UI, movement/deceased-action runtime, save/restart and Godot multiplayer | Godot unavailable | **Blocked / not run** |

## Checks run (2026-10-09)

| Check | Result |
|---|---|
| `npm run check` | **Passed** — ESLint, TypeScript build, 37 Node tests, 0 failures. Includes life and retained Stage 1–4 backend/geography regressions. |
| `npm run geography:check` | **Passed** — 3 processed geography files match pinned inputs. |
| `./.venv/bin/gdformat --check $(find game -name '*.gd' -print)` (gdtoolkit 4.5.0) | **Passed** — all 20 GDScript files unchanged; gdformat parses/format-checks, not Godot type/runtime validation. |
| `./.venv/bin/gdlint $(find game -name '*.gd' -print)` | **Not clean** — 7 style/structure findings listed below; these are not proven engine errors. |
| `godot --version` / project import/tests | **Blocked** — executable is unavailable. |
| Database/runtime operations | No database configured; online JSON store is single-process prototype persistence; local save remains separate. |

Exact successful Node result: `npm run check` ran ESLint, TypeScript build, then Node's test runner: **37 tests, 37 passed, 0 failed**. This includes the ten Stage 5-focused lifecycle/integration tests in addition to retained backend, education, geography, multiplayer, and persistence checks. `npm run geography:check` reproducibly validated the three processed geography assets.

The current `gdlint` structural findings are:

- `max-public-methods`: `game/scripts/domain/character_state.gd` and `game/scripts/ui/prototype_ui.gd`.
- `max-file-lines`: `game/scripts/domain/education_service.gd`, `game/scripts/domain/life_simulation_service.gd`, `game/scripts/prototype_game.gd`, and `game/scripts/ui/prototype_ui.gd`.
- `max-returns`: `game/scripts/prototype_game.gd` function `_on_education_action_requested`.

No Godot engine check or in-game regression is claimed. The gdtoolkit parse/format check cannot establish GDScript static typing, scene resource validity, UI behavior, or save/gameplay behavior.

## Reproduction commands

From repository root:

```sh
npm run check
npm run geography:check
node --test services/world-api/test/life.test.mjs  # after build, focused Stage 5 suite
# If gdtoolkit is installed:
gdformat --check $(find game -name '*.gd' -print)
gdlint $(find game -name '*.gd' -print)
```

When Godot 4.7.2 is available, run the import check and retained client tests in [`README.md`](../README.md), including `domain_smoke.gd`, `player_movement.gd`, and both separate-process `save_restart.gd` phases. Verify Stage 1–4 journeys first, then test Stage 5 creation at ages 15/16, shared/local clock dates, birthday catch-up/idempotency, profile/history/family rendering, NPC reload, marriage/child/death paths, deceased-action guards and two-client lifecycle snapshots. Record exact engine version/output before marking client behavior verified.

## Known limits and next gates

1. The online world clock runs while the API process runs; it pauses during API downtime. Server-downtime catch-up is not implemented.
2. Offline Godot mode keeps its existing local save/clock, advances only during play, and does not synchronize to online server time. Online characters share one authoritative clock.
3. The current JSON store is single-process and limited to 16 MiB; there are no DB transactions, multi-writer coordination, production backups or recovery.
4. Stage 5 client/engine checks remain blocked by missing Godot 4.7.2. Node tests and gdformat do not substitute for Godot runtime tests.
5. Keep accident, violence/crime-related and poisoning/exposure categories abstract narrative data. Do not add methods or instructions. Do not implement employment, asset transfer, legal inheritance or broader systems as Stage 5 work.
6. **Next planned stage: Stage 6 — Careers & Employment.** Do not begin it until Stage 5 implementation and its required verification gate are accepted.
