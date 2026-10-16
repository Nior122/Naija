# Stage 28: Case Access (Slice 1)

Status: IMPLEMENTED and tested in the file-backed and disposable PostgreSQL suites. Stage 28 remains OPEN and
production remains NOT READY. This record covers only `view_case` and `submit_evidence`.

## 1. Confirmed policy

Confirmed by the project owner. Not to be re-asked.

- **Who may view a case** (subject to valid authorization and case status):
  the filing party, the respondent, legitimate active participants recorded in trusted server-side case data, and the
  judge assigned to that case when the assignment and authority are valid.
- **Who may not access a private case:** unrelated players, judges not assigned to that case, and anyone whose
  participation or authority cannot be verified from trusted server records.
- **Who may submit evidence:** the filing party, the respondent, and legitimate active participants, only when the
  case status and applicable rules permit it.
- **Judges:** the assigned judge may view but must not submit evidence while acting as judge in that case. Other
  judges and unrelated players must not submit evidence.
- **Security:** the caller is identified from the authenticated server-side session. Participation and judge
  assignment are resolved from trusted server records. Client-supplied role, judge ID, participant ID, or authority
  fields are never trusted. Refusals must not mutate case data or world state. Unauthorized access and nonexistent
  cases must produce indistinguishable responses.

## 2. Behaviour before this slice (audited)

| Actor, request | Before | Problem |
|---|---|---|
| Party, `view_case` | Case returned. | None. |
| Assigned judge of the case's court, `view_case` | Case returned. | None. |
| Stranger, `view_case` on a real case | `justice_case_not_found` | None. Same as a missing case. |
| Stranger, `submit_evidence` on a real case | `justice_not_case_party` | **Leak.** A missing case gives `justice_case_not_found`, so a player could tell which case IDs exist. |
| Assigned judge, `submit_evidence` | `justice_judge_cannot_submit_evidence` | None. |
| Any party, `submit_evidence` in any status | Accepted. No status check. | **Gap.** Evidence could be added after judgment, on a closed case, or after dismissal. |

Refusals already changed nothing: the checks throw before any write, and the engine marks a request as processed only
on success. Caller identity came from the server-side player record. No client field was read for authority.

The police `submit_evidence` route writes to a separate police evidence store keyed by incident. It cannot add
evidence to a justice case. No player route reaches `assignJudgeToCourt` or `appointLegalProfessional`.

## 3. Implemented behaviour

Implemented in `services/world-api/src/justice/service.ts`:

- `submitEvidence` resolves two facts from server state: whether the caller is the assigned judge of the case's court
  (`isAssignedJudgeForCase`) and whether the caller is a party (`isCaseParty`).
- A caller who is neither a party nor the assigned judge gets `justice_case_not_found`, the same as a missing case.
- An assigned judge gets `justice_judge_cannot_submit_evidence`. This is checked before party standing, so a judge who
  is also a listed participant is refused.
- A party's evidence is accepted only when the case status is in `EVIDENCE_OPEN_CASE_STATUSES`.
- The new refusal `justice_case_not_open_for_evidence` has the message "This case is no longer taking evidence."

Resulting responses:

| Caller | `view_case` | `submit_evidence` |
|---|---|---|
| Party (filer, respondent, active participant) | Case returned | Accepted in open statuses. `justice_case_not_open_for_evidence` in closed statuses. |
| Assigned, active judge of the case's court | Case returned | `justice_judge_cannot_submit_evidence` |
| Judge not assigned to the case | `justice_case_not_found` | `justice_case_not_found` |
| Judge listed as assigned but without an active authority record | `justice_case_not_found` | `justice_case_not_found` |
| Unrelated player, or withdrawn participant | `justice_case_not_found` | `justice_case_not_found` |
| Nonexistent case ID | `justice_case_not_found` | `justice_case_not_found` |

### 3.1 Assumptions for review

These are implementation choices. The confirmed policy did not name them. They are listed here so that they can be
checked, and they are not presented as confirmed rules.

- **Statuses open to evidence:** `submitted`, `accepted`, `awaiting_response`, `pretrial`, `awaiting_hearing`,
  `in_hearing`. Evidence closes when a case reaches `awaiting_judgment`. A case that has been judged, appealed,
  settled, withdrawn, dismissed, rejected, or closed is closed to evidence. `submitted` is included so that a filing
  can carry evidence before the court accepts it.
- **Viewing is not restricted by status.** The confirmed policy says viewing is "subject to case status", but it did
  not name any status that hides a case from its parties. Nothing in the current code hides a case from its parties
  by status. This needs confirmation.

## 4. Documentation correction

`STAGE_28_AUTHORITY_MODEL.md` row J-4 and the header comment of `justice-finance-containment.test.mjs` previously
stated that non-parties were refused with `justice_not_case_party`. That was the leak described in section 2. Both are
corrected.

## 5. Tests

- `test/justice-case-access.test.mjs` (7 tests, run on the file backend and on the disposable PostgreSQL backend, so 14 test executions): authorized view and
  judge evidence refusal; a party may still submit; a wrong-court or suspended judge and a made-up ID get the same
  refusal with no case data; an unrelated player gets the missing-case refusal for view and evidence, with no change
  to case, evidence, participant, hearing, audit, or player record; an unassigned judge and a judge with an
  assignment but no authority record are refused as missing; an assigned judge who is also a participant is refused
  evidence; the status matrix (every open status accepted, every closed status refused with no state change);
  client-supplied authority fields (`character_id`, `submitted_by_character_id`, `judge_character_id`, `role`,
  `is_judge`, `party`, `assigned_judge_character_id`, `court_id`) are ignored.
- `test/justice-finance-containment.test.mjs`: the submit-evidence test now runs on a case open to evidence, so its
  positive control does not depend on the status rule. Its refusals now assert the missing-case response and the same
  message as a made-up case.
- `test/justice.test.mjs`: the unit-level evidence test is unchanged and still passes.

Mutation checks were run on the compiled output and restored byte-identical afterwards:

| Mutation | Result |
|---|---|
| Restore `justice_not_case_party` for non-parties | 4 tests fail |
| Remove the status check | 1 test fails |
| Remove the judge refusal | 3 tests fail |

## 6. Not in this slice

- Appeal decisions, fine payments, conviction creation, and the other suspended mutations remain suspended. This slice
  does not change them.
- There is still no player route to add a case participant. Participants can be written only through trusted code.
- `my_cases` lists only cases where the caller is a party. An assigned judge can view a case by ID but does not see it
  in that list.
- Refused authenticated requests still refresh the in-memory activity markers (`lastSeen` and
  `session.lastActivityAt`), as existing behaviour. This is not a case or world-state change.
- Godot is not involved in this slice.
