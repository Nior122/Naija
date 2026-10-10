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

1. **Can the backend commands run in the sandbox?** Yes. `npm run db:status` and `npm run db:migrate` run against any reachable PostgreSQL. Verified against a local PostgreSQL 18.4 instance on `127.0.0.1:55432` (disposable, not Neon, not production).
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
| 43 | Stage 27 report files (infrastructure, load test, security and recovery, launch readiness) | NOT IMPLEMENTED | Not created. |
| 44 | Lint: no new errors compared with the baseline | PASS | Baseline `dc20b80`: 52 errors. Current: 51 errors (46 unused-vars, 5 explicit-any, all pre-existing). Measured with ESLint on `services/world-api/src`. |
| 45 | Full test suite, default configuration (no database) | PASS | 510 total, 491 pass, 0 fail, 19 skipped. |
| 46 | Full test suite, against local PostgreSQL 18.4 | PASS | 510 total, 510 pass, 0 fail, 0 skipped. Local instance only; not Neon. |
| 47 | Live Neon validation | BLOCKED | Requires a Neon dev or branch database and a secure DATABASE_URL (section 6). |
| 48 | Production deployment readiness | NOT IMPLEMENTED | Not achieved. Stage 28 cannot be marked complete from this document. |

---

## 4. Defects Found and Fixed During This Stage

1. **Economy, career, business, property, government, election, and justice data were discarded on every JSON load at schema 18 (pre-existing).** The economy case was reproduced: validating the same saved state twice produced new transaction IDs. The other five groups use the same pattern in code; they were not reproduced separately. `validateState` in `src/multiplayer/persistence.ts` used exact-version checks (`schemaVersion === 4 || … === 9`) for these map groups. The current schema version is 18, so these maps were replaced with empty objects on every load, and the economy initializer regenerated accounts and transactions with new random IDs. The `===` ranges were introduced by commits `0ee19f8` (stage-8) and `0edaa4f` (stage-12). Fixed by changing each condition to `schemaVersion >= N`, which matches the same versions up to 9 and fixes 10 and above. Regression test: `test/state-load-regression.test.mjs` "economy data survives repeated loads". **Action for the user:** check whether any saved `world-state.json` in use has economy or career data that was lost before this fix. This change alters load behavior of the live JSON store.
2. **`MigrationManager.getCurrentVersion()` and `getAppliedMigrations()` used the global database singleton** instead of the connection they were given. The CLI owns its own connection, so `status` reported version 0 for a migrated database, and `migrate` could reapply migrations. Fixed. Regression test: `postgres-persistence.test.mjs` "on its own connection".
3. **Stage 27 connection code did not verify TLS certificates** (`rejectUnauthorized: false`). Fixed by default verification in `buildPoolConfig`. Documented in `STAGE_27_DATABASE_ARCHITECTURE.md`.
4. **Stage 27 documents said 15 tables; the schema creates 14** (13 in `schema.ts` plus `schema_migrations`). Corrected.
5. **URL `sslmode` silently overrides explicit `ssl` options in `pg`.** Now parsed and enforced; unsupported modes are rejected.
6. **Live PostgreSQL test file used `test.skip(boolean, …)`, which always skips.** Replaced with the `{ skip }` option.

---

## 5. Known Limitations

- **Single-writer snapshot design.** `PostgresWorldStore` stores the whole world as one JSONB row and fences stale writers with a version check. It is correct for one active writer. It is not a horizontally scalable design, and it does not provide per-character row locking for world-level state.
- **Lost acknowledgements.** If a save commits but the response is lost, the instance reports failure and fences itself. The next save then requires a restart. This is fail-closed, not data loss, but it can cause a brief outage.
- **Account and character tables are not used by the game engine.** The engine's source of truth is still the world snapshot. Money updates in the repositories are tested, but the engine's economy does not call them.
- **Economy transaction IDs are random at creation.** After fix 1 they are stable across loads. Records that were regenerated by the old bug have no original IDs to recover.
- **File backend is single-instance only.** It is labeled as development mode.
- **Local tests use `DB_SSL=false`** against a local server without TLS. They do not exercise the default TLS path.

---

## 6. User Steps (Neon, for the DATABASE_URL and live tests)

1. In Neon, create a **development project or a branch** dedicated to Naija testing. Do not use the production database.
2. Create a **runtime role** with only the privileges the app needs, and a separate **migration role** for `npm run db:migrate`. Do not use the project owner role at runtime.
3. Build the connection string with `sslmode=verify-full`. Neon's certificates use a public CA, so no `DB_SSL_REJECT_UNAUTHORIZED` override should be needed.
4. Store the string in the deployment platform's secret store, or in a **gitignored** local `.env`. Confirm first how Arena supplies secrets (section 2, Q3). Never put it in source, `.env.example`, a commit, or chat. If a string is ever pasted into chat, rotate the password.
5. Run `npm run db:status`, then `npm run db:migrate`, against the development database only.
6. Run the live tests with `DATABASE_URL=… NAIJA_ALLOW_DB_TESTS=true npm test` from `services/world-api`. These tests write `t28-*` rows and additive migrations. They are not safe against a database with real data.
7. For CI, add the string as a GitHub Actions secret and use it only in a job that sets `NAIJA_ALLOW_DB_TESTS=true`.

---

## 7. Decisions

- **JSON → PostgreSQL importer: DEFERRED by the user.** Its three files (`json-import.ts`, `import-cli.ts`, `json-import.test.mjs`) are kept outside the repository at `/home/user/deferred/stage-28-importer/`. The root `persistence:import` script was removed. Before any real import, the importer needs its own review, a rerun of its tests against the committed loader, and a backup plan.
- **Deployment platform.** Needed for platform testing (#10) and for choosing where the DATABASE_URL secret lives.
- **Confirm the economy-data fix (defect 1)** is acceptable for the live JSON store.

---

## 8. Commands Run for This Document

- `npm run build` (services/world-api): PASS, exit 0.
- `npx tsc --noEmit -p .`: PASS, exit 0.
- `npm test` with no database configured: 510 total, 491 pass, 0 fail, 19 skipped.
- `DATABASE_URL=… DB_SSL=false NAIJA_ALLOW_DB_TESTS=true npm test` (local PostgreSQL 18.4): 510 total, 510 pass, 0 fail, 0 skipped.
- ESLint on `services/world-api/src`: baseline 52 errors, current 51 errors (46 unused-vars, 5 explicit-any; all pre-existing).
- `node dist/database/cli.js status` and `migrate` (local PostgreSQL 18.4): status reports version 2, up to date; second `migrate` exits 0.
