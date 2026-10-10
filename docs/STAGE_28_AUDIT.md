# Stage 28 Audit — Persistence, Monitoring, and Verification Status

**Date:** 2026-10-10
**Branch:** `arena/00cdea0e-naija` (base `dc20b80`, stage-27)
**Status:** PARTIAL. Stage 28 is NOT complete. Code is written and tested locally; live and production evidence is missing for the items marked below.

This document follows the acceptance evidence rule: every criterion is marked **PASS**, **FAIL**, **PARTIAL**, **BLOCKED**, **NOT IMPLEMENTED**, or **NOT TESTED**. Code written is not a live test success. A live test success against a local PostgreSQL instance is not a production deployment.

---

## 1. Summary

| Area | Status |
|---|---|
| DATABASE_URL investigation (6 questions) | PASS (answers below; question 3 unresolved) |
| Secure DATABASE_URL in Arena | BLOCKED |
| PostgreSQL persistence code (world snapshot, fencing, startup policy) | PARTIAL (tested on local PostgreSQL 18.4 only) |
| JSON world-state loader and integrity (data-integrity pass) | PARTIAL. Loader fixed and tested offline; see section 10. Not fully resolved. |
| Record-level validation (property, government, election, justice) | PARTIAL. Implemented and tested; all 48 maps have at least one mutation row (134 rows); corpus evidence covers 11 maps; see section 11. |
| Health test design and test isolation | PASS (local). See section 11. |
| Stage 27 report files | CREATED WITH GAPS. Originals never existed; see section 11. |
| Money integrity (account balance) | PARTIAL (tested on local PostgreSQL only) |
| JSON → PostgreSQL importer | DEFERRED by user decision. Not in this commit. |
| Monitoring (Prometheus endpoint) | PARTIAL (unit-tested; not scraped by a real Prometheus) |
| Monitoring (Grafana, alerts, log aggregation, tracing) | NOT IMPLEMENTED |
| Load testing | NOT IMPLEMENTED |
| Platform testing (#10) | BLOCKED |
| 3D multiplayer testing (#11) | NOT TESTED |
| Live Neon validation | BLOCKED |

---

## 2. DATABASE_URL Investigation (the six questions)

Credentials were never printed. No connection string appears in this repository.

1. **Can the backend commands run in the sandbox?** Yes. `npm run db:status` and `npm run db:migrate` run against any reachable PostgreSQL. Verified against a disposable local PostgreSQL 18.4 cluster on `127.0.0.1:55433` (database `naija_stage28_test`, role `tester`, trust auth; not Neon, not production). The cluster on `127.0.0.1:55432` never accepted connections with any role tried, so it is not evidence for anything in this document.
2. **Is DATABASE_URL set in the sandbox?** No. The live PostgreSQL tests were run by setting DATABASE_URL to the local instance for that command only.
3. **How does Arena store secrets?** NOT VERIFIED. A search for Arena's secret configuration returned no relevant documentation, and this session has no tool that reads Arena project settings. Check Arena's project or settings UI for the supported mechanism. Do not assume a secret is injected into the sandbox.
4. **Which deployment platform will run the server?** Undecided. The repository has no deployment configuration, and CI (`.github/workflows/ci.yml`) has no database secret.
5. **Does sandbox state persist?** Files under `/home/user` persist through snapshots. Environment variables and shell state do not. The sandbox lifetime is unconfirmed. Any secret must be re-supplied through a secure mechanism, not kept in a file in the repository.
6. **What must the user do?** See section 6.

### Safest alternative if Arena cannot store the secret

Use a disposable Neon development or branch database (never production). Give the app a limited-privilege role. Store DATABASE_URL in the deployment platform's secret store, or in a gitignored local `.env` for development. For CI, use a GitHub Actions secret only for a job that opts in with `NAIJA_ALLOW_DB_TESTS=true`. Never commit it, never put it in `.env.example`, and rotate any credential that is pasted into chat.

---

## 3. Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | DATABASE_URL investigation answered with no credential printed | PASS | Section 2. Question 3 is unresolved and marked as such. |
| 2 | Secure DATABASE_URL configured in Arena | BLOCKED | Arena's secret mechanism is not verified (section 2, Q3). No DATABASE_URL exists in the sandbox. |
| 3 | TLS: certificate verification ON by default | PASS | `test/database-config.test.mjs` (9 tests) and `test/persistence-policy.test.mjs` (12 tests) pass offline. |
| 4 | TLS: `sslmode=disable` and `DB_SSL=false` require explicit opt-in; `prefer`, `allow`, `no-verify` rejected | PASS | `persistence-policy.test.mjs` "TLS policy" cases. |
| 5 | TLS handshake verified against a real CA-signed server | NOT TESTED | No TLS-enabled PostgreSQL instance was available. Local tests use `DB_SSL=false` and do not exercise certificate verification. |
| 6 | Startup refuses when DATABASE_URL is missing (postgres mode) | PASS | `persistence-policy.test.mjs` "requires DATABASE_URL". |
| 7 | Startup refuses when the database is unreachable, and the error contains no password | PASS | `persistence-policy.test.mjs` "unreachable database" (asserts the secret is absent from message and stack). |
| 8 | Startup refuses an unmigrated or outdated schema | NOT TESTED | Code exists in `src/persistence/open.ts`; no test exercises this path. |
| 9 | File mode is labeled as development only, and never as PostgreSQL | PASS | `persistence-policy.test.mjs` "file mode" cases; `/health` message checked. |
| 10 | Live DB tests run only against an explicitly allowed database | PASS | The live files (`database.test.mjs`, `postgres-persistence.test.mjs`) skip unless `DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true` are both set. The default run shows 19 skipped. |
| 11 | Migration v2: idempotency keys scoped per character (not global) | PASS | `postgres-persistence.test.mjs` "scoped per character" and "migrations applied through version 2" (local PG 18.4). |
| 12 | Migration v2 down-migration | NOT TESTED | `MIGRATION_V2_DOWN_SQL` exists; it was not executed. |
| 13 | Migration CLI `status` and `migrate`; re-running is a no-op | PASS | Local PG 18.4: `status` reports version 2, up to date; second `migrate` exits 0. Covered by `postgres-persistence.test.mjs`. |
| 14 | Concurrent debits cannot overdraw a balance | PASS | 25 concurrent debits of 10 on balance 100: exactly 10 succeed (local PG 18.4). |
| 15 | Same idempotency key applied exactly once under concurrency | PASS | 10 concurrent credits with one key: balance increases by 50 once; one ledger row. |
| 16 | Failed transaction rolls back balance and ledger together | PASS | `postgres-persistence.test.mjs` "rolls back" (local PG 18.4). |
| 17 | Database rejects a negative balance (check constraint) | PASS | `postgres-persistence.test.mjs` "negative" (local PG 18.4). |
| 18 | Inventory integrity | NOT TESTED | The `inventory` table exists; no inventory code path was written or exercised. |
| 19 | World snapshot: first open creates, later opens load the same version | PASS | `postgres-persistence.test.mjs` (local PG 18.4). |
| 20 | Stale writer is fenced; its data is not stored; health reports failure | PASS | Two `PostgresWorldStore` instances on local PG 18.4. Health = fail; stored value keeps the first writer's data. |
| 21 | Fenced instance cannot shut down cleanly (refuses to overwrite) | PASS | `postgres-persistence.test.mjs` "cannot shut down cleanly". |
| 22 | Two real processes writing the same world | NOT TESTED | Fencing was tested with two instances in one Node process, not two OS processes. |
| 23 | Recovery after a simulated crash (final save skipped) | PASS | Identity created before a crash is resumed by a fresh instance (local PG 18.4). This simulates the crash; it does not kill a process. |
| 24 | Recovery after a real process kill | NOT TESTED | Not performed. |
| 25 | Graceful shutdown saves final state; recovered on restart | PASS | `postgres-persistence.test.mjs` "graceful shutdown" (local PG 18.4). |
| 26 | Known limitation: a save committed but whose acknowledgement is lost is reported as failure | PARTIAL | Documented behavior. The next save is fenced (fail-closed). Not tested with fault injection. |
| 27 | `/health` reports persistence status (200 healthy, 503 fenced) | PASS | `postgres-persistence.test.mjs` "Health" and "Multi-instance" (local PG 18.4). |
| 28 | Account and character repository persistence | PARTIAL | Stage 27 repositories tested on local PG (7/7). The engine does not read or write the account and character tables; it persists through the world snapshot. |
| 29 | JSON → PostgreSQL importer: dry-run writes nothing | DEFERRED | Not in this commit. Passed offline and CLI dry-run checks before deferral. Files: `/home/user/deferred/stage-28-importer/` (outside the repository). |
| 30 | Importer: create, no-op re-run, refuse different world, `--replace` with backup, rollback on interruption, no partial first import | DEFERRED | Passed live cases on local PG 18.4 before deferral. Not verified in the committed tree. |
| 31 | Importer: source is never modified; backup has a verified checksum | DEFERRED | Covered by the deferred importer tests, which passed before deferral. |
| 32 | Importer: JSON → PostgreSQL → resumed session | DEFERRED | Covered by the deferred importer test "JSON to PostgreSQL to session", which passed before deferral. |
| 33 | Importer run against real player data | NOT TESTED | No real data was provided. Do not run any importer against production. |
| 34 | Importer kept in this commit | DEFERRED | The user chose to defer it (section 7). |
| 35 | Prometheus endpoint (`/metrics/prometheus`, text format 0.0.4) | PASS | `monitoring.test.mjs` (9 tests) and integration tests. |
| 36 | Prometheus scrape by a real server; alerting rules | NOT TESTED | No Prometheus server was run. |
| 37 | Grafana dashboards, alert rules, log aggregation, distributed tracing | NOT IMPLEMENTED | None were created. |
| 38 | Load test (throughput, latency, persistence under load) | NOT IMPLEMENTED | None was written or run. |
| 39 | Platform testing (#10) | BLOCKED | No deployment platform was chosen (section 2, Q4). |
| 40 | 3D multiplayer testing (#11) | NOT TESTED | Godot is not installed in this sandbox. |
| 41 | Cross-region events, advanced sync, anti-cheat (from Stage 25 list) | NOT IMPLEMENTED | Not started. |
| 42 | Stage 27 documentation corrections (table count, TLS claim) | PASS | `docs/STAGE_27_DATABASE_ARCHITECTURE.md`: correction note added; 14 tables; `sslmode=verify-full`. |
| 43 | Stage 27 report files (infrastructure, load test, security and recovery, launch readiness) | CREATED WITH GAPS | Four files now exist (`STAGE_27_INFRASTRUCTURE_REPORT.md`, `STAGE_27_LOAD_TEST_REPORT.md`, `STAGE_27_SECURITY_AND_RECOVERY_REPORT.md`, `STAGE_27_LAUNCH_READINESS_REPORT.md`), written from repository evidence and labelled. Stage 27 never produced them (see section 11). The load test report records NOT TESTED; no measurement exists. |
| 44 | Lint: no new errors compared with the baseline | PASS | Baseline `dc20b80`: 52 errors. Current: 51 errors (46 unused-vars, 5 explicit-any, all pre-existing). Measured with ESLint on `services/world-api/src`. |
| 45 | Full test suite, default configuration (no database) | PASS | Commit `6ae2001`: 602 total, 583 pass, 0 fail, 19 skipped. |
| 46 | Full test suite, against local PostgreSQL 18.4 | PASS | Commit `6ae2001`: 602 total, 602 pass, 0 fail, 0 skipped (cluster `127.0.0.1:55433`). Local instance only; not Neon. |
| 47 | Live Neon validation | BLOCKED | Requires a Neon dev or branch database and a secure DATABASE_URL (section 6). |
| 48 | Production deployment readiness | NOT IMPLEMENTED | Not achieved. Stage 28 cannot be marked complete from this document. |
| 49 | Record-level validators for property, government, election, and justice maps | PARTIAL | Implemented in `src/multiplayer/record-validation.ts` and wired into `validateState`. Invalid records are rejected, never deleted or regenerated. All 48 map types are validated. All 48 have at least one mutation row (134 rows; section 11). Corpus evidence covers 11 maps only. |
| 50 | Record validator diagnostics do not expose values | PASS | Tests assert the message contains no field values (`record-validation.test.mjs`, no-value-leak test). |
| 51 | Valid schema-18 world round-trips with no loss and stable IDs | PASS (synthetic and corpus) | Seeded engine-saved world round trip test (`record-validation.test.mjs`). Corpus: 284 files, 0 record loss, 0 ID mismatches (`roundtrip-summary.json`, read-only, outside Git). |
| 52 | Health test is deterministic about the contract | PASS | The concurrent test asserts the contract (status follows checks; HTTP 503 only for unhealthy). Persistence fail, throw, pass, and warn cases are tested. Disabling the persistence check makes four of them fail. |
| 53 | Integration tests use an isolated state file; live file unchanged | PASS | `isolation.test.mjs`: every `createApiServer` call in the suite passes `stateFile` or `worldStore`; a temp file is written and the live file is not; running the integration file leaves the live file byte-for-byte unchanged (SHA-256 checked). |
| 54 | Stage 28 complete | NOT ACHIEVED | Blocked by the items in section 5 and section 11. Not decided from the local test suite. |

---

## 4. Defects Found and Fixed During This Stage

1. **Economy, career, business, property, government, election, and justice data were discarded on every JSON load at schema 18 (pre-existing).** The economy case was reproduced: validating the same saved state twice produced new transaction IDs. The other five groups use the same pattern in code; they were not reproduced separately. `validateState` in `src/multiplayer/persistence.ts` used exact-version checks (`schemaVersion === 4 || … === 9`) for these map groups. The current schema version is 18, so these maps were replaced with empty objects on every load, and the economy initializer regenerated accounts and transactions with new random IDs. The `===` ranges were introduced by commits `0ee19f8` (stage-8) and `0edaa4f` (stage-12). Fixed by changing each condition to `schemaVersion >= N`, which matches the same versions up to 9 and fixes 10 and above. Regression test: `test/state-load-regression.test.mjs` "economy data survives repeated loads". **Action for the user:** check whether any saved `world-state.json` in use has economy or career data that was lost before this fix. This change alters load behavior of the live JSON store.
2. **`MigrationManager.getCurrentVersion()` and `getAppliedMigrations()` used the global database singleton** instead of the connection they were given. The CLI owns its own connection, so `status` reported version 0 for a migrated database, and `migrate` could reapply migrations. Fixed. Regression test: `postgres-persistence.test.mjs` "on its own connection".
3. **Stage 27 connection code did not verify TLS certificates** (`rejectUnauthorized: false`). Fixed by default verification in `buildPoolConfig`. Documented in `STAGE_27_DATABASE_ARCHITECTURE.md`.
4. **Stage 27 documents said 15 tables; the schema creates 14** (13 in `schema.ts` plus `schema_migrations`). Corrected.
5. **URL `sslmode` silently overrides explicit `ssl` options in `pg`.** Now parsed and enforced; unsupported modes are rejected.
6. **Live PostgreSQL test file used `test.skip(boolean, …)`, which always skips.** Replaced with the `{ skip }` option.
7. **Schema-18 validators never ran for career, economy, or business records.** The gates in `validateState` (`schemaVersion === 3 … 9`, `=== 4 … 9`, `=== 5 … 9`) were exact-version checks, so any later schema skipped them. They are now `>= 3`, `>= 4`, `>= 5`. Before this change, a corrupt business record passed `validateState` at schema 18. Regression test: `state-load-regression.test.mjs` "business, party and election records survive schema-18 loads and are validated". All 284 saved-state copies in the test corpus (section 10) pass the stricter validators. The corpus has no business records, so business validation is tested only by the new fixture test.
8. **`test/integration.test.mjs` wrote the live world file on every test run.** `createApiServer` was called with no `stateFile`, so it fell back to `services/world-api/data/world-state.json` and flushed on shutdown. The test now uses a temporary state file that is removed afterward. The live file was not modified by any test run after this fix (checked by byte comparison against the backup).
9. **Flaky health assertion in the concurrency test.** The event-loop check is one timing sample, and the heap check depends on load, so the old test (which required `healthy`) failed when the host was busy. The first fix accepted `healthy` or `degraded`. That weakened nothing important, but it still did not test the contract. The test now asserts that every response is HTTP 200, is not `unhealthy`, and follows the health contract (overall status follows the check results; HTTP 503 only for `unhealthy`). Persistence-driven tests cover fail, throw, pass, and warn. Health thresholds are unchanged. See section 11.

---

## 5. Known Limitations

- **Single-writer snapshot design.** `PostgresWorldStore` stores the whole world as one JSONB row and fences stale writers with a version check. It is correct for one active writer. It is not a horizontally scalable design, and it does not provide per-character row locking for world-level state.
- **Lost acknowledgements.** If a save commits but the response is lost, the instance reports failure and fences itself. The next save then requires a restart. This is fail-closed, not data loss, but it can cause a brief outage.
- **Account and character tables are not used by the game engine.** The engine's source of truth is still the world snapshot. Money updates in the repositories are tested, but the engine's economy does not call them.
- **Economy transaction IDs are random at creation.** After fix 1 they are stable across loads. Records that were regenerated by the old bug have no original IDs to recover.
- **File backend is single-instance only.** It is labeled as development mode.
- **Local tests use `DB_SSL=false`** against a local server without TLS. They do not exercise the default TLS path.
- **Record-level validation is partial.** `validateState` now rejects malformed records in the property, government, election, and justice maps (section 11). All 48 map types have at least one mutation row, but the corpus covers only 11 maps. A malformed record in a map the corpus does not cover is shown to be rejected only by synthetic fixtures. Validator enumerations are copied from the domain type unions and can drift if those types change.
- **NPC career timestamps change on every load.** `refreshNpcCareers` in `src/careers/service.ts` sets `updated_at` to the load time on NPC career rows. This was measured on 833 rows in the corpus. It is metadata churn, not record loss or ID regeneration. It has not been changed, because it is engine behavior.
- **Metrics endpoints are unauthenticated.** `/metrics` and `/metrics/prometheus` expose connection counts, memory, and performance figures. They contain no secrets, but restrict them at the network or platform layer before public deployment.
- **Stage 27 password hashing was never verified.** `STAGE_27_DATABASE_ARCHITECTURE.md` lists it as complete. Nothing in this stage checked it. The `accounts` table stores a `password_hash` column; no login route uses it.

---

## 6. User Steps (Neon, for the DATABASE_URL and live tests)

1. In Neon, create a **development project or a branch** dedicated to Naija testing. Do not use the production database.
2. Create a **runtime role** with only the privileges the app needs, and a separate **migration role** for `npm run db:migrate`. Do not use the project owner role at runtime.
3. Build the connection string with `sslmode=verify-full`. Neon's certificates use a public CA, so no `DB_SSL_REJECT_UNAUTHORIZED` override should be needed.
4. Store the string in the deployment platform's secret store, or in a **gitignored** local `.env`. Confirm first how Arena supplies secrets (section 2, Q3). Never put it in source, `.env.example`, a commit, or chat. If a string is ever pasted into chat, rotate the password.
5. Run `npm run db:status`, then `npm run db:migrate`, against the development database only.
6. Run the live tests with `DATABASE_URL=… NAIJA_ALLOW_DB_TESTS=true npm test` from `services/world-api`. These tests write `t28-*` rows and additive migrations. They are not safe against a database with real data.
7. For CI, add the string as a GitHub Actions secret and use it only in a job that sets `NAIJA_ALLOW_DB_TESTS=true`.
8. **Do not create a `.env` containing a real credential inside this workspace.** `.gitignore` excludes `.env` from Git, but the workspace is captured in snapshots. Create the file only on your own machine.

---

## 7. Decisions

- **JSON → PostgreSQL importer: DEFERRED by the user.** Its three files (`json-import.ts`, `import-cli.ts`, `json-import.test.mjs`) are kept outside the repository at `/home/user/deferred/stage-28-importer/`. The root `persistence:import` script was removed. Before any real import, the importer needs its own review, a rerun of its tests against the committed loader, and a backup plan.
- **Deployment platform.** Needed for platform testing (#10) and for choosing where the DATABASE_URL secret lives.
- **Confirm the economy-data fix (defect 1)** is acceptable for the live JSON store.

---

## 8. Commands Run for This Document

- `npm run build` (services/world-api): PASS, exit 0.
- `npx tsc --noEmit -p .`: PASS, exit 0.
- `npm test` with no database configured (commit `6ae2001`): 602 total, 583 pass, 0 fail, 19 skipped, exit 0. Previous pass (`1c7d5e9`): 511 total, 492 pass.
- `DATABASE_URL=postgres://tester@127.0.0.1:55433/naija_stage28_test?sslmode=disable DB_SSL=false NAIJA_ALLOW_DB_TESTS=true npm test` (commit `6ae2001`; cluster `/tmp/pgdata2`, PostgreSQL 18.4, `initdb` with `--auth=trust`, local only): 602 total, 602 pass, 0 fail, 0 skipped, exit 0. The `sslmode=disable` plus `DB_SSL=false` pair is the explicit local-development opt-out required by `connection.ts`. Without it, the live tests fail with "The server does not support SSL connections" (19 failures; this was observed and is a configuration issue, not a code defect). The cluster on `55432` was not used.
- ESLint on `services/world-api/src`: baseline 52 errors, current 51 errors (all pre-existing; none in `record-validation.ts` or `persistence.ts`).
- `npx tsc --noEmit`: PASS, exit 0 (commit `6ae2001`).
- `cmp services/world-api/data/world-state.json /home/user/data-backups/stage28-20261010T143151Z/live/world-state.json`: identical after the default and live runs.
- `node dist/database/cli.js status` and `migrate` (local PostgreSQL 18.4): status reports version 2, up to date; second `migrate` exits 0.

---

## 9. Earlier Audit Pass (preserved verbatim from commit `26a124f`)

The commits `e765d5f`, `ceb4113`, and `26a124f` on this branch came before this document was rewritten. Their TLS, monitoring, and setup-guide changes are kept in the current code (this stage's commit builds on them). This earlier text is kept as written. **Its test counts, lint counts, and "not used at runtime" statements are superseded** by sections 3 and 8 above. Its environment findings and the credential setup steps still apply.

---

### Earlier pass: Stage 28 — Repository Audit, Implementation Notes, and Database Credential Setup

**Status:** Partially complete. Work that needs no live database or Godot runtime is implemented and tested. Items that need credentials or the Godot runtime are blocked and listed below.

**Branch:** `arena/00cdea0e-naija`

---

#### 1. Environment Findings

These were checked directly in the sandbox on 2026-10-10. No credential values were read, printed, or stored.

| Question | Finding |
|---|---|
| Can backend commands run in the sandbox? | **Yes.** Node v22.22.3 and npm 10.9.8 are present. `npm run check` (lint plus the full test suite) runs here. |
| Is `DATABASE_URL` already set? | **No.** The variable is absent from the environment, and no database-related variable names are set. |
| Does Arena provide a supported way to configure a secret for this project? | **Not confirmed.** Nothing in the sandbox exposes Arena's project settings, and a web search found no Arena documentation for secrets. Check Arena's project or workspace settings yourself for a secrets or environment-variables section. If you cannot find one, do not paste the URL into chat. Ask Arena support. |
| Can the application receive `DATABASE_URL` from its deployment platform instead? | **Yes, in principle.** The repository has no deployment configuration (no Dockerfile, no hosting manifest). The CI workflow runs `npm run check` without secrets, so CI does not need `DATABASE_URL` today. The server does not read the database at runtime yet (see Open Items), so it runs without the variable. When a host is chosen, set `DATABASE_URL` there as an environment variable, which is the standard approach for Node hosts. |
| Is the sandbox temporary, and do variables persist? | **Shell environment variables do not persist between tool calls** (the bash tool does not preserve exported variables). Files under `/home/user` are captured in workspace snapshots, but environment variables are not. The sandbox's total lifetime cannot be determined from inside it. Treat any value set in the sandbox as temporary. |

#### Important consequence of the persistence finding

A `.env` file written inside the workspace is excluded from Git by `.gitignore`, but it **is** inside the workspace root, so it may be captured in workspace snapshots. Do not create a `.env` containing real credentials in the sandbox. Create it only on your own machine.

---

#### 2. Stage 28 Item Status

Sources: `docs/STAGE_26_OUTSTANDING_WORK_REGISTER.md` items 9–11 (target Stage 28) and `docs/STAGE_25_IMPLEMENTATION_REPORT.md` (Stage 28 list).

| Item | Status | Notes |
|---|---|---|
| **#9 Advanced monitoring** | **Partially complete** | Done: Prometheus text endpoint at `/metrics/prometheus`; real event-loop delay and CPU sampling (previously hard-coded to `0`); 5xx responses counted (the error counter was never incremented before); monitoring tests added (previously none). Still open: Grafana dashboards, alerting rules, log aggregation, distributed tracing. These need external infrastructure. |
| **#10 Platform testing** | **Blocked** | Godot 4.7.2 is not installed in the sandbox, and export templates and target devices are needed. |
| **#11 3D multiplayer testing** | **Blocked** | Requires the Godot runtime, as above. |
| Stage 25: cross-region events | Not started | Design-level work. Not in this pass. |
| Stage 25: advanced synchronization | Not started | Not in this pass. |
| Stage 25: anti-cheat measures | Not started | Not in this pass. |
| Stage 27 short-term: integrate database into world engine | Not started | Requires a live database to verify. Deferred until credentials are configured. |
| Live database verification (Neon) | **Blocked on `DATABASE_URL`** | See Section 4. |

---

#### 3. Fixes and Changes in This Pass

#### Security and correctness

1. **TLS certificate verification is now on by default.** Before this change, `connection.ts` set `rejectUnauthorized: false` for the individual-field configuration, and for any URL without an `sslmode` parameter. That disables certificate checking, which allows man-in-the-middle attacks. The default is now `rejectUnauthorized: true`. Disabling it requires an explicit `DB_SSL_REJECT_UNAUTHORIZED=false`, which is intended only for a private test certificate authority.
   - Note: if the URL itself contains `sslmode`, `pg` applies that value over the explicit setting. `sslmode=require` and `sslmode=verify-full` both verify certificates in Node. Use `sslmode=verify-full` in `DATABASE_URL`.
2. **The live database tests could never run.** `test.skip(!hasDatabase, name, fn)` always skips, because node's `test.skip` takes an options object, not a boolean first argument. Confirmed with a probe: the test was skipped even when the condition was false. The tests now use `{ skip: !hasDatabase }`.
3. **Live database tests require an explicit opt-in.** They write test rows and apply additive migrations. They run only when both `DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true` are set. A `DATABASE_URL` left in a shell therefore cannot cause writes by accident.
4. **Connection URLs are validated without being echoed.** A non-PostgreSQL scheme is rejected with a message that does not include the value, so credentials never appear in an error.
5. **A failed `connect()` no longer leaves a dead pool behind.** Before, the failed pool was kept, so later `connect()` calls returned early without retrying.

#### Monitoring (Stage 28 item #9)

- `GET /metrics/prometheus` returns the Prometheus text format (version 0.0.4) with `HELP` and `TYPE` for each metric. Metric names use the `naija_world_api_` prefix. Counters end in `_total`.
- The existing JSON `GET /metrics` is unchanged.
- `event_loop_delay_ms` is now the p99 of Node's event-loop histogram over the window since the last sample. `cpu_percent` is CPU time since the last sample as a percent of one core.
- `MonitoringService.dispose()` releases the histogram for tests.

#### Tests added

- `test/database-config.test.mjs` (9 tests, no database): TLS defaults and opt-out, URL scheme validation without echo, environment parsing, and a failed-connect negative test against a closed local port.
- `test/monitoring.test.mjs` (8 tests): counters, error counting, measured event-loop delay (the stall is injected in a timer callback), measured CPU, Prometheus format validity, counter naming, non-finite value handling, and HTTP behavior of `/metrics/prometheus` and `/metrics`.

#### Verification

- `npm test`: **483 tests, 478 passing, 0 failing, 5 skipped.** The 5 skips are the live database tests, which are skipped because `DATABASE_URL` is not configured.
- `npm run lint`: 51 errors remain, all pre-existing across 17 files (mostly unused variables and `any` types). None are new in the files changed here, and the unused variable in `monitoring.ts` was removed.
- The live database tests were run once with a **dummy URL pointing at a closed local port**. All five failed with `Database connection failed: connect ECONNREFUSED`, which confirms they execute and do not silently pass. This is a failure-path check, not a connection test. It proves nothing about the real database.

---

#### 4. Securely Configuring `DATABASE_URL`

Use a **disposable development or test database**. Do not use a database that holds real data for these steps.

1. **Create a dev/test database in Neon.** Use a separate project or a non-production branch. Do not reuse a production database.
2. **Create a dedicated role for testing** if you can. Limit it to the test database. Migrations need schema-creation rights in that database.
3. **Build the URL in the Neon console.** The format is `postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=verify-full`. Keep the `sslmode=verify-full` parameter.
4. **Store the URL in a secret store, never in code or chat.**
   - **Arena:** look in your project or workspace settings for a secrets or environment-variables section, and add a secret named `DATABASE_URL`. If you cannot find such a section, ask Arena support how to add one. Do not paste the URL into chat.
   - **Your own machine:** put `DATABASE_URL=...` in a `.env` file at the repository root. `.gitignore` already excludes it. The config loader reads this file.
   - **Your deployment host (later):** set `DATABASE_URL` in that host's environment-variable settings.
5. **Run the live tests on your own machine** from `services/world-api` after a build:
   ```bash
   npm run build --workspace=@naija/world-api
   cd services/world-api
   NAIJA_ALLOW_DB_TESTS=true node --env-file=../../.env --test --test-force-exit test/database.test.mjs
   ```
   You should see five tests pass. If you see `Database connection failed`, check the URL, the network path, and that the database is awake.
6. **If the URL is ever exposed** (pasted in chat, committed, or shown in logs), reset the database password in Neon immediately and update the secret.
7. **Do not** add the URL to `.env.example`, source files, test fixtures, docs, or commit messages. `.env.example` keeps placeholders only.

---

#### 5. Open Items

- **Security: metrics endpoints are unauthenticated.** `/metrics` and `/metrics/prometheus` expose connection counts, memory, and performance figures. They contain no secrets, but restrict them at the network or platform layer before public deployment.
- **The database is not yet used at runtime.** World state is still stored in JSON, and `/health` has no database check. Integration is Stage 27's short-term work and needs a live database to verify.
- **Stage 27 documentation overstates some items.** It lists "Password hashing (application layer)" as complete. That was not verified in this pass.
- **Lint debt:** 51 pre-existing errors. Clearing them is a separate cleanup.
- **Godot runtime:** needed for items #10 and #11 and for the Stage 4–7 client gates recorded in `DEVELOPMENT_STATUS.md`.
- **Grafana, alerting, log aggregation, and tracing** (rest of item #9) need external infrastructure.

---

## 10. Data-Integrity Pass (world-state JSON store)

**Question asked:** Did the JSON store lose or regenerate player or world data?

**Evidence collected**

- Backup, read-only, taken before any test run: `/home/user/data-backups/stage28-20261010T143151Z/`. It contains the live `world-state.json` (SHA-256 in `SHA256SUMS-live.txt`) and 283 copies written by earlier test runs (`SHA256SUMS-tmp.txt`).
- The live file has schema 18, zero players, and seeded catalogs only. Git history does not contain runtime world state (the file is gitignored). Git cannot show what the live file held before 14:20 on 2026-10-10.
- The 284 files were each loaded three times through the pre-fix loader (commit `26a124f`, built to `/tmp/oldbase`) and through the fixed loader. Analysis scripts and output are in `/home/user/data-investigation/`.

**Findings**

| Category | Pre-fix loader (`26a124f`) | Fixed loader |
|---|---|---|
| Economy | 849 records. Lost and regenerated with new IDs in 283 files. 566 IDs unstable across loads. | No loss. IDs stable. |
| Property | 12,169 records lost in 283 files | No loss |
| Government | 7,924 records lost in 283 files | No loss |
| Justice | 9,339 records lost in 283 files | No loss |
| Career | No key loss. `created_at`/`updated_at` reset to load time on 3,408 employer fields and 2,840 vacancy fields. `updated_at` reset on 833 NPC rows. | No key loss. `npcCareers.updated_at` still reset on 833 rows (see section 5). |
| Business | No records in the corpus. Not measured. | Not measured. A fixture test covers it. |
| Election | No records in the corpus. Not measured. | Not measured. A fixture test covers it. |

**What this supports**

- The pre-fix loader dropped and regenerated economy, property, government, and justice records on load, in the test corpus. The fix stops that in the same corpus.
- The fix does not change the saved file format.

**What this does not establish**

- Whether production or live player data was lost. No runtime backup existed before this pass. The 284 copies are output from test runs, not from play. The live file has no player progress. Data loss in any real world file cannot be ruled out, and cannot be checked from the evidence available.
- Whether any map has corruption in real play data. Record validators now cover the property, government, election, and justice maps (section 11). The corpus exercises 11 of them; the rest rely on synthetic fixtures.

**Changes made in this pass**

- `validateState` gates changed from exact versions to `>=` (defect 7).
- Integration tests isolated from the live file (defect 8).
- Two regression tests added to `test/state-load-regression.test.mjs`. Both were checked: the business and election test fails on the pre-change gating and passes on the fix.
- Flaky health assertion made tolerant of `degraded` (defect 9).

**Open decisions for the user**

1. Confirm the loader fix and the stricter validation. The stricter validation can make a previously accepted invalid saved world fail to start (fail-closed), which is the intended behavior elsewhere in the store. Decide whether that is acceptable for the live file.
2. Review the record-level validators added in `6ae2001` (section 11). Their behaviour on real data is not yet established for maps the corpus does not contain.
3. Decide whether NPC career `updated_at` should stop changing on load.

---

## 11. Record Validation, Health Test, Isolation, and Stage 27 Reports (commit `6ae2001`)

### 11.1 Record-level validators

Module: `services/world-api/src/multiplayer/record-validation.ts`. Called from `validateState` in `persistence.ts` after seeding, before `return state`. `initialState` is not changed.

Rules:
- Invalid records are **rejected** (the load fails). They are never deleted, regenerated, or rewritten.
- The only rewrite is deterministic: an **absent nullable** field becomes `null`. Each such normalization is counted. The corpus produced zero normalizations.
- Absent required fields fail.
- Diagnostics name the category, map, record identifier (only if it matches the identifier pattern; otherwise `(non-identifier key)`), field, and invariant. They **never include field values**.
- References are checked only against maps held in the same world state. Owner and character identifiers that point outside these four domains are checked for syntax only.

Coverage by map (all 48 map keys in the four type interfaces are validated):

| Domain | Maps | Maps with a mutation row | Mutation rows | Corpus-covered (284 files) | Corpus-covered maps |
|---|---|---|---|---|---|
| Property | 9 | 9 | 29 | 4 | properties, propertyOwnership, propertyListings, propertyEvents |
| Government | 9 | 9 | 28 | 4 | governmentOrganisations, governmentOffices, governmentBudgets, governmentEvents |
| Elections | 13 | 13 | 27 | 0 | none |
| Justice | 17 | 17 | 50 | 3 | laws, lawProvisions, courts |
| **Total** | **48** | **48** | **134** | **11** | |

The earlier figures in this document (28 mutation-tested, 20 without) were wrong. A multi-line parser of the mutation tables found 42 of 48 maps covered before this pass, and six with none: `laws`, `legislativeProposals`, `legalProfessionals`, `caseParticipants`, `witnesses`, `hearings`. This pass added rows for those six and extra rows for other justice, property, government, and election maps. Every map now has at least one row. Each row asserts the exact map, record identifier, and field, that the rejected record is unchanged, and that nothing is normalized.

A mutation row proves that the validator rejects that malformed field. It does not prove that the validator rejects every malformed value. A structural test fails if any map declared in the four type interfaces has no mutation row.


Corpus evidence (read-only, `roundtrip-summary.json` in `/home/user/data-investigation/`): 284 files; 0 validation failures; 0 record loss; 0 ID mismatches; 0 unstable reloads (ignoring the known NPC `updated_at` churn); 0 normalizations; 0 raw record issues. Record counts were nonzero only for the 11 corpus-covered maps. Election maps and most justice maps are absent from the corpus.

Tests: `test/record-validation.test.mjs` (155 tests: 134 mutation rows, a valid-record acceptance test per domain that checks every map in it, normalization, no-value-leak, a rejected-record-unchanged check on every mutation, a seeded world saved by the real server and loaded twice with stable IDs, a test that `validateState` rejects an invalid seeded property, and the structural guard described above). `test/justice-filing.test.mjs` (20 tests) covers the justice filing rules (section 11.7).

Enumerations in the validator are copied from the domain type unions. If a union changes, the validator must change too. Nothing enforces that yet.

### 11.2 Health test: what changed and why

The health contract (from `src/monitoring.ts` and `src/app.ts`, unchanged):
- Overall status is `unhealthy` if any check fails, `degraded` if any check warns, otherwise `healthy`.
- HTTP 503 is returned only for `unhealthy`. `healthy` and `degraded` return 200.
- The `persistence` check, when configured, joins the overall status. A fail or a thrown error makes the service `unhealthy`.

The `event_loop` check is a single `setImmediate` latency sample; it warns above 50 ms. The `memory` check warns above 75% of heap. Both depend on host load. The `connections` check counts WebSocket clients, not HTTP requests.

Old test: ten concurrent `/health` requests; each had to be `healthy` or `degraded`; HTTP status not checked. Its guarantee was that no request reported `unhealthy`.

New test design (`test/integration.test.mjs`):
- **Concurrent test:** ten requests; each must return HTTP 200, must not be `unhealthy`, and must follow the contract. The test does not assert `healthy` and does not assert on the `event_loop` or `memory` values.
- **Contract helper** `assertHealthContract`: overall status must equal the value derived from the check results, and HTTP status must follow the overall status. A negative test shows the helper rejects inconsistent bodies.
- **Persistence tests (deterministic):** fail → 503 and `unhealthy`; throw → 503, `unhealthy`, and the message is the fixed text (no error details); pass → persistence reported as `pass` and any `unhealthy` must come from a non-persistence check; warn → status is not `healthy`.

Checked: with the persistence branch disabled in the compiled `app.js` (temporary, restored afterward), four persistence tests fail. With it restored, all 17 integration tests pass.

Production health semantics were not changed.

### 11.3 Test isolation

- `createApiServer()` falls back to `services/world-api/data/world-state.json` when neither `stateFile` nor `worldStore` is given.
- `test/isolation.test.mjs` proves the following:
  1. Every `createApiServer({` call in every test file passes `stateFile` or `worldStore` (static check).
  2. A server with a temporary `stateFile` writes that file on shutdown (positive control), and the live file is unchanged.
  3. Running `test/integration.test.mjs` as a child process exits 0 and leaves the live file byte-for-byte unchanged (SHA-256 before and after).
- Live file: SHA-256 `c325380b88e3b087673da8b012bdbe3024cceb86a4d497145f9477ec0951c7c4`, identical to `/home/user/data-backups/stage28-20261010T143151Z/live/world-state.json` (checked with `cmp` after the default run and the live run).

### 11.4 Stage 27 report files: why they were missing

Finding: **the four files were never created.** Evidence:
- No file with those names or topics exists in the working tree, in any commit reachable from any ref, in the reflog, or in the dangling objects (`git fsck --lost-found`). The dangling commit `171acac` holds an earlier documentation tree; it contains no Stage 27 report.
- A filesystem search of `/home/user`, `/tmp`, `/root`, and `/var/tmp`, including the read-only `data-backups` and `data-investigation` folders, found none.
- The Stage 27 document's deliverable list (`STAGE_27_DATABASE_ARCHITECTURE.md`, "Deliverables") lists eight files. None are the four reports.
- Section 3, row 43 of this audit recorded them as "Not created" before this pass.

What is unknown: whether they were planned in a different session or clone. The repository cannot show that. They are created now, in `docs/`, from evidence, and labelled:
- `docs/STAGE_27_INFRASTRUCTURE_REPORT.md`
- `docs/STAGE_27_LOAD_TEST_REPORT.md` (no load test exists; NOT TESTED; no measurements)
- `docs/STAGE_27_SECURITY_AND_RECOVERY_REPORT.md`
- `docs/STAGE_27_LAUNCH_READINESS_REPORT.md` (NOT READY)

### 11.5 Still NOT TESTED or BLOCKED

- CA-signed TLS certificate verification: NOT TESTED.
- Unmigrated-database refusal: NOT TESTED.
- Real multi-process fencing (the existing fencing test runs two instances in one process): NOT TESTED.
- Process-kill recovery: NOT TESTED.
- Down-migration of schema v2: NOT TESTED.
- Engine account and character wiring (the engine does not read or write `accounts`/`characters`): NOT IMPLEMENTED.
- Neon connection: BLOCKED.
- Deployment-platform testing: BLOCKED.
- 3D multiplayer: NOT TESTED.
- Load and capacity: NOT TESTED.

Local PostgreSQL results are not evidence for Neon or production.

### 11.6 Open items found in this pass

- **Justice court-category mismatch: fixed in this pass, with decisions still needing approval (section 11.7).**
- **`world-store.ts` cites a missing file.** Its header refers to `docs/STAGE_28_MULTI_INSTANCE_READINESS.md`, which does not exist. This audit is the Stage 28 record. Not fixed in this pass.
- **Every map has at least one mutation row** (section 11.1). Mutation rows do not prove the absence of other faults.
- **Validator enumerations can drift** from the domain type unions.
- **Metrics endpoints are unauthenticated** (existing limitation).
- **Stage 27 password hashing is unverified** (existing limitation).
- **Build output:** `services/world-api/dist/` is rebuilt for tests and is not committed.

### 11.7 Justice court-category decision (Task 1)

**Problem found.** Seeded courts list **law** categories (for example `supreme` = `constitutional, criminal, civil, commercial, property, employment`). The filing check accepted a case only when the court listed the case's **category ID** (for example `employment_claim`) or its **type** (`civil` or `criminal`). So `commercial`, `property`, `employment`, and the other law categories matched no case, and `court:nic` (which lists only `employment`) accepted no filing. There was also no jurisdiction check: a filer in any state could file at a state court tied to another state. Before the fix, the old build (`26a124f`) rejected an employment claim at `court:nic` with `justice_court_category_not_permitted`.

**Decision.**
- A court's `permitted_categories` lists **law categories**. This is the vocabulary used by the seeded courts and the stored worlds.
- Each case category declares a `law_category` in `game/data/justice/catalog.json`. The loader rejects a case category whose `law_category` is not a law category, and a seed court that lists a non-law category (`justice_catalog_case_law_category_unknown`, `justice_catalog_court_category_unknown`).
- A filing is accepted when the court lists the case's `law_category` or its `type`. The case-ID match is removed.
- Order of checks in `fileCase`: unknown case category (`justice_case_category_invalid`); court category (`justice_court_category_not_permitted`); jurisdiction (`justice_court_jurisdiction_mismatch`).
- Jurisdiction: a court with `applicable_jurisdiction_id` rejects a filer whose `geographic_location.state_id` is present and different. Federal courts have no `applicable_jurisdiction_id` and accept filers from any state.
- Seed change: `court:customary-fct` changes `tenancy_dispute` to `property`. Saved worlds keep the old list. The old entry is a string, still valid, and matches the tenancy case through its `property` law category. Seeding does not overwrite existing courts.
- The validator still accepts `permitted_categories` as an array of strings. Tightening it to law categories would reject valid stored data (252 corpus court copies carry `tenancy_dispute`).

**Implications and gaps (need product decisions).**
- `debt_recovery` maps to `financial`, and `regulatory_penalty` maps to `administration`. Neither law category is listed by any court that would otherwise reject them. `financial` is listed only by `court:federal-high`, and no seeded court lists `administration`. Both case types are `civil`, so these cases are still fileable at every court that lists `civil`. Those mappings therefore change nothing about which courts accept them today.
- **Type-level matches are broad.** A court that lists `civil` accepts every civil case type. For example, `court:customary-fct` (`civil`, `property`) accepts a `commercial_dispute` and a `regulatory_penalty`. This is how the code worked before this pass, and it is kept. Narrowing it (for example, listing law categories only) is a product decision.
- **Jurisdiction scope.** The three FCT courts (`court:magistrate-fct`, `court:state-high-fct`, `court:customary-fct`) are tied to `ng:state:fc`. The four federal courts have no `applicable_jurisdiction_id` and accept filers from any state.
- **No location, no jurisdiction check.** A character with no recorded `geographic_location` is not placed, so the jurisdiction rule does not apply. Requiring a location would block characters that have none, so it needs a decision.
- **Backward compatibility.** The new acceptance rule is a superset of the old one for the seeded data: a case the old rule accepted is still accepted. The only new rejection is the jurisdiction check, which is a deliberate tightening. The court lists are restricted, not opened to all filings.
- No seeded data is deleted or regenerated. The change does not touch `courts` records in stored worlds.

**Evidence.** `test/justice-filing.test.mjs` (20 tests): catalog consistency; accepted filings (employment at NIC, commercial at the FCT High Court and at the Federal High Court, tenancy through the customary court, federal courts for any state, filer in the court's state); rejected filings (civil general and criminal felony at NIC, criminal misdemeanor at customary, unknown category, other-state filer at state and local courts); a rejected filing leaves cases and courts unchanged; the no-location gap; stored-world compatibility; seeded data passes record validation. Mutation check: removing the law-category match fails 3 tests, and disabling the jurisdiction check fails 3 tests. The restored build passes all 20.

### 11.8 Verification for the Task 1 and Task 2 pass

Measured on branch `arena/00cdea0e-naija` after the changes in this pass (base commit `6072661`). Results are from the sandbox only. They are not evidence for Neon or production.

- `npm test` (default, no database variables): **694 tests, 675 pass, 0 fail, 19 skipped.** The 19 skips are the PostgreSQL tests, which need `DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true`.
- `npm test` with the disposable cluster (`DATABASE_URL=postgres://tester@127.0.0.1:55433/naija_stage28_test`, `NAIJA_ALLOW_DB_TESTS=true`, `DB_SSL=false`, local loopback only, trust auth): **694 tests, 694 pass, 0 fail, 0 skipped.** `test/postgres-persistence.test.mjs` alone: 14 of 14. The SSL opt-out applies only to this disposable loopback cluster.
- `tsc --noEmit` (services/world-api): exit 0.
- ESLint (`npm run lint`): **51 errors, 0 warnings.** The same 51 errors appear at `6072661` (HEAD before this pass) with an identical file list. At `dc20b80`, the audit's baseline, the count is 52; the one error missing now is in `monitoring.ts` and was removed before this pass. No justice file has a lint error, and this pass adds none.
- Isolation: `test/isolation.test.mjs` passes as part of the suite (3 of 3). The live world file `services/world-api/data/world-state.json` is byte-identical to the backup taken at 14:31Z (`cmp` shows no difference).
- Corpus validation (`/home/user/data-investigation/roundtrip-check.mjs`, read-only, against `/home/user/data-backups/stage28-20261010T143151Z`): 284 files; 0 validation failures; 0 record loss; 0 ID mismatches; 0 unstable reloads (NPC `updated_at` churn ignored); 0 normalized fields; 0 raw record issues. Same result as before this pass.
- Catalog loader failure paths: in a temporary copy of the build and game data, a case category with an unknown `law_category` throws `justice_catalog_case_law_category_unknown`, and a seed court with an unknown permitted category throws `justice_catalog_court_category_unknown`. The intact catalog loads. The copy was deleted.
- Backup checksums: `SHA256SUMS-live.txt` passes. `SHA256SUMS-tmp.txt` passes for all 283 copies when run from `tmp-test-dirs/`, which is the directory the file assumes.

These checks do not show that the historical player data is intact. The corpus is a set of test copies, and it covers 11 of the 48 maps.

