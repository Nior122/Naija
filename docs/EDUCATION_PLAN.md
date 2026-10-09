# Stage 4 — Complete Nigerian Education System

## Purpose and boundaries

Stage 4 makes education a persistent life progression inside the existing Naija prototype. It extends the Stage 0–3 Node API, Stage 1 offline Godot life, Stage 2 optional multiplayer, and Stage 3 geography/presence foundation. There is still one logical world, `nigeria-main`; a region or school campus is a location in that world, not a separate world or shard.

The data and institutions here are **fictional prototype content**, not official curriculum, examination, admission, accreditation, or fee guidance. WAEC/NECO are references for the broad idea of a senior-secondary certificate examination only. Every question is original game content; no protected paper, real exam question, real campus address, or real-institution endorsement is included. Synthetic institution coordinates are gameplay anchors inside the existing Akure South preview, not mapped school addresses.

Stage 4 does not implement the full employment/careers system, banking/economy, education policy/government, national curriculum authority, age/birthday/life-stage simulation, or Stage 5 life simulation. Age is used as a configured entry-eligibility input; the existing world clock drives school timetables, attendance, terms, exam windows, and study history. The player does not age automatically in Stage 4.

## Current implementation and verification boundary

- Shared data: [`../game/data/education/catalog.json`](../game/data/education/catalog.json).
- Offline domain rules: `game/scripts/domain/education_service.gd`, with the retained `school_service.gd` adapting the old class/timetable interface.
- Offline character/save integration: `game/scripts/domain/character_state.gd`, `game/scripts/services/save_service.gd`, and `game/scripts/prototype_game.gd`.
- Player-facing panel and course/exam feedback: `game/scripts/ui/prototype_ui.gd`.
- Fictional school, classroom, tertiary-campus, and skills-centre locations/NPCs: `game/scripts/world/world_map.gd`.
- Online catalog/types/rules: `services/world-api/src/education/`.
- Online authority/persistence integration: `services/world-api/src/multiplayer/world-engine.ts`, `persistence.ts`, and `types.ts`.
- Backend regression coverage: `services/world-api/test/education.test.mjs`, plus the retained API/world/geography tests.

The offline record is included in the local character JSON save. Local save format version 2 reads the existing version-1 Stage 1 saves and migrates their legacy score/attendance fields into an education record. Online student records are nested in the server-owned character record in the existing single-process `world-state.json`; older Stage 2/3 online records without an education record are initialized from their legacy education fields without replacing identity or geography. Static catalogs stay in the repository, not player save files.

Node lint/build/tests and deterministic geography checks pass on this implementation. Static `gdformat` parses and formats all 19 GDScript files; `gdlint` reports the documented file-length/public-method-limit warnings. Godot is not installed here, so project import, GDScript engine/type validation, client runtime, offline save/restart, UI rendering, and Godot multiplayer remain unverified. See [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).

## Configurable education catalog

The catalog has schema version 1 and world ID `nigeria-main`. It centralizes school years, curriculum, subjects, assessment weights, timetable, attendance rules, examination rules, program requirements, fees, scholarship capacity, training sessions, and fictional institution anchors. The TypeScript loader validates IDs and cross-references, one-world/geography identity, fictional flags, configured fees, program rules, timetable links, and original-content flags before the server uses it. The Godot loader checks catalog presence, schema version, and world identity.

Current sample configuration (all values are gameplay tuning, not official standards):

- Six class IDs: **JSS1, JSS2, JSS3, SS1, SS2, SS3**. The catalog maps age 15 to JSS1 and age 16 to SS1; fallback ages use SS1. These are starting-character rules, not automatic ageing.
- Twelve subjects: Mathematics, English Language, Civic Education, Biology, Chemistry, Physics, Computer Studies, Economics, Government, Geography, Literature in English, and Agricultural Science. Compulsory subjects and elective groups are defined by curriculum data; defaults include Biology and Computer Studies.
- Three terms per secondary academic year; five game days per configured term; weekday-indexed school timetable, scheduled breaks/activities, teachers, classrooms, locations, assessment types, late grace and class duration are data-backed.
- Secondary assessment categories are continuous assessment, assignment, test, practical, and examination with configurable weights. Attendance is a separate configured component. The prototype's grade bands, 50% overall promotion average and 40% core-subject floor are tunable, not official grading policy.
- Initial diagnostic scores seed a new student's academic record. Later subject choices do not delete prior assessment/history.
- School/institution labels, curriculum IDs, entry rules, capacities, program durations, fees, scholarship awards and training requirements remain catalog data rather than rules inferred from real Nigerian schools.

## Secondary-school progression

A student receives a persistent `StudentEducationRecord` with a stable student/character identity, school, class, academic year, term, enrollment/progression states, selected subjects, attendance, assessments, term results, exam records, qualifications, skills, applications, funding, and an ordered bounded history of education events.

The configured timetable resolves the student's class and selected electives. Beginning a lesson records attendance; answers create an assessment using the configured assessment category. Missed scheduled periods can be recorded as absences against the shared game calendar. Attendance entries are idempotent per student/scheduled period/day. School activities record attendance and configured prototype energy, academic and relationship effects; ordinary Stage 1 money and needs remain in use.

At term close, subject averages are derived from configured assessment weights, attendance contribution, and available records. The service publishes per-subject scores/grades, attendance, overall result and promotion eligibility. At the final term the player can promote, repeat the class, choose a supported recovery year, or leave secondary school with history preserved. Promotion advances through the configured JSS/SS sequence; an eligible SS3 student can proceed to the fictional senior certificate exam. Final exam failure does not erase the student's existing record and permits a configured retake.

## Fictional senior certificate examination

`Naija Senior Certificate Examination` is a fictional prototype. Registration checks SS3/final-exam eligibility and configured subject choices; registration and retake fees are data-backed. Papers open after the configured in-game delay. The server keeps the correct answer private while presenting the original question and choices; each answer creates a saved subject attempt. Configured credit count and required core-subject credits determine prototype certificate eligibility and an education-history qualification. Result statuses distinguish registration, in-progress, and published outcomes.

The catalogue currently requires at least five subjects and five credits including Mathematics and English Language. These rules are **not** represented as WAEC or NECO regulations. UI copy explicitly says the exam is original fictional content and not an official result or qualification.

## Tertiary pathways

Fictional institution records are geographically associated with the same one-world Akure South prototype region. Their displayed place labels are Ondo State, Akure South LGA, and Akure settlement; coordinates are synthetic gameplay anchors and do not identify real campuses.

The sample has a fictional university, technical polytechnic, and college of education, with six configured programs: three four-year BSc/BSc Ed routes (eight prototype semesters), a two-year ND route and a **separate** two-year HND route (each four semesters), and a three-year NCE education route (six semesters). Applications evaluate age, secondary certificate/final-exam credits, required subjects, recent secondary results and any configured qualification prerequisites. Offers can be accepted or declined; application, registration, tuition, capacity and semester length are configurable. Courses have original game assessments; semester closure requires course results, evaluates configured standing, charges fees through the existing prototype money/funding foundation, and records a qualification plus future career-eligibility links on completion.

The HND route explicitly requires the configured ND qualification; it is not an alias or a direct substitute for the ND program. These programs do not assert real accreditation or guarantee real-world entry or employment.

## Vocational learning and apprenticeships

Thirteen fictional skills-centre programs cover tailoring, welding, electrical installation, carpentry, mechanics, hairdressing, catering, photography, phone repair, computer repair, graphics/design, plumbing, and small-scale farming. Catalog entries provide duration, session cost, mentor, skill ID, and certificate/career links.

A player can enroll in one vocational course or apprenticeship at a time. Practical sessions use the training-centre location, existing money and energy, and configured session lengths/fees. They add skill experience and history; completion can award a fictional certificate. An apprenticeship also persists its mentor, required/completed sessions, and skill level. Career links are eligibility metadata only: there is no job board, hiring, wage, or employment simulation in this stage.

## Scholarships, fees, family, and existing money

Catalog rules provide school/tertiary fees, one-off application/registration costs, scholarship amounts/term limits/capacity, need/merit thresholds, books/materials, and a bounded family-study-support request at home. Scholarship funds are a separate education-only balance consumed against configured education costs before ordinary player cash. They are not a bank account, transferable currency, or general-purpose economy. Family support is a limited prototype cash contribution from the existing household; it is not a full family-finance model. Insufficient funds return clear player-facing guidance rather than allowing a negative balance.

## Geography, people, and UI

The school and tertiary/training institutions refer to `world_id: nigeria-main` and the existing synthetic Stage 3 sample-region identity. The client has schoolyard/classroom locations plus fictional tertiary-campus and training-centre subscenes. Online travel is server-validated; education actions check relevant scene/time/enrollment where applicable. Indoor transitions retain the same world and clear only optional outdoor geographic presence as Stage 3 already specifies.

The education panel shows class/year/term/progression, subject choices, recent scores and attendance, today's timetable, available actions, program/offer details and location labels, scholarships/funding, qualifications, and recent history. Basic fictional student and teacher/mentor NPC data are drawn from the catalog in the school/campus areas. This is not a living population or advanced NPC routine simulation.

## Multiplayer and persistence contracts

- The server owns online education actions, scores, exam correctness/results, attendance, progression, fee deductions, applications, and qualification/history updates. The client sends action intent and answer selection, not authoritative marks or money.
- Existing `school.begin` / `school.answer` protocol supports scheduled secondary lessons and tertiary course assessments. `education.action` covers configuration-backed actions such as subjects, progression, exam registration, applications, scholarships, fees, and training; the final-exam start uses the server's education-aware classroom flow.
- Beginning a lesson, final-exam paper, or tertiary course assessment records attendance in the server-owned education record. Character snapshots and JSON persistence retain the resulting education data; the prototype JSON file is still single-process and non-transactional.
- Two-client tests move players through the existing home/street/school entrances into one shared `schoolyard` scene and verify co-presence in `nigeria-main`. This proves the Node/WebSocket path only, not the Godot client UI.

## Tests and completion gate

The current Node suite includes checks for data/catalog invariants, JSS/SS years, enrollment, selected subjects, lesson attendance/absence, assessment grading, term results and progression, final-secondary eligibility/pass/fail/qualification/save-load normalization, university BSc admission/course/semester/graduation, ND and separate prerequisite-based HND, vocational courses/apprenticeships/skills/certificates, scholarship and household support limits, multiplayer schoolyard co-presence, online attendance/action replication, reconnect and persisted education save/load. The Stage 1–3 backend regressions remain in the same suite.

Engine/runtime checks still require Godot 4.7.2: import the project, run existing domain/movement/save-restart harnesses, manually test offline education journeys and verify two Godot clients through one school scene. Do not claim the client path is complete until those checks run. No acceptance of official policy or real exam papers is implied.

## Out of scope and next stage

No full employment/careers, banking, credit, realistic national economy, education ministry/policy, real admissions, official accreditation/exam material, automatic birthdays/age progression, family-life simulation, national institution coverage, production database, or large-scale MMO operations are included in Stage 4. Stage 5 age/family simulation is implemented separately in [`LIFE_SIMULATION_PLAN.md`](LIFE_SIMULATION_PLAN.md); its Godot client/runtime verification remains pending. The next planned roadmap stage is **Stage 6 — Careers & Employment**, not yet started.
