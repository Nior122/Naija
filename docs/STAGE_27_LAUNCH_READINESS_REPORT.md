# Stage 27 — Launch Readiness Report

**Status:** Created during Stage 28 from repository evidence. Stage 27 did not produce this file.
**Position: NOT READY FOR LAUNCH.** Nothing in this report supports a production or public launch decision.

This report is a checklist of evidence. Every item is labeled. No item is marked "ready" unless a test or a code reading supports it.

---

## 1. Summary

| Area | Status |
|---|---|
| PostgreSQL connection and TLS policy (code) | VERIFIED by unit tests; LOCAL ONLY for connections |
| World snapshot persistence on PostgreSQL | LOCAL ONLY (14 live tests, local PostgreSQL 18.4). The engine's live world still runs from JSON by default. |
| Account and character tables | NOT USED by the engine. Repository tests are LOCAL ONLY. |
| Money integrity (balance, ledger) | LOCAL ONLY |
| Neon (managed PostgreSQL) | **BLOCKED.** Not connected. |
| CA-signed TLS verification | **NOT TESTED** |
| Real multi-process fencing | **NOT TESTED** |
| Kill-and-recover | **NOT TESTED** |
| Backup and restore | **NOT TESTED**. No procedure exists. |
| Down-migration of schema v2 | **NOT TESTED** |
| Refusal to start on an unmigrated database | **NOT TESTED** |
| Load and capacity | **NOT TESTED** (see `STAGE_27_LOAD_TEST_REPORT.md`) |
| Deployment platform | **BLOCKED.** No platform chosen. |
| Monitoring in a real Prometheus or Grafana setup | **NOT TESTED** (endpoint unit-tested only). Alerts and dashboards: **NOT IMPLEMENTED**. |
| Metrics endpoint access control | **OPEN.** `/metrics` and `/metrics/prometheus` are unauthenticated. |
| Password hashing | **UNVERIFIED** |
| JSON-to-PostgreSQL importer | **DEFERRED** by user decision. Not built. |
| Historical data loss from the old JSON loader | **UNKNOWN.** No pre-fix runtime backup exists. |
| 3D multiplayer | **NOT TESTED.** Godot is not installed in the sandbox. |

## 2. Blocking items

1. Connect to Neon and run the full test suite with a secure `DATABASE_URL`. (Requires the user to provide a dev or branch database and a secure secret path.)
2. Choose a deployment platform and test a deployment against it.
3. Verify TLS with a CA-signed chain.
4. Decide how the engine will use `accounts` and `characters`, then test that wiring. Today the game persists through the world snapshot, not these tables.
5. Define, implement, and test backup and restore.
6. Test real multi-process fencing and process-kill recovery.
7. Run a load test and publish results labeled by environment.
8. Restrict or authenticate the metrics endpoints.
9. Verify or remove the password-hashing claim.
10. Complete record-level validation for the world-state maps (see `STAGE_28_AUDIT.md`, section 5): 20 of 48 maps have validator code but no mutation test.
11. Resolve the justice `courts.permitted_categories` inconsistency (law categories in data, case types in the service check). See `STAGE_28_AUDIT.md`.

## 3. What would count as evidence for a later launch decision

- A dated test run against the target environment, with the commit hash and the full result counts.
- The runs listed above with labels: LOCAL ONLY, Neon, or deployment platform.
- No claim of capacity without a load test.

Until those exist, the answer is: **not ready**.
