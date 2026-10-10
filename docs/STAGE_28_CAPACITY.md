# Stage 28 — Capacity (R5): diagnosis, measured results, and recommendation

**Status:** diagnosis and measurements complete for the single-file store. Decision 2 (compact JSON on save) and Decision 1 (notify once per capacity episode) are **implemented** (section 5). **The 16 MiB limit is not raised.** The 10,000-identity figure is a planning target and is **not** a supported claim. No automatic pruning or deletion was added. The R4 identity budget (review section 5) is **not** implemented.

**Evidence:** raw JSON results are in `docs/evidence/stage28-capacity/`. They contain no creation keys, tokens, or player names. The server logs from the runs are not committed (they are verbose connection logs).

**Reproduce:** `cd services/world-api && npm run build && node scripts/capacity-probe.mjs --mode default-cap --identities 1000 --out /tmp/x.json`. The probe uses a temporary directory and never reads or writes `data/world-state.json`.

---

## 1. Diagnosis

### 1.1 What limits the world

- The whole world is one JSON document (`world-state.json` for the file backend; one `world_state` JSONB row for PostgreSQL). Every save serializes all records and writes them again.
- The file backend used to serialize with `JSON.stringify(state, null, 2)` (**pretty-printed**). It now writes compact JSON, `JSON.stringify(state)`, with the same content and schema (section 5, item 2). The PostgreSQL backend already wrote compact JSON (`src/database/world-store.ts`, `JSON.stringify(state)`), with the same 16 MiB limit (`MAX_SNAPSHOT_BYTES`). Its ceiling was therefore not affected by this change.
- Before this phase, a save over the limit failed at a point where the in-memory world had already been changed (R2). This is now refused before anything is written. The previous valid file is kept, and no record is removed.
- Before the compact change, a starter family added about **23.5 KB** of pretty-printed JSON per identity (measured, section 3). With compact JSON it adds about **15.8 KB** per identity (measured, section 5.1). The limit is 16,777,216 bytes. The file backend therefore reached the limit after about 700 identities before the change and about 1,050 after it.

### 1.2 Why the failure point varies (629 earlier, 705–713 now)

- The earlier figure (629–653, review E8) came from the code before the R2 fix. Those runs were not saved in full, so I cannot fully explain the difference from the current 705–713. The likely contributors are the random sibling count in starter families (`Math.random` in `src/life/service.ts`), which changes each identity's size, and the orphan records that the old code kept after failed saves. **This is not verified.**
- The pre-change code gave three repeated default-cap runs: 705, 706, and 713 identities created, each followed by a refused save with `world_capacity_reached`.
- With compact JSON (current code), three repeated default-cap runs gave 1,059, 1,069, and 1,047 identities created (section 5.1). The 629 figure is still not reproduced, and the cause of the 629 result remains undiagnosed.

### 1.3 Other costs that grow with the world

- **Per-creation work is proportional to the world.** Each creation makes a `structuredClone` of the whole world, then diffs it. Even with the save skipped (the no-op-flush runs), creation p50 was about 260–290 ms at 1,000–1,500 identities, with p95 about 1 s.
- **Save and shutdown time grow linearly with size.** Measured in section 3.
- **Memory** in the probe process (server and client in one process) was about 300–430 MB RSS at 700–1,500 identities. It is not a hard limit.

### 1.4 Ruled out

- **Not the memory limit.** RSS stayed well under the sandbox's 4 GB.
- **Not the connection limit.** The probe raised `connectionAttemptsPerMinute` only for test runs. The production limit (30 new connections per minute per IP) still applies to real players and is the reason real traffic is slower than the probe.
- **Not corrupted saves.** The refused save leaves the previous file byte-identical (test `world-capacity.test.mjs`), and the probe's final file is 16,757,240 to 16,769,024 bytes, which is under the limit.

## 2. What was implemented (no cap change)

| Item | Where | Behaviour |
|---|---|---|
| Refusal before write | `persistence.ts`, `world-store.ts` | A serialized save over the limit throws `WorldStateCapacityError` (`world_capacity_reached`). Nothing is written. |
| Clear error to clients | `world-engine.ts` | Creation returns `world_capacity_reached`. The periodic flush sends the same code to online players. |
| Test-only size override | `WorldStore` option `maxBytes` (file backend only) | Used by tests and the probe. Production uses the default. |
| Capacity metrics | `monitoring.ts`; `/metrics` JSON and `/metrics/prometheus` | `world.state_bytes_last_saved`, `world.state_limit_bytes`, `world.state_usage_ratio`, `world.persisted_players`. Gauges: `naija_world_api_world_state_bytes`, `…_limit_bytes`, `…_usage_ratio`, `…persisted_players`. |
| Warning thresholds | `monitoring.ts`; env `WORLD_STATE_WARN_PERCENT` (default `75,90`) | One warning log per threshold as usage rises. Invalid values stop startup and are not echoed. |
| Probe | `services/world-api/scripts/capacity-probe.mjs` | Repeatable runs (section 3). |
| Tests | `test/world-capacity.test.mjs`, `test/world-state-warnings.test.mjs` | Refusal keeps the file unchanged; shutdown over the limit fails with `world_capacity_reached` and keeps the file; thresholds; metrics; config validation. |

Metric and log content: no record contents, player names, keys, or tokens.

## 3. Measured results

All runs: real WebSocket creation over separate sockets, one temporary file per run, on a 2-CPU sandbox. Times are as measured. Numbers are from single runs, except the three default-cap runs.

### 3.1 Production limit (16 MiB), real saves

| Run | Identities created | Refused at | Final file (bytes) | Save p50 / p95 (ms) | Creation p50 / p95 (ms) | Creation phase (s) | Shutdown (ms) | RSS at end (MB) |
|---|---|---|---|---|---|---|---|---|
| default-cap run 1 | 705 | #706 `world_capacity_reached` | 16,757,240 | 102.0 / 209.9 | 228.9 / 468.6 | 165.3 | 213.2 | 297.4 |
| default-cap run 2 | 706 | #707 `world_capacity_reached` | 16,764,162 | 96.5 / 205.5 | 210.3 / 435.0 | 157.3 | 175.2 | 297.2 |
| default-cap run 3 | 713 | #714 `world_capacity_reached` | 16,769,024 | 97.4 / 185.4 | 216.3 / 391.9 | 149.9 | 168.8 | 387.8 |

Shutdown succeeded in all three runs, and the file was kept at the last successful size.

### 3.2 Real saves with the limit raised for the run (test-only, 1 GiB)

| Run | Identities | Final file (bytes) | Save p50 / p95 (ms) | Creation p50 / p95 / max (ms) | Creation phase (s) | Shutdown (ms) | RSS at end (MB) |
|---|---|---|---|---|---|---|---|
| real-300 (for composition) | 300 | 7,170,916 | 41.5 / 81.8 | — | — | 77.5 | — |
| real-1000 | 1,000 | 23,574,464 (**over 16 MiB**) | 156.5 / 377.9 | 359.6 / 860.3 / 1,125.7 | 372.2 | 365.3 | 361.6 |

Real-1000 (pretty-printed, measured before the compact change) shows what the production limit prevents: the file would exceed 16 MiB at about 700 identities. With compact JSON the same limit is reached at about 1,050 identities (section 5.1).

### 3.3 No-op flush (LABELLED). Creation saves skipped; one real save timed at the end

These runs measure the creation path and memory growth **without** a save per creation. Each had a 600-second budget. **None reached its target.** The creation count is where the budget ran out.

| Target | Created in 600 s | Final real save (ms) | Final file (bytes) | Shutdown save (ms) | Creation p50 / p95 / max (ms) | RSS at end (MB) |
|---|---|---|---|---|---|---|
| 2,500 | 1,519 | 447.6 | 35,711,017 | 478.0 | 285.9 / 994.6 / 1,632.6 | 418.1 |
| 5,000 | 1,556 | 462.4 | 36,635,631 | 520.1 | 258.8 / 985.8 / 1,449.4 | 426.5 |
| 10,000 | 1,452 | 492.4 | 34,179,582 | 438.4 | 286.7 / 1,042.3 / 1,604.4 | 404.4 |

The final files are over the 16 MiB limit. They exist only to measure size and save time at that size. **They do not show that these worlds can be saved in production.**

### 3.4 Composition of a 300-identity file

Source: `docs/evidence/stage28-capacity/composition-300-identities.json`.

- Pretty-printed: 7,170,916 bytes. Compact (no indentation): 4,833,923 bytes. **Compact is 67.4% of pretty.** Formatting alone accounts for about a third of the bytes.
- Share of compact bytes by top-level collection: players 42.8%, people 16.6%, relationships 14.9%, lifeEvents 7.7%, economyTransactions 4.0%, economyAccounts 3.7%, households 3.6%, families 3.5%, economyCreditScores 1.4%. All others are under 0.2% each.

### 3.5 Extrapolations (NOT measured)

These are arithmetic from the measured per-identity size. They are labelled as estimates.

- **Pretty format, 5,000 identities:** about 117 MB (23.5 KB × 5,000). **10,000:** about 235 MB. (The pretty format is no longer written.)
- **Compact format, 5,000 identities:** about 79 MB (15.8 KB × 5,000). **10,000:** about 158 MB. These are arithmetic from the measured marginal size and are **not measured**. A 5,000 or 10,000 identity save has not been run.
- **Compact format at the limit:** measured. Three runs reached 1,047–1,069 identities (section 5.1). The earlier estimate of about 1,050 was close.
- **Time to reach 5,000 or 10,000 identities** at the measured rate of about 2.5 creations per second is roughly 33 minutes and 67 minutes respectively. Creation time was not measured beyond about 1,500 identities, so the real figure may be longer.

## 4. Conclusion: what the architecture can and cannot do

- **Safe today (file backend, compact JSON):** up to about 1,000 identities per world under the 16 MiB limit. Real saves reached 1,047–1,069 identities before the first refused save (section 5.1). Saves over the limit are refused cleanly, with no data loss. The 1,000 mark is close to the limit: one run was at 16,048,106 bytes at 1,000 identities.
- **Previously:** up to about 700 identities (measured 705–713 with pretty JSON). That figure is superseded by the compact measurements.
- **Not supported:** 2,500, 5,000, or 10,000 identities in one file-backed or PostgreSQL-backed world. The single-document design and the 16 MiB limit prevent it. The no-op-flush runs show that the process also gets slower as the world grows.
- **Bottlenecks, in order of impact on the limit:**
  1. The single document and its 16 MiB limit. (Formatting was about a third of the bytes; compact JSON removed it for the file backend.)
  2. The whole-world copy and diff on each creation (creation time).
  3. The whole-world save on each change (save and shutdown time).

## 4.1 Open issue: notification at the limit (Decision 1 implemented)

When the world is at the limit, the in-memory world keeps changing from gameplay, but no save can succeed. Before this change, each failed retry sent `world_capacity_reached` to every online player and wrote a log line, about once per second.

**Decision 1 (approved by the user): notify once per capacity episode.** An episode starts at the first refused save and ends at the next successful save. Within an episode:

- Online players receive `world_capacity_reached` once. A creation requester always receives its own refusal.
- The log receives one line.
- Retries are silent. Nothing is removed. The previous saved file is kept.

Tests: `test/world-capacity-notify.test.mjs`. The creation-path test fails on the committed code (0 notices where 1 is expected). The periodic-retry test fails on the committed code (3 notices where 1 is expected in the first episode, from the retries). Both pass on the current code.

Still open: the in-memory changes made after the last successful save exist only in memory, and a restart loses them. Notification does not change that. Rejecting new gameplay writes at the limit, and an operator-visible warning, are not implemented. They are product and operations decisions. The notice has not been tested with real players.

## 5. Recommendation (smallest safe improvements; NOT implemented, awaiting approval)

1. **Keep the 16 MiB limit.** Do not raise it until items 2 and 3 are measured.
2. **Compact JSON on save. IMPLEMENTED (Decision 2, approved by the user).** Same JSON content and no schema change; `src/multiplayer/persistence.ts` writes `JSON.stringify(state)`.
   - Tests: `test/world-state-format.test.mjs` (a save reloads to an equal state; a pretty-printed file from the earlier format still loads to the same state; compact saves are smaller).
   - Size measurements at 250, 500, 750, and 1,000 identities are in section 5.1 (checkpoints from the default-cap runs).
   - **Not yet done:** a round-trip on a copy of the 284-file saved-data corpus. That corpus is **not present** in the current sandbox (`/home/user/data-backups` and `/home/user/data-investigation` are missing), so it was not run. Rollout should wait for that check.
3. **Stop copying the whole world per creation.** Build the new records and diff only the touched subtrees. Measure creation time before and after. Medium effort.
4. **For 5,000 to 10,000 identities:** move records out of the single document (one row per record, or per collection). This is a database schema redesign. It is **out of scope for this phase** and needs a separate approved plan, a migration review, and tests on a disposable database. The PostgreSQL store has the same single-document limit today.
5. **R4 (identity creation budget)** remains open. It limits how fast the world can fill up and needs an operator decision.

## 6. Limits (keep with every capacity claim)

- All measurements are from one sandbox (2 CPUs, about 4 GB RAM), one process, and loopback sockets. They are not production measurements.
- The no-op-flush runs skip the per-creation save, so they do not measure a real save at each creation. They are labelled as such.
- The 1 GiB runs change the limit for testing only. The production limit is unchanged.
- PostgreSQL was not measured at capacity sizes. The local development database was used only for the functional tests in `identity-rollback`. Neon and production were not tested (BLOCKED).
- The 629 figure from earlier was not reproduced. The cause of the difference is unverified (section 1.2).
- Random family sizes mean that per-identity size varies. The spread across three runs is 705–713.
- `pg_dump` was not available and no backup or restore was tested in this phase.

## 5.1 Compact-format measurements (after Decision 2)

Source: `docs/evidence/stage28-capacity/default-cap-compact-run{1,2,3}.json`. Same probe, real saves, production 16 MiB limit, temporary directory, loopback. Each run stops at the first refused save.

| Run | Identities created | Final file bytes | Marginal bytes per identity | Creation p50 / p95 (ms) | Save p50 / p95 (ms) | Shutdown (ms) | Max RSS (MB) |
|---|---|---|---|---|---|---|---|
| 1 | 1,059 | 16,774,334 | 15,840 | 219 / 466 | 85 / 171 | 166 | 385 |
| 2 | 1,069 | 16,776,341 | 15,693 | 224 / 490 | 89 / 171 | 167 | 435 |
| 3 | 1,047 | 16,775,869 | 16,023 | 219 / 470 | 84 / 177 | 158 | 395 |

- Size checkpoints (file bytes): 250 identities 3.99–4.06 MB; 500 identities 7.84–8.06 MB; 750 identities 11.77–12.03 MB; 1,000 identities 15.71–16.05 MB.
- Each run ended with `world_capacity_reached` and a clean shutdown (`shutdown_error: null`). The saved file stayed under the limit in every run.
- Pretty-format runs, for comparison (section 1.2): 705, 706, and 713 identities.
- These are single-process loopback runs in the sandbox. They are not production measurements.
- A run at 2,500 identities or more was **not** done with real saves. Each creation rewrites the whole world, so such a run would take far longer than this phase allows. The earlier no-op-flush runs (section 3) skip the save and do not show what a real save costs at those sizes.
