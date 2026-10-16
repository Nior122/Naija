# Stage 27 — Infrastructure Report

**Status:** Created during Stage 28 from repository evidence. Stage 27 did not produce this file (see `STAGE_28_AUDIT.md`, row 43, and the "Why the Stage 27 reports were missing" note in that audit).
**Branch:** `arena/00cdea0e-naija`
**Scope:** What the PostgreSQL infrastructure foundation contains, and what has and has not been tested.

Labels used below: **VERIFIED** (checked by a test or by reading code in this repository), **LOCAL ONLY** (tested on a disposable local PostgreSQL 18.4 cluster, not on any managed or production service), **NOT TESTED**, **BLOCKED**.

---

## 1. Components

| Component | Location | Status |
|---|---|---|
| Connection pool and TLS policy | `services/world-api/src/database/connection.ts` | VERIFIED by unit tests (`database-config.test.mjs`, `persistence-policy.test.mjs`); LOCAL ONLY for connections |
| Schema (13 tables from `schema.ts`, plus `schema_migrations`, 14 total) | `services/world-api/src/database/schema.ts`, `migrations.ts` | LOCAL ONLY (migrations applied on the disposable cluster) |
| Migrations: v1 `initial_schema`, v2 `scope_idempotency_keys_per_character` | `services/world-api/src/database/migrations.ts` | v1 and v2 applied LOCAL ONLY; **down-migration of v2: NOT TESTED** |
| Account and character repositories | `services/world-api/src/database/repositories.ts` | LOCAL ONLY (`database.test.mjs`, 7 tests). The game engine does **not** read or write these tables yet. |
| World snapshot store (`PostgresWorldStore`) | `services/world-api/src/database/world-store.ts` | LOCAL ONLY (`postgres-persistence.test.mjs`, 14 tests that run only with a live database) |
| Environment template | `.env.example` | Present |

## 2. Connection and pool settings (from code)

- TLS: on by default with certificate verification (`rejectUnauthorized: true`). `sslmode=disable` is accepted only with the explicit `DB_SSL=false` opt-out (local development). `prefer`, `allow`, `no-verify`, and unknown `sslmode` values are rejected. VERIFIED by `persistence-policy.test.mjs` and `database-config.test.mjs`.
- Pool defaults: idle timeout 30 000 ms, connection timeout 10 000 ms, statement timeout 30 000 ms. VERIFIED by reading `buildPoolConfig`; default values are asserted by `database-config.test.mjs`.
- Connection strings are never printed in errors. VERIFIED by tests.

## 3. Environments actually used

| Environment | Used for | Result |
|---|---|---|
| Local PostgreSQL 18.4, cluster `/tmp/pgdata2`, port `55433`, database `naija_stage28_test`, role `tester` | Full live test run (`DATABASE_URL` with `sslmode=disable` and `DB_SSL=false`) | LOCAL ONLY. 602 of 602 tests pass. |
| Local PostgreSQL cluster `/tmp/pgdata`, port `55432` | Not used for evidence | It never accepted connections with any role tried. Do not cite it. |
| Neon | — | **BLOCKED.** Not connected. No Neon dev or branch database has been provided. |
| CA-signed TLS certificate chain | — | **NOT TESTED.** The local server has no TLS, so the verify-full path was never exercised against a real certificate. |
| Deployment platform | — | **BLOCKED.** No platform has been chosen. |

Local PostgreSQL results do not prove behaviour on Neon or in production.

## 4. Not yet covered by infrastructure tests

- **Unmigrated-database refusal** (starting against a database without the expected schema): **NOT TESTED**.
- **Down-migration of v2**: **NOT TESTED**.
- **Real multi-process fencing**: **NOT TESTED**. Current tests run two instances inside one process.
- **Process-kill recovery**: **NOT TESTED**.
- **Backup and restore of the PostgreSQL database**: **NOT TESTED**. No backup procedure exists.
- **Engine account and character wiring** (the engine reading and writing `accounts`/`characters`): **NOT IMPLEMENTED**.

## 5. Related documents

- Security and recovery detail: `STAGE_27_SECURITY_AND_RECOVERY_REPORT.md`
- Load testing: `STAGE_27_LOAD_TEST_REPORT.md` (no load test was run)
- Launch position: `STAGE_27_LAUNCH_READINESS_REPORT.md`
- Stage 28 evidence and the record of all test runs: `STAGE_28_AUDIT.md`
