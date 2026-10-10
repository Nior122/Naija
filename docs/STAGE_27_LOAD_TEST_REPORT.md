# Stage 27 — Load Test Report

**Status:** Created during Stage 28 from repository evidence. Stage 27 did not produce this file.
**Result: NOT TESTED. No load test was written or run, and this report contains no measurements.**

---

## 1. What exists

- No load-test script, harness, or benchmark exists in the repository. Searching the tree and the full git history found none.
- The only performance-related checks are unit-level:
  - `monitoring.test.mjs` checks the metrics shape, not capacity.
  - `integration.test.mjs` runs ten concurrent `/health` requests and checks that each one returns a valid response. That is a correctness check with ten requests. It is not a throughput or latency measurement.
- `services/world-api/test/database-config.test.mjs` asserts the default pool limits (idle timeout, connection timeout, statement timeout). Those are configuration values, not measured behaviour.

## 2. What is unknown

- Maximum concurrent players or sessions.
- Throughput and latency for the world tick, for snapshot saves, and for the `/health` endpoint.
- Snapshot save time as world size grows. The snapshot store rewrites the whole world on every save. The limit is 16 MiB (`MAX_SNAPSHOT_BYTES`), and no measurement shows how close a real world gets to it.
- Behaviour of the PostgreSQL pool under contention. The pool defaults have never been stressed.
- Whether the in-process fencing check behaves correctly under real concurrent processes. See the security and recovery report.

## 3. Why this is not a launch-capacity claim

No number in the repository describes capacity. Any statement about how many players the system supports would be unsupported. This is a blocker for launch readiness (`STAGE_27_LAUNCH_READINESS_REPORT.md`).

## 4. Minimum plan for a future load test (not started)

1. Choose a repeatable scenario: N WebSocket clients, a fixed world, a fixed duration.
2. Run it against the local disposable PostgreSQL cluster first, then against a dedicated Neon branch database, and label each result with its environment.
3. Record throughput, p50/p95/p99 latency for `/health` and for snapshot saves, memory, and event-loop delay. Store the raw output with the commit hash.
4. Only then state any capacity figure, and only for the environment that produced it.

Status of each step: **NOT STARTED**.
