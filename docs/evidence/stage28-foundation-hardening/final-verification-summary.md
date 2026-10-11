# Stage 28 Foundation Hardening: final verification summary

Recorded 2026-10-11 on branch `arena/00cdea0e-naija`, working tree at HEAD `a487630` plus the uncommitted Stage 28 changes described in `docs/STAGE_28_FOUNDATION_HARDENING.md`. Console logs were kept outside the repository under `/tmp/s28/`. Only the counts below are recorded here. No connection strings or credentials appear in any file.

| Check | Command (run from the stated directory) | Result | Log (outside repo) |
|---|---|---|---|
| Build | `npm run build` in `services/world-api` | exit 0 | `/tmp/s28/p3-build5.log` |
| Default suite | `npm test` in `services/world-api` (builds, then runs `test/*.test.mjs`; PostgreSQL tests skipped without `DATABASE_URL`) | exit 0. 1022 tests, 985 pass, 0 fail, 37 skipped | `/tmp/s28/final6-test-default.log` |
| PostgreSQL suite | `npm test` with `DATABASE_URL` pointing at the local disposable loopback cluster, `NAIJA_ALLOW_DB_TESTS=true`, `DB_SSL=false`, database `naija_stage28_test` | exit 0. 1098 tests, 1094 pass, 0 fail, 4 skipped (the four live-TLS tests, which need a TLS server) | `/tmp/s28/final6-test-pg.log` |
| Live TLS | `node --test test/tls-verification.test.mjs` with `TLS_TEST_DATABASE_URL` (same local cluster, `ssl=on`, private test CA) and `TLS_TEST_CA_FILE` | exit 0. 12 tests, 12 pass, 0 skipped. Local evidence only, not Neon or production | `/tmp/s28/final6-tls.log` |
| Lint | `npm run lint` at the repository root | exit 1. 51 errors, 0 warnings. Same files and rules as the programme baseline. Not fixed and not suppressed | `/tmp/s28/final6-lint.log` |
| Family containment | `node --test test/family-containment.test.mjs` (file, and PostgreSQL in the PostgreSQL run) | 3/3 file; 3/3 `[postgres]` | `/tmp/s28/p3-family-containment-3.log` |
| Police (existing) | `node --test test/police.test.mjs` | 34/34 | `/tmp/s28/p3-police-2.log` |
| Identity concurrency | `node --test test/identity-concurrency.test.mjs` | 6/6 (file backend) | `/tmp/s28/p2-identity-concurrency-1.log` |
| Identity conflict and interruption | `identity-conflict-safety` 5/5; `identity-conflict-retry` 6/6; `identity-interruption` 2/2 | pass | `/tmp/s28/p2-conflict-safety-1.log`, `p2-conflict-retry-1.log`, `p2-interruption-1.log` |
| App identity retry | `app.test.mjs` (full file) | 12/12 | `/tmp/s28/p2-app-full-1.log` |
| Justice and government (file) | `justice-case-access`, `justice-finance-containment`, `government-authorization`, `mutation-resend-guards` | 28/28 | `/tmp/s28/p5-justice-gov-1.log` |
| Multi-process persistence | `multiprocess-persistence.test.mjs` | Skipped in the default run. Passes in the PostgreSQL run (six subtests `ok`) | `/tmp/s28/final6-test-pg.log` |
| Mutation harness, run 2 | `node docs/evidence/stage28-foundation-hardening/mutation-harness.mjs` in `services/world-api` | 13 of 13 mutations detected. `allRestored=true`, `finalMatchesBaseline=true`, exit 0 | `mutation-run2-console.log`, `mutation-results-run2.json` |
| Mutation harness, run 1 | same harness, earlier source state (M0 to M6) | 7 of 7 detected, all restored | `mutation-run1-console.log`, `mutation-results-run1.json` |
| Checkpoint bundle | `git bundle verify` against the pre-final checkpoint bundle, run inside the repository | exit 0. Complete history. HEAD `a4876301` | `/tmp/s28/bundle-verify.log` |
| Godot 4.7.2 client tests | Not run. The Godot binary is not installed | NOT RUN | n/a |

## Mutation list (run 2)

| ID | Guard removed or reverted | Detected |
|---|---|---|
| M0-attempt1-replay | Justice and crime containment lists and the fine-payment check | yes (4 of 7 tests fail) |
| M1 | Judge view in the case view | yes |
| M2 | Judge refusal on evidence submission | yes |
| M3 | Party check on evidence submission | yes |
| M4 | Stranger view refusal | yes |
| M5 | D-05 key-only refusal replaced by the old `recoverIdentity` path | yes (4 of 20 tests fail) |
| M6 | Justice and crime suspensions removed | yes |
| M7 | Military enlistment suspension removed | yes |
| M8 | Police arrest suspension removed | yes |
| M9 | Crime-to-justice link suspension removed | yes |
| M10 | Military eligibility reads education from the client | yes |
| M11 | Police recruitment reads education from the client | yes |
| M12 | Crime-to-police link suspension removed | yes |

## Notes

- The "seven versus five" commit count is reconciled in `docs/STAGE_28_FOUNDATION_HARDENING.md`.
- The mutation-run attempt-1 anomaly (a reported 7/7 pass) could not be reproduced from any surviving log. See the same document.
- Nothing in this summary is a production, Neon, or launch claim.
