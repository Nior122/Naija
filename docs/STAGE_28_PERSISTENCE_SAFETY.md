# Stage 28 — Persistence safety: health, load limit, recovery signal, mutation map, durability

**Status: STAGE 28 OPEN — PRODUCTION NOT READY.**

This document records the Stage 28 continuation work on gaps G1 to G5, the capacity follow-up (Task F), and the
account and character status (Task G). Every result stated here comes from a test or command listed in section 9.
Local PostgreSQL results do not prove Neon or production behaviour. No multi-process, power-loss, backup, restore, or
TLS-in-production claim is made.

Historical evidence (`STAGE_28_CAPACITY_INCIDENT.md` section 4 and `STAGE_28_PERSISTENCE_UNAVAILABLE_POLICY.md`) is
kept as it was written. Corrections are recorded in section 8 and in the status notes at the end of those documents.

---

## 1. Health model (G1)

The process now reports four different things. A running process does not imply healthy persistence.

| Endpoint | Question it answers | Depends on persistence | Reads or writes world state | HTTP status |
|---|---|---|---|---|
| `GET /live` | Is the process running and answering HTTP? | No | No | 200 `{status:"alive"}` |
| `GET /health` | Should this instance receive players now? (readiness) | Yes | No (read-only checks) | 200 when healthy or degraded, 503 when unhealthy |
| `persistence` check inside `/health` | Are saves succeeding, is the store fenced, is the database reachable? | Is the check | No | `fail` makes `/health` 503 |
| Save outcome (per store) | What did the latest save attempt do? | Is the source | Records only | Not an endpoint |

Save outcome states (`src/persistence-status.ts`, `SaveStatusTracker`):

- `not_attempted`: no save since start. Reports `pass`.
- `saved`: the latest save succeeded. Reports `pass`, with the time of that success.
- `failing`: the latest save failed. Reports `fail`, with a reason (`capacity`, `conflict`, or `error`) and the time
  failing started. The message contains no world data, credentials, or error text.

Rules:

- Only a successful save closes the `failing` state. Connection checks, retries, timers, and the passage of time do not.
- A refused save (size limit) and a failed write both report `fail` until a later save succeeds.
- PostgreSQL `health()` reports `fail` when the instance is fenced, when the database is unreachable, or when the
  latest save failed. A reachable database alone is not enough.
- The file store reports the same save outcome. Its message still starts with "File persistence (development mode)".
- Health checks never save, retry, or change world state. Test: `persistence-recovery-signal.test.mjs`, "health and
  liveness checks never write". It checks the write counter and the file digest after 10 `/health` and 10 `/live`
  calls.

Degradation: a save failure is reported as `fail`, not `warn`. No `warn` state is used for persistence. The reason is
that a load balancer would otherwise keep sending players to an instance that is not saving. The cost is that a single
failed attempt makes readiness 503 until the next retry succeeds (about one second, from the tick).

Production wiring: `src/index.ts` passes `persistence.health()` to the app, and that call reaches the store's outcome.
The test fixtures pass the same function explicitly.

Not done: the repository has no deployment, ingress, or probe configuration (see `STAGE_28_PRODUCTION_AND_NEON_STATUS.md`).
Which endpoint a probe uses is therefore BLOCKED until a deployment exists. The intended mapping is `/live` for
liveness and `/health` for readiness.

Tests: `persistence-failure-audit.test.mjs` ("G1: while saves are refused…"), `persistence-recovery-signal.test.mjs`
("G1: a failing save fails /health…", "G1: health and liveness checks never write…"), and
`persistence-failure-audit-postgres.test.mjs` ("G1: health() reports fail…"). The old characterization tests that
asserted the gap were replaced, not loosened.

**G1 flake: test narrowed (test-only; production health unchanged; pending review).** The original G1 readiness assertion
checked the whole `/health` status after a successful save. `/health` also runs a `memory` check (`src/monitoring.ts`,
`checkMemory`), which reports `fail` when `heapUsed / heapTotal` is above 90%. That ratio depends on garbage-collection
timing, not on the heap limit. In one of five full PostgreSQL runs (`/tmp/s28/final-test-pg.log`, 1019 pass, 1 fail,
rc=1) the final assertion failed with `memory: fail, "Heap usage critical: 91.8%"`, while the `persistence` check was
`pass`. Earlier isolated runs did not reproduce it.

The G1 tests in `persistence-failure-audit.test.mjs` now use a `withHeapReading` helper:

- **"G1: while saves are refused…" (persistence)**: heap is pinned at 50%, so the memory check cannot influence the result.
  The test asserts the `persistence` check directly: `/health` returns 503 with `persistence` failing while saves are
  refused and `memory` passing, `/live` stays 200, and after a later successful save `persistence` passes and `/health` is
  not unhealthy (200). This test runs on the file backend only.
- **"G1 (memory)"**: heap is pinned at 95%. The test asserts that memory pressure alone returns 503 with the `memory` check
  failing and the `persistence` check passing. This keeps the memory check tested.

Verification of the narrowed tests: `--test-name-pattern G1` passed 3 of 3 runs on the file backend and 3 of 3 runs on
PostgreSQL loopback (`/tmp/s28/g1-file-{1,2,3}.log`, `/tmp/s28/g1-pg-{1,2,3}.log`). Mutation checks: forcing the memory check
to `pass` makes only the memory test fail (`/tmp/s28/r2-mut-memory.log`, rc=1); forcing the persistence check to `pass` makes
only the persistence test fail (`/tmp/s28/r2-mut-persist.log`, rc=1). Both were restored afterwards.

What this does not do: it does not change the memory check's 90% heap-ratio threshold, which still measures
`heapUsed / heapTotal` rather than the heap limit. That is a health-semantics question and needs separate approval. A clean
full run is not claimed as proof of anything beyond the G1 tests above.

Mutation check: in the built output, a failing save was forced to report `pass`. `persistence-recovery-signal.test.mjs`
then failed 3 of 4 tests (the audit test was not re-run for this mutant).

---

## 2. Load limit on PostgreSQL (G2)

- `PostgresWorldStore.open()` measures the stored state as `Buffer.byteLength(JSON.stringify(row.value), "utf8")`.
  That is the same measure the save path uses. A stored state above `MAX_SNAPSHOT_BYTES` (16 MiB) throws
  `StoredWorldTooLargeError` before validation and before any write.
- The error message gives the size and says the row was not changed. It contains no world data.
- The row and its version are unchanged. Nothing is truncated, deleted, migrated, or pruned.
- The file backend is unchanged. It already refuses an oversized file at startup.
- The limit is still 16 MiB. It is not raised here.
- Tests (`stored-world-size-load.test.mjs`, PostgreSQL-gated): exactly the limit loads, one byte more is refused, the size
  check runs before validation, and repeated refused loads write nothing. A test-owned row replaced by a smaller
  valid world then loads. This test shows the load path recovers. It is not an operator procedure for production data.
- Mutation check: with the new check removed from the built output, all 3 tests failed.

Limitation: the operator has no tested procedure for an oversized live row. Such a row must be reviewed under a
documented plan before anything changes it. No such plan is in this change.

---

## 3. Recovery signal (G3)

- After a successful save that follows a failure notice, the server sends one message to each online player:
  `{"type":"persistence.restored","failedAttempts":N,"outageSeconds":S}`.
- `failedAttempts` counts failed attempts since the last successful save. `outageSeconds` is the time from the first
  notice of the episode. The message contains nothing else.
- One notice and one recovery signal are sent per episode. A normal save after recovery sends nothing.
- The server also writes one log line on recovery.
- Meaning, stated exactly: the save that succeeded serialized the whole live world at the moment it ran. Changes that
  were in the live world at that moment are in the saved file. Changes made after it are saved by the next save,
  normally within about a second. The signal does not list which changes were included. It does not say that any
  earlier change was lost or recovered.
- Before this change, the protocol had no such message. Clients that had seen `persistence_failed` never learned that
  saves had resumed.

Client status: the game client does not handle `persistence.restored`. Its message handler is a `match` with no
matching arm, so the message is ignored without error. No player-facing text was added, because the brief forbids
inventing client behaviour. A player can still see `persistence_failed` with the reworded text described in section 4.
Showing the recovery in the client is a separate, reviewed change.

Tests (`persistence-recovery-signal.test.mjs`, file backend in a temporary directory):

- healthy → failure → repeated failures → success → normal saves: one notice, one signal, `failedAttempts` = 3, and no
  repeat after normal saves.
- healthy → failure → recovery → new failure → recovery: two notices, two signals, and the second signal counts only
  its own failures (`failedAttempts` = 1).
- The message keys are exactly `failedAttempts`, `outageSeconds`, and `type`.

Mutation check: with the signal removed from the built output, 3 of 4 tests failed.

---

## 4. Mutation map and decision table (G4)

### 4.1 How persistence works per family (from source)

- Most gameplay families call `touchPlayer(player)` for each action that is not on the family's read-only list. That
  sets `dirty`. At the end of the handler they call `await this.flushDirty()`. So an action that changes the world
  makes an immediate, awaited save attempt. If that attempt fails, the change stays in memory and the periodic tick
  retries about once a second. Concurrent saves are coalesced through `flushInFlight`.
- `movement.input` does not call `touchPlayer` or `flushDirty`. Movement, energy, and the clock change inside the tick,
  which sets `dirty` through its `changed` flag. Those changes are saved by the periodic save.
- `chat.send` and `player.interact` do not touch the world. They are not persisted.
- Identity creation (`commitIdentity`), identity recovery (`recoverIdentity`), session resume, and life events save
  through `store.saveState` or `store.flush`, or through `flushDirty`.

Correction to the earlier policy table: it labels most families "periodic save". The code shows an awaited save attempt
at the end of each family handler, with periodic retries after a failure. The earlier table is kept as written. This
note corrects it.

Reply ordering: in `world.travel` the success reply (`sendCharacterSnapshot`) is sent before the awaited save. The
other handlers were not individually checked for ordering. Treat their ordering as unverified.

### 4.2 Decision table

Decision options: **warning-only** (current behaviour, plus the health and recovery changes); **reject before change**
(refuse a write before any state changes, with no budget consumed); **degraded read-only** (refuse all writes while
persistence is failing).

Decision applied in this change: **warning-only for every family.** No new rejection is added. The reasons are:
the mapping above has not been reviewed per action path, the brief forbids broad blocking without that review, and
blocking a write after it has already been applied in memory would itself create divergence. Rejection before change
is the safer shape, and it is a candidate for each family listed below after its own review.

| Family (message type) | Handler | Writes world state | Save timing | If the save fails | Decision now | Candidate for later reviewed rejection |
|---|---|---|---|---|---|---|
| `movement.input` | `handleMovement` | Via tick only | Periodic | Position reverts on restart | Warning-only | No |
| `world.travel` | `travel` | Yes | Immediate, reply first | Location reverts on restart | Warning-only | Low |
| `world.bus` | `takeBus` | Yes | Immediate, reply first | Money and position revert | Warning-only | Yes (money) |
| `shop.purchase` | `purchaseItem` | Yes | Immediate, reply first | Money and goods revert | Warning-only | Yes (money and goods) |
| `inventory.consume` | `consumeItem` | Yes | Immediate, reply first | Inventory and needs revert | Warning-only | Low |
| `clinic.care` | `visitClinic` | Yes | Immediate, reply first | Money and health revert | Warning-only | Yes (money) |
| `character.rest` | `rest` | Yes | Immediate, reply first | Energy and needs revert | Warning-only | Low |
| `geography.enter` / `geography.leave` | `enterGeographicRegion` / `leaveGeographicRegion` | Yes | Immediate | Presence reverts | Warning-only | No |
| `school.begin` | `beginLesson` | Yes | Immediate | Lesson start reverts | Warning-only | No |
| `school.answer` | `answerLesson` | Yes | Immediate, reply first | Progress and rewards revert | Warning-only | Low |
| `education.action` | `educationAction` | Yes | Immediate, reply first | Records revert | Warning-only | Low |
| `career.action` | `careerAction` | Yes | Immediate, reply first | Employment and pay revert | Warning-only | Yes (pay) |
| `economy.action` | `economyAction` | Yes | Immediate, reply first | Balances, transfers, loans revert | Warning-only | **Yes (highest)** |
| `business.action` | `businessAction` | Yes | Immediate, reply first | Ownership and ledger revert | Warning-only | **Yes (highest)** |
| `property.action` | `propertyAction` | Yes | Immediate, reply first | Ownership and money revert | Warning-only | **Yes (highest)** |
| `government.action` | `governmentAction` | Yes | Immediate, reply first | Records and appointments revert | Warning-only | Yes (appointments) |
| `election.action` | `electionAction` | Yes | Immediate, reply first | Candidacies and results revert | Warning-only | Yes (results) |
| `justice.action` | `justiceAction` | Yes | Immediate, reply first | Court records and fines revert | Warning-only | **Yes (fines)** |
| `police.action` | `policeAction` | Yes | Immediate, reply first | Police records revert | Warning-only | Low |
| `military.action` | `militaryAction` | Yes | Immediate, reply first | Military records revert | Warning-only | Low |
| `crime.action` | `crimeAction` | Yes | Immediate, reply first | Criminal records revert | Warning-only | Low |
| `culture.action` | `cultureAction` | Yes | Immediate, reply first | Cultural records revert | Warning-only | Low |
| `entertainment.action` | `entertainmentAction` | Yes | Immediate, reply first | Records revert | Warning-only | Low |
| `relationship.progress` | `progressRelationship` | Yes | Immediate, reply first | Relationship stage reverts | Warning-only | Low |
| `family.childbirth` | `recordChildbirth` | Yes | Immediate, reply first | Family records revert (irreversible in practice) | Warning-only | **Yes (irreversible)** |
| `chat.send` | `handleChat` | No | None | Not persisted | No change | No |
| `player.interact` | `handlePlayerInteraction` | No | None | Not persisted | No change | No |
| Identity creation | `commitIdentity` | Yes | Immediate, before reply | Identity is not created; the request gets `persistence_failed` or `world_capacity_reached` | Already safe (no identity, no budget) | No |
| Identity recovery | `recoverIdentity` | Yes | Immediate, before reply | Recovery is reverted; the request gets an error | Already safe | No |

Notes:

- "Reply first" means the success reply is sent before the awaited save (checked for `world.travel`; see 4.1).
- Rejections already in place do not consume identity budget (`identity-rollback` and R4 tests). This change adds no
  rejection, so it changes no budget behaviour.
- Degraded read-only mode (refuse all writes while saves fail) is a product decision. It is not implemented.

### 4.3 Safeguards implemented (justified and non-breaking)

- Health reports the save outcome (section 1), so an operator sees the failure.
- Recovery is signalled once per episode (section 3).
- The failure notice now says what the player needs to know. The old text was "Server state could not be saved." The
  new text is: "Server state could not be saved. Changes made now may be lost if the server restarts before saving works
  again." No test asserted the old text. Clients show the description unchanged.

Gap, recorded: a player who has just received a success reply has no per-action "unsaved" marker. The shared notice is
the only signal. Progress is not shown as saved, but it is not shown as unsaved either.

---

## 5. File-save durability (G5)

### 5.1 What the code does now (`src/multiplayer/persistence.ts`)

1. The size is checked against the limit, from `JSON.stringify` before any write.
2. A temporary file is created exclusively (`open(path, "wx")`) in the same directory, named with the process ID and a
   random UUID.
3. The temporary file is written and flushed to stable storage (`fsync`) before it is closed.
4. The temporary file is renamed over the saved file. On the same filesystem this is atomic against process death.
5. The directory is synced (`fsync` on the directory) so the rename itself is recorded. This step is skipped on Windows,
   where Node cannot open a directory.
6. The save is reported as successful only after step 5. A failure in step 5 is reported as a failed save, even though
   the rename has already happened. The engine retries, and the retry writes the same content.
7. The temporary file is removed in a `finally` block. A leftover temporary file (after a crash) is not removed
   automatically.

### 5.2 Facts established by tests (`file-save-durability.test.mjs`, 7 tests)

- A normal save produces a file that a new store loads, and leaves no temporary file.
- A failure before the temporary file is written leaves the previous file byte-identical and no temporary file.
- A failure after the temporary file is synced leaves the previous file byte-identical, and the finally block removes
  the temporary file.
- **A failure after the rename is reported as a failed save, but the new file is already in place. A restart loads the
  new world.** Callers must treat a failed save as "not known to be saved", not as "not saved".
- After an injected failure the next save succeeds and health returns to `pass`.
- A leftover temporary file is ignored at load and is not deleted.
- A process killed with SIGKILL during repeated saves (3 rounds, a child process in a temporary directory) never leaves a
  partial main file. The loaded file holds at least every save the child reported and at most one more.

The fault points are reached through `fileWriteFaultHook`, a test-only option. Production code never sets it.

### 5.3 What is NOT established

- **Power loss is not tested.** A SIGKILL leaves the operating system's page cache intact. These tests cannot show that
  a completed save survives a power cut. Hardware evidence would need a power-cut test on the target storage, which has
  not been done.
- Filesystems other than the sandbox's ext4, NFS and network filesystems, and Windows behaviour are not tested.
- **fsync cost:** a scratch measurement in the sandbox (`/tmp`, not committed) timed a 1 MiB and a 16 MiB write. The
  plain write, the write with file `fsync`, and the write with directory `fsync` were not measurably different (median
  of 7; 5.9, 4.7, and 5.5 ms for 1 MiB; 43.1, 36.3, and 42.4 ms for 16 MiB). Sandbox disks often acknowledge `fsync`
  without reaching physical media, so this is not evidence of production cost or of durability.
- The leftover temporary files from a crash are not cleaned up. This follows the "no automatic deletion or pruning" rule.

---

## 6. Task F: capacity follow-up (concise)

- The 16 MiB limit is kept. It is not raised.
- The 629-identity failure is still unexplained. The three reproductions on `b206f40` gave 709, 709, and 708 identities.
  No cause is assumed. The write-up is in `STAGE_28_CAPACITY_INCIDENT.md`.
- Real-save measurements at the 16 MiB default: compact 1,059, 1,069, and 1,047 identities; pretty 706 and 707.
- Real saves at a 1 GiB test-only limit (not production): 1,000 and 2,500 identities saved. 5,000 and 10,000 were not
  run.
- The 10,000 figure is a planning target only. No support claim is made for 2,500, 5,000, or 10,000 identities at the
  production limit.
- No hard state cap is added. No automatic deletion is added. The G2 load check refuses oversized rows; it does not
  shrink them.
- Next: a reviewed plan for the 629 case, and a measured real-save run at 5,000 in an isolated environment.

---

## 7. Task G: account and character status

- No account or character integration is implemented or approved. The tables exist in `schema.ts`. The repositories are
  used only by tests. The live engine persists the JSON `world_state` row.
- No email recovery, no new operator CLI, and no change to key-only recovery.
- The 24-hour wait in recovery remains a design (`STAGE_28_R8_RECOVERY_DESIGN.md`). Nothing was implemented.
- Documents: `STAGE_28_ACCOUNT_CHARACTER_INTEGRATION_REVIEW.md` and `STAGE_28_ACCOUNT_CHARACTER_DESIGN.md`. Neither is
  approved.

---

## 8. Corrections to earlier reports

| Earlier statement | Status now |
|---|---|
| `/health` reports pass while saves are refused (G1, incident doc section 4) | **Corrected.** A refused or failing save reports `fail` until a later save succeeds. |
| PostgreSQL does not check the size limit on load (G2) | **Corrected.** Loads above the limit are refused. |
| Clients are never told that saves have resumed (G3) | **Corrected on the server.** `persistence.restored` is sent once per episode. The client does not display it yet. |
| The file write has no `fsync` (G5) | **Corrected.** The temporary file and the directory are synced. Power-loss durability is still not established. |
| Most families mark dirty and rely on the periodic save (policy table) | **Corrected.** Each family handler makes an awaited save attempt at its end (section 4.1). |
| The `persistence_failed` notice says only that the state could not be saved | **Changed.** The text now says changes may be lost on restart until saving works again. |
| Test runner counts for earlier phases | Unchanged. See `STAGE_28_CAPACITY_INCIDENT.md` section 8. |

---

## 9. Verification (this continuation)

Baseline before any edit, on `4419d98`: `npm test` 950 total, 913 pass, 0 fail, 37 skipped, exit 0. TypeScript 0
errors. ESLint 51 errors in 16 files, all pre-existing.

Final results are recorded in section 10, after the last run.

Notes on counting:

- A PostgreSQL-gated file whose database variables are unset reports as a skipped suite. It is not counted in the
  individual test totals. The default totals therefore do not include the PostgreSQL tests.
- `DB+TLS` means `DATABASE_URL` pointing at a local `ssl=on` server with `sslmode=verify-full` and the test CA. It is
  local only. It is not Neon and not production.

---

## 10. Final results

Recorded at the final run on the branch before the commit that adds this document. Numbers are from
`npm test` logs in `/tmp/s28/`.

| Configuration | Tests | Pass | Fail | Skipped | Exit | Notes |
|---|---|---|---|---|---|---|
| Default (no database) | 961 | 924 | 0 | 37 | 0 | PostgreSQL-gated suites skipped at suite level |
| Local PostgreSQL (`127.0.0.1`, `DB_SSL=false`, loopback only) | 987 | 983 | 0 | 4 | 0 | 4 TLS-only tests skipped |
| Local PostgreSQL with TLS (`localhost`, `sslmode=verify-full`, test CA) | 987 | 987 | 0 | 0 | 0 | Local scratch server only |

TypeScript: 0 errors in every configuration. ESLint: 51 errors, same per-file counts as the baseline.

---

## 11. Limitations (directive item 6, in full)

- All results are local: one process, a local PostgreSQL server, and a disposable database. They are not Neon, not
  production, and not multi-process.
- Process-kill tests are not hardware proof. Power loss is not tested.
- No real player data, live world file, or corpus file was read or written. The live file path
  `services/world-api/data/world-state.json` does not exist in this checkout.
- No backup or restore was run. `pg_dump` is not available in this environment.
- The compact rollout is BLOCKED, and the 629 case is unexplained.
- R4 (identity budget) is implemented, disabled, and stays disabled in production.
- Stage 28 remains OPEN. Production is not ready.
