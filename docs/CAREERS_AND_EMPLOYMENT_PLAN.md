# Stage 6 — Careers & Employment

## Status, verification, and boundary

**Stage 6 backend implementation and automated tests are present.** The careers catalogue, rules, lifecycle and persistence are server-owned; the careers panel is wired into the existing Godot client and receives private server profile projections. TypeScript build/lint and the complete Node suite pass. `gdformat` parses and format-checks the GDScript, but **Godot 4.7.2 is unavailable**, so project import, static engine checks, rendered UI, client/server interaction, and Godot save/runtime behavior remain unverified. This is not deployment approval for a public or valuable-state service.

Stage 6 extends Stages 0–5 on the same `nigeria-main` world and one shared online clock. It uses Stage 4 education/skills/qualification history and Stage 5 DOB, age, life status, retirement, and death processing; it does not replace either source of truth. The Stage 5 Godot verification caveat remains open. See [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md) for current evidence.

Stage 6 provides configurable occupations and prototype employers/vacancies, server-checked job search and applications, employment and work-session history, schedules, career skills, periodic performance reviews, idempotent pay records, unpaid leave, promotions, resignation, an internal employer-authorized termination service, retirement integration, death handling, and deterministic household-NPC occupation foundations.

It does **not** add a bank, full Naira economy, general transaction service, taxes, credit, investment, player-owned businesses, real employer/player accounts, real professional licensing, legal employment rules, labor-market claims, advanced NPC workforce behavior, production database, or production operations. The next roadmap stage is **Stage 7 — Full Nigerian Economy**.

## Configurable catalogue

The shared, fictional prototype catalogue is [`../game/data/careers/careers_catalog.json`](../game/data/careers/careers_catalog.json), schema version 1 for `nigeria-main`. It defines:

- 12 industry categories, 63 occupation definitions, schedules, career/skill links, and promotion requirements.
- 12 fictional Idera-area employer fixtures and 10 starting vacancy fixtures. Vacancies carry employment type, salary offer, pay frequency, and openings; the persisted world holds remaining openings and active staffing.
- Minimum ages, permitted weekly hours and employment types, education level, qualification IDs/groups, required skills, regulated-role flags, prototype registration IDs, salary ranges, work schedules, work-skill awards, experience/performance thresholds, and explicit later-stage placeholders.
- Bounded application/search/history/work-session/leave/payroll rules, maximum salary and balance values, performance-review cadence, and the small deterministic NPC occupation set.

Catalogue validation checks unique IDs, cross-references, salary ranges, schedule bounds, vacancy/employer links, under-18 hour/type limits, regulated-role registration requirements, and the configured NPC set. Future-stage occupation links are metadata/placeholders only; jobs marked `future_stage_only` are not recruited into vacancies. Fixture counts, wages, institutions, employers, qualification labels and occupational descriptions are not official Nigerian statistics, pay guidance, accreditation, or legal advice.

## Eligibility and Stage 4 / Stage 5 integration

The server derives current age from the Stage 5 date of birth and shared world date; a client-supplied age is not accepted. The configured minimum working age is 16 in the current prototype. Under-18 roles are limited by catalogue validation to no more than 12 hours per week and part-time, casual, or temporary work types. Deceased characters cannot apply, start/complete a shift, or remain employed. Retirement age comes from the Stage 5 life catalogue (60 years by default); Stage 6 does not introduce another age or life-status source.

Education levels and required qualification IDs/groups are checked against the existing Stage 4 character education record. Education skill history can satisfy relevant skill prerequisites; career-earned skill records accumulate alongside it. Regulated occupations require configured registration and age constraints. `issueCareerLicenseServerSide` is a server-only prototype helper; it does not establish or verify a real-world licence, professional body, or qualification. It is not exposed as a player action, and vacancy fixture availability does not imply that an occupation is currently recruitable.

A character may not hold a second active employment while another active/on-leave/suspended commitment exists. Search results return the server's eligibility result and missing requirements, but each application is checked again when submitted and reviewed.

## Employers, vacancies, applications, and hiring

The server seeds employer and vacancy fixture records into persistent world state without overwriting existing runtime opening counts or employer active state. Search is bounded and can filter by text, industry, and configured work location. Employer staffing capacity and vacancy openings are checked on the server.

Applications are attached to the authenticated character, not a character ID from the request. A repeated pending application for the same character/vacancy returns the existing record instead of creating another. The configured review delay is one world day by default. Due applications are processed across the shared world in stable order (due date, eligibility score, submission date, then application ID); acceptance re-checks life status, age, education, skills, licensing, current employment, employer capacity, vacancy capacity, and pay bounds. A vacancy's openings and the employer's employee list are updated with the resulting employment record. A character cannot use multiple applications to acquire concurrent employments.

This is a deterministic prototype review, not a simulated interview process, employer AI, labor market, or player-employer marketplace. Employer fixtures and their staffing limits are gameplay data, not real organizations.

## Work sessions, skills, and performance

A work schedule specifies weekdays, start/end minutes, work minutes, clock-in grace, minimum session length, weekly hours, and whether the schedule is flexible. The server uses its shared date/minute, the character's server-held location, the active job, and that job's configured schedule. A client cannot report its own hours, wages, skill awards, performance score, or workplace. Each employment can record at most one deterministic session ID per world date; an unfinished shift expires or is invalidated, and deceased characters cannot continue one.

A completed session records the role, date, workplace, scheduled and actual minutes, gross earned amount, performance score, skill ID/experience, status, and payroll reference. Earnings are prorated from the configured monthly offer and expected scheduled sessions; partial work receives a lower amount. Career skill experience adds to Stage 4 education skill history without replacing it. Performance is based on recorded shift timing/completion, with a bounded score; a review is produced at the configured completed-session cadence and can support promotion eligibility. These are prototype game rules, not timesheets or employment policy.

## Payroll boundary and Stage 7 adapter

Stage 6 does not create a second balance or economy. `SalaryAccountPort` is the seam for the future economy service. The current `prototypeSalaryAccountPort` credits the existing server-owned `CharacterRecord.money`; it validates integer amounts and configured balance bounds and de-duplicates a `payment_id`. `salaryPayments` records the employment/character/employer IDs, amount, pay frequency, period, world date, session IDs, final-payment flag and posting timestamp. Completed sessions are marked with that payment ID in the same persisted JSON snapshot. A failed credit is deferred for a later safe retry instead of marking the work as paid.

Payment IDs are deterministic per employment/pay period (and a separate final-payment key). Reprocessing the same due date does not credit the balance or settle the same session twice. Resignation, eligible termination, and retirement perform final reconciliation for completed eligible sessions. Stage 7 must replace the prototype account adapter with the canonical Naira ledger using `payment_id` as the idempotency key and a transactional account/ledger write. The current JSON snapshot is still a single-process prototype and cannot provide production transaction guarantees.

No tax, bank account, transfer, benefit, loan, credit, business, investment, or general transaction API is implemented. A posted salary is a prototype character-balance credit only.

## Leave, progression, termination, resignation, retirement, and death

- **Leave:** one-day personal leave is exposed in the current UI; the server can record configured personal or vacation leave up to the catalogue maximum. The bounded prototype automatically approves it as **unpaid**, prevents shift overlap/clock-in during approved dates, records the event, and restores active status after the end date. No paid-leave, employer decision, accrual, or real labor policy is simulated.
- **Promotion:** the current role's completed-session and performance thresholds, the next role's full education/skill/licensing/age eligibility, and an open vacancy with the same employer are rechecked at request time. A promotion updates role, schedule, vacancy and salary on the persistent employment, opens the prior vacancy, and appends a career event. The work-session records and event retain the preceding role references.
- **Resignation:** only the authenticated owner of that employment can request resignation. Completed eligible work is reconciled, any in-progress session is invalidated, end date/reason/status are persisted, and employer staffing/openings are adjusted. Repeating a completed resignation is harmless.
- **Employer termination:** `terminateCareerEmploymentAsEmployer` is an internal server-service capability. It requires an active employer whose ID matches the employment, sanitizes and bounds the reason, reconciles completed eligible work, and closes the employment. There is deliberately **no public employer/admin WebSocket action**: the prototype has no authenticated employer identity/role system, so exposing this operation to ordinary player requests would be unsafe. A future authorized employer workflow must establish actor identity/permissions before adding a protocol action.
- **Retirement:** the Stage 5 life service must first set the character's life status to `retired` after its configured age check. Stage 6 independently requires that source-of-truth status before closing active roles. Roles explicitly configured for retired workers may remain; other active roles are closed and settled.
- **Death:** the existing Stage 5 death path closes active employment, invalidates an unfinished shift, removes active staffing, preserves work/history records, and prevents future payroll. The prototype does not transfer wages or assets to an estate; outstanding employment/payroll after death is not a Stage 7 inheritance or settlement system.

No Stage 6 operation overrides the server-held Stage 4 qualifications or Stage 5 DOB/life status.

## NPC foundation and private profile

Starter-household NPCs receive deterministic prototype occupational status from their stable person ID and the small catalogue allowlist. Children are students; retired/deceased life states override work status. NPC records are explicitly tagged as deterministic fixtures, have no wage/production/capacity side effects beyond fixture staffing, and do not run schedules, applications, or autonomous economic behavior. This is a data foundation for a later living-NPC stage, not a populated labor market.

Authenticated character snapshots and `career.result` responses contain the requesting character's career profile: eligibility/search information, skills/licenses, applications, employment history/current employment, work sessions, payroll, reviews, leave, career events, and bounded household occupations. Career history is not copied into public presence or shared `world.snapshot` player rows. The UI displays server-returned data, explains the fixture/ledger boundary, disables actions where applicable, and reports server errors; it does not fabricate a successful application, shift, promotion, or payment.

## Persistence, migration, and protocol

The online world state is schema version 3. It adds validated ID-keyed maps for `careerEmployers`, `careerVacancies`, `careerApplications`, `employments`, `workSessions`, `careerSkills`, `careerLicenses`, `careerReviews`, `careerLeaveRequests`, `careerEvents`, `salaryPayments`, and `npcCareers`. Stage 5 schema version 2 and older supported version 1 state are normalized to version 3 while preserving life, education, geography, money, identity, and character records. New state receives catalogue employer/vacancy fixtures; malformed version-3 career maps fail closed rather than resetting the world. The JSON file remains bounded to 16 MiB, single-process, and atomically replaced; it is not a database migration system.

The Godot client sends `career.action` messages with bounded action data and a request ID using the existing multiplayer deduplication path. Supported player operations are search, apply/withdraw, clock-in/complete shift, unpaid leave, promotion, resignation, and retirement. The server determines identity from the authenticated session; it does not accept client character ID, wage, qualification outcome, duration, performance, employment status, world date, or balance as authoritative. Employer termination and professional registration remain internal server-service operations. Career errors and results are returned to the caller; profile fields remain private.

## Verification

| Requirement | Evidence | Status |
|---|---|---|
| Catalogue bounds, links, schedules, employer/vacancy data and salary constraints | `services/world-api/test/careers.test.mjs` catalogue tests | **Passed (Node)** |
| Stage 4 qualifications/skills, Stage 5 age and server-recorded licence eligibility | Focused eligibility tests | **Passed (Node)** |
| Server review ordering, vacancy capacity, one-employment rule and application idempotency | Career service tests | **Passed (Node)** |
| Work schedule/location, skill/performance records, payroll idempotency, resignation | Career service tests | **Passed (Node)** |
| Employer-authorized termination and vacancy release | Career service test | **Passed (Node; internal operation only)** |
| Unpaid leave, promotion requirements, Stage 5 retirement and death closure/no future salary | Career/life tests | **Passed (Node)** |
| Schema v2-to-v3 migration without lifecycle-record loss | Persistence migration test | **Passed (Node)** |
| Authenticated multiplayer routing and private/public data separation | Two-client WebSocket test | **Passed (Node)** |
| Godot career panel import, static engine typing, visible UI, interactions and client reconnect | Godot unavailable | **Blocked / not run** |

Reproduce with `npm run check` and `npm run geography:check`. The full project verification table and exact GDScript caveat are maintained in [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md). GDScript formatter/parser validation does not replace Godot import/runtime checks.

## Stage 7 integration gates

Before treating employment pay as durable or valuable:

1. Connect `SalaryAccountPort` to the Stage 7 canonical Naira ledger and use `payment_id` as the ledger idempotency key inside an atomic ledger/account transaction.
2. Define account posting, payroll correction/reversal, failed-credit retry, debt/arrears, termination and deceased-recipient/estate rules without direct client balance writes.
3. Add authenticated employer identities/roles and authorized vacancy management before exposing employer actions over the network.
4. Decide how real professional credentials, applicable regulations, taxes, benefits, leave and privacy should be represented; do not present current fixtures as verified rules.
5. Migrate to a transactional database with tested backups/recovery and multi-writer controls before public deployment or valuable player state.
6. Complete Godot 4.7.2 import/runtime checks for the careers panel and the retained Stage 1–5 journeys; keep the Stage 5 verification limitation explicit until those checks pass.
