# Stage 28 — Identity creation: atomicity and same-key serialization (R1, R2)

**Status:** implemented on `arena/00cdea0e-naija` with tests. **Not** production-ready. The guarantees below are scoped to one server process (R1) and to the save paths tested (R2). See section 6.

**Related:** `docs/STAGE_28_CREATION_KEY_REVIEW.md` (E3 and E6b, the original reproductions), `docs/STAGE_28_R8_RECOVERY_DESIGN.md`, `docs/STAGE_28_R7_CREDENTIAL_LIFECYCLE_DESIGN.md`.

---

## 1. Bugs reproduced before the fix

| ID | Bug | Reproduction (before fix) |
|---|---|---|
| R1 | Two sockets presenting the same **new** creation key during the first save both received an identity. The first socket's token was then invalid (`session_invalid`). | E3 in the review; `test/identity-concurrency.test.mjs` test 1 (second socket received `identity.created` where an error was expected). Timing test: 15 of 15 same-key pairs returned two `identity.created` replies. |
| R2 | A failed save left the **in-memory** world changed (a household, people, a family, a player, and map entries). The next successful save persisted those orphans. | E6b in the review (1 player, 3 people, 1 household, 1 family before; 2 players, 8 people, 3 households, 3 families after the next save); `test/identity-rollback.test.mjs` tests 1 and 2. |
| R2 (also) | Failure at any of ten injection points during creation left partial state, and a lost response after a committed save was not reconciled. | `test/identity-rollback.test.mjs`, one test per injection point. |

Baseline before the fix (file backend): 20 tests, 4 pass, 16 fail. PostgreSQL backend: 30 tests, 2 pass, 28 fail. The two passing guards on each backend check that unrelated players are unchanged.

## 2. What changed

### 2.1 Reservation (R1)

- `createIdentity` validates the request synchronously. It then reserves the SHA-256 hash of the creation key in `creationKeyReservations`. The reservation is released in a `finally` block, so success, failure, and a closed socket all release it.
- A second request with the same key while the reservation exists receives `identity_creation_in_progress` at once. Its socket is not closed, and the message does not echo the key.
- The key check and the reservation happen before the queued work starts. The queue is `serialize()`, which runs creation, saves, and shutdown flushes one at a time in this process.
- A creation for an **existing** identity goes through `recoverIdentity` inside the same queue (see section 2.3). A concurrent recovery therefore cannot rotate the token twice.

### 2.2 Transactional creation (R2)

`commitIdentity` runs inside the queue and does the following:

1. Returns early if the socket is no longer open.
2. For a known key, runs the recovery path (no new records).
3. Checks the world capacity (section 4).
4. Builds the new identity on a `structuredClone` **draft** of the live world: the player, the starter family (`createStarterFamily(draft, ...)`), and the catalog seeding (`seedNewIdentityWorlds(draft)`, in the same order as before).
5. Computes the change set with `diffState(live, draft)`.
6. Saves the **draft** as a candidate with `store.saveState(draft)`. The save runs the `before-save` hook.
7. Only after the candidate save succeeds, merges the change set into the live world with `mergeStateChanges`. The merge is all-or-nothing. A change applies only if the live value still matches the base (for an add, only if the key is absent).
8. If the merge conflicts, nothing is applied. The live world is saved again (a compensating `flush`), so the durable file matches the live world. The request receives `identity_creation_conflict`.

If the candidate save fails, the draft is discarded and the live world was never touched. The error is `persistence_failed` (or `world_capacity_reached` for a refused save).

**Measured property (change inventory):** a creation only **adds** records. In three sequential creations, no existing value was changed or removed (`test/identity-merge.test.mjs`, "change inventory"). This is why the merge conflict path is a guard and not a common case.

### 2.3 Recovery

`recoverIdentity` (existing behaviour, now inside the queue) rotates the session token and saves. On a failed save it restores the old token hash and the old timestamps, and returns `persistence_failed`. It does not change any other record.

### 2.4 Files

| File | Purpose |
|---|---|
| `services/world-api/src/multiplayer/world-engine.ts` | Reservation, `commitIdentity`, `seedNewIdentityWorlds`, `recoverIdentity`, `serialize`, merge conflict handling, `creationFaultHook` (test seam, optional) |
| `services/world-api/src/multiplayer/state-merge.ts` (new) | `diffState` and `mergeStateChanges` |
| `services/world-api/src/multiplayer/persistence.ts` | `saveState(candidate)` (size check and serialization inside the queued write) |
| `services/world-api/src/database/world-store.ts` | Same `saveState` contract for PostgreSQL, including the version check |
| `services/world-api/test/support/faulty-store.mjs` | Test wrapper: fail, hold, or fail-after-commit a write |
| `services/world-api/test/support/creation-fixture.mjs` | Shared helpers; orphan check |
| `services/world-api/test/support/creation-crash-child.mjs` | Child process for kill tests |
| `services/world-api/test/identity-concurrency.test.mjs` | R1 tests over separate sockets |
| `services/world-api/test/identity-rollback.test.mjs` | R2 tests (file, and PostgreSQL when enabled) |
| `services/world-api/test/identity-merge.test.mjs` | Merge unit tests, conflict test, change inventory |
| `services/world-api/test/identity-interruption.test.mjs` | Process kill before and after commit (file backend) |

### 2.5 Records a creation touches (measured by the change inventory)

The first creation in a fresh world added records in these 23 top-level collections (measured with the change inventory). Later creations in the same world added records in nine of them only: `players`, `people`, `households`, `families`, `relationships`, `lifeEvents`, `economyAccounts`, `economyTransactions`, and `economyCreditScores`. The seeded world records (laws, courts, property, government, police, and military) were added by the first creation in the test world and not by the later ones.

- Player and family: `players` (player record with `tokenHash`, `creationKeyHash`, `recentRequestIds`, and the character), `people`, `households`, `families`, `relationships`, `lifeEvents`.
- Economy: `economyAccounts`, `economyTransactions`, `economyCreditScores`.
- Property: `properties`, `propertyOwnership`, `propertyListings`, `propertyEvents`.
- Government and justice: `governmentOrganisations`, `governmentOffices`, `governmentBudgets`, `governmentEvents`, `laws`, `lawProvisions`, `courts`.
- Police and military: `policeUnits`, `militaryOrganizations`, `militaryBases`.

The in-memory indexes `playerByTokenHash` and `playerByCreationKeyHash` are derived from the players and are not persisted. They are updated only after a successful merge.

## 3. Tests (what each one proves)

| Test | Proves |
|---|---|
| R1 reproduction | A concurrent second socket with a new key is refused; the first creation succeeds; its token works |
| R1 timing (15 pairs) | Across 15 simultaneous same-key pairs, exactly one identity per key in the durable file |
| R1 failed save | A failed save releases the reservation; a retry succeeds; one identity |
| R1 later request | After success, a later request recovers the same identity (existing behaviour kept) |
| R1 socket closed mid-save | The reservation is released; the identity is recovered once |
| R1 concurrent recovery | Two sockets recovering one key: one session issued, the other refused, the winner's token works |
| R2 reproduction | A failed save leaves the in-memory world identical to its state before the attempt |
| R2 next success | After a failed save, the next creation persists no orphaned person, household, family, or player |
| R2 injection (10 points) | A failure at each point (player, starter family, economy, property, government, justice, military, culture, entertainment, before save) leaves the state identical to the pre-attempt state; the next creation works |
| R2 lost response | A save that commits but reports failure leaves no orphans; the retry creates one identity |
| R2 guards | A concurrent change to an unrelated record survives a failed save; a creation for another key is not affected by a failed one |
| R2 merge conflict | A concurrent live change refuses the creation; the concurrent record survives; the durable file matches live; the retry works |
| Change inventory | Creation only adds records |
| Process kill, before commit | The last committed world is kept; the key works after restart |
| Process kill, after commit | One complete identity; the key recovers it after restart |

Players, households, and families are compared exactly. **People** are compared by orphan check, not by exact count: the starter family's sibling count is random (`Math.random` in `src/life/service.ts`), so the number of people per identity varies. An exact count would make the test flaky without testing the rollback property.

## 4. Capacity guard (summary; detail in `docs/STAGE_28_CAPACITY.md`)

- Before a save, the serialized size is compared with the limit (16 MiB). Over the limit, the save is refused with `world_capacity_reached`, the previous file is kept, and no record is removed.
- The engine maps this error to the requester (creation) and to every online player (periodic flush).

## 5. Verified in this phase

Results are recorded in section 7 and in `docs/STAGE_28_CAPACITY.md`. Summary: default suite, PostgreSQL rollback and concurrency suites, `tsc`, and the build.

## 6. Limits (keep with every report)

- **Timeouts.** There is no timer on a save. A save that never settles holds its creation key reservation and the write queue until it settles or the process restarts. A timer that released the reservation early could let a second identity be created while the first save later commits, which is the R1 problem. A timeout therefore needs a design that fences the late commit, and it is not implemented.

- **R1 is per process.** The in-process reservation does not coordinate two server processes. Cross-process behaviour depends on the PostgreSQL version check, which is covered by the existing fencing tests. This phase does **not** claim multi-process exactly-once creation.
- **Not general exactly-once execution.** A lost response after a committed save is handled for one tested sequence (section 3). Other failure sequences are not claimed.
- **The file backend's save is not crash-atomic against a power loss.** It writes a temporary file and renames it. The durability of the rename depends on the host filesystem. This is not tested here.
- **The PostgreSQL path was tested against a local development database only.** Neon and production were not tested (BLOCKED).
- **The draft clone and the diff walk the whole world on each creation.** Their cost grows with the world, as measured in `docs/STAGE_28_CAPACITY.md`.
- Injected-point tests use a test seam (`creationFaultHook`). It is optional and has no effect when unset.
- The merge conflict path is reached only by a concurrent add of the same key, which the change inventory shows is not a normal creation effect. It is a guard, not a measured production case.
