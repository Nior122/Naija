# Stage 28: same-key identity conflict (REFUSE UNTIL RESOLVED)

Status: implemented on `arena/00cdea0e-naija` in the continuation work. **Not committed at the time of writing; see the
final report for commit IDs.** Stage 28 remains OPEN — PRODUCTION NOT READY.

Policy (approved in the continuation brief): refuse until resolved. No automatic merge into live state. No second
identity created as a fallback. A rejected or unresolved request mutates no authoritative state and consumes no identity
budget. No token is revoked or rotated for a legitimate player, and no active session is taken over.

## 1. Root cause (original engine, `e68e805`)

`commitIdentity` (world-engine.ts) runs these steps inside the persistence queue:

1. Builds the new identity on a `structuredClone` **draft** of the live world. The draft is built from the live world, not
   from the saved file.
2. Saves the draft with `store.saveState(draft)`. **This is the first authoritative change**: the saved file now holds the
   identity.
3. Merges the change set into the live world with `mergeStateChanges`. The merge is all-or-nothing.

A conflict is therefore detected **after** the authoritative file change and before the live world takes it. The
conflict branch then tried one compensating save of the live world:

- If the compensating save **succeeded**, the saved file lost the identity again. The request got
  `identity_creation_conflict`, nothing was charged, and nothing was left behind.
- If the compensating save **failed**, the identity stayed in the saved file, not in the live world. The original code then
  recorded its budget slot, returned `identity_creation_conflict`, and left the key unregistered in the live world.

Reproduced on the original engine (probe, file backend, one conflict with a failing compensating save, then a retry with the
same key):

| Step | Original engine (`e68e805`) | Result |
|---|---|---|
| First request | reply `identity_creation_conflict` | file holds the identity (1 with key), live holds none (0) |
| Retry, same key | reply `identity.created` (a new identity) | created while the first identity was still in the file |
| After the retry's save | file holds 1 identity with the key | the retry's save overwrote the file, so the first identity was dropped |

The reproduced sequence therefore did **not** leave two identities in the saved world. The defects it did show:

- **A second identity was created while the first was still durable** in the saved file (the retry was a fallback, not a
  refusal).
- **Inconsistent retry outcomes.** If the server restarts before the retry, the same key recovers the saved first identity
  instead (this matches the earlier characterization in `docs/STAGE_28_CAPACITY_INCIDENT.md` section 9).
- **Budget over-count.** The first identity's per-IP slot stayed charged and the retry charged another.
- **The player was told "try again"** while an identity they never received a token for sat in the saved file.

The original engine's conflict tests fail as expected: `test/identity-conflict-retry.test.mjs` and
`test/identity-conflict-safety.test.mjs` (M1 mutation run, `/tmp/s28/m1.log`: 17 pass, 8 fail). The eight failures include
the `identity_creation_pending` assertions, the failed-persistence creation case, and the session-ownership case.

## 2. Behaviour after the fix

Stable codes, all sent with the request's `requestId` when one was given:

| Situation | Reply | Identity in the saved file | Live world | Budget | Token |
|---|---|---|---|---|---|
| Key already live (recovery) | unchanged (existing `recoverIdentity`) | yes (the live one) | yes | none | rotated, as before |
| Key being created by another socket now | `identity_creation_in_progress` (unchanged) | — | — | none | — |
| Creation save fails (generic) | `persistence_failed` | unknown; may hold the identity | no | **none** | none |
| Merge conflict, compensating save **succeeds** | `identity_creation_conflict` (retryable) | removed | no | none | none |
| Merge conflict, compensating save **fails** | `identity_creation_pending` | **yes, unresolved** | no | **one slot, held** | none |
| Key pending, any new request | the request first runs a live save (see 3) | — | — | — | — |
| Pending key, live save **fails** | `identity_creation_pending` (no new identity) | unchanged by this call | no | unchanged | none |

`identity_creation_pending` is new. Its message says the identity is not confirmed as saved and that requests with this key
are refused until saving works again. It names no address, player, key, or path.

`persistence_failed` keeps its code for the generic failure. Its message changed from "could not be saved" to "could not be
confirmed as saved", because the outcome is unknown, not known to be a failure.

## 3. Resolution

A pending key is resolved only by a **successful save of the live world**, which holds none of the pending identities. Such a
save removes them from the saved file. `noteSaveSucceeded` calls `resolvePendingCreations`, which clears every pending entry
and gives back any held budget slot.

A new request with a pending key first calls `saveLiveWorld()`:

- If that save **fails**, the request is refused with `identity_creation_pending`. Nothing is created, and the file is left
  as the failed save left it.
- If that save **succeeds**, the pending identity is resolved. The request then proceeds as a **normal** creation. It is not
  refused a second time.

Decision for review: the retry that succeeds in resolving the key also creates the new identity. This follows from "refuse
until resolved": by the time the new identity is created, the earlier identity is confirmed absent from the saved file, so
no second identity exists at any point. The conservative alternative (refuse once more after a successful resolution) is a
one-line change and is not made here.

Other paths that resolve a pending key: any successful save of the live world (a different player's save, a tick, a
disconnect). This is also tested.

## 4. Budget

- A generic failed creation consumes no budget.
- A conflict whose compensating save fails holds one per-IP slot while the key is unresolved. The slot is released when the
  key resolves. It is not released by a restart, because restart drops the pending map.
- A rejected or refused request consumes nothing.
- The global R4 count is derived from saved identities, so an unresolved identity in the saved file counts there too. It is
  removed when resolution removes it from the file.

## 5. Sessions and tokens

- A pending identity was never given a token, so no token holder exists for it. The token hash that the saved file holds
  for it is not valid for the player.
- A pending key never disconnects, rotates, or takes over another player's session. Tested in
  `session ownership: an unresolved conflict for one key does not disconnect, rotate, or take over another player's session`.
- `resumeSession` on a token that is already online still returns `player_already_connected` and closes the new socket. No
  takeover.

**Bearer-token fact (documented, not changed):** a creation does not bind the creating socket. `identity.created` returns the
token; a session becomes live only through `session.resume`. A holder of the token can resume it when the player is offline.
This is the existing model, and it is why tests resume the owner explicitly before asserting on a session.

## 6. Restart (residual, reported)

The pending map is in memory. A restart drops it. The identity that was in the saved file is then recovered by key through the
existing recovery path (`recoverIdentity`), which issues a new token. This is the documented residual: the outcome after a
restart is "recovered by key", not "refused". Changing this would need a persisted pending marker, which is a schema and
persistence change and is not made here.

## 7. Tests

All tests are deterministic and use disposable temporary state. Each asserts world contents, counts, tokens, session
state, and budget counters. The file backend always runs; PostgreSQL runs only with a disposable database configured
(`DATABASE_URL`, `NAIJA_ALLOW_DB_TESTS=true`, database name containing `test`).

`test/identity-conflict-safety.test.mjs` (file, plus PostgreSQL when configured):
- two simultaneous requests with one key, on separate sockets, create exactly one identity
- failed persistence during creation: no record remains, the retry is refused while saving fails, then creates one identity
- ambiguous save (committed, response lost): the reply says failed; the retry resolves the file and creates one new identity
- existing-key recovery is unchanged: same identity, new token, old token stops working
- session ownership: an unresolved conflict for one key does not disconnect, rotate, or take over another player's session

`test/identity-conflict-retry.test.mjs` (file, plus PostgreSQL when configured):
- an unresolved conflict returns no identity; the saved file holds it, the live world does not, and the key is refused
- repeated requests with the key are refused while unresolved: nothing is written, and the held slot limits the address
- once persistence works, the retry resolves the unresolved identity, creates one new identity, and releases the held slot
- a conflict whose compensating save succeeds is rejected with no identity and consumes no budget
- another player's successful save resolves the unresolved identity; the key then creates a normal identity
- after a server restart the saved identity is the key's identity: recovery, with no second identity

`test/identity-budget.test.mjs`:
- R4 budget: an unresolved merge conflict keeps the saved identity, which holds the per-IP budget until it is resolved

Every test checks for orphans with `orphanProblems` (no household, family, or person without a player).

Results (historical until the final regression run; see the final report):

| Run | Result | Log |
|---|---|---|
| Conflict, safety, budget, file backend | 25/25, rc=0 | `/tmp/s28/fix4-conflict.log` |
| Same three, PostgreSQL loopback (disposable DB, `DB_SSL=false`, loopback only) | 36/36, rc=0 | `/tmp/s28/pg-conflict.log` |
| Broader identity, trusted proxy, persistence failure audit, capacity, file | 91/91, rc=0 | `/tmp/s28/fix5-identity.log` |
| Same, PostgreSQL loopback | 119/119, rc=0 | `/tmp/s28/fix5-identity-pg.log` |
| Mutation M1 (original engine restored from `HEAD`) | 17 pass, 8 fail (the conflict tests) | `/tmp/s28/m1.log` |
| Mutation M2 (budget release skipped in `resolvePendingCreations`) | 24 pass, 1 fail | `/tmp/s28/m2.log` |

After each mutation, the fixed engine was restored from a saved copy and checked with `cmp`, then rebuilt.

## 8. Limits (not claimed)

- PostgreSQL results are from a **local loopback** database, not Neon or production.
- Power loss is not tested. The pending state and its effects depend on the save contract in
  `docs/STAGE_28_DIRECTORY_SYNC.md`.
- Multi-process use is not covered. The reservation and pending maps are per process.
- The per-IP budget counter is per process and resets on restart (existing limitation, R4 document).
- R4 stays disabled in production unless the operator enables it.
