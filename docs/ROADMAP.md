# Master Roadmap

The roadmap describes intended development, not completed features. Phase 0 is complete. Phase 1 implementation is present but its Godot runtime, gameplay, and save/restart verification remain pending. Phase 2 implementation is present and its Node backend checks pass, while Godot multiplayer runtime verification is blocked by the missing engine. Later phases remain not started; see `DEVELOPMENT_STATUS.md` for exact results.

| Phase | Name | Purpose | Status |
|---:|---|---|---|
| 0 | Game Foundation & Architecture | Establish the repository, chosen stack, modular boundaries, plans, minimal client/API shells, and development checks. | **Complete** |
| 1 | First Playable Prototype | Build a deliberately small life-simulation slice: create/control a student character, explore one bounded setting, and complete a few understandable interactions. | **Implementation present; Godot/runtime verification pending** |
| 2 | Multiplayer Foundation | Add server-authoritative identity, sessions, synchronization, and persistence for a small test population while retaining one logical world. | **Implementation present; backend verified; Godot runtime verification pending** |
| 3 | Nigerian Geography Expansion | Introduce validated administrative geography, place data, coordinates, and a repeatable import/provenance pipeline. | Not started |
| 4 | Complete Education System | Expand secondary school, universities, polytechnics, vocational study, apprenticeships, school years, and education records. | Not started |
| 5 | Age & Life Simulation | Add birthdays, age progression, life stages, family events, death, inheritance, and generational continuity. | Not started |
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

## Stage 1 exit gate

The Stage 1 scope is a local, single-player 2D life-simulation slice in fictional Idera Quarter: create a 15–16-year-old student, begin in a generated family home, move and interact with NPCs/objects, visit school and complete class activities, manage basic needs/money/inventory, and save locally. The code is present; implementation alone does not complete the phase.

Before marking Phase 1 complete, import and launch the project with Godot 4.7.2, run the domain and movement scripts, run both `save_restart.gd` phases in separate processes, and manually verify the creation-to-school-to-save loop. This gate remains blocked until the engine is available. Phase 2's implementation was added under the explicit follow-on request despite the blocked Stage 1 runtime check; it does not make Phase 1 runtime-verified. Record exact results and fix any engine/runtime failures in `DEVELOPMENT_STATUS.md`. Full Nigeria geography, production accounts, and production persistence remain out of scope here.
