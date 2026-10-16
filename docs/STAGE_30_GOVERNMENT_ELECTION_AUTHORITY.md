# Stage 30: Government, Election, and Judicial Authority Foundation

> **Stage 31 update.** The budget and treasury rows of sections 1 and 9, and section 10, are superseded. Stage 31
> implements treasury ownership: three treasury routes are open behind the resolver and the office permission table, and
> everything else that moves money stays suspended. The seed placement and the hierarchy rule also changed. See
> `docs/STAGE_31_TREASURY_AUTHORITY.md`. The sections below are kept as the record of Stage 30.

Date: 2026-10-11. Branch: `arena/00cdea0e-naija`. Starts from `51fab81`.

Status: **FOUNDATION ONLY.** This stage establishes the office-authority model, the appointment and term rules, the
election self-dealing and single-transfer rules, and the judicial conflict and standing rules, in the trusted service
layer, with tests. It does not open any government or election route. Every government and election write is still
refused at the engine (`government_writes_suspended`, `election_writes_suspended`). Nothing in this stage makes an
election legally valid, and nothing changes money.

It is the next stage after Stage 28 (`docs/STAGE_28_AUTHORITY_MODEL.md`). It does not complete Stage 29, and it does not
run the regional-profile generator or resolve the Kaduna classification or the lighting-ownership decisions.

## 1. Scope against the priority order

| Priority | Area | Delivered in this stage | Not delivered (and why) |
|---|---|---|---|
| 1 | Authority and office records | Pure office-authority resolver (`src/government/authority.ts`). Optional office `status` (`active` / `suspended`) with validation. Undefined or null means active, so legacy records need no migration. | Relational government tables. Not needed: state stays in the existing JSON state. |
| 2 | Appointment and succession foundations | `appointOfficial` refuses suspended offices. Term expiry is processed on identity resume and checked on every authority call. `expireElapsedTerms` is idempotent. `setGovernmentOfficeStatus` is a trusted function with no route. | Succession rules (no owner rule). Player appointment routes (suspended, R-a). |
| 3 | Budget and treasury ownership | Nothing changed in Stage 30. (Stage 31: see `STAGE_31_TREASURY_AUTHORITY.md`. Approval, allocation, and spending are open behind server authority; revenue and `create_budget` stay suspended.) | Funding source for treasuries. Payment credit to economy accounts. Owner confirmation of R-b and R-f. |
| 4 | Election bodies, elections, candidates, results | E-2: no self-approval, self-certification, or self-publication (`elections_self_approval_refused`, `elections_self_certification_refused`). E-4: one transfer per election (`elections_office_already_transferred`). | Electoral authority office (E-1 / R-d). Any route. Election validity: the process is not implemented end-to-end, so no election is legally valid yet. |
| 5 | Court, appeal, enforcement checks | J-2 standing ends with the appointment. J-8 party conflict (`justice_judge_conflicted`). Judges cannot submit evidence in their own case (J-4, existing). Standing refusals are indistinguishable from a missing case. | Appeal assignment (J-5, suspended). Enforcement and arrest (P-3, suspended). Fines (J-6, suspended). |

## 2. Authority model (what the resolver decides)

`authorizeGovernmentActor` and `effectiveOfficeGrants` in `src/government/authority.ts` answer one question from
persisted server state: does this character hold an effective office authority over this organisation on this world
date?

An appointment is effective only when all of these hold:

- its status is `active`;
- its start is not in the future, and its term has not ended on the world date;
- its office exists, is not suspended, and is not contested;
- its organisation exists and is active;
- its holder exists and is not deceased;
- its office's level matches the organisation's level (otherwise `office_level_mismatch`, and no authority).

Scope is exact. An office authorises only its own organisation. Refusal codes are `government_authority_none` and
`government_authority_scope`. Per-action permission (which office may take which action) is R-b, which is not decided.
So the resolver is necessary for any future action, but it is not a permission on its own. A role name alone grants
nothing. Client-supplied office, role, organisation, or character fields are never read.

Covered by `test/government-authority.test.mjs` (15 tests): effective grant, exact scope, citizen with no authority,
term end, future term, future start, removal, expiry idempotency, suspension and reinstatement, contested office,
deceased and missing holders, inactive organisation, level mismatch, cross-state refusal, duplicate-fill refusal, office
status validation, and a save-and-reload check on both file and PostgreSQL backends through the socket harness.

## 3. Elections (E-2 and E-4)

- `approveCandidate`: a candidate cannot approve their own candidacy.
- `certifyElectionResult` and `publishElectionResult`: a candidate in that election, including one who withdrew, cannot
  certify or publish it (`isCandidateInElection`).
- `transferElectedOffice`: once per election. A second transfer changes no appointment.

These are service-layer rules. The engine still refuses election writes. `test/election-authority.test.mjs` (4 tests)
checks each refusal and a positive control. `test/elections.test.mjs` fixtures now use a separate citizen as the
candidate, and an administrator who approves and certifies. This is the E-2 rule applied to the fixtures, not a
weakening of the rule. A refused certification or publication leaves the result `preliminary` and transfers no office.

Not decided: who administers an election (E-1 / R-d). The service accepts any caller that the route layer passes in,
so the route layer must not expose these functions until E-1 is decided.

## 4. Judiciary (J-2, J-4, J-8)

- Standing (`isAssignedJudgeForCase`, unchanged rule, now enforced in `issueJudgment` and `scheduleHearing`): an active
  judge or magistrate appointment, to the case's own court, with the court's assignment present.
- Behaviour change: an unassigned, suspended, or other-court judge, or a judge whose appointment has ended, receives
  `justice_case_not_found`. Before this stage, `issueJudgment` returned `justice_judge_not_assigned`, which revealed that
  the case existed. Existing tests that expected the old code were updated.
- Conflict (J-8, default): a case party (filing party, respondent, or active participant) cannot issue the judgment or
  schedule the hearing (`justice_judge_conflicted`). Wider conflicts are an owner decision.
- Evidence (J-4, existing): an assigned judge who is also a party is refused evidence, because the judicial role is not
  a party role.

Judicial mutation check (run this stage, file backend, `test/judicial-authority.test.mjs`, `justice.test.mjs`,
`justice-finance-containment.test.mjs`, `justice-case-access.test.mjs`, `justice-filing.test.mjs`). Each mutation was
applied to `src/justice/service.ts`, rebuilt, and tested. The file was restored and its SHA-256 checked afterwards.

| Mutation | Result |
|---|---|
| M-J1: remove the party-conflict check from `issueJudgment` | 1 test fails (`judgment refusals`). Detected. |
| M-J2: revert standing to the list-only check | 2 tests fail (`judgment refusals`, `authority ends with the appointment`). Detected. |
| M-J3: remove the judge evidence refusal | 3 tests fail (`may view but may not submit evidence`, `active participant`, `client-supplied fields ignored`). Detected. |
| M-J4: remove the active-appointment requirement | 3 tests fail (`judgment refusals`, `authority ends`, `another court or suspended`). Detected. |

## 5. Persistence

No migration was added. Government and election state remains validated JSON: the file store, and `world_state.value`
for PostgreSQL. The new office `status` field is optional. Records written before this stage load unchanged. They are
not rewritten. An earlier attempt to normalise the field to `null` rewrote legacy records and broke 31 validation
tests, so the validator uses a non-rewriting invariant. Do not change this to a nullable normaliser.

Migrations are forward only and non-destructive. None was needed in this stage.

## 6. Defects found and fixed in this stage

- Judicial: `issueJudgment` revealed a case's existence to a non-party stranger (`justice_judge_not_assigned`). Fixed
  (`justice_case_not_found`).
- Judicial: a judge suspended after assignment kept the ability to rule because the check was list-only. Fixed.
- Elections: a candidate could approve, certify, and publish their own result, and could transfer office more than
  once. Fixed (E-2, E-4).
- Not a pre-existing defect, but a new rule: suspension (`status`) and term-end authority were added in this stage.
  Neither existed before, so no existing record needed a fix.
- Government: the seed data places every office, including state and local definitions, in `gov:federal`. The resolver
  grants nothing for those offices. The placement is recorded as an owner decision (R-c). It was not changed here.
- Government: a reported exploit, where a 16-year-old with no office sends `create_budget`, is still refused, and is
  covered by a regression test on both backends.

## 7. Security and residual risks

- Authority is server-derived. No client-supplied role, office, or character field grants anything (tested with
  fabricated fields on both backends).
- Engine writes stay suspended. Stage 30 adds no route. The rules above are reachable only from the trusted service
  layer and from tests.
- The term-end check does not depend on processing. It runs on every authority call. The explicit `appointment_ended`
  event is emitted on identity resume and is idempotent. If a world is never resumed, the event is not written, but
  authority still ends correctly.
- A federal office can never act for a state or local body in this stage. That is the conservative default, not a
  policy decision.
- Not fixed and not in scope (carried from Stage 28): session expiry is not enforced (D-06, owner decision). Client
  credentials are stored in plaintext (CRED-1). Touch controls are unwired. Mutation M4 is not run. The GitHub Actions
  job is not verified from here.

## 8. Verification (actual runs, this stage)

Run from `services/world-api`. A "live" run uses a disposable local PostgreSQL 18.4 server on loopback
(`DATABASE_URL` pointing at a database whose name contains `test`, `NAIJA_ALLOW_DB_TESTS=true`, `DB_SSL=false` for the
local plaintext opt-out, `NAIJA_ENV=test`). Loopback without TLS is a local development result. It is not production
evidence, and it is not multi-instance evidence.

| Run | Total | Pass | Fail | Skip | Notes |
|---|---|---|---|---|---|
| `npm run build && npm test` (file backend, default env) | 1102 | 1064 | 0 | 38 | All 38 skips are database-dependent tests that need `DATABASE_URL` or `TLS_TEST_DATABASE_URL`. |
| `node --test test/*.test.mjs`, live PostgreSQL (`DATABASE_URL` set) | 1203 | 1199 | 0 | 4 | The 4 skips are the TLS live tests, which need `TLS_TEST_DATABASE_URL` (an `ssl=on` server). Those were not run. |
| Focused: record validation and government authority | 170 | 170 | 0 | 0 | Run after the validation fix, before the judicial mutation check. |
| `npm run lint` (eslint, `services/world-api/src`) | - | - | - | - | Exit 0. |
| Focused, file backend, after the final build: judicial, government, government-authority, election-authority, elections, government-authorization, mutation-resend-guards, justice, record-validation | 263 | 263 | 0 | 0 | Run after the mutation check and restore. |
| Judicial mutation check (section 4) | - | - | - | - | Four mutations, each detected. |

The final counts are recorded in the commit message and the final report. Where a number here disagrees with a later
run, the later run wins.

## 9. Owner decisions still required

1. R-a / G-2: the appointing-office table, and the succession rule when an office falls vacant.
2. R-b: which offices may control budgets, projects, and announcements.
3. R-c: whether a federal office may act for a ministry, state, or locality. The seed data also needs its office
   placement decided (all offices are in `gov:federal` today).
4. R-d / E-1: whether an electoral authority office exists, and who holds it. Until then, no election is administered by
   any authorised office.
5. R-f: a minimum age for budget authority.
6. J-8: whether judicial conflict covers more than case parties.
7. G-7: the definition of a conflicting interest for public financial decisions.
8. Confirmation that E-2 and E-4 are the intended rules. They are adopted defaults, not owner decisions.

## 10. Next highest-value stage

(Superseded by Stage 31. The treasury now exists. The next stage is the funding and payee-credit design in `STAGE_31_TREASURY_AUTHORITY.md` section 10.)

Original recommendation, kept for the record. Treasury ownership, once R-b and R-f are decided: a defined treasury account per organisation, budget creation and
spending gated by the resolver plus the owning office, an atomic ledger entry for each movement, a refusal that leaves
the treasury unchanged, and tests on both backends. This is the largest remaining gap in the priority order, and it is
the one that carries money. It must not be started on the default rules alone.
