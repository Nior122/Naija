# Stage 27 — Security and Recovery Report

**Status:** Created during Stage 28 from repository evidence. Stage 27 did not produce this file.
**Branch:** `arena/00cdea0e-naija`
**Important:** This report lists what is tested. It does not grant any security guarantee beyond those tests, and it does not establish launch readiness.

Labels: **VERIFIED** (tested in this repository), **LOCAL ONLY** (tested on a disposable local PostgreSQL 18.4 cluster), **NOT TESTED**, **BLOCKED**, **UNKNOWN**.

---

## 1. Transport security

| Control | Status | Evidence |
|---|---|---|
| TLS is on by default for database connections | VERIFIED (config) | `database-config.test.mjs`, `persistence-policy.test.mjs` |
| Server certificate is verified by default (`rejectUnauthorized: true`) | VERIFIED (config) | `database-config.test.mjs` |
| `sslmode=disable` requires explicit `DB_SSL=false` | VERIFIED | `persistence-policy.test.mjs` |
| Unsafe or unknown `sslmode` values (`prefer`, `allow`, `no-verify`, unknown) are rejected, not downgraded | VERIFIED | `persistence-policy.test.mjs` |
| Verification against a **CA-signed certificate chain** | **NOT TESTED.** The local server has no TLS. |
| Verification against **Neon** | **BLOCKED.** No Neon database has been connected. |

The Stage 27 code set `rejectUnauthorized: false`. That encrypted the connection without verifying the server. Stage 28 changed the default; see `STAGE_28_AUDIT.md`, defect list.

## 2. Secret handling

| Control | Status | Evidence |
|---|---|---|
| No real connection string or password is committed to the repository | VERIFIED by `git grep` during Stage 28 | Matches are only the placeholder `.env.example` line (`USER:PASSWORD`) and test fixtures (`user:pw@db.example.invalid`, `${SECRET}`). |
| `DATABASE_URL` is read from the environment and never printed | VERIFIED | `database-config.test.mjs` ("read from the environment without printing it") |
| An unreachable database produces an error that does not contain the password | VERIFIED | `persistence-policy.test.mjs` (startup failure test) |
| Health check failures do not expose error details | VERIFIED | `integration.test.mjs` (persistence throws → message is the fixed text) |
| Live database credentials were pasted into chat | Not done. The user was asked for a secure setup path; see `STAGE_28_AUDIT.md` section 2. |

The `/metrics` and `/metrics/prometheus` endpoints are **not authenticated**. They contain counts and resource figures, not secrets. Restrict them at the network layer before any public deployment. This is open.

## 3. Write safety and fencing

- Snapshot saves use a version check. A stale instance that tries to save after another writer has saved is **fenced**: it refuses further saves until it restarts. Code: `services/world-api/src/database/world-store.ts`.
- Money: concurrent debits cannot overdraw a balance; a retried idempotency key is applied once under concurrency; a failed transaction rolls back the balance and ledger together; the database rejects a negative balance. **LOCAL ONLY** (`postgres-persistence.test.mjs`, `database.test.mjs`).
- Fencing tests run **two application instances inside one Node process** against one database. **VERIFIED LOCAL ONLY.**
- **Real multi-process fencing (separate OS processes, separate pools): NOT TESTED.**
- A save whose acknowledgement is lost is reported as a failure, and the next save fences the instance. This is fail-closed. It is not silent loss, but it does require a restart.

## 4. Recovery

| Scenario | Status | Evidence |
|---|---|---|
| Fresh application context recovers an identity saved before a restart | LOCAL ONLY (in-process restart) | `postgres-persistence.test.mjs` ("Restart: an identity saved before a crash...") |
| Graceful shutdown saves the final state and it is recovered on restart | LOCAL ONLY | `postgres-persistence.test.mjs` |
| **Process killed mid-operation (SIGKILL) and recovered** | **NOT TESTED** | — |
| **Backup of the PostgreSQL database and restore into a clean database** | **NOT TESTED.** No backup procedure is defined. | — |
| **Down-migration of schema v2** | **NOT TESTED** | — |
| **Refusal to start against an unmigrated database** | **NOT TESTED** | — |

The title in the first row says "crash"; the test simulates a restart by creating a fresh application context. It does not kill a process.

## 5. Password hashing (Stage 27 claim, not verified)

`STAGE_27_DATABASE_ARCHITECTURE.md` lists password hashing as complete. **Nothing in the repository verifies it.** The `accounts` table has a `password_hash` column. No login route reads it. Treat password hashing as **UNVERIFIED**.

## 6. The JSON world-state file (data integrity, not a security control)

- The live file `services/world-api/data/world-state.json` is preserved byte-for-byte across the test runs in Stage 28 (SHA-256 checked before and after; see `STAGE_28_AUDIT.md`).
- Historical real-player data loss from the old loader is **UNKNOWN**. No runtime backup from before the fix exists. Do not attempt reconstruction without a separately reviewed plan.

## 7. Open items before launch

1. Verify TLS against a CA-signed chain and against Neon (**BLOCKED**).
2. Test real multi-process fencing (**NOT TESTED**).
3. Test kill-and-recover (**NOT TESTED**).
4. Define and test backup and restore (**NOT TESTED**).
5. Verify or remove the password-hashing claim (**UNVERIFIED**).
6. Authenticate or network-restrict the metrics endpoints (**OPEN**).
7. `world-store.ts` cites `docs/STAGE_28_MULTI_INSTANCE_READINESS.md`, which does not exist (**OPEN**, documentation).
