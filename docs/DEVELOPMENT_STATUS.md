# Development Status

> **Future AI agents: read this file before modifying the project.** It separates implementation from verification; source code and test files are not proof of runtime behavior.

## Current stage and verification gate

**Stage 4 — Complete Nigerian Education System: implementation present; Node/backend and geography checks pass; Godot runtime verification remains blocked.** Stages 0–3 remain in the repository. Stage 4 extends the existing `nigeria-main` world rather than replacing its local life simulation, optional online authority, Stage 3 geography, or persistence contracts.

Godot 4.7.2 is not installed in this workspace (`godot: command not found`). GDScript formatting is checked, but project import, engine/type validation, scenes, client gameplay/UI, local save/restart, and Godot two-client/multiplayer behavior have not been run. Do not infer client-runtime success from Node tests.

The next roadmap line is **Stage 5 — Age & Life Simulation**. It has not started. Follow the Stage 4 exit gate in [`ROADMAP.md`](ROADMAP.md); do not begin Stage 5 work while Godot-dependent Stage 4 runtime checks remain pending.

## Stages 0–3 preserved

- The Stage 0 Node HTTP API, `/health`, `/api/v1/world`, strict TypeScript service and canonical world ID `nigeria-main` remain.
- The Stage 1 offline Godot life, Idera Quarter, character/family/home, movement, school and community actions, money/needs/inventory, local clock and client-local save remain in the project. Their current client runtime is unverified here.
- The Stage 2 optional WebSocket service, online character snapshots, presence, movement/actions, shared clock and server JSON persistence remain separate from Stage 1 local saves. Node integration regressions pass; Godot runtime remains unverified.
- The Stage 3 administrative geography catalog, bounded Akure South preview/source pipeline, geography opt-in and server-derived online presence remain. The preview is not a complete boundary/city map. The deterministic import check passes; rendering and Godot client integration remain unverified.
- Older online records without `geographic_location` remain supported. Stage 4 adds education-record normalization without resetting existing online character identity, household, money, position or geography.

For the complete Stage 3 source provenance and coordinate limitations, see [`DATA_SOURCES.md`](DATA_SOURCES.md) and the Stage 3 history in [`ROADMAP.md`](ROADMAP.md).

## Stage 4 — education implementation

### Configurable fictional catalog

`game/data/education/catalog.json` is schema version 1 and uses `world_id: nigeria-main`. It contains:

- Six configurable secondary years: JSS1, JSS2, JSS3, SS1, SS2 and SS3; diagnostic age mapping, curricula, compulsory/elective subjects, subject groups and a starter score set.
- Twelve subjects; the school calendar/timetable, school days, term length, teachers, classrooms, activities, assessment categories, assessment weights, attendance grace, grade bands, promotion thresholds, exam rules, fees, training programs, scholarship amounts/capacities/terms, tertiary calendar, course/program prerequisites and NPCs.
- Five configured secondary assessment types and original fictional questions. The sample WAEC/NECO-inspired final certificate examination is not affiliated with any examination body and contains no protected exam paper/questions.
- Fictional secondary, university, polytechnic, college-of-education and skills-centre institution data with synthetic anchors inside the existing Akure South geographic sample. These are not real addresses, endorsements, accreditation claims, or official curriculum/admissions/fee rules.
- Three fictional university BSc/BSc Ed routes, a distinct ND and prerequisite-based HND sequence, one NCE route and 13 vocational/apprenticeship trade programs with skills/career eligibility links.

All values are prototype tuning. Read [`EDUCATION_PLAN.md`](EDUCATION_PLAN.md) for scope, limitations and pathway details.

### Offline client integration (source present; engine checks blocked)

- `game/scripts/domain/education_service.gd` loads catalog data and owns the local student record rules. `school_service.gd` adapts existing timetable/class actions to the structured school/education service.
- `game/scripts/domain/character_state.gd` persists a structured education record while maintaining compatibility fields for legacy scores/attendance.
- `game/scripts/services/save_service.gd` keeps local saves separate from online state and migrates existing version-1 Stage 1 saves into the current record format.
- `game/scripts/prototype_game.gd`, `game/scripts/ui/prototype_ui.gd` and `game/scripts/world/world_map.gd` integrate school, campus and skills-centre actions, student data/panels, NPCs and the existing world scenes.
- `game/scripts/domain/education_service.gd`, `prototype_game.gd` and `prototype_ui.gd` exceed gdtoolkit's default file-length threshold; `prototype_ui.gd` also exceeds its public-method threshold. These are static lint findings; runtime behavior is unknown until Godot runs.

### Online authority and persistence (Node-tested)

- `services/world-api/src/education/` contains catalog validation, typed education records and server-owned lifecycle rules. `services/world-api/src/multiplayer/types.ts` attaches each `StudentEducationRecord` to the existing server-owned character.
- `services/world-api/src/multiplayer/world-engine.ts` integrates server-validated education actions, scheduled lessons, attendance, scores/results, final-exam flow, tertiary course work, pathways, costs and funding with the existing time/location/world authority.
- `services/world-api/src/multiplayer/persistence.ts` normalizes legacy online character education fields into the structured record while retaining Stage 2/3 character state. The existing JSON state file remains a bounded single-process prototype, not a database.
- `services/world-api/test/education.test.mjs` verifies education lifecycle rules and a two-client school co-presence/attendance/action/save-restart integration path.

### Acceptance coverage status

| Requested area | Current evidence | Status |
|---|---|---|
| Enrollment, configured JSS/SS years, subject choices and progression | Node education lifecycle tests | **Passed** |
| Timetable attendance, absences, idempotence, weighted grades and term results | Node education lifecycle tests; online classroom attendance assertion | **Passed** |
| Final-secondary eligibility, original exam content, pass/fail, retained history and saved results | Node education lifecycle tests and JSON normalization round trip | **Passed** |
| University program, course assessments, semester completion and qualification links | Node BSc route test | **Passed** |
| Polytechnic ND followed by distinct prerequisite-based HND | Node ND/HND route test | **Passed** |
| Vocational course/apprenticeship sessions, skill level and certificates | Node route tests | **Passed** |
| Scholarship awards, fee funding and bounded family support | Node funding test | **Passed** |
| Education event/history and persistent records | Node lifecycle plus online state-file restart/reconnect | **Passed** |
| Geography/institution catalog integration and source reproducibility | Education catalog assertions plus `npm run geography:check` | **Passed** |
| Online schoolyard co-presence, attendance/action replication | Two real WebSocket clients moved into the same school scene; server snapshot assertions | **Passed** |
| Offline Godot play, player-facing education UI, local save/load runtime | Godot unavailable | **Not run / unverified** |
| Godot education multiplayer client workflow | Godot unavailable | **Not run / unverified** |
| Full Stage 1–3 Godot runtime regression | Godot unavailable | **Not run / unverified** |

## Technology and executed checks (2026-10-08)

| Component | Baseline/check | Result |
|---|---|---|
| Node.js/npm | Node `v22.22.3`; npm `10.9.8` | Available |
| TypeScript API | `npm run check` (ESLint, strict TypeScript build, all Node tests) | **Passed**: 26 Node tests, 0 failures |
| Focused education suite | `npm run build --workspace=@naija/world-api && node --test services/world-api/test/education.test.mjs` | **Passed**: 8 education tests, 0 failures |
| Geography provenance/reproducibility | `npm run geography:check` | **Passed**: all 3 processed geography files match the pinned inputs |
| GDScript formatting | `PYTHONPATH=/tmp/naija-gdtoolkit-packages /tmp/naija-gdtoolkit/bin/gdformat --check $(find game -name '*.gd' -print)` | **Passed**: 19 files left unchanged |
| GDScript lint | `PYTHONPATH=/tmp/naija-gdtoolkit-packages /tmp/naija-gdtoolkit/bin/gdlint $(find game -name '*.gd' -print)` | **Not clean**: 4 structural findings listed below |
| Godot | Project targets Godot 4.7.2 | **Blocked**: executable unavailable; no import/runtime checks |
| Database | None configured | Single-process JSON server persistence and separate local client JSON save only |

Exact executed results:

- `npm run build --workspace=@naija/world-api && node --test services/world-api/test/education.test.mjs` — **passed**, 8 tests, 0 failures. Includes a live two-WebSocket-client school co-presence journey, server-validated classroom attendance/action and online record persistence through API restart.
- `npm run check` — **passed**, ESLint, TypeScript build and 26 Node tests, 0 failures. Includes the retained Stage 1–3 API, multiplayer, persistence, geography, and importer regressions alongside Stage 4 coverage.
- `npm run geography:check` — **passed**, 3 processed files reproducibly matched the pinned sources.
- `gdformat --check` over all game GDScript files — **passed**, 19 files unchanged.
- `gdlint` — **failed only the style/structural gate**, with four configured maximum-count warnings: `max-file-lines` for `game/scripts/domain/education_service.gd` (2,162 lines), `game/scripts/prototype_game.gd` (1,090 lines), and `game/scripts/ui/prototype_ui.gd` (1,144 lines); plus `max-public-methods` in `game/scripts/ui/prototype_ui.gd`. The earlier line-length finding was fixed and does not appear in this latest run.
- `godot --version` — **not run successfully**: shell reports `godot: command not found`. No engine, scene, graphics, input, local save/load, education UI, or Godot client-multiplayer results are claimed.

## Reproduction commands

From the repository root:

```sh
npm run check
npm run build --workspace=@naija/world-api
node --test services/world-api/test/education.test.mjs
npm run geography:check
PYTHONPATH=/tmp/naija-gdtoolkit-packages /tmp/naija-gdtoolkit/bin/gdformat --check $(find game -name '*.gd' -print)
PYTHONPATH=/tmp/naija-gdtoolkit-packages /tmp/naija-gdtoolkit/bin/gdlint $(find game -name '*.gd' -print)
```

When Godot 4.7.2 is available, import and run the existing tests documented in [`README.md`](../README.md), verify Stage 1 creation/movement/save/restart first, then follow the offline education journeys and two-client school/campus workflow described in [`EDUCATION_PLAN.md`](EDUCATION_PLAN.md). Confirm client scene transitions preserve one world, school clock/timetable behavior, attendance, results, final-exam eligibility/outcomes, funding and local save/restart. Fix any engine import/runtime failures before marking Stage 4 client behavior verified or beginning Stage 5.

## Known limits and next gates

1. Keep the shared education catalog fictional, configurable and versioned; do not present its curricula, fees, admissions, awards or progression thresholds as Nigerian government or institutional policy.
2. Do not add protected examination papers, imply WAEC/NECO or institution endorsement, or turn career eligibility metadata into employment simulation.
3. Maintain one canonical `nigeria-main` world; campus anchors are synthetic prototype points inside the existing geographic sample, not real addresses.
4. Before production, replace JSON persistence with an explicit storage/migration/recovery design, authoritative writes and operational/security controls. No banking or full economy was introduced.
5. Godot import/runtime and Stage 1–4 offline-client/regression checks remain blocked until Godot 4.7.2 is available. Node tests do not substitute for these checks.
6. **Next stage: Stage 5 — Age & Life Simulation.** Stage 5 remains not started and is gated on completing the available Stage 4 test/runtime verification first.
