# Stage 38: Authority Enforcement and Multiplayer Reliability

Scope: server-side authority for the police, crime, and military actions that were still trusting client identifiers (`dispatch_unit`, `open_investigation`, `apply_recruitment`, `commit_crime`, `apply_for_service`); socket-level tests for `create_proposal`/`submit_proposal` and `family.childbirth`; the R5 notification and slow-reader investigation; the PostgreSQL CI failure output; and a treasury retry-safety review. It extends the Stage 28 authority model, the Stage 36 request-ID gate, and the Stage 37 confirm-after-save path. It does not add a criminal, police, military, or judicial capability, and it does not enable any suspended route.

## 1. Starting and final hashes

- Starting HEAD: `9f2d5b38baa0ac4d2644f6027c4b2ec333388cf4` (`9f2d5b3`, branch `arena/00cdea0e-naija`). The remote branch was verified at `9f2d5b3` before the work began.
- During the session the local clone was found re-created from `main` at `44483b4` with the Stage 1 to 37 history not present locally, and the working tree held the Stage 38 edits. The working tree was backed up (`/tmp/s38-wt-backup/worktree.tar`), the remote commit was fetched, the local branch was fast-forwarded to `9f2d5b3` (`git merge --ff-only`), and the nine Stage 38 files were restored from a stash entry (`s38-pre-realign-worktree`, kept). A file-by-file comparison showed that these nine files were the only differences from `9f2d5b3`. No history was rewritten.
- Code and report commit: `97793e1394bc78d78d3ba60648ab2500ca42f57d` (`97793e1`), a fast-forward of `9f2d5b3` (`9f2d5b3..97793e1`). Final HEAD: the follow-up commit that records the CI result in section 11; its hash is verified after the push. Nothing is force-pushed.

## 2. Summary

- **Police and crime authority.** `dispatch_unit` and `open_investigation` take the acting officer from the session, not from the request. The station must be the officer's own station, the officer must be active or on duty, and the incident must be assigned to that station and be in an allowed state. An unassigned incident is refused, because no socket route performs triage yet (this is the fail-closed prerequisite; section 4). `apply_recruitment` takes the applicant from the session and refuses a character with no date of birth, instead of assuming age 20.
- **Crime victims.** `commit_crime` checks each named victim against the saved world before the crime is recorded: a character must exist and not be the perpetrator; a property must have an active owner record; a business must exist and have an owner. A target type that the crime does not take is refused. Only the checked identifiers are passed on. Malformed identifiers are refused with `crime_target_invalid`.
- **Military.** `apply_for_service` takes the applicant from the session, ignores a client-named applicant, and refuses a character with no date of birth.
- **Socket tests.** One new file (`authority-stage38.test.mjs`, 14 tests) runs on both backends. It covers the consequential paths in section 6.
- **R5.** A demonstrated defect is fixed: the per-game-minute character snapshot was sent to every online player with no backlog check. A slow reader's outbound queue then grew until the heartbeat terminated the live socket. The fix holds back that snapshot while the socket's backlog is over 1 MiB and sends the latest state once the backlog drains. Heartbeat diagnostics record counts and times only. No timeout was changed.
- **CI.** The live PostgreSQL job now keeps its full output, lists the failing tests in the job summary, collects the PostgreSQL service log on failure, and uploads both as an artifact. The failure of run `38209331236` is **not** explained. Its logs could not be retrieved, and this change is not a fix for that failure.
- **Treasury.** Reviewed; no code change. The cross-process treasury payment race is not tested. The gap and a test design are documented (section 9).
- **Not changed.** Suspended routes stay suspended. No revenue, tax, fine, borrowing, minting, business, or organisation payment path was added. The education eligibility defect is documented and not changed (section 4).

## 3. Mutation families audited and changed

| Family | Route (socket message) | Before Stage 38 | After Stage 38 |
|---|---|---|---|
| Police dispatch | `police.action` / `dispatch_unit` | No officer or station check in the service path (per the diff); the incident and priority checks only. | Session officer; station must be the officer's own; officer active or on duty; incident assigned to that station; status `accepted` or `assigned`. Refusals create no dispatch. |
| Police investigation | `police.action` / `open_investigation` | Lead officer taken from the request. | Lead is the session officer; the same station, duty, and assignment checks as dispatch. |
| Police recruitment | `police.action` / `apply_recruitment` | Missing date of birth defaulted the age to 20. | Applicant from the session; station must exist and be active; date of birth required (`police_age_ineligible` if absent). Stable error codes replace plain messages for station and duplicate refusals. |
| Crime | `crime.action` / `commit_crime` | Victim identifiers from the request were passed to the crime service without a check against the saved world. | Each victim identifier is validated (section 2). Refusal creates no crime record. |
| Military | `military.action` / `apply_for_service` | Missing date of birth defaulted the age to 20. | Applicant from the session; date of birth required (`military_age_ineligible`). |

Read-only actions in these families are unchanged. Stage 37 request-ID rules are unchanged.

Behaviour changes for review:

- **Dispatch and investigation are effectively unavailable through the socket until triage exists.** Because no route assigns an incident to a station, `dispatch_unit` and `open_investigation` now refuse every incident that has no station assignment (`police_incident_not_assigned`). This is the fail-closed outcome the mission requires. It removes a path that previously accepted any station. It is a visible gameplay change.
- Recruitment or application with no date of birth is refused rather than assumed to be age 20. Characters are created with a date of birth, so no existing live character should be affected.

## 4. Suspended or incomplete routes

Still suspended, unchanged in Stage 38 (from the Stage 28 and 37 records and the engine's suspension map): `execute_arrest` (`police_arrest_suspended`), `link_to_police` and `link_to_justice` (`crime_link_suspended`), `enlist` (`military_enlistment_suspended`), `create_criminal_record`, `create_restitution`, `add_evidence`, `transition_incident` (crime), and the other Stage 28 suspensions. No suspension code was bypassed.

Incomplete or latent:

- **Station ownership (latent).** Incident station assignment has no socket route, so `dispatch_unit` and `open_investigation` are fail-closed for every incident. The rule is implemented and tested with an incident assigned by a test fixture. A triage route, and the rule for who may assign an incident to a station, are the prerequisites (section 12, open decisions).
- **Education eligibility (documented, not changed).** Character `education_level` is free text (for example `Secondary school complete`, `Vocational training · …`, or `Not recorded (NPC)`). The police and military hierarchies map only the codes `none`, `primary`, `secondary`, `tertiary`, and `postgraduate`. An unknown value maps to 0. Both catalogs set the minimum to `secondary` (`game/data/police/catalog.json`, `game/data/military/catalog.json`). So a character whose recorded education is text above `none` is refused. The police refusal throws a plain message (`Minimum education requirement: secondary`), not a stable code, so the socket reports it as an internal error. The military refusal uses a stable code (`military_education_ineligible`). Which representation is authoritative was not decided, so no eligibility rule was changed. Whether a live character can hold a bare code was not checked.
- **Not given socket tests in this stage** (named in the Stage 37 next-step list): `submit_evidence`, `issue_judgment`, `file_appeal` (justice); and the positive path of `request_leave` (military).
- **Same-ID, different-payload refusal** (`request_id_reused`) is tested in this stage for `dispatch_unit` only. The generic gate for the other routes is covered by the Stage 36 and 37 suites, and was not re-proven per route here.

## 5. Authority, persistence, idempotency, and concurrency guarantees

What the new tests prove, on the file and PostgreSQL backends:

- **Authority.** A request that names another officer's station, a non-officer, a suspended or dismissed officer, an unknown station, an unassigned incident, or a victim that does not exist, is refused, and the saved world is unchanged after the refusal (checked against the saved state, not only the reply).
- **Identity from the session.** A client-named applicant or lead officer is ignored. The session's character or officer is the one recorded.
- **Persistence.** A save failure returns a `*_not_saved` code, and the operation is not reported as done. A retry with the same request ID applies the change once. A duplicate of a completed request replays as `command.duplicate` and creates no second record. A reused ID with a different payload is refused with `request_id_reused`.
- **Persistence gate.** While saving fails, a new change in these families is refused before it starts (`<family>_persistence_unavailable`), as in Stage 33 and 37.

What the tests do **not** prove:

- Idempotency records expire (90 days or 256 entries, from the Stage 37 record). Deduplication is not indefinite.
- No multi-host safety is claimed. The file backend is single-process; the PostgreSQL cross-process tests of Stage 36 remain the only cross-process evidence.
- No lock race was reproduced or fixed in this stage.

## 6. Socket-level test scenarios and outcomes

All in `services/world-api/test/authority-stage38.test.mjs` unless noted. Each runs on the file backend and on PostgreSQL (14 + 14 = 28 in the PostgreSQL run).

| Family | Test (short form) | Cases covered | File | PostgreSQL |
|---|---|---|---|---|
| Police, `dispatch_unit` | Own station and assigned incident only; refusals change nothing | authorised, foreign station, unassigned incident | pass | pass |
| Police, `dispatch_unit` | Refuses non-officer, suspended officer, missing and unknown station | unauthorised, malformed, foreign identifier | pass | pass |
| Police, `dispatch_unit` | Duplicate replays once; reused ID refused; failed save not confirmed until retry | duplicate, same-ID-different-payload, persistence failure, retry | pass | pass |
| Police, `open_investigation` | Session officer is lead; own station and assigned incident only | authorised, foreign identifier, unassigned | pass | pass |
| Police, `apply_recruitment` | Applicant from session; known station; missing date of birth refused | authorised, foreign station, malformed | pass | pass |
| Crime, `commit_crime` | Character victim checked against saved world (real, different character only) | foreign identifier, self-targeting, malformed (`victim_character_id: 42`) | pass | pass |
| Crime, `commit_crime` | Target type refused for the crime; property and business owners checked | foreign business, property without owner | pass | pass |
| Crime, `commit_crime` | Save failure not confirmed; retry records the crime once | persistence failure, retry, no duplicate | pass | pass |
| Military, `apply_for_service` | Applicant from session; client-named applicant ignored; missing date of birth refused | foreign applicant, unauthorised, malformed | pass | pass |
| Military, `apply_for_service` | Save failure not confirmed; retry records the application once | persistence failure, retry | pass | pass |
| Proposal, `create_proposal` / `submit_proposal` | Only the sponsor submits a draft, once; no route enacts a law (per test name) | submit by a non-sponsor, duplicate submit | pass | pass |
| Proposal, `create_proposal` | Minor refused; request without ID refused; save failure retried once | unauthorised (minor), missing request ID, persistence failure, retry | pass | pass |
| Childbirth, `family.childbirth` | Needs an active marriage; refused birth records nothing | unauthorised (no marriage), no change | pass | pass |
| Childbirth, `family.childbirth` | Refused birth records nothing; saved birth told to spouse once, after the save; retry records one child | refusal no change, success after save, retry, one notice | pass | pass |

Results: 14 of 14 on the file backend; 14 of 14 on PostgreSQL. Per family, this stage's tests are: police 5, crime 3, military 2, proposal 2, childbirth 2 (total 14).

Mutation checks (intended tests fail on the mutation, pass after restore):

- Mutation M1: a police station and officer check in the compiled `dist/police/service.js` disabled: 2 tests fail.
- Mutation M2: the victim check in the compiled `dist/crime/targets.js` disabled: 1 test fails.
- The mutated `dist` files were restored byte-for-byte (`cmp`) and rebuilt after each check.

A test defect found and fixed during the work (recorded, not hidden): one test matched a buffered `character.snapshot` as its reply. The reply matcher was tightened so that snapshots are not replies. The matcher was not loosened to make a test pass.

Routes not covered by a socket test in this stage: see section 4.

## 7. R5 findings

R5 is the notification-once failure first recorded in Stage 35 and carried through Stage 37 (section 8 of the Stage 37 report). The test is `test/world-capacity-notify.test.mjs`. Its assertions and timeouts are unchanged.

**Hypotheses tested.** Heartbeat termination; event-loop delay; large snapshots; unrelated closure; closing connection.

**Verified (demonstrated by logs or code reading):**

- The heartbeat in `src/app.ts` pings each socket every 15 s. A socket that did not answer the previous ping is terminated at the next tick without a close frame. A new connection counts as responsive, so it is pinged first and terminated only if the next ping is unanswered. By that rule the close comes about 15 to 30 s after a connection is opened, unless a pong arrives.
- The large outbound queue was produced by `advanceWorldMinute` in `src/multiplayer/world-engine.ts`. Every game minute it called `sendCharacterSnapshot` for every online player, with no backlog check. Every outbound message over 1 MB traced back to that call (send-stack log, `/tmp/r5/load5.log`).
- Under four busy processes on the 2-CPU sandbox, a paused reader's outbound queue reached 35.7 MB, 71.4 MB, 303 MB, and 678 MB across runs. In one run the heartbeat terminated a live online socket with `queued_bytes` 677,918,811, `ping_wait_ms` 16,857, and `connection_age_ms` 33,022. Its pong was queued behind the backlog.
- The 17.8 MB snapshot size came from the test fixture's padding. **Real production snapshot sizes were not measured.** The defect (an unbounded per-minute resend to a slow reader) does not depend on the size, but its production magnitude is unverified.
- Event-loop blocks of 2252 ms and 1556 ms were logged under four busy loops. Serialising the padded state alone blocks the loop for about 0.4 s unloaded.

**Fix (demonstrated):**

- `SNAPSHOT_BACKLOG_LIMIT_BYTES` = 1 MiB. `sendMinuteSnapshot` holds back the per-minute snapshot for a socket whose backlog exceeds the limit. `releaseHeldSnapshots` sends the then-current state once the backlog drains. A held-back snapshot is not lost, because the latest state is sent.
- Normal play is unaffected by the limit, since normal snapshots are a few kilobytes. This is an assumption from the design, not a measurement.

**Evidence after the fix:**

- `test/slow-reader-stage38.test.mjs` (2 tests): while a reader is paused, no snapshot is queued past the backlog limit, and far fewer than one per game minute are sent; the latest state arrives after resume. A reader that keeps reading still gets one snapshot per game minute. Pass on the file backend and in the full PostgreSQL run.
- Mutation check: with the backlog check disabled in the compiled code, the paused-reader test fails (`306 !== 0`: 306 snapshots sent over the limit). The keep-reading test still passes, as it should. The file was restored byte-for-byte.
- `test/world-capacity-notify.test.mjs` on the fixed build: unloaded 2 of 2 pass; under four busy loops 3 of 3 runs pass (15.3 s, 12.2 s, and 15.6 s runs, against 7.7 s unloaded). Before the fix, one of two loaded runs failed with an assertion (`s38-r5-load.log`).

**Diagnostics added** (`src/app.ts`; counts, times, and byte counts only; no addresses, player IDs, or tokens):

- `heartbeat terminated a connection that did not answer its ping` with `queued_bytes`, `ping_wait_ms`, `connection_age_ms`.
- `a connection has a large outbound queue` when a live socket's queue is over 1 MiB at a tick.
- `event loop was blocked during a heartbeat interval` when a block over 1 s is seen in one interval.
- `heartbeatIntervalMs` option (default 15 000; the production entry point does not set it).

Heartbeat tests (`test/heartbeat-stage38.test.mjs`, 2 tests): a client that never answers is terminated on the second tick, with one diagnostic line and no identifiers; a client that answers is not terminated across several intervals. Pass on the file backend and PostgreSQL. Mutation check: with termination disabled, the first test fails.

**Unresolved:**

- **The Stage 37 close with code 1006 at 13.97 s** (recorded as "13.97 s after the second episode started"). The connection's age at that close was not recorded. A heartbeat termination needs at least about 15 s since the connection, so the close is possible from the heartbeat if the connection was opened more than about 1 s before the episode started. The heartbeat is therefore neither shown nor excluded for that run. This is not verified. The new diagnostics would log a heartbeat termination with its queue size if it recurs.
- **Load margin.** Three loaded runs pass after the fix, on a 2-CPU sandbox. This is evidence for this environment only. It does not prove the test passes under every load.
- **Multi-host.** Not claimed.

## 8. CI investigation findings

Failed run `38209331236` (commit `237de19`, job "World API live PostgreSQL tests (disposable service)", step "Run tests with live PostgreSQL"). The foundation job in that run passed.

- Logs: `gh run view --log-failed` and the job log API both failed (`EOF`; the blob host is not reachable from this sandbox). No failing test name or error text was recovered. **The cause is unknown.**
- `gh run rerun` was refused by GitHub for that run. No retry was made.
- The same code passed later: run `38210023837` (commit `87ce096`) and run `38210208410` (commit `9f2d5b3`, the Stage 38 starting commit). `git diff --stat 237de19 9f2d5b3 -- services .github` is empty, so the services and workflow code are identical. This shows the failure is intermittent or environmental on identical code. It does not show the cause.
- Earlier live-job failures: `c71964b` (run `38196966222`) and `825e0e8` (run `38196196114`), recorded in Stage 37. Their logs were not recovered either. Passing live-job runs after them: `cbcd72e`, `3252af1`, and `5f64523`.
- Local reproduction: the full PostgreSQL suite passed (section 10) in this stage and in Stage 37 (three CI-configuration runs). No failure was reproduced.

Change made (`.github/workflows/ci.yml`, job `node-live-database`, no change to concurrency, retries, or the command):

- The test step runs under `pipefail` and writes the full TAP output to `$RUNNER_TEMP/world-api-live-postgres.log`.
- On failure, a summary step writes the failing test lines (`not ok`, `failureType`, `error:`, hook failures) to the job summary.
- On failure, the PostgreSQL service container log (last 200 lines) is appended to the same file.
- On failure, the file is uploaded as artifact `world-api-live-postgres-log` (14 days retention).
- The job references no repository or environment secret. The database is an ephemeral container with trust authentication and no password, so the connection string in the output holds no secret.

**The workflow change is unverified until the next CI run.** It does not fix the `237de19` failure. A later passing run does not show that the earlier failure was fixed. The next failure of the live job should produce an artifact, which will settle what is missing.

## 9. Treasury retry-safety review

Scope: payment and funding paths for government treasury. No code was changed in this stage.

Existing coverage (verified by test names and by the full runs; per-file counts in section 10):

- `government-treasury-payments.test.mjs`: one-time funding, payment credit with ledger rows, eligibility refusals, limits, conflicts, failed-save rollback, same-ID replay and changed-payload refusal, audit, validator, and socket tests (lost reply, crash and restart, fenced writer). PostgreSQL adds a fenced writer where another writer saved first.
- `postgres-treasury-writers.test.mjs`: two PostgreSQL writers on initial funding; the version check lets one save.
- `treasury-funding-stage35.test.mjs`: allocation exactly once, restart, failed and lost-reply saves.
- `cross-process-requests-stage36.test.mjs`: child-process harness for property, justice, and rest races. It has **no treasury payment case**.

Gap (not implemented): **no cross-process treasury payment race test**. The existing "fenced writer" tests run in one process with two store instances, so they show the version check, not a second process racing.

Design for the missing test (not implemented in Stage 38): seed a government structure, a minister, a budget, and a payee in the saved world; send the same `spend_budget` request ID to a stale child process and to a current child process; assert one debit, one credit, one saved expenditure, and a `treasury_not_saved` reply for the stale writer. This must run on PostgreSQL, where the version fence applies, and it must not be counted as passed until it runs.

Status of the treasury safeguards: unchanged. One-time funding, treasury authority, budget ceilings, jurisdiction, self-dealing and conflict checks, idempotent requests, PostgreSQL version fencing, file-lock checks, and ledger validation are all still in place. Business and organisation payments remain disabled. Race status: **unverified** for cross-process payment (no test).

## 10. Test totals

Counts are from the final runs on the final tree, unless marked otherwise. Pass, fail, skip, and TODO are reported separately; no skip is counted as a pass.

**Full suites** (`npm test`, the same command CI runs; it runs the build first):

| Suite | Tests | Pass | Fail | Skip | TODO | Exit | Log |
|---|---|---|---|---|---|---|---|
| File backend (no `DATABASE_URL`) | 1342 | 1288 | 0 | 54 | 0 | 0 | `/tmp/s38-final-file2.log` |
| PostgreSQL (`DATABASE_URL`, `NAIJA_ALLOW_DB_TESTS=true`, disposable local PostgreSQL 18.4) | 1593 | 1589 | 0 | 4 | 0 | 0 | `/tmp/s38-final-pg.log` |

The skipped tests on the file backend are the database-gated tests (PostgreSQL and live-TLS tests that need `DATABASE_URL`). The PostgreSQL run's skips are the four live-TLS tests that need `TLS_TEST_DATABASE_URL` (a local `ssl=on` server, not configured here).

Note: an earlier file-backend run was started without `NAIJA_ENV=test`. One test (`game-time scaling`) failed with `NAIJA_ENV must be set`. That was a mistake in the invocation, not a code failure. The `npm test` run above sets it and passes. An earlier PostgreSQL full run (`/tmp/s38-full-pg.log`) gave the same totals. The final run above was made after the workflow comment edit and the mutation restores, on the restored tree.

**Per family** (this stage's tests, each on both backends unless noted):

| Family | Tests | File | PostgreSQL |
|---|---|---|---|
| Police (`dispatch_unit`, `open_investigation`, `apply_recruitment`) | 5 | 5 pass | 5 pass |
| Crime (`commit_crime`) | 3 | 3 pass | 3 pass |
| Military service (`apply_for_service`) | 2 | 2 pass | 2 pass |
| Proposal (`create_proposal`, `submit_proposal`) | 2 | 2 pass | 2 pass |
| Childbirth (`family.childbirth`) | 2 | 2 pass | 2 pass |
| Authority file total | 14 | 14 pass | 14 pass |
| R5 heartbeat | 2 | 2 pass | 2 pass |
| R5 slow reader | 2 | 2 pass | 2 pass |
| R5 notify-once (existing, unchanged) | 2 | 2 pass | 2 pass |
| Treasury (four files, existing) | 40 file / 57 PostgreSQL | 28 pass, 12 skip (PostgreSQL-only cross-process tests) | 57 pass |

Per-family unit suites (file backend, `node --test`): police 34 pass / 0 fail; crime 29 pass / 0 fail; military 30 pass / 0 fail.

Not separable: a per-family total for the whole suite, because the suites are not tagged by family.

## 11. Build, type-check, lint, CI, and push status

- Build: `npm run build` exit 0 (on the restored tree).
- Type-check: `npx tsc --noEmit -p .` exit 0.
- Lint: `npm run lint` exit 0.
- Tests: section 10.
- CI for the starting commit `9f2d5b3` (run `38210208410`): success.
- CI for the code and report commit `97793e1` (run `38231065407`, started by the push): **success**, both jobs ("World API build, lint, and tests" and "World API live PostgreSQL tests (disposable service)"). This is one passing run. It does not show that the `237de19` failure was fixed or that its cause was found. The new failure-output steps did not run, because nothing failed, so their behaviour on a failure is still unverified.
- CI for `237de19` (run `38209331236`): failure, cause unknown (section 8). Not fixed by this stage.
- Push: fast-forward only, never forced. The remote commit is verified after the push.

## 12. Remaining risks and next stage

Verified risks:

- **The PostgreSQL CI failure in `237de19` is unexplained.** The logs are not recoverable from this sandbox. The workflow change makes the next failure diagnosable; it does not make it go away.
- **R5 is not proven closed for all cases.** The backlog fix is demonstrated in this environment (section 7). The 1006 close at 13.97 s in Stage 37 is unexplained.
- **Dispatch and investigation are fail-closed.** They refuse every incident until a triage route assigns station ownership. Players cannot use them through the socket.
- **Education eligibility** compares free text against a code hierarchy, so recruitment is refused for text values above `none` (section 4). Not changed.
- **Cross-process treasury payment** race: unverified (section 9).
- **Partial coverage**: `submit_evidence`, `issue_judgment`, `file_appeal`, and the positive `request_leave` path have no socket test.
- **Single process**: the file backend is single-process. No multi-host safety is claimed.
- **Idempotency** is limited to 90 days and 256 entries.
- **Doc debt**: `docs/TECH_STACK.md` line 14 still says PostgreSQL is "not configured", which is out of date. Not changed in this stage.

Open decisions (need the owner):

1. Who may assign an incident to a station (triage route), and which officers may dispatch beyond their own station. Until answered, dispatch and investigation stay fail-closed.
2. Whether education is recorded as a code or as text, and which representation the eligibility rules read. Until answered, the police and military education rules are unchanged.
3. The socket route, if any, for `submit_evidence`, `issue_judgment`, `file_appeal`, and the positive path of `request_leave`.

Next stage (Stage 39, suggested): build the cross-process treasury payment test in section 9 and run it on PostgreSQL; decide the education representation; add the triage route with its authority rule (only after decision 1); add socket tests for the justice actions named above; and record the next live-job failure's artifact in the CI docs. Business and organisation payments, revenue, tax, fines, borrowing, and minting remain disabled and are not part of the next stage.
