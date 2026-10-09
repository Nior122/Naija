# Master Roadmap

The roadmap describes intended development, not completed features. Phase 0 is complete. Phases 1–3 remain in place; their Godot runtime verification is still pending. Phase 4 education implementation is present with backend/persistence/multiplayer/geography checks passing; Godot client checks remain blocked. Phase 5 Age & Life Simulation implementation and Node tests are present; Godot client verification remains blocked. Phase 6 and later phases have not started. See `DEVELOPMENT_STATUS.md` for exact results.

| Phase | Name | Purpose | Status |
|---:|---|---|---|
| 0 | Game Foundation & Architecture | Establish the repository, chosen stack, modular boundaries, plans, minimal client/API shells, and development checks. | **Complete** |
| 1 | First Playable Prototype | Build a deliberately small life-simulation slice: create/control a student character, explore one bounded setting, and complete a few understandable interactions. | **Implementation present; Godot/runtime verification pending** |
| 2 | Multiplayer Foundation | Add server-authoritative identity, sessions, synchronization, and persistence for a small test population while retaining one logical world. | **Implementation present; backend verified; Godot runtime verification pending** |
| 3 | Nigerian Geography Expansion | Introduce validated administrative geography, place data, coordinates, and a repeatable import/provenance pipeline. | **Implementation present; Node/data checks pass; Godot runtime verification pending** |
| 4 | Complete Education System | Integrate configurable secondary schooling, attendance/results, original final-secondary exams, fictional tertiary/ND/HND/vocational/apprenticeship pathways, scholarships, geography, multiplayer and saves. | **Implementation present; Node/backend checks pass; Godot runtime verification pending** |
| 5 | Age & Life Simulation | Add birthdays, age progression, life stages, family events, death, inheritance, and generational continuity. | **Implementation present; Node tests pass; Godot client verification pending** |
| 6 | Careers & Employment | Model skills, job seeking, employment, work progression, and career changes. | Not started |
| 7 | Full Nigerian Economy | Build a balanced Naira-denominated simulation for prices, wages, banking, transactions, taxes, credit, and investment. | Not started |
| 8 | Player Businesses | Let players establish and operate businesses with staffing, costs, stock, compliance, and customer demand. | Not started |
| 9 | Housing & Property | Add homes, rentals, ownership, construction, property records, and housing markets. | Not started |
| 10 | Government | Model local, state, and federal institutions, agencies, budgets, public services, and office holders. | Not started |
| 11 | Elections & Politics | Add parties, candidates, campaigns, voting, election integrity, offices, and terms of government. | Not started |
| 12 | Laws, Courts & Justice | Establish versioned laws, legal procedure, courts, cases, judges, lawyers, judgments, and appeals. | Not started |
| 13 | Police & Security | Add accountable policing, reports, investigations, evidence, and safeguards around sensitive systems. | Not started |
| 14 | Military | Model the armed forces and their lawful institutional roles at an appropriate level of abstraction. | Not started |
| 15 | Crime & Consequences | Add risk, reports, investigations, adjudication, penalties, rehabilitation, and prevention without rewarding real-world harm. | Not started |
| 16 | Religion, Culture & Community | Represent diverse faiths, traditions, languages, community groups, events, and local variation respectfully. | Not started |
| 17 | Entertainment & Media | Support music, film, comedy, journalism, broadcasting, and creator careers. | Not started |
| 18 | Social Network | Introduce in-world publishing, profiles, feeds, privacy controls, reporting, and moderation. | Not started |
| 19 | Transportation & Infrastructure | Expand roads, public and private transport, rail, airports, ports, utilities, and travel systems. | Not started |
| 20 | Living NPC Society | Develop population cohorts and purposeful NPC routines, relationships, work, and reactions. | Not started |
| 21 | Dynamic Nigerian World | Connect the clock, weather, markets, public events, institutions, NPCs, and player actions into evolving state. | Not started |
| 22 | Full Nigeria | Broaden and validate national geographic, institutional, and cultural coverage across the country. | Not started |
| 23 | Advanced 3D World | Evolve presentation, environments, interiors, animation, lighting, and performance toward the intended visual direction. | Not started |
| 24 | One-World Scaling | Partition physical workloads and data while preserving globally coherent authoritative Nigeria state. | Not started |
| 25 | Mobile + PC Optimization | Optimize controls, rendering, memory, networking, accessibility, and platform-specific packaging. | Not started |
| 26 | Testing & World Simulation | Add long-duration simulations, load/chaos testing, balance validation, migration testing, and disaster exercises. | Not started |
| 27 | Launch Preparation | Complete operational readiness, privacy/safety review, support, release pipelines, localization, and platform compliance. | Not started |
| 28 | Full Game | Deliver and operate the integrated life-simulation experience, then continue evolving it responsibly. | Not started |

## Stage 3 exit gate

The implementation slice includes 36 states plus FCT and 774 canonical LGA records, 11 ward reference points, a pinned 200-feature ODbL-attributed Akure South sample, deterministic/validated processing, WGS84-to-game conversion, stable 500 m chunks, an opt-in existing-client map preview, and optional server-derived geographic presence. The viewport is not an administrative boundary; source coordinate semantics and licenses are documented in `DATA_SOURCES.md`.

The Node importer, deterministic output check, backend build/lint/tests and GDScript formatter check pass. The missing Godot 4.7.2 executable blocks scene import, visual review, Stage 1 offline save/load regression, and Stage 3 client/map/two-window verification. Record that limitation rather than marking client behavior engine-verified. Stage 4 implementation has since extended this foundation; its tests and current runtime gate are recorded below.

## Stage 4 exit gate

The implementation is in place across `game/data/education/catalog.json`, the offline Godot education domain/UI/world/save path, the server-side TypeScript education catalog/rules and the existing WebSocket character/persistence path. The catalog provides six JSS/SS years, configured subjects/timetable/assessment/grading, fictional original-content final exams, university and distinct ND/HND routes, vocational/apprenticeship trades, scholarships, synthetic Stage 3 institution anchors and history. Education remains inside one `nigeria-main` world. No official institution/curriculum/exam claim, protected exam content, full jobs/careers, banking/economy, education policy or Stage 5 life simulation is included.

The prior Stage 4 verification reported 26 Node tests, including eight focused education tests for enrollment/progression, attendance/grades/results, final exam outcomes/persistence, tertiary and ND/HND pathways, training/apprenticeship, scholarships/history, geography, online schoolyard co-presence, attendance replication and save/restart. The current full suite has since grown to 37 Node tests and continues to cover those regressions. Geography reproducibility and GDScript formatting pass. Static GDScript lint has structural findings. **Godot 4.7.2 is unavailable**, so Stage 4 project import, offline/client UI/save journeys and Godot multiplayer/runtime regressions remain unverified. See `DEVELOPMENT_STATUS.md` and `EDUCATION_PLAN.md` for the remaining client gate. Stage 5 implementation has been added without replacing or declaring these Godot checks successful; the Stage 4 client limitation remains open.

Next roadmap line: **Stage 6 — Careers & Employment** (not started; Stage 5 client/runtime verification remains blocked).

## Stage 5 exit gate

Stage 5 implementation adds a configurable Gregorian calendar and one shared online `nigeria-main` clock; DOB-derived age/life-stage records; idempotent birthday and reconnect catch-up; unique persistent family NPCs and generic family/household/relationship links; minor-safe friendship and adult-only mutual romantic progression; marriage and child-NPC records; retirement, preserved death/history, deceased-action guards and inheritance-reference hooks. It does not add employment, legal/property inheritance, asset transfers or automatic old-age death. See `LIFE_SIMULATION_PLAN.md` for the exact contracts and boundaries.

`npm run check` passes all 37 Node tests (including ten Stage 5 lifecycle/integration tests); `npm run geography:check` passes; `gdformat --check` parses/formats all 20 GDScript files. Static `gdlint` reports seven structural findings. **Godot 4.7.2 is unavailable**, so client project import, offline profile/family/NPC behavior, lifecycle UI, local save/restart, movement/deceased-action runtime and Godot multiplayer remain unverified. This stage is implementation-present and backend-tested, but its client verification gate is still open. Do not mark it fully verified or begin Stage 6 until the Stage 5 client checks in `LIFE_SIMULATION_PLAN.md` and the retained Stage 1–4 runtime regressions are run and reviewed.

## Stage 1 exit gate

The Stage 1 scope is a local, single-player 2D life-simulation slice in fictional Idera Quarter: create a 15–16-year-old student, begin in a generated family home, move and interact with NPCs/objects, visit school and complete class activities, manage basic needs/money/inventory, and save locally. The code is present; implementation alone does not complete the phase.

Before marking Phase 1 complete, import and launch the project with Godot 4.7.2, run the domain and movement scripts, run both `save_restart.gd` phases in separate processes, and manually verify the creation-to-school-to-save loop. This gate remains blocked until the engine is available. Phase 2's implementation was added under the explicit follow-on request despite the blocked Stage 1 runtime check; it does not make Phase 1 runtime-verified. Record exact results and fix any engine/runtime failures in `DEVELOPMENT_STATUS.md`. Full Nigeria geography, production accounts, and production persistence remain out of scope here.
