# Stage 28 Foundation Hardening Programme: Record

**Status: Stage 28 OPEN. Production NOT READY.** Nothing in this record is a production, Neon, or launch claim. Godot 4.7.2 client tests are NOT RUN. Neon and production PostgreSQL were not reached. Stage 28 stays open because the blockers in the table at the end of this section are not closed.

Branch: `arena/00cdea0e-naija`. Verification: `docs/evidence/stage28-foundation-hardening/final-verification-summary.md`.

## Final state (latest mission, Phases 1 to 11)

### Phase results

| Phase | Result | Status label |
|---|---|---|
| 1. Preservation and baseline | Checkpoint `/home/user/stage28-checkpoints/20261011-034416-pre-final/` created outside the repository. `git bundle verify` passes (HEAD `a4876301`). Remote and local history reconciled (see below). | DONE |
| 2. Identity takeover containment (F-04, D-05) | Key-only recovery refused on the existing-identity path with `identity_recovery_unavailable`. No token rotation, save, or budget use on refusal. Client does not repeat `identity.create` with a saved key after `session_invalid`. Concurrency and budget tests updated to assert refusal, one identity, and original-token resume. | PARTIAL. Waiting-period recovery (D-05) NOT implemented: no verified notification channel. Plaintext credential file remains. |
| 2b. Justice judge access (follow-on to Slice 1) | Assigned judges of the case's court may view the case and may not submit evidence. Other judges are refused. Party definition for `submit_evidence` and `view_case` still awaits user confirmation. | PARTIAL. Implemented and tested (file and PostgreSQL). Not user-confirmed. |
| 3. Mutation integrity audit (F-07 to F-10) | Military, police, and crime-link routes now refused at the server with stable codes (`military_*_suspended`, `police_arrest_suspended`, `crime_link_suspended`). Reads remain open. Military and police recruitment take education only from the character record. | CONTAINED (D-04). Authority model is documented in `docs/STAGE_28_AUTHORITY_MODEL.md`. Full routes not implemented. |
| 3b. Police recruitment refusal code | Police recruitment age and education refusals were reported as `internal_error`. They now map to `police_age_ineligible` and `police_education_ineligible`, the codes the catalogue already defined. Service-level messages are unchanged. | DONE (tested, PostgreSQL included) |
| 4. Persistence, database, recovery | Not changed in this mission. 16 MiB limit unchanged. Compact JSON rollout BLOCKED. Capacity above the measured range NOT claimed. Backup and restore NOT run (`pg_dump`, `pg_restore`, `psql` missing). | BLOCKED or OPEN (see table) |
| 5. Client, operations, deployment, session policy | Session policy options are proposed below; not implemented. No deployment configuration exists in the repository. Godot not available. | BLOCKED or DECISION REQUIRED |
| 6. Mutation-test anomaly | Mechanism for the unreproduced attempt-1 pass demonstrated (see below). Harness run 2: 13 of 13 mutations detected and restored. | INVESTIGATED. Attempt-1 result not reproducible from surviving logs. |
| 7. Final verification | Default suite, PostgreSQL suite, live-TLS suite, mutation harness, build, bundle verify: see the summary file. Lint still has 51 errors (baseline, not introduced here). Godot NOT RUN. | DONE, with the lint and Godot exceptions stated |
| 8. Documentation and acceptance audit | Status notes added to the design documents that described key-only recovery as current. Authority model, verification summary, and this record updated. | DONE |
| 9. Commits and remote reconciliation | See the commit section below. Push performed only after the checks listed there. | See the commit section |
| 10. Stage 28 exit decision | OPEN. | DECISION: OPEN |
| 11. Next game stage | Stage 29 is the next documented target. Proposal below. Not started. | PROPOSAL ONLY |

### Verification results (exact)

- Default suite (`npm test`, `services/world-api`): exit 0. 1022 tests, 985 pass, 0 fail, 37 skipped (PostgreSQL-only tests). The prior run (1017 tests, 980 pass) predated the guard, access test, and containment edits.
- PostgreSQL suite (local disposable loopback cluster, database `naija_stage28_test`): exit 0. 1098 tests, 1094 pass, 0 fail, 4 skipped. The four skipped tests are the live-TLS tests.
- Live-TLS suite (same local cluster with `ssl=on` and a private test CA): 12 of 12 pass, 0 skipped. This is local evidence only, not Neon or production.
- Lint (`npm run lint`): 51 errors, 0 warnings. Identical files and rules to the programme baseline. Not fixed and not suppressed. CI runs `npm run check`, which includes lint, so CI will fail on this baseline. It did so before this mission.
- Mutation harness run 2: 13 of 13 detected; all source restored; `finalMatchesBaseline=true`.
- Godot 4.7.2: NOT RUN. The binary is not installed. The four headless GDScript tests under `game/tests/` were not run. The GDScript edit to `multiplayer_client.gd` was reviewed by reading only.

### Five-versus-seven reconciliation (D-12)

- `origin/arena/00cdea0e-naija` = `e68e805`. Local HEAD before this mission's commits = `a487630`. Local is 5 commits ahead and 0 behind.
- The five local-only commits: `8721104`, `92dfd5f`, `607bf7d`, `258b7f3`, `a487630`.
- The last seven Stage 28 commits in the graph are `f3e2f74`, `4419d98`, `e68e805` (on origin) and the five above (local). The "seven" count therefore includes three commits that are already on origin. The discrepancy is explained by counting origin-side Stage 28 commits. This explanation is an inference from the graph and has not been confirmed by the user.
- Every commit on origin is an ancestor of local HEAD. A push is a fast-forward and rewrites nothing. No force push, reset, rebase, or amend was used.
- Other remote heads, untouched: `main` `44483b4`, `arena/f48b6f8e-naija` `02dd67c`, `pull/1/head` `02dd67c`.

### Mutation-test anomaly (Phase 6)

- The attempt-1 log `/tmp/s28/contain-mutant.log` records a 12 of 19 failure run with the government gates removed. It does not show a 7 of 7 pass. No log in `/tmp/s28/` contains the claimed "7/7" report.
- Mechanism demonstrated: piping a failing `node --test` run through `tail` returns exit 0 for the pipeline (`direct exit=1`, `piped exit=0` on a throwaway failing test). A script that reports on the piped status would therefore report success while tests fail. This is a plausible cause of the attempt-1 symptom, but the original script is not recoverable and this is not proven as the cause.
- The current harness (`mutation-harness.mjs`) runs each test command through `spawnSync` with no pipe. It decides "detected" from the exit status and a non-zero failure count. Run 2 shows the restored-source check works.
- Rule kept: a mutation is reported only from a direct exit status, and every run records its restore check.

### Session policy (D-06): decision required, nothing implemented

Current state: the session token has no expiry and no revocation (F-05). The protocol has no logout message. The client stores the token and creation key in plaintext under `user://naija-multiplayer.cfg`. Godot secure storage has not been verified.

Options for the user to choose from:

1. **Option A (recommended): staged rollout.** First add server-side session metadata (issued-at and last-seen) and log-only "would expire" counts, with no enforcement. Then add a `session.logout` message that revokes the token. Enforce the 30-day absolute and 7-day idle limits only after a verified re-authentication path exists (the D-05 notification channel). Reason: with key-only recovery refused, enforcing expiry now would lock every player out permanently.
2. **Option B: enforce now with a manual reset.** Enforce expiry immediately, and add an operator-run procedure to re-issue sessions. Reason: a safety-critical operator action, with no tested path yet, and the operator CLI is not approved.
3. **Option C: defer.** Keep the current state and record F-05 as an accepted limitation until the D-05 channel exists.

Client credential storage: no verified safer platform mechanism for Godot 4.7.2 has been identified. Keep the plaintext cfg, and state this as an open risk until a platform mechanism is verified in Godot.

### Stage 28 blocker table (status at end of this mission)

| Blocker | Status |
|---|---|
| Live saved-world corpus (284 files) | BLOCKED. Absent. `/home/user/data-backups` and `services/world-api/data` do not exist. A search for `world-state*.json` finds only test temporaries. |
| Neon / production PostgreSQL | BLOCKED. Not reached. |
| Deployment configuration (Task 6) | BLOCKED. Only `.github/workflows/ci.yml` exists. |
| `pg_dump`, `pg_restore`, `psql`, `docker` | MISSING. Backup and restore success NOT claimed. |
| Godot 4.7.2 client tests | NOT RUN. Binary missing. |
| Key-only recovery (F-04) | Refused. Waiting-period recovery (D-05) NOT implemented. |
| Session expiry and revocation (F-05, D-06) | OPEN. Decision required (options above). |
| Justice decision and fine-payment exploits (F-01, F-02) | Contained (suspended). Ledger-backed payment and appeal authority NOT implemented. |
| Criminal record exploit (F-03) | Contained (suspended). Judgment pathway NOT implemented. |
| Military and police authority (F-07 to F-10) | Contained (suspended). D-04 model documented; routes NOT implemented. |
| Response ordering (F-16) | Decision required (D-08). |
| Capacity above the measured range (F-23, F-24) | OPEN. 16 MiB limit unchanged. No 2,500, 5,000, or 10,000 claim. |
| Compact JSON rollout (F-25) | BLOCKED for existing saved worlds. |
| Backup and restore success (F-28) | UNTESTED. Tools missing. |
| Multi-process fencing and global identity limit | Fencing tested on the local PostgreSQL cluster (`multiprocess-persistence` passes there). Global identity limit NOT met. |
| Power-loss durability (F-20) | NOT TESTED. |
| CI coverage (F-32) | Limited. CI runs `npm run check` only (lint plus default suite). PostgreSQL, TLS, Godot not run in CI. |
| Lint baseline | 51 errors. Not fixed. CI fails on it. |
| Pre-push gate (A to J) | The A to J list is not defined in any file in this repository. It cannot be checked against a definition. The checks used instead are listed in the commit section. |
| Production readiness | NOT READY. |

### Stage 28 exit decision

**OPEN.** Every item in the blocker table that is not marked contained, tested, or done remains open. Pushing this work does not close Stage 28. Stage 28 would close only after the corpus question, Neon or production PostgreSQL testing with approved credentials handling, a deployment configuration, a backup and restore run with approved tools, Godot test runs, the session decision, D-05 implementation, and the authority routes are each resolved.

### Next game-development stage (Phase 11)

- The master roadmap (`docs/ROADMAP.md`) is stale. It lists phases 22 to 27 as "Not started", while the repository has completion reports for stages 22 to 27. It also labels phase 28 as "Full Game", which conflicts with Stage 28 being used for this hardening programme.
- The only documented forward target found is **Stage 29**, in `docs/STAGE_26_OUTSTANDING_WORK_REGISTER.md`: NPC AI completion (item 12), regional environment completion (item 13: 5 of 37 regions have visual profiles), and building interiors (item 14).
- Decision: no Stage 29 code was started. Stage 28 remains open, and the client cannot be verified (Godot not run). A gameplay slice that adds state also adds to the capacity risk, which is not measured above the tested range.
- Proposed smallest safe slice (for user choice): **Stage 29 Slice 1, regional visual profiles for the 32 missing regions, as data only.** It adds no mutation routes and changes no saved records. Acceptance: profiles validated by a Node data check, existing regions unchanged, Godot visual check marked NOT RUN until a runner exists. The alternative is NPC AI completion, which changes the simulation tick and needs a design review first.

### Commit and push record

The commits made in this mission and the push result are recorded in the final report to the user. This file does not record its own commit hash.

Checks before push (all of them run; results above):
1. Checkpoint and bundle verified.
2. Default, PostgreSQL, and live-TLS suites: passing.
3. Mutation harness run 2: 13 of 13 detected, source restored.
4. Credential scan of all changed and new files: no connection strings, passwords, or private keys found.
5. Remote fetched: `origin/arena/00cdea0e-naija` = `e68e805`, an ancestor of HEAD. Push is a fast-forward.
6. Lint: unchanged baseline (51 errors). Stated, not hidden.

---

## Appendix: Slice 1 record (historical, unchanged below)

The sections below are the Slice 1 record as written at the end of Slice 1. Their statements about the branch, the graph, and the pending decisions are superseded by the final state above.

## Slice 1: contain confirmed justice and financial exploits

### Scope and decisions applied

| Action | Decision | Result in this slice |
|---|---|---|
| `decide_appeal` | D-01 | Suspended for every caller (`justice_appeal_decision_suspended`). No decider check was added. Authorised judicial assignment does not exist yet. |
| `pay_fine` | D-02 | Suspended for every caller (`justice_fine_payment_suspended`). No economy link exists, so a fine cannot be marked paid without a ledger transaction. |
| `create_criminal_record` | D-03 | Suspended for every caller (`crime_record_creation_suspended`). The case-to-judgment pathway is incomplete. |
| `submit_evidence` | Scoping (see below) | Non-parties refused with `justice_not_case_party`. |
| `view_case` | Scoping (see below) | Non-parties get `justice_case_not_found`, the same as a missing case. |

The three suspensions are containment, not the permanent rules. They are gates on the request path. They run before payload parsing, `markRequestProcessed`, `touchPlayer`, and `flushDirty`, so a refused request changes no state and consumes no request ID.

**Scoping decision NOT yet confirmed by the user.** The two party checks were implemented before the user confirmed them. The party definition in code is: filing party, respondent, or an active `caseParticipants` record for the character. Assigned court judges are NOT included in `view_case` (not implemented). Reject or amend this definition before Slice 2 relies on it. The three suspensions do not depend on the answer.

### Files changed (uncommitted)

- `services/world-api/src/multiplayer/world-engine.ts`: `JUSTICE_SUSPENDED_ACTIONS` and `CRIME_SUSPENDED_ACTIONS` maps; gates in `justiceAction` and `crimeAction` after the action-name check; `view_case` calls `viewCaseForCharacter`.
- `services/world-api/src/justice/service.ts`: `isCaseParty`, `viewCaseForCharacter`, party check in `submitEvidence`, three error messages.
- `services/world-api/src/crime/service.ts`: one error message (`crime_record_creation_suspended`).
- `services/world-api/test/justice-finance-containment.test.mjs` (new, untracked): 7 tests per backend, file and PostgreSQL. Real socket path. Uses `dist/justice/index.js`.
- `services/world-api/test/world-capacity-notify.test.mjs` (tracked, modified in this slice): see "Test change" below.
- `docs/evidence/stage28-foundation-hardening/` (new, untracked): probe scripts `probe-G-justice-party-access.mjs` and `probe-ABCDE-rerun-after-slice1.mjs`.
- `docs/STAGE_28_FOUNDATION_HARDENING.md` (this file, new, untracked).

Preserved: all other modified and untracked files listed in `git status` (earlier Stage 28 work), `/home/user/stage28-optionD-rejected.patch`, and the untracked audit and government documents.

### Findings addressed or re-classified

- F-03 (conviction against another character with a made-up incident ID, live before this slice): `create_criminal_record` suspended. Probe C now refused, no record created.
- F-02 (fine marked paid without payment, latent): `pay_fine` suspended. Probe E now refused, fine still outstanding, balances unchanged.
- F-01 (appeal decided by a non-judge, latent): `decide_appeal` suspended. Probe B refused, state unchanged.
- G2 (new, live before this slice): any logged-in character with a leaked case ID could `submit_evidence` to another party's case. Now refused `justice_not_case_party`, evidence count unchanged.
- G3 (new, live before this slice): any character with a leaked case ID could `view_case` and read the case. Now refused `justice_case_not_found`, no case data returned.
- D (economy transfer from another account, safe before): still safe.
- A (key-only identity recovery, F-04): NOT addressed. This is Slice 2 and needs D-05 work (notification channel, waiting period).

### Test change (disclosed)

`test/world-capacity-notify.test.mjs`, test "R5 notify-once: a refused periodic save retries silently until a save succeeds, and a new episode notifies again". Before this change, the second over-limit episode was created by writing padding directly into the store. That does not mark the engine dirty, so the test depended on an incidental dirty flag from the world tick. In the full default suite it failed in 3 of 3 runs (1 `not ok`), while passing in isolation. The fix sends one `session.resume` at the start of the second episode, the same trigger the first episode uses. No assertion was changed or removed. This is a test-determinism fix, not a product change. It does not prove the cause of the earlier unrelated timing failure in the baseline (`test/app.test.mjs:690`), which is still a documented load-sensitive flake.

### Verification (exact results)

| Check | Result |
|---|---|
| `npm run build` (services/world-api) | exit 0 |
| Probe G (pre-change, file): G2 accepted, G3 returned case | Confirmed live before the change |
| Probe G and ABCDE (post-change, file) | G2 refused `justice_not_case_party`, G3 refused `justice_case_not_found`, B/C/E refused with state unchanged, D safe, A unchanged (Slice 2) |
| Focused existing suites (`justice`, `crime`, `mutation-resend-guards`, `government-authorization`, file) | 71 pass, 0 fail |
| `justice-finance-containment.test.mjs`, file backend | 7 pass, 0 fail, 0 skipped (final run) |
| `justice-finance-containment.test.mjs`, PostgreSQL loopback (`naija_stage28_test`, `127.0.0.1:55433`, `DB_SSL=false`) | 14 pass, 0 fail across file and PostgreSQL |
| Mutation check: all three suspensions and both party checks removed, rebuilt | 5 of 7 tests fail (`decide_appeal`, `pay_fine`, `create_criminal_record`, `submit_evidence`, `view_case`). Restored from byte-identical backups; restored build passes 7 of 7. |
| Default suite `npm test` (file backend), after the notify fix | 1017 tests, 980 pass, 0 fail, 37 skipped, exit 0 |
| Default suite without the new containment file | 1010 tests, 973 pass, 0 fail, 37 skipped (matches the earlier baseline exactly) |
| Full PostgreSQL suite (`npm test`, loopback, `NAIJA_ALLOW_DB_TESTS=true`, `DB_SSL=false`) | 1088 tests, 1084 pass, 0 fail, 4 skipped (TLS-live, unchanged) |
| `npm run lint` (root) | 51 errors, same files and rules as baseline (46 `no-unused-vars`, 5 `no-explicit-any`). Not suppressed. Not introduced by this slice. |
| `git diff --check` | clean |

Logs: `/tmp/s28/g/` (`contain-file-2.log`, `contain-file-3.log`, `contain-pg-1.log`, `contain-mutant2.log`, `npm-test-default-slice1-fixed.log`, `npm-test-pg-slice1.log`, `lint-after-slice1.log`).

### Unexplained result (recorded, not hidden)

The first mutant run (`contain-mutant.log`) passed 7 of 7 although the mutation script reported success. The logs do not show why the mutation was not in effect. I applied the mutation again using asserted replacement counts, confirmed the compiled `dist` no longer contained the suspension strings, and the same tests then failed 5 of 7. The tests are therefore sensitive to the gates, but the first run's inconsistency is not explained.

### Known limitations of Slice 1

- Containment only. Appeal decisions, fine payments, and criminal-record creation are unavailable to players until D-01, D-02, and D-03 are implemented.
- Judge-inclusion for `view_case` not implemented (see scoping decision).
- Other justice read paths were reviewed only in the engine (`file_case` returns the caller's own case; `my_cases` returns the caller's own cases). Other read endpoints were not audited.
- `government_action_invalid` for non-string actions still undecided (from the earlier containment task).
- Gate-refused requests still set `player.lastSeen` (F-15), as before.
- Tests run on a 2-core sandbox; the default suite still shows load-sensitive timing tests (`test/app.test.mjs:690` clock test flaked in the baseline). Not weakened.
- PostgreSQL is a disposable loopback cluster only. It is not Neon or production. No TLS-live tests ran (4 skipped).
- Godot 4.7.2 unavailable: client tests NOT RUN. No client validation claimed.

## Git status and graph (end of Slice 1)

Branch `arena/00cdea0e-naija`, HEAD `a487630`. Origin `origin/arena/00cdea0e-naija` at `e68e805`. Local is 5 commits ahead, 0 behind. No stashes.

```
* a487630 (HEAD) Stage 28 gate: characterize the unresolved same-key identity, graceful stop, and G1 flake
* 258b7f3 Stage 28: directory-sync failure states, engine-level fault injection
* 607bf7d Stage 28: client notice for persistence.restored
* 92dfd5f Stage 28: mutation response-ordering audit and characterization tests
* 8721104 Stage 28: refuse same-key identity conflicts until resolved
* e68e805 (origin/arena/00cdea0e-naija) Stage 28 continuation: save-outcome health, PostgreSQL load limit, recovery signal, file-save durability
* 4419d98 Stage 28: test suite exits cleanly without --test-force-exit; fix a multi-process test defect
* f3e2f74 Stage 28: reproduce the conflict-then-retry gap (characterization test); record the test-runner omission
```

Slice 1 changes are uncommitted in the working tree. No push. The D-12 reconciliation (seven commits versus five ahead) is still awaiting confirmation.

## Data and protocol risks

- No game data, government, election, justice, identity, or financial records were modified or deleted. All tests used disposable temp files and the disposable loopback database.
- Protocol: new error codes (`justice_not_case_party`, `justice_appeal_decision_suspended`, `justice_fine_payment_suspended`, `crime_record_creation_suspended`) are sent in existing `justice.error` / `crime.error` envelopes. Older clients will display the message text. No client code was changed.
- Requests refused by suspensions do not record their request ID, so a duplicate of a refused request is re-evaluated (and refused again). No state changes.

## Remaining decisions and next slice

Open decisions:
- Confirm or reject the party definition for `submit_evidence` and `view_case`, including whether assigned judges should see the case (scoping decision above).
- D-01: judicial appointment and assignment mechanism (required before appeal decisions can reopen).
- D-02: whether payment-on-behalf is wanted. Ledger design needed before fines can be paid.
- D-03: case-to-judgment pathway for criminal records.
- D-04: military and police authority model.
- D-05: verified notification channel for recovery. Needed before any recovery change (Slice 2 target: key-only takeover A).
- D-12: reconcile push scope (seven commits versus five ahead). No push until confirmed.

Next slice (not started): Slice 2 identity recovery and session policy (D-05, D-06). Stopped here as instructed.

