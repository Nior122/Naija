# Stage 36: Cross-Process Transaction Safety and Request Idempotency

Status: complete for the scope below, with named open items. Nothing in this stage makes the project production-ready, and it makes no multi-host claim.
Production runs on PostgreSQL. The file backend is for development and tests (see `docs/PERSISTENCE_FILE_BACKEND.md`).

## 1. Starting and final hashes

- Branch: `arena/00cdea0e-naija`. Starting commit: `3252af1` (Stage 35), verified clean and equal to `origin/arena/00cdea0e-naija` at the start of this stage. Its CI run `38200747332` passed.
- Final commit: the commit that adds this document. A file cannot record its own hash, so the final hash is in `git log arena/00cdea0e-naija` and in the final report.
- The CI runs that failed intermittently (live PostgreSQL job, step "Run tests with live PostgreSQL"): `38196196114` on `825e0e8` and `38196966222` on `c71964b`. Their logs could not be downloaded, so the failing test names are unknown. See section 3.

## 2. Summary

- Duplicate requests are now recognised across processes. The durable record of a request is written in the same PostgreSQL transaction as the world change it applied, under the version fence.
- A request ID that is reused for a different command or body is refused with `request_id_reused` and changes nothing. Before this stage, any repeat of an ID was answered as a duplicate. This is a deliberate contract change (section 6).
- A second copy of a request that is still being processed in the same process now waits for the first, then is answered by the gate. Before this stage, both copies could pass the duplicate check before either was recorded.
- Nine new live-PostgreSQL tests run two or more game-server processes over one world (`test/cross-process-requests-stage36.test.mjs`). Two further gate tests cover the legacy-ID and reused-ID-with-different-command cases (`test/request-gate-stage36.test.mjs`).
- Mutation checks show the new tests fail when the durable lookup or the version fence is removed (section 8).

## 3. The intermittent CI failures

- What is known: two runs of the live PostgreSQL job failed on `825e0e8` and `c71964b`. Each completed normally in about 87–90 s. The failing test names and the error text could not be retrieved (the logs were not downloadable, and `gh run rerun` was not used).
- What was tried: four CI-like local runs with the live database and `--test-concurrency=3`. Three of them ran on an earlier revision of this stage's code (their logs are `/tmp/s36-ci-run-1.log` to `/tmp/s36-ci-run-3.log`, which were not saved to the repository). All three had 1534 tests, 1530 passing, 0 failing, and 4 skipped (the TLS tests). The final run (section 8) had 1545 tests, 1541 passing, 0 failing, and 4 skipped.
- What is not established: the cause of the CI failures. The collision was not reproduced under CI-like local concurrency. The work in this stage fixes real cross-process and in-process duplicate gaps, but nothing here shows that those gaps caused the CI failures. **This is unresolved.**

## 4. What was wrong at the start of the stage

At `3252af1`:

- The duplicate check was `player.recentRequestIds.includes(requestId)`, held in memory. A request applied by another process was not recognised, and a request ID with a different command or body was answered as a duplicate.
- There was no in-flight guard. Two copies of one request that arrived close together could both pass the check before either was recorded, so both could apply.

## 5. Design

### 5.1 Durable request records

- Migration version 3 (`services/world-api/src/database/schema.ts`) adds the `world_operations` table: `(world_key, player_id, request_id)` primary key, with `command`, `fingerprint`, `world_version`, and `recorded_at`.
- A request that changes the world is queued as a record when it is applied (`markRequestProcessed`). The next save writes the queued records in the same transaction as the world update, using the version-fenced conditional `UPDATE`. A record therefore exists if and only if the change it describes was committed.
- A failed save keeps its records queued. A later successful save writes them with the change they describe. A fenced or crashed save writes neither.
- Records older than 90 days (`OPERATION_RECORD_RETENTION_DAYS`) are pruned during saves, at most 1000 rows per save.

### 5.2 Fingerprint and verdict

- `requestFingerprint(command, body)` is a SHA-256 of the canonical JSON of the command and the message body, without the type and the request ID. Property actions keep the Stage 35 fingerprint (`propertyRequestFingerprint`).
- The verdict for an incoming request with an ID (`priorRequestVerdict`):
  1. A record in memory (the last 256 per player) is compared first.
  2. An ID in the memory list with no record is a **legacy** ID: it is answered as a duplicate and is never applied again.
  3. Otherwise the durable record is read (`findOperation`). None means new.
  4. A record with the same command and fingerprint is a duplicate. Anything else is `request_id_reused`.
- If the durable lookup fails, the request is refused with `request_check_unavailable` and nothing is changed. The engine does not guess.

### 5.3 Concurrency inside one process

- A tracked request (a money command, or `property.action`) registers an in-flight entry by player and request ID. A second copy waits for the first to finish, then the gate answers it (normally as a duplicate).
- The first success reply releases the in-flight entry (`confirmMoneyReply`). The save that follows is not held behind it, so a retry during that save is answered from the record.
- A request whose money change is not yet confirmed is still answered from its pending record once its save succeeds (Stage 34 behaviour, unchanged).

### 5.4 Cross-process roles

- Every session resume saves the world (`resumeSession` flushes), so the last process to resume is current, and earlier ones are stale. Two processes cannot both be current at the same version.
- A stale process is fenced on its next save (`WorldStateConflictError`) and writes nothing. It still answers duplicates and reused IDs from the durable record, without saving.

### 5.5 Limits of the idempotency window

- In the saved world, the last 256 request records per player are kept (`recentRequestRecords`). The file backend keeps the same window, because the records are part of the world file. It has no `world_operations` table.
- On PostgreSQL, the durable table keeps records for 90 days. A retry of an ID that is older than both the 256-entry window and 90 days is a new request. This is a stated limit, not a guarantee.

## 6. Behaviour changes (for review)

These are deliberate changes to existing behaviour. Each one is also visible in a test expectation.

1. **Reused ID with a different body is refused, not replayed.** Before, `economy-money-durability` expected a second `dep-conflict` request with a different amount to get `command.duplicate`. It now gets `request_id_reused`, and nothing changes. The no-double-charge safeguard holds, and the client is no longer told that a different request succeeded. This matches the Stage 35 property rule. **The user should confirm this decision.**
2. **The fingerprint covers the whole body.** A retry that differs only in a field the server ignores is refused as reused. `careers.test.mjs` sent such a retry (it omitted `character_id`, which the server takes from the caller). The test now sends a byte-identical retry for the duplicate case, and asserts `request_id_reused` for the different-body case. This is fail-closed. Canonicalising the ignored fields per command is possible future work.
3. **`character.rest` still replies before its save.** This is existing behaviour, and no money is involved. A failed save after the reply leaves no record, so a retry applies the rest again, which is harmless. Changing the order is out of this stage's scope. The cross-process test waits for the save before its duplicate check.

## 7. Changes

Source (`services/world-api/src`):

- `persistence/request-records.ts` (new): the record type, canonical JSON, the fingerprints, `compareWithRecord`, the 90-day constant.
- `database/schema.ts`, `database/migrations.ts`: migration version 3 (`world_operations`), with its down-migration.
- `database/world-store.ts`: records queued and written in the save transaction; pruning; `findOperation`; fenced saves write no records.
- `multiplayer/world-engine.ts`: the in-flight guard, the record write in `markRequestProcessed`, the verdict, the reused-ID reply, the durable property check.
- `multiplayer/persistence.ts`, `multiplayer/types.ts`: optional `queueOperation` and `findOperation` on the store interface; validation of `recentRequestRecords` (at most 256 entries).

Tests (`services/world-api/test`):

- `cross-process-requests-stage36.test.mjs` (new, 9 live tests) and `request-gate-stage36.test.mjs` (new, 2 live tests). Both are skipped with a stated reason unless `DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true` are set, and both refuse a database whose name lacks "test".
- `support/server-process.mjs` (new): a child game server over the PostgreSQL store. It has a test-only crash injection (`S36_CRASH`) that exists only in this support file.
- `support/faulty-store.mjs`: forwards `queueOperation` and `findOperation`. Before this change, the in-process PostgreSQL tests silently skipped the durable path.
- `support/creation-backends.mjs`: PostgreSQL `cleanup()` also deletes `world_operations`. `durableRecords()` is new, and `restoreDurable(snapshot, records)` restores the records as well when they are given. Without this, a restore left records committed by a later shutdown save, and the restored file disagreed with them.
- Expectation changes, each deliberate: `economy-money-durability` (section 6.1); `careers` (section 6.2); `migration-concurrency` and `persistence-readiness` (the schema version is now 3, and the down-migration is version 3); `mutation-ordering` and `property-mutation-stage35` (pass the records to `restoreDurable`, same assertions).

Documentation: this file; `docs/DATABASE_PLAN.md` (Stage 36 note).

## 8. Test results and evidence

Commands: `npm run build`, `npx tsc --noEmit -p .`, `npm run lint`, and `node --test --test-concurrency=3 test/*.test.mjs` in `services/world-api`, run twice. The second run used `DATABASE_URL` for `naija_s36_dev_test`, a disposable database whose name contains "test".

| Run | Tests | Pass | Fail | Skip | TODO | Notes |
|---|---|---|---|---|---|---|
| File backend and unit tests (no `DATABASE_URL`) | 1315 | 1263 | 0 | 52 | 0 | 48 live-PostgreSQL tests skipped with their stated reason, plus the 4 TLS tests |
| Live PostgreSQL (`DATABASE_URL` set) | 1545 | 1541 | 0 | 4 | 0 | The 4 skips are the TLS live tests, which need `TLS_TEST_DATABASE_URL`. CI does not run them either |

The two runs enumerate tests differently (skipped live tests are listed without being run), so their totals are not added together. No skipped test is reported as passed.

Build, typecheck, and lint: `npm run build` exit 0; `npx tsc --noEmit -p .` exit 0; `npm run lint` exit 0. Unused imports in the changed test files were checked with a script: none.

Focused cross-process run (`/tmp/s36-xp6.log`, before the window test was added): 8 of 8 pass. The window test (`/tmp/s36-xp11.log`) and the gate tests (`/tmp/s36-gate1.log`) pass.

Mutation checks (the code was changed in the compiled `dist`, the cross-process file was run, and the build was restored from source afterwards):

- Durable lookup removed (`durableRequest` returns nothing): tests 3, 5 and the window test fail. Test 2 still passes, because the version fence stops the second copy's save, so the in-process path alone keeps it safe.
- Version fence removed (the conditional `UPDATE` ignores the version): tests 1, 5, 6 and the store test fail.

CI-like local runs 1 to 3 are described in section 3.

## 9. Race status

| Race | Status | Rule that enforces it | Evidence |
|---|---|---|---|
| Two copies of one request in one process | Resolved for one process | In-flight wait, then the gate answers the second copy | `economy-money-durability` "the same request sent twice at once is applied once" (existing); mutation-ordering pending-reply tests (existing) |
| The same request ID at a stale and a current process, at once | Resolved for protocol-following processes on one Linux host | Version fence in the same transaction as the durable record | Cross-process test 2 |
| Two processes race for one listing | Resolved for protocol-following processes on one Linux host | Version fence; exactly one purchase is applied | Cross-process test 1 |
| Crash before COMMIT | Resolved | Nothing is written; the retry applies once | Cross-process test 4 |
| Crash or lost reply after COMMIT | Resolved | The record is in the committed transaction; the retry is a duplicate | Cross-process test 5 |
| Stale writer after another process commits | Resolved | Fenced; writes nothing and answers duplicates from the record | Cross-process test 6 |
| Two processes start on a world with no treasury allocation | Resolved for protocol-following starters on one host | Single allocation write under the version fence | Cross-process test 7 |
| The intermittent CI failures | **Unresolved** | Not reproduced; cause not identified | Section 3 |
| Multi-host safety | **Not claimed** | Not tested; the version fence is a PostgreSQL row check, and the file lock is single-host | None |
| R5 notify-once (`test/world-capacity-notify.test.mjs`) | **Unchanged, still open** | Not in this stage's scope | Unchanged |

## 10. Operations

- Migration version 3 is required. The server refuses to start on an out-of-date schema. Run `npm run db:migrate` against the database before starting the server.
- The file backend is unchanged in its operating contract (single process per world file, advisory file lock). Its request window is the last 256 records per player.

## 11. Remaining gaps and next stage

- The CI failures remain unexplained. The next step is to obtain the failing test names from the GitHub run (through the web interface, if the API log download is still unavailable) or add per-test timing and output capture to the live job.
- `character.rest` replies before its save (section 6.3).
- Canonicalise fields that the server ignores before fingerprinting (section 6.2), if the user wants retries that differ only in ignored fields to be duplicates.
- Multi-host guarantees need a separate design and tests.
- The 90-day record window and the 256-entry in-memory window are the idempotency limits (section 5.5).
- R5 notify-once is still open.
- A queued record that conflicts with an existing record (the same player and request ID) makes that save fail, closed, on every attempt. The current protocol does not produce this case (a repeated ID is answered from memory or the record, not queued again), and no test covers it. It should get a test, or a defined recovery, before multi-writer use is extended.
- The business and organisation payment work, and the treasury allocation timing decision from Stage 35, are unchanged.
