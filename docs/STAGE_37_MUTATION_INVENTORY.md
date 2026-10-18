# Stage 37: Per-Operation Mutation Inventory

This inventory lists every changing (state-mutating) socket operation in the consequential families, and the families that
already have their own containment. Read-only operations are listed only where they share a handler with a changing one.
It was built from the code in `services/world-api/src/multiplayer/world-engine.ts` and the family services. It is a
reading of the code, with test evidence noted per row. It is not a proof.

## The eleven fields

1. **Operation**: the socket message type and `action` (or the message type alone).
2. **Family**: government, election, justice, police, military, crime, relationship/family, character, or the money families.
3. **Handler**: the engine function, and the family service function it calls.
4. **Server-side authority**: the check the server makes before the change. "None" means the code makes none.
5. **Request-ID gate**: whether the request needs a request ID and is deduplicated, through `IDEMPOTENT_COMMANDS` or
   `consequentialFamilyOf` (Stage 37).
6. **Authoritative state**: the saved maps the operation changes.
7. **Reply order**: whether the success reply is sent before or after the save.
8. **Failure outcome**: what the client is told when the save fails (`*_not_saved`, `*_outcome_unknown`, or
   `*_persistence_unavailable`).
9. **Replay record**: where the request is recorded (memory, `recentRequestRecords`, or the durable `world_operations` row).
10. **Reversible**: whether the change can be undone by another operation. "No" means it is a permanent record.
11. **Status and evidence**: Protected, Suspended, Incomplete, or Not audited, with the test that proves it.

Evidence labels: **[T]** verified by a test that fails on the pre-Stage-37 engine, **[C]** verified by a code reading only,
**[U]** unverified.

## Summary by status

| Status | Count | Meaning |
|---|---|---|
| Protected (server check, gate, and save-before-reply) | J3, M2, R1, H1 (test-backed); other gated rows are [C] | The write is authorised server-side, deduplicated, and replies after the save. |
| Suspended, new in Stage 37 | 7 (M4, M5, M6, C4, C5, C6, P7) | Refused before any parsing, with a stable code. No state is changed. |
| Suspended, existing | rows J7, J8, P8, M3, C7, G2, E1, X4 (`pay_rent`) | Suspended before Stage 37. Listed for completeness. |
| Incomplete | 3 (P3, P4, C1) | The operation runs, but a server authority check is missing. Documented, not fixed. |
| Not audited in Stage 37 | see the last section | Outside this stage's families, or covered by an earlier stage. |

## Government

| # | Operation | Handler / service | Authority | Gate | State | Reply order | Failure | Replay | Reversible | Status and evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| G1 | `government.action` `approve_budget`, `allocate_budget`, `spend_budget` | `governmentAction` / government service | Treasury authority, office, jurisdiction, budget ceilings, self-dealing and conflict checks (Stages 31–34) | `markRequestProcessed`; `changeGeneration`; `ensureDurable` | treasury accounts, budgets, ledger | after save (`government.result` after `ensureDurable`) [C] | `government_not_saved` / outcome unknown [C] | memory `recentRequestIds` (no fingerprint for this family) [C] | No | Protected by Stages 31–34 safeguards. Not re-audited here. Existing treasury tests. |
| G2 | any other `government.action` write (e.g. `create_budget`) | `governmentAction` | none reached | refused before parsing | none | n/a | `government_writes_suspended` [T] | n/a | n/a | Suspended. `mutation-resend-guards` test 3 [T]. |

## Elections

| # | Operation | Handler / service | Authority | Gate | State | Reply order | Failure | Replay | Reversible | Status and evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| E1 | any non-read `election.action` | `electionAction` | none reached | refused before parsing | none | n/a | `election_writes_suspended` [C] | n/a | n/a | Suspended. Code read [C]; existing election tests. |

## Justice

| # | Operation | Handler / service | Authority | Gate | State | Reply order | Failure | Replay | Reversible | Status and evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| J1 | `justice.action` `create_proposal` | `justiceAction` / `createLegislativeProposal` | sponsor is the caller; age; not deceased [C] | Stage 37 gate (request ID, fingerprint, `world_operations`) | `legislativeProposals` | after save [T for file_case; C here] | `justice_not_saved` / `justice_outcome_unknown` / `justice_persistence_unavailable` | memory and `world_operations` | No | Incomplete test coverage: gate and reply order by code only [C]. |
| J2 | `justice.action` `submit_proposal` | `justiceAction` / `submitProposal` | sponsor only [C] | as J1 | proposal status | after save [C] | as J1 | as J1 | No | Code read [C]; no socket test. |
| J3 | `justice.action` `file_case` | `justiceAction` / `fileCase` | court active; category permitted; jurisdiction [C] | as J1 | `cases` | after save [T] | as J1 | as J1 | No | **Protected** [T]: `consequential-families-stage37` tests 3 and 4 (both backends); cross-process race (PG) [T]; `mutation-resend-guards` (one case) [T]. |
| J4 | `justice.action` `submit_evidence` | `justiceAction` / `submitEvidence` | party or assigned judge; judge refused; status open; evidence limit [C] | as J1 | `evidence`, case | after save [C] | as J1 | as J1 | No | Code read [C]; no socket test. |
| J5 | `justice.action` `issue_judgment` | `justiceAction` / `issueJudgment` | assigned judge only; not a party; status awaiting judgment [C] | as J1 | `judgments`, case status | after save [C] | as J1 | as J1 | No | Code read [C]; existing service tests (`judicial-authority`). |
| J6 | `justice.action` `file_appeal` | `justiceAction` / `fileAppeal` | judgment eligible; appellant is a party; appellate court [C] | as J1 | `appeals` | after save [C] | as J1 | as J1 | No | Code read [C]; no socket test. |
| J7 | `justice.action` `decide_appeal` | `justiceAction` | none reached | refused before parsing | none | n/a | `justice_appeal_decision_suspended` [C] | n/a | n/a | Suspended (existing). |
| J8 | `justice.action` `pay_fine` | `justiceAction` | none reached | refused before parsing | none | n/a | `justice_fine_payment_suspended` [C] | n/a | n/a | Suspended (existing; fines are not enabled). |

## Police

| # | Operation | Handler / service | Authority | Gate | State | Reply order | Failure | Replay | Reversible | Status and evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | `police.action` `apply_recruitment` | `policeAction` | applicant is the caller [U] | as J1 | recruitment records | after save [C] | as J1 | as J1 | No | Gated. Authority [U]. |
| P2 | `police.action` `submit_incident` | `policeAction` / police service | caller is an active officer (`getOfficerByCharacter`) [C] | as J1 | `policeIncidents` | after save [C] | as J1 | as J1 | No | Gated. Officer check [C]; station not checked [U]. |
| P3 | `police.action` `dispatch_unit` | `policeAction` / police service | caller is an officer; **station not checked** [C] | as J1 | `policeUnits` | after save [C] | as J1 | as J1 | Partly | **Incomplete**: no station authority. Documented gap, not fixed. |
| P4 | `police.action` `open_investigation` | `policeAction` / police service | caller is an officer; **station not checked** [C] | as J1 | `policeInvestigations` | after save [C] | as J1 | as J1 | No | **Incomplete**: as P3. |
| P5 | `police.action` `submit_evidence` | `policeAction` | [U] | as J1 | `policeEvidence` | after save [C] | as J1 | as J1 | No | Gated. Authority [U]. |
| P6 | `police.action` `file_complaint` | `policeAction` | [U] | as J1 | complaints | after save [C] | as J1 | as J1 | No | Gated. Existing test in `police.test`. |
| P7 | `police.action` `request_wanted` | `policeAction` / `requestWantedRecord` | **none** (officer existence only) | refused before parsing (Stage 37) | `wantedRecords` | n/a | `police_wanted_request_suspended` [T] | n/a | No | **Suspended** [T]: consequential suspended test (both backends). Duplicate `requested` records were possible before. |
| P8 | `police.action` `execute_arrest` | `policeAction` | none reached | refused before parsing | none | n/a | `police_arrest_suspended` [C] | n/a | n/a | Suspended (existing). |

## Military

| # | Operation | Handler / service | Authority | Gate | State | Reply order | Failure | Replay | Reversible | Status and evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 | `military.action` `apply_for_service` | `militaryAction` | applicant is the caller [C] | as J1 | `militaryServiceRecords` | after save [C] | as J1 | as J1 | No | Gated. |
| M2 | `military.action` `request_leave` | `militaryAction` / `requestLeave` | **caller must own the service record** (Stage 37) [T] | as J1 | `militaryLeaveRecords` | after save [C] | as J1 | as J1 | No | **Protected** [T]: consequential test "another character's service record" (both backends). Before Stage 37 there was no ownership check. |
| M3 | `military.action` `enlist`, `enroll_training`, `complete_training`, `promote`, `create_appointment`, `assign` | `militaryAction` | none reached | refused before parsing | none | n/a | `military_*_suspended` [C] | n/a | n/a | Suspended (existing). |
| M4 | `military.action` `create_asset` | `militaryAction` / `createAsset` | **none** (caller recorded as authority) | refused before parsing (Stage 37) | `militaryAssets` | n/a | `military_asset_creation_suspended` [T] | n/a | No | **Suspended** [T]. |
| M5 | `military.action` `create_security_event` | `militaryAction` | **none** (caller recorded as `authorizing_authority`) | refused before parsing (Stage 37) | security event records | n/a | `military_security_event_suspended` [T] | n/a | No | **Suspended** [T]. |
| M6 | `military.action` `file_disciplinary_case` | `militaryAction` | **none** (caller recorded as `reviewing_authority`) | refused before parsing (Stage 37) | `militaryDisciplinaryRecords` | n/a | `military_disciplinary_suspended` [T] | n/a | No | **Suspended** [T]. |

## Crime

| # | Operation | Handler / service | Authority | Gate | State | Reply order | Failure | Replay | Reversible | Status and evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | `crime.action` `commit_crime` | `crimeAction` / crime service | victim IDs come from the payload; **no authority or existence check** [C] | as J1 | `crimeIncidents`, participations | after save [C] | as J1 | as J1 | No | **Incomplete**: unresolved risk. Gated, but victims are not checked. |
| C2 | `crime.action` `report_crime` | `crimeAction` | reporter is the caller [U] | as J1 | `crimeReports` | after save [C] | as J1 | as J1 | No | Gated. Authority [U]. |
| C3 | `crime.action` `start_rehabilitation` | `crimeAction` | [U] | as J1 | `crimeRehabilitation` | after save [C] | as J1 | as J1 | No | Gated. Authority [U]. |
| C4 | `crime.action` `transition_incident` | `crimeAction` / `transitionIncident` | **none** [C] | refused before parsing (Stage 37) | `crimeIncidents` status | n/a | `crime_incident_transition_suspended` [T] | n/a | No | **Suspended** [T]. |
| C5 | `crime.action` `add_evidence` | `crimeAction` / `addEvidence` | **none** [C] | refused before parsing (Stage 37) | `crimeEvidence` | n/a | `crime_evidence_suspended` [T] | n/a | No | **Suspended** [T]. |
| C6 | `crime.action` `create_restitution` | `crimeAction` / `createRestitution` | **none**: any `debtor_character_id` [C] | refused before parsing (Stage 37) | `crimeRestitution` (debt) | n/a | `crime_restitution_suspended` [T] | n/a | No | **Suspended** [T]. |
| C7 | `crime.action` `create_criminal_record`, `link_to_justice`, `link_to_police` | `crimeAction` | none reached | refused before parsing | none | n/a | `crime_record_creation_suspended`, `crime_link_suspended` [C] | n/a | n/a | Suspended (existing). |

## Relationship and family

| # | Operation | Handler / service | Authority | Gate | State | Reply order | Failure | Replay | Reversible | Status and evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | `relationship.progress` | `progressRelationship` / `proposeRelationship` | two-party confirmation; target connected and nearby; adults or friendship age gap; no close-family romance; stage order [C] | `IDEMPOTENT_COMMANDS` (request ID, fingerprint, `world_operations`) | relationships, events | **after save**, reply and partner notice (Stage 37) [T] | `relationship_not_saved` / `relationship_outcome_unknown` (type `relationship.error`) [T] | memory and `world_operations` | Bounded: `world_operations` keeps records 90 days (Stage 36); the memory window is 256 entries | **Protected** [T] for the friendship proposal: `consequential-families-stage37` test 6 (both backends). Mutual-confirmation rules in `life.test` [C]. |
| R2 | `family.childbirth` | `recordChildbirth` / `createChildForMarriage` | caller is a spouse in an active marriage [C] | `IDEMPOTENT_COMMANDS` | people, household, relationships | **after save**, parent reply and spouse notices (Stage 37) [C] | `family_not_saved` / `family_outcome_unknown` [C] | memory and `world_operations` | No | **Gated and reply order changed; socket test not written** (a seeded marriage is needed). Service rules in `life.test` [C]. |

## Character

| # | Operation | Handler / service | Authority | Gate | State | Reply order | Failure | Replay | Reversible | Status and evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| H1 | `character.rest` | `rest` | must be at home, in range | `IDEMPOTENT_COMMANDS` plus the Stage 37 persistence gate | energy, hunger, health | **after save** (Stage 37; it was before) [T] | `rest_not_saved` / `rest_outcome_unknown` / `rest_persistence_unavailable` [T] | memory and `world_operations` | Not needed (restores vitals; applied once) | **Protected** [T]: the rest tests in `consequential-families-stage37` (file and PostgreSQL) and the Stage 37 cross-process rest test (PostgreSQL). |

## Money families (earlier stages, not changed in Stage 37)

| # | Operation | Status |
|---|---|---|
| X1 | `shop.purchase`, `world.bus`, `clinic.care` | Protected by Stage 34 (`chargeAndConfirm`, `financialWritesOpen`). Not changed. |
| X2 | `world.travel`, `inventory.consume`, `school.answer` | Idempotent (`IDEMPOTENT_COMMANDS`). Not changed. |
| X3 | `economy.action`, `business.action`, `education.action`, `career.action` | Protected by Stages 34–36 (`confirmMoneyReply`). Not changed. |
| X4 | `property.action` (`purchase`, `sell`, and others); `pay_rent` suspended | Protected by Stage 35 (`propertyAction` gate). `pay_rent` suspended. Not changed. |

## Not audited in Stage 37

`culture.action`, `entertainment.action`, `chat.send`, `geography.enter`, `geography.leave`, and NPC or life simulation
ticks are outside the families in this stage. Their changing actions have not been audited here, and they are not
evidenced by this inventory.
