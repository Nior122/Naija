# Stage 28 Task 1: Capacity and Shutdown Incident Report

Status: **Stage 28 remains OPEN.** This report covers the read-only audit of the 16 MiB world limit and the
shutdown path. It makes no production-readiness, Neon, production, corpus, or historical-integrity claim.
Local test results are not readiness claims. The 16 MiB limit is not raised, and no player data was deleted
or truncated.

Scope: the file backend (pretty and compact JSON) and the PostgreSQL backend. Every test uses an isolated temporary
file or a disposable local database (`naija_stage28_test`). Nothing read or wrote a live world file or the
284-file corpus (not located; see the corpus section of `STAGE_28_CAPACITY.md`).

## 1. Confirmed causes (reproduced by tests or probes)

| # | Finding | Evidence |
|---|---------|----------|
| C1 | A save whose serialized world exceeds 16 MiB is refused before any temporary file is written. The previous file stays byte-identical. | `persistence-failure-audit.test.mjs`: repeated refusals keep the file byte-identical (3 refusals). Byte-limit boundary: one byte under refuses, exact size saves (pretty and compact, separately). |
| C2 | The same refusal applies to PostgreSQL. The size check runs before the version-fenced `UPDATE`, so the row, its version, and its value are unchanged. The instance is not fenced. | `persistence-failure-audit-postgres.test.mjs` (6/6 on `naija_stage28_test`). |
| C3 | A creation refused at the limit leaves the live world unchanged (the candidate exists only in the draft). This is why a clean shutdown can follow refused creations. | `persistence-failure-audit.test.mjs`: shutdown after a refused creation exits cleanly. |
| C4 | Gameplay can grow live state past the limit without a creation. Periodic saves are then refused. Changes after the last successful save are lost on restart. | `persistence-failure-audit.test.mjs` ("gameplay after saves stop..."): live clock advances, the file does not change, and a restart loads the old clock. PostgreSQL: a restart loads the last saved clock (test 2). |
| C5 | A final flush refused at shutdown logs `API shutdown failed`, exits 1, and keeps the previous file. | In-process: shutdown with padded state throws `world_capacity_reached` and keeps the file. Process-level (`persistence-shutdown-exit.test.mjs`): a control SIGTERM exits 0 and saves; a failed final flush exits 1, logs the failure, and leaves the file's bytes and mtime unchanged. The failure is injected through the real error class (see Limitations). |
| C6 | A restart never loads a partial, truncated, malformed, or oversized file. Startup refuses and leaves the file unchanged. A leftover `.tmp` file does not change the load. | File: truncated, oversized, and leftover-`.tmp` tests. PostgreSQL: malformed row refused and unchanged. |
| C7 | Probe reproduction of the mechanism: adding 1,735,956 bytes of non-identity content reduces the identity count to 639 (640 total) before the first refusal, at 16,771,701 bytes. | `docs/evidence/stage28-capacity/padding-probe-1735956.json`. Synthetic content. This shows that non-identity bytes lower the count. It does not show what the historical world contained. |
| C8 | PostgreSQL real-save probe (local, disposable database): 1,059 identities created, first refusal at attempt 1,060 (`world_capacity_reached`), marginal 16,835 bytes per identity in compact JSON, shutdown 853 ms, exit 0. The `final_snapshot_bytes` figure (17,828,109) is the refused candidate, not the stored file. | Raw output at `/tmp/s28/pg-probe-run1.json` and `.log` (session workspace, not committed). The probe ran on the disposable database and deleted its rows. |

## 2. Non-capacity defect found and fixed

**D1. One persistence failure produced a notice storm.** A save that failed for a non-capacity reason sent
`persistence_failed` to every online player on each retry. A single unsaved change produced **21 notices in
2 seconds** for one online player (`persistence-failure-audit.test.mjs`, run on the pre-fix engine: **29 notices**
in the first 2-second episode).

Fix (`src/multiplayer/world-engine.ts`): one notice and one log line per failure episode, mirroring the existing
capacity rule. The episode closes on the next successful save, so a later failure is notified again.
Result after the fix: **1 notice** in episode 1, and **1 notice** in episode 2 after a successful save.
This changes notifications only. It does not change what is stored or how saves are attempted.

## 3. Unexplained: the historical 629-identity failure

**Status: UNEXPLAINED.** Nothing in this phase establishes what the 629-identity world contained or why it stopped there.

- Reproduction on `b206f40` (pre-fix tree, `/tmp/prefix-s28`): 709, 709, and 708 identities. One earlier attempt
  timed out at 60 s; the padding probe later reproduced the same `openPeer` timeout, which matches the
  connection-attempt limit (30 per minute per IP). The original run's logs were not checked. Run 3 shutdown threw
  `World data file exceeds the 16 MiB prototype limit.`
- The 629 figure is not reproduced. The padding probe shows a mechanism that could produce 629 if about 1.8 MB of
  other records were present. That is arithmetic (a hypothesis), not evidence. E8's starting file was not kept.
- Do not state that the 629 case is explained. Do not state that the historical world is intact.

## 4. Gaps recorded, not fixed (characterization tests)

| # | Gap | Evidence | Consequence |
|---|-----|----------|-------------|
| G1 | `/health` does not report saves refused by the size limit. Health is 200 and not `unhealthy`, and no check names the save failure. | `persistence-failure-audit.test.mjs` (file); PostgreSQL `health()` returns `pass` after a refusal ("reachable; version 2"). | Operators see green health while progress is not saved. Health semantics are not changed in this task. |
| G2 | PostgreSQL does not check the size limit on load. A 16,801,070-byte stored world loads. The next save is refused. | `persistence-failure-audit-postgres.test.mjs` case 6. The file backend refuses an oversized file at startup. | The two backends differ at startup. |
| G3 | Clients are never told that saves have resumed. The episode closes silently. | Code: no "saved again" message exists. | A client that saw a notice keeps no signal that the save later succeeded. |
| G4 | Gameplay continues after saves stop. Players are not blocked, and a restart loses the unsaved progress. | C4 above. | Unsaved progress can be lost. The policy decision belongs to Task 2 (persistence-unavailable policy). |
| G5 | Durability on power loss is not established. The file write uses temp file and rename without `fsync`. | Code reading only (`writeSnapshot`). Not tested. | Atomic against process death only. |
| G6 | The compact format is always used for PostgreSQL. Pretty and compact were tested separately for the file backend only. | Tests. | No PostgreSQL pretty case exists, by design. |

## 5. Tests added in this task

| File | Cases | Result |
|------|-------|--------|
| `services/world-api/test/persistence-failure-audit.test.mjs` | 15 (file backend, temp directories) | 15/15 in six consecutive runs before a title-only edit; 15/15 in one run after it |
| `services/world-api/test/persistence-failure-audit-postgres.test.mjs` | 6 (disposable database, unique keys, cleaned up) | 6/6 on local `naija_stage28_test`; skipped without the DB gate |
| `services/world-api/test/persistence-shutdown-exit.test.mjs` | 2 (child process, temp `DATA_FILE`, real `dist/index.js`) | 2/2 |
| `services/world-api/test/support/fail-final-flush.mjs` | Preload for the child process only (`AUDIT_FAIL_FINAL_FLUSH=1`) | Used by the shutdown test only |
| `services/world-api/scripts/capacity-padding-probe.mjs` | Probe (temp file, test-only connection-attempt setting) | Run once: C7 |

## 6. Limitations (stated in full)

- The shutdown failure is **injected**. The preload replaces the file store's `flush` with one that throws the real
  `WorldStateCapacityError`. Reaching 16 MiB with real saves takes minutes. The shutdown path and exit code are the
  production code; the trigger is not.
- All results are local: a single process, a local PostgreSQL 17 server on `127.0.0.1`, and a disposable database.
  They are not Neon, not production, and not multi-process.
- No real player data, live file, or corpus file was read or written.
- No capacity support claim is made for 2,500, 5,000, or 10,000 identities beyond the earlier real-save measurements
  recorded in `STAGE_28_CAPACITY.md`.
- The 16 MiB limit remains a prototype limit. It is not raised here.

## 7. Recommended next steps (not implemented here)

1. Task 2: decide the persistence-unavailable policy from the mapped action paths before any write block.
2. Health (G1): decide with the operations owner whether a refused save should change `/health`. Do not change
   health semantics to pass tests.
3. Startup parity (G2): decide whether PostgreSQL should refuse oversized rows at load, as the file backend does.
   This needs a reviewed migration plan for any existing oversized row, since no automatic deletion is allowed.
4. Recovery notice (G3): design a "saved again" signal, or document that clients must reconnect to re-learn save state.
5. Keep the 629 investigation open. Locate the original world (if any) and its logs before drawing any conclusion.
