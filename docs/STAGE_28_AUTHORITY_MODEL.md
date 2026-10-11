# Stage 28 Authority Model (D-04)

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
| G-2 Who appoints | An office is filled by (a) certified election transfer (`transfer_office` flow, server-side, one per certified result), or (b) an appointing official whose office is named as the appointing authority for that office in the government definition. Platform-level appointment is not a player action. | `appoint` and `remove_official` SUSPENDED (see STAGE_28_GOVERNMENT_AUTHORIZATION.md). Rule (b) needs the appointing-office table, which is a DECISION. |
| G-3 Removal | Only the appointing office, or a certified election replacing the holder. | Suspended with G-2. |
| G-4 Budgets, revenue, expenditure | Only the holder of the office that owns the budget (its ministry or government level) may create or record against it. Spending must not exceed the approved amount. A refused request changes no treasury. | `create_budget`, `record_revenue`, `record_expenditure` SUSPENDED. |
| G-5 Projects | Proposed by any eligible citizen; approved and funded only by the owning office. A proposer cannot approve or fund their own project. | `create_project`, `update_project`, `fund_project` SUSPENDED. |
| G-6 Announcements | Only the holder of a communications or executive office. | `publish_announcement` SUSPENDED. |
| G-7 Public financial eligibility | An official holding a budget or fund authority must not hold a conflicting interest in the recipient (for example, an appointing official may not be the recipient). Checked server-side. | Not implemented. DECISION: definition of "conflicting interest". |
| G-8 Reads | `view_federal`, `view_state`, `view_local`, `search_projects`, `announcements`, `my_appointments` remain open. | Open. |

## 2. Elections

| Rule | Adopted minimal rule | Status |
|---|---|---|
| E-1 Election oversight | Election administration (scheduling, certification, publication) is performed by an electoral authority office, not by a candidate. | Election writes SUSPENDED. The electoral authority office is a DECISION (not yet in the model). |
| E-2 Self-certification | A candidate may not approve their own candidacy, certify, or publish their own election result. Checked against the candidate's character ID and the election record. | Not implemented; writes suspended. |
| E-3 Voting | One ballot per eligible voter per election; eligibility from the voter's own character record. | Suspended with the election writes. |
| E-4 Office transfer | Only from a certified result, once, with a link to the election. Preserves prior appointment history. | Suspended. |

## 3. Justice (D-01, D-02, D-03)

| Rule | Adopted minimal rule | Status |
|---|---|---|
| J-1 Assignment | A judge is assigned to a court only through the trusted appointment path (appoint legal professional, then assign to court). No player route. | Trusted functions exist; no player route. |
| J-2 Judicial standing for a case | Active judge or magistrate appointment, assigned to the case's own court. | IMPLEMENTED (`isAssignedJudgeForCase`). Tested through the socket. |
| J-3 Case access | Parties (filing party, respondent, active participant) and assigned judges of the case's court may view. Everyone else gets `justice_case_not_found`. | IMPLEMENTED. Tested. |
| J-4 Evidence | Parties may submit. An assigned judge may not submit evidence in that capacity. Non-parties may not submit. | IMPLEMENTED. Tested. |
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

## Open decisions (need the user)

1. G-2: the appointing-office table (which office appoints which office).
2. G-7: the definition of a conflicting interest for public financial decisions.
3. E-1: whether an electoral authority office exists in the model, and who holds it.
4. M-2 / M-4 / M-6: whether recruiting, commanding, and unit roles are modelled as offices, or as service-record fields.
5. P-2 / P-3: station command and the legal-basis record format.

Until these are answered, the suspended rows stay suspended. The implemented rows are the only player-reachable consequential mutations that the rules above allow.
