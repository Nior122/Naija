# Stage 37: Consequential Mutation Safety

Scope: government, justice, elections, police, military, crime, relationship/family, and character rest. This stage extends
the existing request-ID gate (Stages 34 and 36), the save-before-reply path (`pending` plus `confirmMoneyReply`), and the
suspension maps. It does not rewrite the game and does not add a new persistence design. The per-operation inventory is in
`docs/STAGE_37_MUTATION_INVENTORY.md`.

## 1. Starting and final hashes

- Starting HEAD: `5f645230a392ac169cccb58048dc915adeadcd70` (`5f64523`, branch `arena/00cdea0e-naija`). `origin/arena/00cdea0e-naija` was the same commit. The working tree was clean.
- Code commit: `237de197cc62111df7e67c4da67752df781f80ae` (`237de19`), pushed as a fast-forward of `5f64523` (`5f64523..237de19`). Remote `arena/00cdea0e-naija` was verified at `237de19` after the push.
- Final HEAD: the commit that adds this report update, on top of `237de19`. Its hash is verified after the push (section 11). The push is a fast-forward; nothing is force-pushed.

## 2. Summary

- Authority: five authority-less writes are now refused before any change (suspended with stable codes). Military `request_leave` now requires the caller to own the service record.
- Persistence: changing requests in the justice, police, military, crime, relationship, family, and rest families now reply only after their save succeeds. Before this stage, justice, police, military, crime, `character.rest`, `relationship.progress`, and `family.childbirth` all replied before saving.
- Idempotency: the justice, police, military, and crime changing actions now need a request ID and are deduplicated (the same record and fingerprint rules as Stage 36). A resent `file_case` no longer files a second case.
- While saving fails or the writer is fenced, a new change in these families is refused before it starts (`<family>_persistence_unavailable`). This is the Stage 33 rule, extended to these families.
- Tests: 7 new tests on the socket path, run on both backends, and 2 new PostgreSQL cross-process tests. The 7 tests fail on the pre-Stage-37 engine. The 2 cross-process tests also fail on it.
- Not changed: the treasury, money, elections, and property containment from earlier stages. No schema change, no migration, no new ledger, no business or organisation payment, no revenue, tax, fine, borrowing, or minting path.

## 3. Mutation families audited and changed

| Family | Changed | How |
|---|---|---|
| Government | No | Treasury writes already reply after `ensureDurable` (code read). Non-treasury writes are refused (`government_writes_suspended`). |
| Elections | No | Non-read writes are refused (`election_writes_suspended`) (code read). |
| Justice | Yes | Six changing actions (`create_proposal`, `submit_proposal`, `file_case`, `submit_evidence`, `issue_judgment`, `file_appeal`) now use the request-ID gate and reply after the save. `decide_appeal` and `pay_fine` stay suspended. |
| Police | Yes | Six changing actions (`apply_recruitment`, `submit_incident`, `dispatch_unit`, `open_investigation`, `submit_evidence`, `file_complaint`) use the gate and reply after the save. `request_wanted` is suspended (no authority check; duplicate `requested` records). `execute_arrest` stays suspended. |
| Military | Yes | `apply_for_service` and `request_leave` use the gate and reply after the save. `request_leave` checks ownership. `create_asset`, `create_security_event`, and `file_disciplinary_case` are suspended (no authority check; the caller was recorded as the authority). The other military writes stay suspended. |
| Crime | Yes | `commit_crime`, `report_crime`, and `start_rehabilitation` use the gate and reply after the save. `transition_incident`, `add_evidence`, and `create_restitution` are suspended (no authority check; `create_restitution` could create a debt for any character). |
| Relationship and family | Yes | `relationship.progress` and `family.childbirth` reply after the save. The partner's or spouses' notices are sent after the save as well. They were sent before. |
| Character | Yes | `character.rest` is confirmed after the save (section 7). |
| Money families (Stages 34–36) | No | Not changed. |
| Culture, entertainment, chat, geography, NPC | Not audited | Outside the families in this stage. |

Mechanism (verified in code): `consequentialFamilyOf` lists the changing requests of these families. The engine treats them
as gated requests, with the same in-flight guard, verdict, and fingerprint as `IDEMPOTENT_COMMANDS`. A new change is checked
against `financialWritesOpen()` before the handler runs. The success reply is produced by `replyAfterSave` through
`confirmMoneyReply`. That path calls `ensureDurable` first, and any notice to another player runs only after a success.
Failures are `<family>_not_saved` (the save is known to have failed before any write) or `<family>_outcome_unknown` (the
save may have committed). A retry with the same request ID is answered from the record and never applies the change twice.

## 4. Suspended or incomplete routes

**Suspended in Stage 37** (refused before any parsing, state unchanged, stable code):

| Operation | Code |
|---|---|
| `military.action` `create_asset` | `military_asset_creation_suspended` |
| `military.action` `create_security_event` | `military_security_event_suspended` |
| `military.action` `file_disciplinary_case` | `military_disciplinary_suspended` |
| `crime.action` `transition_incident` | `crime_incident_transition_suspended` |
| `crime.action` `add_evidence` | `crime_evidence_suspended` |
| `crime.action` `create_restitution` | `crime_restitution_suspended` |
| `police.action` `request_wanted` | `police_wanted_request_suspended` |

**Incomplete (documented, not fixed in this stage):**

- `police.action` `dispatch_unit` and `open_investigation`: the caller must be an officer, but the station is not checked (`policeService.getOfficerByCharacter` only). Any officer can act for any station.
- `crime.action` `commit_crime`: victim IDs come from the payload with no authority or existence check. This is an unresolved risk.
- Unverified authority (no code check found, and no test): `police.apply_recruitment`, `police.submit_evidence`, `police.file_complaint`, `crime.report_crime`, `crime.start_rehabilitation`, `military.apply_for_service`. These are gated now, which fixes replay, not authority.

Unchanged suspended routes: `justice.decide_appeal`, `justice.pay_fine`, `police.execute_arrest`, the six military writes listed in the inventory, `crime.create_criminal_record`, `crime.link_to_justice`, `crime.link_to_police`, `property.pay_rent`, and government and election writes.

## 5. Authority, persistence, idempotency, and concurrency guarantees

**Authority.** Verified by tests: the seven suspended operations refuse without changing any record (both backends). Military `request_leave` on another character's record is refused as `military_service_not_found`, and no leave record is created (both backends). Military `request_leave` on the caller's own record is not tested through the socket, so its positive path is unverified.

**Persistence (save before success).** Verified by tests on both backends: a `file_case` whose save fails is reported as `justice_not_saved` and is not confirmed. The retry replays the recorded filing, and exactly one case is saved. A `relationship.progress` whose save fails is reported as `relationship_not_saved`. The partner receives nothing until the retry succeeds; then the partner is notified once. A `character.rest` whose save fails is reported as `rest_not_saved`. The retry applies the rest once (hunger falls by 18 once, not twice), and the saved world holds it.

**Persistence gate.** Verified by tests on both backends: with saving failing, a new filing is refused with `justice_persistence_unavailable`, and the case list in memory is unchanged by the refusal. The gate applies to new changes only. Replays of recorded requests are still answered.

**Idempotency.** Verified by the existing `mutation-resend-guards` test (one case after a resend; the test's expectation changed, see section 9) and by the cross-process tests. Records are kept for 90 days in `world_operations` (Stage 36) and for 256 entries in memory. Beyond those windows, a reused request ID is no longer recognised from memory; the durable record is what remains. This stage does not claim indefinite deduplication.

**Read-only operations are not gated.** Verified by the test "a read-only request does not need a request ID" (both backends): `justice.list_courts` without a request ID is answered normally.

**Concurrency.** Verified by PostgreSQL cross-process tests: (a) a `file_case` sent to a stale and a current process at once is filed once, and the stale copy reports a duplicate or a refused write, never a filing; (b) a stale process's `character.rest` is never confirmed, and a current process applies the same request ID once. The file backend has no cross-process test in this stage. Its single-process rule and lock behaviour are as in Stage 35; this stage does not change them. No lock race is claimed fixed.

## 6. Cross-process test scenarios and outcomes

Run on PostgreSQL (`naija_s37_test`, disposable) with `npm test`:

| Scenario | File | PostgreSQL |
|---|---|---|
| Suspended writes refused, state unchanged | pass | pass |
| Military leave on another character's record refused | pass | pass |
| Justice filing save fails, retry files once | pass | pass |
| Justice gate refuses a new filing while saving fails | pass | pass |
| `character.rest` confirmed after save, not applied twice | pass | pass |
| Relationship partner notified only after save | pass | pass |
| Request ID required for changing requests; not for reads | pass | pass |
| Stage 37 cross-process: justice filing at a stale and a current process | not applicable | pass |
| Stage 37 cross-process: stale rest never confirmed; current applies once | not applicable | pass |

Counts for the Stage 37 tests specifically: 7 file, 7 PostgreSQL, 2 PostgreSQL cross-process. None skipped, none TODO.

Failures during this stage, recorded honestly:

1. The focused run first failed `mutation-resend-guards` ("file_case re-sent … files a second case (gap, current behaviour)"). That test asserted the defect. It now asserts the fixed behaviour (a `command.duplicate` and exactly one case). It is a stronger assertion, not a weaker one. Its old expectation is in section 9.
2. The first full PostgreSQL run failed one new cross-process test (a 20-second wait). Cause: the wait matched only `justice.result`, `justice.error`, and `command.duplicate`. The persistence gate sends a generic `error` with the request ID, which that predicate did not match. The predicate now matches any reply carrying the request ID, and then asserts the type and code. The timeout error now shows the last messages received. The same test passed in two isolated runs and in the next full PostgreSQL run. The cause is the wait predicate, shown by the reply shape in code; the test under load was not separately re-run with the old predicate.

## 7. `character.rest` findings

- Before: `rest()` sent the character snapshot, then `flushDirty()`. The reply was sent before the save. It was in `IDEMPOTENT_COMMANDS` (request ID and fingerprint), so the duplicate record was in memory, but a failed save still reported success.
- After: `rest()` requires a request ID, applies the change, and calls `chargeAndConfirm(… "rest" …)`. The snapshot is sent only once the save succeeds. A failure is `rest_not_saved` (or `rest_outcome_unknown`), and the retry wording says "applied", not "charged".
- The persistence gate (`rest_persistence_unavailable`) applies to new rests while saving fails.
- Verified: the file and PostgreSQL rest tests, and the cross-process test (PostgreSQL). The old behaviour fails the rest test on the pre-Stage-37 engine.

## 8. R5 findings

R5 is the Stage 28 state-cap risk. Its test is `test/world-capacity-notify.test.mjs`, "R5 notify-once: a refused periodic save retries silently until a save succeeds, and a new episode notifies again". The capacity code is not changed by Stage 37.

Evidence gathered in this session:

- Unloaded: 3 of 3 runs pass (both R5 tests).
- Under load (four busy processes on this 2-CPU sandbox): 2 of 2 runs fail. The failure is an assertion, `1 !== 2`, at the check for the second episode's notice. It is not a timeout in the wait itself. The earlier Stage 35 record described timeouts, and this session shows an assertion failure under the same kind of load.
- Diagnostic (a temporary copy of the test, removed afterwards): the second over-limit episode did open. The server logged it once. The online socket then closed with code 1006 (abnormal, no close frame) 13.97 s after the second episode started. After that, the server logged 72 to 76 `multiplayer send failed` lines, and the notice was never delivered on that socket. The test's own `close()` runs only in `finally`, so the client did not close the socket.

Findings, by strength of evidence:

- Verified: the second episode opens and is logged on the server; the notice does not reach the socket; the socket closes with code 1006 about 14 s into the episode.
- Consistent with, not proven: `src/app.ts` sends a heartbeat every 15 s and terminates a socket that has not answered the previous ping. It logs nothing when it terminates. The client and server run in the same loaded process, so the heartbeat can be delayed by 17 MiB frames. This would explain a 1006 close, but nothing here shows the heartbeat fired. A different cause for the drop has not been excluded.
- Not shown: that the notice logic is wrong. The notice is produced; it is not delivered on a closed socket.
- Not tested in this session: the pre-Stage-37 engine under the same load. The Stage 35 record says the pre-stage code `f45b80f` failed in 1 of 2 loaded runs.

Status: R5 remains an open blocker. The test is not changed and its assertion is not weakened. A proper test of the heartbeat hypothesis would need a server-side log of the terminate call, and that change is out of scope for this stage.

## 9. CI investigation findings

- Current head `5f64523`: run `38204941533` ("Foundation checks"), both jobs succeeded: "World API build, lint, and tests" and "World API live PostgreSQL tests (disposable service)". Verified with `gh run view`.
- `3252af1` (run `38200747332`) and `cbcd72e` (run `38198636400`): succeeded.
- `c71964b` (run `38196966222`) and `825e0e8` (run `38196196114`): failed. The logs for these two runs could not be downloaded in this session (the log download returned `EOF`; the record is in `/tmp/ci-doc-failed.log`, outside the repository). The Stage 35 record says the live PostgreSQL job failed on both. The cause is unknown. R5 is a load-sensitive test that may be involved, but no link has been shown. No root cause is asserted here. The log fetch was not retried.
- `237de19` (run `38209331236`, pushed for this stage): **failed.** The job "World API build, lint, and tests" succeeded. The job "World API live PostgreSQL tests (disposable service)" failed at its step "Run tests with live PostgreSQL" (`npm test`). The job took about 109 s (started 05:45:24Z, completed 05:47:13Z). The check-run annotation says only "Process completed with exit code 1." It names no test.
- What could not be retrieved: the failing test name and error text. The run log (`gh run view --log-failed`) and the job log API both failed with `EOF`. The log is served from `productionresultssa9.blob.core.windows.net`, and a direct connection to that host fails with `SSL_ERROR_SYSCALL` from this sandbox, so the sandbox's outbound allowlist blocks it. This is an access limit of this environment, not evidence about the tests. `gh run rerun` (with and without `--failed`) was refused by GitHub with "cannot be rerun; its workflow file may be broken". The workflow file is active, and the run had already executed its jobs, so that message does not match the state seen here. No second CI attempt exists.
- Local reproduction of the CI configuration (PostgreSQL 18.4, the same major version as CI `postgres:18`; `npm run build`, then `NAIJA_ENV=test node --test --test-concurrency=3 test/*.test.mjs`, with the disposable `naija_s37_test` database): three runs, each 1561 tests, 1557 pass, 0 fail, 4 skip, 0 TODO (about 98 s, 102 s, and 100 s). The explicit concurrency matches what Node chooses on a 4-CPU runner (the runner size is assumed from the Stage 35 record, not verified here). CI's `npm test` runs with Node's default concurrency, not the explicit flag. No failure was reproduced.
- Earlier local observation (not CI): one serial PostgreSQL run (`/tmp/s37-pg-full.log`) had one failure, the cross-process justice race test. It has not recurred in later runs. That test's predicate was fixed (section 6). It is not linked to the CI failure.
- Root cause of the `237de19` live-PostgreSQL failure: **unknown.** It is unreproduced, and it is unverified whether it is the same cause as the earlier `c71964b` and `825e0e8` failures. The new CI run is not evidence that the code is correct, and the Stage 37 claims must be read with this failure in mind.

Changed test expectation (for review): `mutation-resend-guards.test.mjs`, "justice file_case re-sent with the same requestId". Before: `assert.equal(cases.length, 2, "current code does not deduplicate…")`, with a wait for `justice.result` only. After: the re-sent copy is `command.duplicate`, and `cases.length` must be 1.

## 10. Test totals

Run with `npm run check` (file backend; lint, build, and tests), and `npm test` with `DATABASE_URL` pointing to a disposable `naija_s37_test` database (PostgreSQL). Counts are from the final runs.

| Suite | Tests | Passed | Failed | Skipped | TODO |
|---|---|---|---|---|---|
| File backend (`npm run check`) | 1324 | 1270 | 0 | 54 | 0 |
| PostgreSQL (`npm test`, live DB) | 1561 | 1557 | 0 | 4 | 0 |
| PostgreSQL, CI configuration (`npm run build`; `node --test --test-concurrency=3`; three runs) | 1561 each | 1557 each | 0 each | 4 each | 0 each |

The three CI-configuration runs are a diagnostic against the CI failure in section 9. Their result is the same as the main PostgreSQL run. They do not reproduce the CI failure.

The 54 file-backend skips are database-gated tests (for example the Stage 36 cross-process and request-gate tests, and the backup and migration live tests) that need `DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true`. The 4 PostgreSQL skips are live-TLS tests that need `TLS_TEST_DATABASE_URL`. No skipped test is counted as passed.

Per family, for the Stage 37 tests (each is run on both backends unless noted):

| Family | Tests | File | PostgreSQL |
|---|---|---|---|
| Suspended writes (military, crime, police) | 1 | 1 pass | 1 pass |
| Military leave ownership | 1 | 1 pass | 1 pass |
| Justice filing (save failure; gate; resend) | 3 (2 new, 1 existing `mutation-resend-guards`) | 3 pass | 2 pass (new) + 1 cross-process (PG only) pass |
| Character rest | 1 new + 1 cross-process | 1 pass | 1 pass + 1 pass |
| Relationship partner notice | 1 | 1 pass | 1 pass |
| Request-ID rule and read-only exception | 1 | 1 pass | 1 pass |

Not separable: per-family totals for the whole suite. Those would need test-to-family tagging, which this stage did not add.

## 11. Build, type-check, lint, CI, and push status

- Build: `npm run build` passes. Type-check: `tsc --noEmit` passes with no errors.
- Lint: `npm run lint` passes.
- `npm run check`: passes (section 10).
- `npm test` with PostgreSQL: passes (section 10).
- CI for `237de19` (run `38209331236`): the foundation job passed; the live PostgreSQL job **failed** (section 9). Cause unknown. Not green.
- Push: `5f64523..237de19`, fast-forward only, never forced. The remote commit was verified at `237de19` after the push.

## 12. Behaviour changes (for review)

- Changing requests in justice, police, military, crime, `relationship.progress`, `family.childbirth`, and `character.rest` now require a request ID. A request without one is refused with `request_id_required`. The repository has no client that sends these message types. Any external client must send request IDs.
- Replies in these families now come after the save. A save failure is reported with the code `<family>_not_saved` or `<family>_outcome_unknown`. Its message type is:
  - `relationship.error` for relationship proposals (new type);
  - `family.error` for childbirth (new type);
  - `error` for `character.rest` (the existing snapshot-style error, as before);
  - `error` for the persistence gate (`<family>_persistence_unavailable`) in every family, the shared error reply.
  - Justice, police, military, and crime save failures use their existing `<family>.error` types.
- Resending a recorded request now returns `command.duplicate` (or the replay) instead of a second effect.
- Suspended operations return their codes. Suspended operations keep their existing codes and gate order (suspension is checked before the gate).
- A changed test expectation is listed in section 9.

## 13. Remaining risks and next stage

Verified risks:

- **The live PostgreSQL CI job failed on `237de19` (section 9). Its cause is unknown, and it is not reproduced locally in three CI-configuration runs. This is the top open risk. Stage 37 is not CI-green.** The next step needs the failing test name, which the sandbox cannot download. A rerun was refused by GitHub.
- Incomplete authority (section 4): station checks for police `dispatch_unit` and `open_investigation`; victim checks for `commit_crime`.
- Unverified authority for several gated operations (section 4), and no socket tests for `submit_proposal`, `submit_evidence`, `issue_judgment`, `file_appeal`, `family.childbirth`, and the positive path of `request_leave`.
- R5 remains open (section 8). The two older CI failures remain unexplained (section 9).
- The file backend is still single-process, as in Stage 35. No multi-host safety is claimed.
- The 90-day and 256-entry idempotency windows are the limits.

Suggested next stage (Stage 38): add station and victim authority checks for the police and crime operations above, add socket tests for the remaining justice and family actions, and decide R5 by a test of the heartbeat hypothesis (a server-side log of terminate calls under load). Business and organisation payments, revenue, tax, fines, borrowing, and minting remain disabled and are not part of the next stage.
