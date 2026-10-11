# Stage 28 Authority Model (D-04)

> **Stage 31 update.** The G-4, G-7, R-b, R-c, and R-f rows below have been partly decided and implemented. See
> `docs/STAGE_31_TREASURY_AUTHORITY.md`. `approve_budget`, `allocate_budget`, and `spend_budget` are now open behind
> server-side office authority. `record_revenue`, `record_expenditure`, `create_budget`, and every other write named
> below remain suspended. Each row's status column shows the Stage 31 position where it changed.

Status update (2026-10-11, authority mission): the rule-by-rule implementation and test map is in `docs/STAGE_29_REGIONAL_VISUAL_PROFILES_AUDIT.md` section 28. No rule below was changed by that work. Rows marked SUSPENDED stay suspended, because the owner decisions they depend on are still open.

Status update (Stage 30, hybrid governance foundation): the rows below marked "Stage 30" are implemented in the trusted service layer and tested. None of them re-opens a player route. Every government and election write is still refused at the engine, so no row marked SUSPENDED is enabled. The stage record is `docs/STAGE_30_GOVERNMENT_ELECTION_AUTHORITY.md`.

Status: DESIGN, minimal rule set, revisable. Most consequential mutations are SUSPENDED until these rules are implemented and each route has server-side checks and negative tests. Nothing here is a claim that the rules are implemented, except where a row says so.

Principles (apply to every family):
1. Authority comes only from trusted server state: the caller's own character, its appointment or service records, and the target record. Client-supplied role, office, rank, government, election, judge, station, or education fields are never authority.
2. A route that changes an office, a rank, a case, money, or a record must check the actor's authority over that specific target, not only that the actor exists.
3. An unexposed function is not proof of safety. A route that is exposed but unchecked is suspended, not "left for later".
4. Reads stay open where they do not reveal private data or change state.
5. Rules are data-light and reviewed. Any new rule needs a test that fails when the rule is removed.

## 1. Government

| Rule | Adopted minimal rule | Status |
|---|---|---|
| G-1 Initial officials | Seeded by server world initialisation only. No player route can create initial officials. | Seeding exists; initial seeding is not a player route. |
| G-2 Who appoints | An office is filled by (a) certified election transfer (`transfer_office` flow, server-side, one per certified result), or (b) an appointing official whose office is named as the appointing authority for that office in the government definition. Platform-level appointment is not a player action. | `appoint` and `remove_official` SUSPENDED (see STAGE_28_GOVERNMENT_AUTHORIZATION.md). Rule (b) needs the appointing-office table, which is a DECISION. Stage 30: `appointOfficial` refuses a suspended office (`government_office_suspended`). Authority is granted only by an effective appointment (resolver `authorizeGovernmentActor`). |
| G-3 Removal | Only the appointing office, or a certified election replacing the holder. | Suspended with G-2. Stage 30: an appointment ends at its term end (`appointment_ended`, idempotent). The holder loses authority at that point, and the resolver checks the term on every call, not only when the term is processed. A suspended office keeps its holder but confers no authority (`office_suspended`, reversible by `office_reinstated`). |
| G-4 Budgets, revenue, expenditure | Only the holder of the office that owns the budget (its ministry or government level) may create or record against it. Spending must not exceed the approved amount. A refused request changes no treasury. | Stage 31: `approve_budget`, `allocate_budget`, `spend_budget` are OPEN, scoped to the exact organisation by `office_permissions` and the server's authority check. Spending is capped by the allocated budget and the treasury balance, and is idempotent by request ID. `record_revenue`, `record_expenditure`, and `create_budget` remain SUSPENDED (revenue has no funding source; `create_budget` is a trusted seeding path). The owning-office table is partly decided: president and minister (catalogue, pending owner confirmation). The budget age rule (R-f) applies to approval only, at 25. |
| G-5 Projects | Proposed by any eligible citizen; approved and funded only by the owning office. A proposer cannot approve or fund their own project. | `create_project`, `update_project`, `fund_project` SUSPENDED. |
| G-6 Announcements | Only the holder of a communications or executive office. | `publish_announcement` SUSPENDED. |
| G-7 Public financial eligibility | An official holding a budget or fund authority must not hold a conflicting interest in the recipient (for example, an appointing official may not be the recipient). Checked server-side. | Stage 31: narrow rule implemented. A payment to the actor, or to a business the actor owns, is refused (`treasury_conflict_of_interest`). The broader definition of "conflicting interest" is still a DECISION. |
| G-8 Reads | `view_federal`, `view_state`, `view_local`, `search_projects`, `announcements`, `my_appointments` remain open. | Open. |

## 2. Elections

| Rule | Adopted minimal rule | Status |
|---|---|---|
| E-1 Election oversight | Election administration (scheduling, certification, publication) is performed by an electoral authority office, not by a candidate. | Election writes SUSPENDED. The electoral authority office is a DECISION (not yet in the model). |
| E-2 Self-certification | A candidate may not approve their own candidacy, certify, or publish their own election result. Checked against the candidate's character ID and the election record. | Stage 30: IMPLEMENTED in the service layer (`elections_self_approval_refused`, `elections_self_certification_refused`). A withdrawn candidate is still excluded. Tested in `election-authority.test.mjs` and `elections.test.mjs`. Election writes at the engine remain SUSPENDED. |
| E-3 Voting | One ballot per eligible voter per election; eligibility from the voter's own character record. | Suspended with the election writes. |
| E-4 Office transfer | Only from a certified result, once, with a link to the election. Preserves prior appointment history. | Stage 30: IMPLEMENTED in the service layer. A second `transferElectedOffice` for the same election is refused (`elections_office_already_transferred`) and changes no appointment. Engine election writes remain SUSPENDED. |

## 3. Justice (D-01, D-02, D-03)

| Rule | Adopted minimal rule | Status |
|---|---|---|
| J-1 Assignment | A judge is assigned to a court only through the trusted appointment path (appoint legal professional, then assign to court). No player route. | Trusted functions exist; no player route. |
| J-2 Judicial standing for a case | Active judge or magistrate appointment, assigned to the case's own court. | IMPLEMENTED (`isAssignedJudgeForCase`). Tested through the socket. Stage 30: a judge who is suspended or whose appointment ends loses standing at once. Refusals are `justice_case_not_found`, the same as a missing case (J-3). Tested on both backends in `judicial-authority.test.mjs`. |
| J-8 Judicial conflict | A judge who is a party to a case (filing party, respondent, or active participant) may not issue its judgment or schedule its hearing. | Stage 30: IMPLEMENTED (`justice_judge_conflicted`). DEFAULT: conflict covers case parties only. Wider conflicts, such as family or business ties, are an owner decision. |
| J-3 Case access | Parties (filing party, respondent, active participant) and assigned judges of the case's court may view. Everyone else gets `justice_case_not_found`. | IMPLEMENTED. Tested. Recorded in `docs/STAGE_28_CASE_ACCESS.md`. |
| J-4 Evidence | Parties may submit, only while the case is open to evidence (filed through in hearing). An assigned judge may not submit evidence in that capacity. Anyone else gets `justice_case_not_found`, the same as a missing case. | IMPLEMENTED. Tested. Corrected in the case-access slice: non-parties previously received `justice_not_case_party`, which revealed that the case exists. See `docs/STAGE_28_CASE_ACCESS.md`. |
| J-5 Appeal decision | Authorised, independently assigned judge of the appellate court; not the original judge; not a party; not conflicted. | SUSPENDED (`justice_appeal_decision_suspended`). Appellate assignment mechanism is not built. |
| J-6 Fine payment | Paid from the responsible character's own balance to the designated account, atomically, with a ledger entry. | SUSPENDED (`justice_fine_payment_suspended`). No atomic ledger link. |
| J-7 Criminal record | Only from a valid final judgment in a case, by an authorised justice process. | SUSPENDED (`crime_record_creation_suspended`). |

## 4. Military (D-04)

| Rule | Adopted minimal rule | Status |
|---|---|---|
| M-1 Recruitment intake | A citizen may apply for themselves. Eligibility (age, education) is read from the character record. A client value is ignored. | IMPLEMENTED for `apply_for_service` (education from server state). Tested. |
| M-2 Enlistment | An approved application is enlisted by a recruiting officer of the branch, not by the applicant. | `enlist` SUSPENDED (`military_enlistment_suspended`). Recruiting-officer role not modelled. |
| M-3 Training | Enrolment and completion by the commander of the training organisation, for a service member in that organisation. | `enroll_training`, `complete_training` SUSPENDED. |
| M-4 Promotion | Only a commanding officer of the member's unit, with rank senior to the new rank, and within the branch's promotion rules. | `promote` SUSPENDED. |
| M-5 Command appointment | Only a senior command appointee of the organisation, never by the appointee. Rank does not confer command (separate records). | `create_appointment` SUSPENDED. |
| M-6 Assignment | Only the commander of the receiving unit or base, for a member under that command. | `assign` SUSPENDED. |
| M-7 Discharge | Not implemented as a route. | No route. |
| M-8 Reads | `military_profile`, `list_branches`, `list_training`, `rank_history`, `service_profile` remain open. | Open. |

## 5. Police (D-04)

| Rule | Adopted minimal rule | Status |
|---|---|---|
| P-1 Recruitment intake | Citizen applies for themselves; education from server state. | IMPLEMENTED for `apply_recruitment` (education from server state). Tested. |
| P-2 Officer appointment | Only a station commander of the station, for an eligible applicant. `enrollOfficer` has no player route. | No player route. |
| P-3 Arrest | Only an officer of the arresting station, with a recorded legal basis that names an incident or warrant that exists and is attributable to the target. Free text is not a legal basis. | `execute_arrest` SUSPENDED (`police_arrest_suspended`). |
| P-4 Misconduct complaints | Any citizen may file against an existing officer. | Open (self-service; accused officer must exist). |
| P-5 Reads | `police_profile`, `list_stations`, `list_incidents` remain open. | Open. |

## 6. Crime links

| Rule | Adopted minimal rule | Status |
|---|---|---|
| C-1 Linking an incident to a police record | Only a police officer with authority over the incident's station. | `link_to_police` SUSPENDED (`crime_link_suspended`). |
| C-2 Linking an incident to a justice case | Only a party to the case with standing over the incident, or the court's own process. Never a player-supplied case ID alone. | `link_to_justice` SUSPENDED (`crime_link_suspended`). |

## Permanent rules R-a to R-f (from STAGE_28_GOVERNMENT_AUTHORIZATION.md)

| Rule | Question | Status after Stage 30 |
|---|---|---|
| R-a Who may appoint, and to which offices | Appointing authority per office | NOT DECIDED. Only the trusted appointment path fills offices. A suspended office cannot be filled. No appointing-office table exists. |
| R-b Which offices control budgets, projects, and announcements | Owning-office table | Stage 31: budgets, by catalogue `office_permissions` (president and minister, pending owner confirmation). Projects and announcements stay SUSPENDED. |
| R-c Hierarchy | May a federal office act for a ministry, state, or locality? | DEFAULT: exact organisation scope only (kept). Stage 31: the seed places each office only where it reliably fits (president, vice-president, one minister per ministry, electoral commissioner). State and local offices are not seeded, because no state or local organisation exists. Legacy placements grant nothing. |
| R-d Election authority | Who administers an election | NOT DECIDED. E-1 open. Stage 30 adds no electoral authority office. |
| R-e Self-dealing | May a candidate approve or certify their own election? | DEFAULT, not an owner decision: no, under the adopted minimal rule E-2. Implemented in the service layer. The owner must confirm it. |
| R-f Age for budgets | Minimum age for budget authority | Stage 31: 25 for budget APPROVAL only (`budget_approval_minimum_age_years`), from the mission rule. Not applied to allocation or spending. Owner confirmation needed. |

## Open decisions (need the user)

1. G-2 / R-a: the appointing-office table (which office appoints which office), and the succession rule when an office falls vacant.
2. G-7: the definition of a conflicting interest for public financial decisions.
3. E-1 / R-d: whether an electoral authority office exists in the model, and who holds it.
4. M-2 / M-4 / M-6: whether recruiting, commanding, and unit roles are modelled as offices, or as service-record fields.
5. P-2 / P-3: station command and the legal-basis record format.
6. R-c: whether a federal office may act for a ministry, state, or locality. The current default is exact scope. The seed data's placement of every office in `gov:federal` must also be corrected (or confirmed) before any state or local office can grant authority.
7. J-8: whether judicial conflict covers more than case parties (family, business, or prior advocacy).
8. R-b / R-f: the budget owner table and the budget age rule.

Until these are answered, the suspended rows stay suspended. The implemented rows are the only player-reachable consequential mutations that the rules above allow. Stage 30 implemented rows are service-layer rules. Player routes that call them remain suspended.
