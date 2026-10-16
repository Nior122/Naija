# Stage 28: file save and directory-sync failure states

Status: analysis and fault-injection tests for the **file** backend. No change to the save contract in this stage.
Stage 28 remains OPEN — PRODUCTION NOT READY. Power loss is NOT tested (see §6).

## 1. The save sequence (`services/world-api/src/multiplayer/persistence.ts`, `WorldStore.writeSnapshot`)

Each save runs inside the store's write queue, in this order:

| Step | Action | Failure here means |
|---|---|---|
| 0 | Serialize the candidate (pretty JSON by default). Refuse if larger than the limit (16 MiB; `WorldStateCapacityError`). | Nothing is written. The saved file is unchanged. |
| 1 | `mkdir` the directory (recursive). | Nothing is written. |
| — | hook `before-temp` (test only) | — |
| 2 | Create `<file>.<pid>.<uuid>.tmp` exclusively (`open` with `wx`, mode `0600`), write it, `fsync` the file, close it. | The saved file is unchanged. A partial temporary file may exist and is removed in `finally`. |
| — | hook `after-temp-sync` (test only) | — |
| 3 | `rename(temporary, saved)`. Atomic on the same filesystem: the saved file is either the old one or the new one. | The saved file is unchanged. The temporary file is removed in `finally`. (**Replacement failure.**) |
| — | hook `after-rename` (test only) | — |
| 4 | `fsync` the **directory** (skipped on Windows). | **The saved file is already the new one.** The save is reported as failed. The directory entry may not be durable. |
| 5 | Record success in monitoring. `finally`: remove the temporary file if it still exists (it does not after a rename). | — |

The engine reports a save as successful only after step 4 succeeds (`saveState` returns, `saveStatus.recordSuccess`). Any
failure throws to `flushDirty`, which keeps `dirty` set, counts the failed attempt, and sends one `persistence_failed` per
failure episode to online players (see `docs/STAGE_28_MUTATION_ORDERING_AUDIT.md`).

## 2. States

For each state: the saved file, the live world in the same process, what the engine reported, and what a restart loads.

### S-cap. Capacity refusal (step 0)

- Saved file: unchanged (previous valid world).
- Live world: unchanged; no rollback.
- Reported: `world_capacity_reached`, once per episode (the one-shot rule).
- Restart: the previous file.

### S0. Failure before the temporary file is written, or while writing or syncing it (steps 1–2)

- Saved file: the **previous** world, byte-identical (tested: `file-save-durability.test.mjs`).
- Live world: keeps the changes (no rollback).
- Reported: `persistence_failed`.
- A later successful save writes the live world, which includes the changes.
- **Restart before that save (crash): loads the previous world. The changes made since the last successful save are lost.**
- **Graceful restart: `shutdown()` flushes again. If the disk has recovered, the changes are saved at shutdown. If it has not, they are lost.**

### S1. Replacement failure (step 3, `rename` fails)

- Saved file: the previous world (rename is atomic; a failed rename changes nothing).
- Otherwise the same as S0.
- Not injected in the tests. The hook `after-temp-sync` runs immediately before the rename and shows the same saved-file state.

### S2. Successful replacement, then directory-sync failure (steps 3–4)

- Saved file: the **new** world. The save was reported as failed, but the file on disk already holds the state the save was
  trying to write.
- Live world: the same as the file.
- Reported: `persistence_failed`, although the changes are in the saved file. **A failure report does not prove the previous world
  is authoritative.**
- A later successful save rewrites the file (same content, plus any newer changes), and the directory sync succeeds. Then the
  state is durable as far as the platform's `fsync` guarantees.
- Restart before that save (crash), without power loss: loads the **new** world, including the changes reported as failed.
- **Power loss after the rename but before the directory entry is durable:** the rename may be undone, so the previous world may
  return. The process cannot know this. This is the uncertainty that is not tested here.

Simulation in the tests: the `after-rename` hook throws before step 4 runs. Its observable effect (the file replaced, the save
reported as failed, no directory sync performed) matches a failing directory `fsync`. The injected failure does not make the
`fsync` system call fail.

### S3. Subsequent successful save (after any of the above)

- Saved file: the live world at the time of the save, with the directory sync done.
- The next success sends one `persistence.restored` to online players (client notice: "Server saving is working again. This does
  not confirm changes made while saving was failing.").
- The notice never claims the outage-period changes were recovered. A successful save writes the live world; it does not prove
  the earlier failed attempts were applied in the file, and the notice does not say so.

### S4. Restart after each state

| State | Crash restart loads | Graceful restart (shutdown flush) loads |
|---|---|---|
| S-cap | previous world | not tested |
| S0 | previous world; outage changes lost | live world if the flush succeeds (tested, 3 phases); otherwise previous world |
| S1 | previous world; outage changes lost | same as S0 |
| S2 | **new world** (includes changes reported as failed) | live world, same as the new file (tested) |
| S2 then power loss | previous world **may** return; uncertain | — |
| S3 | the successful save | the successful save |

### S5. Leftover temporary files

A crash during step 2 leaves `<file>.<pid>.<uuid>.tmp`. Load reads only the saved file, so a leftover is ignored. Nothing removes
it automatically (no automatic deletion is allowed in this stage). Tested: `file-save-durability.test.mjs`, "a leftover temporary
file from an earlier crash is ignored at load and is not removed".

## 3. What is guaranteed, and what is not

Guaranteed by the code and tested in-process:

- A failed save never leaves a partially written saved file (the saved file is replaced only by a rename of a fully synced
  temporary file). Tested: SIGKILL during repeated saves never leaves a partial main file.
- A failed save never rolls back the live world. No automatic rollback exists, so no rollback can overwrite a newer valid
  world.
- A successful save is reported only after the directory sync succeeds.
- Changes made during an outage are not claimed as saved by any message.

Not guaranteed:

- **Power-loss durability.** The directory sync is what makes the rename durable. Whether a power cut keeps the rename depends on
  the filesystem, its mount options, and the hardware. Not tested.
- Storage that acknowledges `fsync` without persisting the data. Not tested.
- Network filesystems, Windows (the directory sync is skipped), and multi-process use. Not tested.
- That a file reported as saved will load on a later server version. Schema changes are out of scope here.

## 4. Engine-level fault-injection tests

`services/world-api/test/directory-sync-states.test.mjs` (new, file backend, 6 tests). Three test the crash-style restart (one per phase; each restores the failed-save bytes, because a stop would otherwise overwrite them). Three test a graceful stop with the disk working again (one per phase): shutdown writes the live world, and a restart loads it. Each crash-style test:

1. Creates an owner and a second player online on separate sockets. Records the saved money of the owner.
2. Waits until every write has committed (`quiet()`, using the fault-store counters). `session.resume` replies before its
   background save commits, and without this barrier the injected change can land in an in-flight save. This was observed and
   fixed in the test (not in the engine).
3. Changes the owner's money in memory (a test-controlled change; the engine saves the live world, so the change is saved by
   the next write).
4. Arms the phase, then disconnects the second player (a save through `flushDirty`).
5. Asserts: the owner receives `persistence_failed`; the live money keeps the change (no rollback); no temporary file is left; the
   saved file is the previous world for `before-temp` and `after-temp-sync`, and the new world for `after-rename`.
6. Copies the failed-save state. A later successful save (a creation from a third socket) sends exactly one
   `persistence.restored` to the owner and writes the live world (asserted from the file and orphan check).
7. Stops the server, restores the failed-save bytes (so the shutdown flush cannot overwrite them), and restarts from the file.
   Asserts the loaded money matches S0/S2, and that the owner's token still resumes.

Results: the three crash-style tests passed in each of four earlier runs (`/tmp/s28/dirsync-2.log`, rc=0, and three repeat runs). The graceful-stop tests were added after those runs. The file with all six tests: 6/6, rc=0 (`/tmp/s28/dirsync-3.log`).

Existing store-level tests (G5, `test/file-save-durability.test.mjs`): normal save; failure before the temporary file (previous file
identical); failure after sync (previous file identical; temporary removed); failure after rename (new file loads); next save
succeeds and health returns; leftover temporary ignored; SIGKILL during repeated saves.

Not written (recorded as gaps): a failing `rename` injected as an error (equivalent to S0/S1 by the atomicity argument above); a
failing `fsync` system call (needs a filesystem double, not in this stage); power loss (not feasible in a test process).

## 5. Recommendations (no change in this stage)

1. Document for operators that a failed save may still have written the new file (S2). The recovery procedure must compare the
   saved file with the process's last-known state before assuming the old world is authoritative.
2. Consider a separate, reviewed change that makes the save report carry the step that failed (temporary, rename, or directory).
   This is diagnostic only and is not made here.
3. Power-loss testing needs a disposable host or a filesystem that can drop unsynced data. Record it as a blocker for production
   durability claims.
4. Stray temporary files are not cleaned up. Any cleanup needs an explicit, reviewed procedure. No automatic deletion.

## 6. Durability uncertainty, stated plainly

A save reported as successful means that the new file was synced, renamed over the saved file, and the directory was synced
(on platforms that allow it). It does not prove durability on any particular storage device. A save reported as failed may
still have replaced the saved file (S2). The engine cannot tell these apart after a power loss, and this test suite cannot
simulate one.

For PostgreSQL, the equivalent case (a commit that succeeds but whose response is lost) is covered by the commit-then-fail
tests in `test/identity-conflict-safety.test.mjs` ("ambiguous save"). Those tests use loopback only, not Neon.
