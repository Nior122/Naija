# Stage 28 — Repository Audit, Implementation Notes, and Database Credential Setup

**Status:** Partially complete. Work that needs no live database or Godot runtime is implemented and tested. Items that need credentials or the Godot runtime are blocked and listed below.

**Branch:** `arena/00cdea0e-naija`

---

## 1. Environment Findings

These were checked directly in the sandbox on 2026-10-10. No credential values were read, printed, or stored.

| Question | Finding |
|---|---|
| Can backend commands run in the sandbox? | **Yes.** Node v22.22.3 and npm 10.9.8 are present. `npm run check` (lint plus the full test suite) runs here. |
| Is `DATABASE_URL` already set? | **No.** The variable is absent from the environment, and no database-related variable names are set. |
| Does Arena provide a supported way to configure a secret for this project? | **Not confirmed.** Nothing in the sandbox exposes Arena's project settings, and a web search found no Arena documentation for secrets. Check Arena's project or workspace settings yourself for a secrets or environment-variables section. If you cannot find one, do not paste the URL into chat. Ask Arena support. |
| Can the application receive `DATABASE_URL` from its deployment platform instead? | **Yes, in principle.** The repository has no deployment configuration (no Dockerfile, no hosting manifest). The CI workflow runs `npm run check` without secrets, so CI does not need `DATABASE_URL` today. The server does not read the database at runtime yet (see Open Items), so it runs without the variable. When a host is chosen, set `DATABASE_URL` there as an environment variable, which is the standard approach for Node hosts. |
| Is the sandbox temporary, and do variables persist? | **Shell environment variables do not persist between tool calls** (the bash tool does not preserve exported variables). Files under `/home/user` are captured in workspace snapshots, but environment variables are not. The sandbox's total lifetime cannot be determined from inside it. Treat any value set in the sandbox as temporary. |

### Important consequence of the persistence finding

A `.env` file written inside the workspace is excluded from Git by `.gitignore`, but it **is** inside the workspace root, so it may be captured in workspace snapshots. Do not create a `.env` containing real credentials in the sandbox. Create it only on your own machine.

---

## 2. Stage 28 Item Status

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

## 3. Fixes and Changes in This Pass

### Security and correctness

1. **TLS certificate verification is now on by default.** Before this change, `connection.ts` set `rejectUnauthorized: false` for the individual-field configuration, and for any URL without an `sslmode` parameter. That disables certificate checking, which allows man-in-the-middle attacks. The default is now `rejectUnauthorized: true`. Disabling it requires an explicit `DB_SSL_REJECT_UNAUTHORIZED=false`, which is intended only for a private test certificate authority.
   - Note: if the URL itself contains `sslmode`, `pg` applies that value over the explicit setting. `sslmode=require` and `sslmode=verify-full` both verify certificates in Node. Use `sslmode=verify-full` in `DATABASE_URL`.
2. **The live database tests could never run.** `test.skip(!hasDatabase, name, fn)` always skips, because node's `test.skip` takes an options object, not a boolean first argument. Confirmed with a probe: the test was skipped even when the condition was false. The tests now use `{ skip: !hasDatabase }`.
3. **Live database tests require an explicit opt-in.** They write test rows and apply additive migrations. They run only when both `DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true` are set. A `DATABASE_URL` left in a shell therefore cannot cause writes by accident.
4. **Connection URLs are validated without being echoed.** A non-PostgreSQL scheme is rejected with a message that does not include the value, so credentials never appear in an error.
5. **A failed `connect()` no longer leaves a dead pool behind.** Before, the failed pool was kept, so later `connect()` calls returned early without retrying.

### Monitoring (Stage 28 item #9)

- `GET /metrics/prometheus` returns the Prometheus text format (version 0.0.4) with `HELP` and `TYPE` for each metric. Metric names use the `naija_world_api_` prefix. Counters end in `_total`.
- The existing JSON `GET /metrics` is unchanged.
- `event_loop_delay_ms` is now the p99 of Node's event-loop histogram over the window since the last sample. `cpu_percent` is CPU time since the last sample as a percent of one core.
- `MonitoringService.dispose()` releases the histogram for tests.

### Tests added

- `test/database-config.test.mjs` (9 tests, no database): TLS defaults and opt-out, URL scheme validation without echo, environment parsing, and a failed-connect negative test against a closed local port.
- `test/monitoring.test.mjs` (8 tests): counters, error counting, measured event-loop delay (the stall is injected in a timer callback), measured CPU, Prometheus format validity, counter naming, non-finite value handling, and HTTP behavior of `/metrics/prometheus` and `/metrics`.

### Verification

- `npm test`: **483 tests, 478 passing, 0 failing, 5 skipped.** The 5 skips are the live database tests, which are skipped because `DATABASE_URL` is not configured.
- `npm run lint`: 51 errors remain, all pre-existing across 17 files (mostly unused variables and `any` types). None are new in the files changed here, and the unused variable in `monitoring.ts` was removed.
- The live database tests were run once with a **dummy URL pointing at a closed local port**. All five failed with `Database connection failed: connect ECONNREFUSED`, which confirms they execute and do not silently pass. This is a failure-path check, not a connection test. It proves nothing about the real database.

---

## 4. Securely Configuring `DATABASE_URL`

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

## 5. Open Items

- **Security: metrics endpoints are unauthenticated.** `/metrics` and `/metrics/prometheus` expose connection counts, memory, and performance figures. They contain no secrets, but restrict them at the network or platform layer before public deployment.
- **The database is not yet used at runtime.** World state is still stored in JSON, and `/health` has no database check. Integration is Stage 27's short-term work and needs a live database to verify.
- **Stage 27 documentation overstates some items.** It lists "Password hashing (application layer)" as complete. That was not verified in this pass.
- **Lint debt:** 51 pre-existing errors. Clearing them is a separate cleanup.
- **Godot runtime:** needed for items #10 and #11 and for the Stage 4–7 client gates recorded in `DEVELOPMENT_STATUS.md`.
- **Grafana, alerting, log aggregation, and tracing** (rest of item #9) need external infrastructure.
