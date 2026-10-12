# File Backend: Operating Contract

Status: development and test only. This is not production storage. Production runs on PostgreSQL and refuses the file
backend at startup (`services/world-api/src/persistence/open.ts`). Nothing in this document makes the file backend
safe for more than one server process, or for more than one host.

This document is the operating contract for `PERSISTENCE_BACKEND=file`. It was written in Stage 35 (see
`docs/STAGE_35_PROPERTY_MUTATION_SAFETY_AND_FILE_PERSISTENCE.md`, section 6 for the decision and its evidence).

## 1. When the file backend is used

- Only when `PERSISTENCE_BACKEND=file` is set explicitly. It is never chosen automatically. With neither
  `PERSISTENCE_BACKEND` nor `DATABASE_URL`, startup is refused.
- With `PERSISTENCE_BACKEND=file` and `DATABASE_URL` both set, the file backend wins and the log says that world state is
  not stored in PostgreSQL.
- `NAIJA_ENV=production` with `PERSISTENCE_BACKEND=file` is refused. So is a production start without `DATABASE_URL`.

## 2. What the file backend guarantees (in one process)

- **Atomic replacement.** A save writes a complete temporary file, flushes it to stable storage (fsync), renames it over
  the world file, and flushes the directory entry (`persistence.ts`, `writeFileDurably` and `syncDirectory`). A reader
  sees the old file or the new file, not a partial one. A power-loss guarantee has not been tested (see
  `docs/STAGE_28_DIRECTORY_SYNC.md`, section 6).
- **Single writer per world file, enforced by an OS lock.** The server takes an `flock(2)` advisory lock on the sidecar
  file `<world file>.lock` (Linux only). See section 3.
- **Fencing.** Before each save the writer checks that it still holds the lock, that the lock record names its own token,
  and that the lock path still refers to the locked file. A failed check fences the store, and a fenced store never saves
  again. Each save is refused as `not_saved` when fenced.
- **No false success.** A changing action is confirmed to the client only after a save covers it. A failed save is
  reported as `not_saved`. A save that may have committed is reported as `outcome_unknown`. After a failed save, new
  financial changes are refused as `persistence_unavailable` until a save succeeds.
- **Shutdown save.** A clean SIGTERM saves the live world, exits with code 0, and removes the lock. If that final save
  fails, the server says so and keeps the previous file.

## 3. The lock: how it works

- The lock is held by a small holder process (`/bin/sh` with the world file's **directory** open on descriptor 9, running
  `flock -n 9`, then `cat`, which waits on a pipe from the server). Node has no `flock` binding, so the holder is the
  mechanism.
- **One directory, one file-backend writer.** The lock is on the directory, not on the lock file, so a process that
  replaces the lock file cannot admit a second writer. The cost: two world files in one directory cannot be served at
  once. The second start is refused with `world_file_locked`. Give each world file its own directory.
- The lock file `<world>.lock` is the record (pid and token) and the fence. The owner checks it before each save and again
  immediately before the rename. The owner keeps the lock file open while it holds the lock, so the inode cannot be reused
  while the check runs.
- The kernel releases the lock when the holder exits for any reason, including a SIGKILL of the server. A dead holder
  frees the lock at once. A restart needs no manual step.
- A live holder blocks every other start, however old the lock record looks. Process IDs are used only to name the holder
  in the error message.
- An empty lock file means "no record yet" and does not block its owner. An unreadable, non-empty record blocks while it
  is younger than 10 seconds and is taken over once it is older.
- A starter that cannot get a report from its holder within 5 seconds is refused. The start does not proceed without a
  lock.
- Platforms other than Linux, and Linux without `flock(1)`, GNU `stat`, or `/proc`, are refused at startup with
  `world_file_lock_unsupported`.

Errors a starter can see:

| Code | Meaning |
|---|---|
| `world_file_locked` | Another live server process holds this world file. Only one server may use it. |
| `world_file_lock_holder_failed` | The holder did not report a lock state in time. The start is refused. |
| `world_file_lock_unsupported` | This platform cannot take the lock. Use PostgreSQL, or Linux with `flock(1)`. |
| `world_file_lock_lost` | The lock was taken by another writer. This store is fenced and must restart before saving. |

## 4. What the file backend does NOT guarantee

These are limits, not bugs to be fixed quietly. Treat each as a reason to use PostgreSQL.

1. **Multi-host use.** Two hosts sharing the world file over a network filesystem are not protected. `flock` semantics
   over NFS and similar filesystems are not relied on, and no test covers them. Do not run two servers that share a world
   file across hosts.
2. **Processes that do not follow the protocol.** A person or script that removes, moves, or rewrites the lock file, or that
   writes the world file without taking the directory lock, is outside this guarantee. For a protocol-following starter,
   replacing the lock file at any point (including between the owner's check and its rename) does not admit a second
   writer (Stage 35, race 1; tested). The owner's next save is then fenced. Do not edit lock files by hand. Do not write
   the world file from any other process.
3. **Old builds.** A server built before Stage 35 wrote the lock file without `flock`. Do not run an old build against a
   world file that a Stage 35 server is using.
4. **Restoring old snapshots.** Restoring a backup copy over the live world file is not a safe operation. A snapshot that
   predates a one-time grant (for example the treasury initial allocation) would cause that grant to be applied again
   when the world loads. Restores must be reviewed by hand, and the server must be stopped while they happen.
5. **Power loss during a save.** The fsync and directory-sync steps are written, but a power-loss test has not been run
   (`docs/STAGE_28_DIRECTORY_SYNC.md`, section 6).
   Do not rely on the file backend for records you cannot reconstruct.
6. **Scale.** The whole world is one JSON document. Save cost grows with world size.

## 5. Operating rules

- Run one server process per world file. Do not start a second server with the same `DATA_FILE`. It will be refused with
  `world_file_locked` while the first is alive, which is the intended result. Do not work around it by deleting the lock.
- Give each world file its own directory. Two world files in one directory cannot be served at once (section 3).
- Stop the server with SIGTERM, not SIGKILL, so the shutdown save runs. Check the log for a
  failed shutdown save.
- If the server was killed, starting it again is safe. The dead holder's lock is taken over. Check the world file and the
  log before accepting that the last change was saved.
- Keep backups of the world file made while the server is stopped, or made with a copy from a point you control. Do not
  restore a backup over a running server.
- Move to PostgreSQL before any second process, second host, or concurrent writer uses the same world.

## 6. How to verify this contract

Run from `services/world-api` (no `DATABASE_URL`, so the file backend runs):

```bash
NAIJA_ENV=test node --test test/file-writer-lock.test.mjs test/file-writer-lock-races.test.mjs
```

What the tests show (separate OS processes where noted):

- `file-writer-lock.test.mjs`: lock acquire and release, live-holder refusal, dead-holder takeover, unreadable-record
  handling, a clean SIGTERM releasing the lock, and a fenced store refusing saves.
- `file-writer-lock-races.test.mjs`: two starter processes racing for one stale lock (separate processes, five rounds):
  exactly one wins. A starter that tries while the owner saves is refused. Out-of-protocol replacement before the check
  fences the store. A lock file replaced after the check and before the rename (the "race 1, window" test) does not admit
  a second protocol-following starter, and the owner's next save is fenced. A second world file in one directory is
  refused. These tests fail on the code before the directory lock.

Each test uses its own temporary directory.

## 7. Where the file backend is documented and enforced

- `services/world-api/src/persistence/open.ts`: backend selection and the production refusal.
- `services/world-api/src/persistence/writer-lock.ts`: the lock, its holder, and its error types. Its header comment lists
  the same guarantees and limits as this document.
- `services/world-api/src/multiplayer/persistence.ts`: the atomic save, the lock check before rename, and the fencing.
- `docs/STAGE_28_CONFIGURATION.md`: the configuration variables.
- `docs/STAGE_35_PROPERTY_MUTATION_SAFETY_AND_FILE_PERSISTENCE.md`: the Stage 35 decision, evidence, and results.
