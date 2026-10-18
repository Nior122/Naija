# Stage 35: Property Mutation Safety and File-Backend Decision

Status: complete for the scope below, with named open items. Nothing in this stage makes the project production-ready.
Production runs on PostgreSQL. The file backend is for development and tests (see `docs/PERSISTENCE_FILE_BACKEND.md`).

## 1. Starting and final hashes

- Branch: `arena/00cdea0e-naija`. Starting commit: `f45b80f` (Stage 34), verified at the start of this stage.
- Stage 34 remote commit before this stage: `f45b80f` (fast-forward from `39885d8`).
- Commits in this stage, in order:
  - `1d38f95`: the first Stage 35 commit (property mutations under the outcome contract; file-backend lock decision).
    Its CI run `38194580584` succeeded.
  - `ed06f27`: the follow-up commit (closes stale property listings; the socket tests for the property actions, `pay_rent`,
    and the treasury allocation). Its CI run `38196077165` succeeded.
  - `825e0e8`: documentation only (commit hashes in section 1). Its CI run `38196196114` FAILED in the live PostgreSQL
    job. The job log could not be downloaded, and the run could not be re-run.
  - `c71964b`: makes the news-report test deterministic (`Math.random` fixed for the test) and records the final results.
    Its CI run `38196966222` FAILED in the same job, so the failure is not explained by that test.
  - `cbcd72e`: raises the explicit WebSocket wait budgets from 5 s to 20 s in 31 test files and in the harness default.
    No expected value changed. Its CI run `38198636400` SUCCEEDED in both jobs. That is one passing run, not proof of the
    cause.
  - The commit that makes the lock a directory lock (race 1) and records the result in sections 6, 7, 9 and 10 comes
    after `cbcd72e`. Its hash is in `git log arena/00cdea0e-naija` and in the final report, since a file cannot record its
    own hash.

## 2. Property actions: audit table

Each changing action goes through one gate (`propertyAction`, `world-engine.ts`) before the service function runs. The gate
requires a request ID, checks for a repeat or a reuse, and checks that the write path is open (section 5). The table
lists what the service function checks before any change, and what it changes. "Confirmed" means the reply waits for a
save that covers the change (section 4).

| # | Action | Who may act; checks before any change | Money | Ownership or state changed | Order: checks, then change, then save, then reply |
|---|---|---|---|---|---|
| 1 | `purchase` | Any player. Alive. Age at least `minimum_purchase_age_years`. Listing is a sale and available. Property purchasable. Owned-count and land limits. Price valid. Buyer balance at least price. Current owner exists and is not the buyer (self-dealing). The listing's owner is the current owner (a listing left by an earlier owner is refused, `property_listing_unavailable`). If the seller is a player, the seller's cash account exists. | Buyer −price; seller +price (one sale) | Old owner inactive; buyer owner active; sale record; every open listing of the property closed (sale and any rent listing); active rental terminated | All checks, then debit, then credit, then ownership, sale, and listing, then request record, then save, then reply |
| 2 | `list_for_sale` | Current owner, player kind (`authorizePropertyAction`). Asking price in range. | None | Listing created | Checks, then listing, then save, then reply |
| 3 | `list_for_rent` | Current owner, player kind. Property not land. Rent price, period, and deposit valid. | None | Rental listing created | Checks, then listing, then save, then reply |
| 4 | `rent` (`createRentalAgreement`) | Tenant alive and adult. Rental listing available. Property not already rented. Rental limit. Not the owner. The listing's owner is the current owner (`property_listing_unavailable` otherwise). Balance at least total due. If the landlord is a player, the landlord's cash account exists. | Tenant −total due; landlord +total due | Agreement created (active); listing closed | All checks, then debit, then credit, then agreement and listing, then save, then reply |
| 5 | `pay_rent` (`payRent`) | Tenant of an active agreement; balance; landlord account. **Suspended at the socket**: refused as `property_rent_payment_suspended` before any check, record, or change. | Would be: tenant −rent; landlord +rent | Would be: payment record | Not reachable from the socket. The service ordering was fixed (landlord account before debit) and is covered by service-level tests. The socket refusal, and a termination sent together with a `pay_rent`, are tested on both backends (`property-actions-stage35.test.mjs`). |
| 6 | `terminate_rental` | Tenant or landlord (`property_unauthorized` otherwise). Agreement active. | None | Agreement terminated | Checks, then status, then save, then reply |
| 7 | `maintain` (`recordMaintenance`) | Owner, player kind. Condition valid. Cost at least 0. Description length. If cost is above 0: owner has a cash account and balance at least cost. Checked before any change. | Owner −cost (no receiving account: a spending sink, unchanged) | Condition and maintenance record | Checks, then debit, then condition and record, then save, then reply |
| 8 | `furnish` (`purchaseFurniture`) | Owner, player kind. Not land. Catalogue item exists. Quantity 1 to 10. Furniture limit. Balance at least total. | Buyer −total (spending sink, unchanged) | Furnishing records | Checks, then debit, then records, then save, then reply |
| 9 | `remove_furnishing` | Owner, player kind. Furnishing belongs to the property. | None (no refund, unchanged) | Furnishing removed | Checks, then removal, then save, then reply |
| 10 | `transfer` (`transferProperty`) | Current owner must be a player (`authorizePropertyAction`). From and to differ. Recipient exists, alive, adult, within property and land limits. | None. Transfer is ownership-only in the game rules (no consideration). | Old owner inactive; new owner active; active rental terminated; every open listing of the property closed; event | Checks, then ownership and cancellations, then save, then reply |

Read-only actions (`market`, `view`, `my_properties`, `my_rentals`) need no request ID, record nothing, and reply directly.

Where money moves: only in rows 1, 4, 5 (service only), 7, and 8, and the cash helpers (`deductFromCashAccount`,
`creditToCashAccount`). `processPropertyWorldDate` moves no money.

Atomicity of purchase, sale, and transfer. Purchase is one logical transaction: the debit, the credit, and the ownership
change are made in memory after every check has passed, and then saved in one save. The world is saved as one unit on both
backends (one conditional `UPDATE` of the whole world row on PostgreSQL; one temporary-file-and-rename on the file
backend), so a save either contains all of them or none of them. Transfer has no debit, so the only rule that applies is
the single active owner. Both hold in the code (checked by reading the code and by the tests in section 9). The model has
no separate transaction log, so the claim is "one save", not "one database transaction across tables".

## 3. Changes

- `services/world-api/src/properties/service.ts`: `closeOpenListingsForProperty` (purchase and transfer close every open
  listing, not only the one named or the first found); purchase and rent refuse a listing whose owner is not the current
  owner (`property_listing_unavailable`, checked before any change); `initializePropertyWorldState` closes an open listing
  whose owner is not the active owner, on load (listings only; no money or ownership changes); `assertCashAccountExists`; purchase checks the seller account before the
  debit and no longer has the unreachable idempotency early return (the sale record still stores `idempotency_key`);
  rent and pay-rent check the landlord account before the tenant debit; maintenance checks account and funds before any
  change; transfer takes `catalog` and enforces recipient age, per-character and land limits.
- `services/world-api/src/multiplayer/world-engine.ts`: changing-action gate (`PROPERTY_CHANGING_ACTIONS`, ten actions);
  `propertyRequestFingerprint` (SHA-256 of canonical JSON of action and payload); `PendingMoneyReply` kind `property`;
  save-outcome messages `property_not_saved`, `property_outcome_unknown`, `property_persistence_unavailable`; success path
  records the request and confirms after save; `MAX_RECENT_REQUESTS` (256) bounds the record.
- `services/world-api/src/multiplayer/types.ts`: optional `recentPropertyRequests` on `PersistentPlayer` (`request_id`,
  `fingerprint`).
- `services/world-api/src/multiplayer/persistence.ts`: validator for `recentPropertyRequests` (at most 256 entries, IDs up
  to 80 characters, fingerprints of 64 hex characters). File-backend lock hooks: a second `assertHeld()` before the
  rename, and the `after-lock-check` phase.
- `services/world-api/src/persistence/writer-lock.ts`: rewritten as an `flock(2)` holder (section 6).
- `services/world-api/src/persistence/open.ts`: the file-backend log line names the flock lock and
  `docs/PERSISTENCE_FILE_BACKEND.md`.
- Tests: new `test/property-actions-stage35.test.mjs` (socket tests for the eight changing actions, each with the contract
  cases, plus conflicts, the stale-listing regressions, and the `pay_rent` refusal; 28 tests per backend), new
  `test/treasury-funding-stage35.test.mjs` (the one-time allocation under repeat, restart, a definite save failure with retry,
  and a committed save with a lost reply; 5 tests per backend), new `test/support/property-socket.mjs` (socket helpers,
  shared by the two socket files). New `test/property-invariants-stage35.test.mjs` (16 service-level, in memory), new
  `test/property-mutation-stage35.test.mjs` (12 socket tests, each run on the file backend and on PostgreSQL), new
  `test/support/property-world.mjs` (fixture), new `test/support/writer-lock-race-child.mjs` (separate-process child for
  race 2). Rewritten `test/file-writer-lock-races.test.mjs` (8 tests). Changed
  `test/mutation-resend-guards.test.mjs`: a re-sent purchase expects `command.duplicate` (the charge-once assertion is
  unchanged), and the header comment is corrected.
- Docs: this file; new `docs/PERSISTENCE_FILE_BACKEND.md`; a pointer from `docs/STAGE_28_CONFIGURATION.md`; a pointer
  at the end of `docs/DATABASE_PLAN.md`.
- Deleted before this stage's commit: two scratch files (`tmp-debug-lock.mjs`, `tmp-debug-holder.mjs`). Not in the repository.

No gameplay rule was added. The changes enforce rules that already existed in the service (landlord and seller accounts,
funds before change, recipient eligibility). The one new rule is the request ID requirement for changing property actions,
which is the same contract the Stage 34 money routes use.

## 4. Precise outcome contract

For a changing property request with a request ID:

| Situation | Reply to this request | Storage | Client action |
|---|---|---|---|
| Refused by a check (invalid, unavailable, insufficient funds, unauthorized) | `property.error` with the check's code (for example `property_insufficient_funds`) | Unchanged | Fix the request. Retrying with the same ID and payload is refused again. |
| No request ID | `property.error` `request_id_required` | Unchanged | Send a request ID. |
| Same ID, same action and payload, already recorded | `command.duplicate` and the character snapshot | Unchanged by the repeat | None: the change already happened. |
| Same ID, different action or payload (recorded or pending, or used by another command) | `property.error` `property_request_id_reused` | Unchanged | Use a new request ID for a different request. |
| Save covered the change | `property.result` | Changed | None. |
| Write path closed after an earlier failed save | `property.error` `property_persistence_unavailable`; nothing was changed | Unchanged | Retry after saving recovers. |
| Save known to have failed (`not_saved`) | `property.error` `property_not_saved` | The change is in memory and not confirmed | Retry with the same ID. The retry re-saves the pending change and confirms it once. |
| Save may have committed but the outcome is unknown | `property.error` `property_outcome_unknown` | Unknown to the client | Retry with the same ID. Recorded: answered as `command.duplicate`. Not recorded: applied once. |

What "not_saved" means, precisely. The change is not confirmed. It is not rolled back in memory. A later successful save,
by any action or at shutdown, can store it before the client retries. The reply still says "not confirmed", and the
retry then gets `command.duplicate`. This is intentional: a blind in-memory rollback would be a snapshot restore, which
the rules forbid. The window is listed in section 11.

Replies are sent only after the save, never before the change is durable in the save path. A stale writer that is fenced
cannot confirm a change (section 8).

## 5. Idempotency and concurrency guarantees

Idempotency scope.

- Scope: one player (character). The request record is `player.recentPropertyRequests`, and each entry stores the request
  ID and the fingerprint of the action and payload. Two players can use the same request ID without interfering.
- Retention: the most recent 256 changing requests per player (`MAX_RECENT_REQUESTS`). An ID older than that is no longer
  remembered. This is a count, not a time window. Time-based IDs are not used as a protection.
- The record is saved in the same save as the change, so a restart that keeps the change keeps the record.
- The same ID is also checked against `recentRequestIds`, the list shared with the money routes. An ID used by a money
  route is reused for a property request and is refused.

Guarantees, with the evidence.

- A duplicate of a confirmed request is answered and not applied (the retry test, and the restart test).
- The same ID with a different payload is refused and replays nothing (the reuse test, and the reuse after restart).
- A duplicate sent while the first is unconfirmed is answered once the save covers the first change, and is not applied
  twice (the concurrent duplicates test).
- A retry after a failed save applies the change once (the not-saved test, and the crash test).
- A retry after a committed save with a lost reply is answered as a duplicate and not applied again (the outcome-unknown
  test, and the restart-after-committed test).

Concurrency.

- Within one process, each request is handled from its checks to its mutation without an `await` in between (code read of
  `propertyAction` and the service functions). Two requests cannot interleave between a check and its change. Tested by
  concurrent duplicates and by two buyers for one listing (one purchase applies; the other buyer is
  refused as `property_listing_unavailable` and is not charged).
- Conflicting pairs on one property, sent together on one socket, are tested on both backends: a sale listing and a
  transfer (exactly one applies, one active owner, the money agrees); two tenants for one rental listing (one agreement,
  only its tenant charged); two furnishing orders with cash for one (one applies, cash never negative); a termination and a
  `pay_rent` (the termination applies once, and the payment never applies).
- Stale listings: before this stage, a purchase closed only the listing it named, and a transfer closed only the first open
  listing it found. A rent listing left by a previous owner stayed open, and renting it was accepted, paying an owner who no
  longer held the property. This was found by the new socket tests (the premise check of the rent test failed). It is fixed
  as described in section 3. Three regression tests cover it on both backends: the purchase, the transfer, and a stored
  stale listing on load. On the pre-stage code (`f45b80f`) the purchase test fails with the stale rent listing still offered,
  the transfer test fails with a listing still open, and the load test fails with the listing still open.
- Across processes on PostgreSQL, the whole-world save is a conditional `UPDATE` on the version the writer loaded. A stale
  writer's save affects no row and is not confirmed. Tested generically (`postgres-persistence`, `multiprocess-persistence`
  suites, which pass). No property-specific cross-process test exists yet (section 10).
- Across processes on the file backend, one writer is enforced by the lock (section 6).

## 6. File-backend decision and rationale

Decision: Option A, an OS advisory lock. It is now taken on the world file's **directory**, not on the lock file. Option B's
restriction is also enforced: production refuses the file backend, unsupported platforms refuse startup, and the
operating contract limits use to one process per world file, and one world file per directory. Multi-host and
multi-process use are not supported and are not claimed (see `docs/PERSISTENCE_FILE_BACKEND.md`).

How the lock works.

- Node has no `flock` binding. A small holder (`/bin/sh`, with the world file's directory open on descriptor 9) runs
  `flock -n 9`, then `cat`, which waits on a pipe from the server. The kernel releases the lock when the holder exits for
  any reason, including a SIGKILL of the server. A dead holder frees the lock without any PID check.
- The lock file `<world>.lock` is the record (pid, token) and the fence. The owner checks it before each save and again
  immediately before the rename. It is not what excludes a second starter.
- The owner keeps a descriptor open on the lock file for as long as it holds the lock. While that descriptor is open, the
  inode cannot be freed or reused, so "the path still names the inode that was written" is a real identity check.

Why the directory, and not the lock file (race 1).

- A `flock` on the lock file's inode does not stop a second starter once the file has been replaced. A starter that locks
  the new file is admitted. This was checked in a scratch experiment (`/tmp/dl`, not in the repository), with a control
  showing that a new file locks normally. This was the window between the owner's check and its rename.
- A directory is not replaced by renaming a file inside it, so a `flock` on the directory cannot be bypassed that way. The
  cost is one file-backend writer per directory: a second world file in the same directory is refused.
- A scratch check (`/tmp/s36-ino2.mjs`, not committed) showed that Linux reused the inode number of an unlinked file at
  once. Comparing inode numbers without keeping the old file open is therefore not an identity check. The descriptor fixes
  this: after a same-token replacement, the owner's `isHeld()` returns false.
- The file's contents cannot close race 1 or race 2 by themselves, because the file can be replaced.

What was rejected. A PID or token file alone (it cannot close either race). A process-local flag (it cannot see another
process). Calling the file backend safe for concurrent use in general (it is not; see the boundary in section 7).

## 7. Results for both races

Race (a): a lock replaced between the owner's check and the rename.

- Status: **resolved for protocol-following writers on one Linux host**. It was OPEN before the directory lock. This is
  a bounded claim, not a general one. The boundary is below and in `docs/PERSISTENCE_FILE_BACKEND.md`.
- Demonstrated (`file-writer-lock-races.test.mjs`, separate OS processes unless noted):
  - the "race 1, window" test: after the owner's check and before the rename, an outside process replaces the lock file
    with an empty file (no record). A protocol-following starter in a separate process is refused (`world_file_locked`).
    The owner's save completes, and the owner's next save is fenced with the file unchanged. On the code before this
    change (`cbcd72e`, extracted to a scratch directory), the same starter prints `@@ ACQUIRED`, and this test fails;
  - the "race 1, protocol" test: while the owner holds the lock, another starter cannot take it;
  - the two "out-of-protocol replacement before the check" tests (same token with a new inode, and different content):
    refused, fenced, and the file is unchanged;
  - the "one directory, one file-backend writer" test: a second world file in the same directory is refused with
    `WorldFileLockedError` while the first is open, and can be taken after the first is released. On the code before this
    change, this test fails, because the second world is admitted.
- Boundary (not claimed): a process that writes the world file, or removes or replaces the lock file, without following the
  protocol is outside the guarantee. Network filesystems and other platforms are not tested. Operators must not edit lock
  files (documented, not enforced by the code).

Race (b): two starters racing to take one stale lock.

- Status: **resolved for protocol-following starters on one Linux host**, within the limits in section 4 of the operating
  contract.
- Demonstrated: two separate starter processes, racing for one stale lock, five rounds: exactly one is `LOCKED`, the
  other `REFUSED`, and the winner's lock is not removed ("race 2" test, separate OS processes). A second start in the same
  process is refused whatever the record says ("race 2, in-process" test). A live holder is refused, and a dead holder is
  taken over (`file-writer-lock.test.mjs`). A clean SIGTERM saves, exits 0, and removes the lock (`file-writer-lock.test.mjs`).
- Not claimed: multi-host, network filesystems, or out-of-protocol lock manipulation.

## 8. PostgreSQL guarantees and limits

Guarantees (code and tests).

- The version fence: the whole-world save is `UPDATE ... WHERE key = $1 AND version = $loaded`. A writer that loaded an
  older version affects no row and does not confirm.
- A property change, its money movement, and its request record are in one saved world row, so they persist together or
  not at all.
- Restart keeps the confirmed change, the request record, and the one-time treasury rows (the restart tests in
  `property-mutation-stage35.test.mjs`, `property-actions-stage35.test.mjs`, and `treasury-funding-stage35.test.mjs`, run on
  PostgreSQL in section 9).
- Migrations: the existing migration and schema tests pass in the PostgreSQL run.

Limits.

- The whole world is one JSON row (`world_state`). A save writes the whole world, so cost grows with world size. The
  16 MiB limit is enforced on load and save (Stage 28).
- The PostgreSQL property tests run in one test process. No property-specific multi-process test exists.
- The four TLS live tests skip without `TLS_TEST_DATABASE_URL`. They are not counted as passed.

## 9. Commands and actual results

Results are reported per backend and never added across them. Logs are in `/tmp` on the development host and are not
committed. The runs below are on the working tree of the directory-lock commit, after its last code change. Per-file
results for the files this commit does not touch are the final runs of the earlier commits, and their code has not changed.

| Command | Result | Log |
|---|---|---|
| `npm run build` (`tsc`, the typecheck), `services/world-api` | exit 0 | `/tmp/s36-build.log` |
| `npm run lint` (eslint on `services/world-api/src`) | exit 0 | `/tmp/s36-lint.log` |
| Full suite, PostgreSQL (`NAIJA_ENV=test node --test test/*.test.mjs`, `DATABASE_URL` set) | **1534 tests: 1530 pass, 0 fail, 4 skip, 0 todo**; exit 0 | `/tmp/s36-pg.log` |
| Full suite, file backend (`env -u DATABASE_URL NAIJA_ENV=test node --test test/*.test.mjs`) | **1304 tests: 1263 pass, 0 fail, 41 skip, 0 todo**; exit 0 | `/tmp/s36-file.log` |
| `file-writer-lock-races.test.mjs` and `file-writer-lock.test.mjs`, file backend | 24 tests, 24 pass, 0 fail, 0 todo | `/tmp/s36-locks.log` |
| The race-1 window and two-world tests on the previous code (`cbcd72e`, scratch extract) | 2 of 6 fail, as expected: the second starter is admitted (`@@ ACQUIRED`), and the second world is admitted | `/tmp/s36-prev-races.log` |
| `node --test test/property-actions-stage35.test.mjs`, file backend | 56 tests, 56 pass (unchanged code) | `/tmp/s35k-*` / terminal |
| same, PostgreSQL env sourced (both backends in one run) | 112 tests, 112 pass (56 file, 56 PostgreSQL) | terminal |
| `node --test test/treasury-funding-stage35.test.mjs`, file backend and PostgreSQL | 5 + 5 pass (file); 10 pass (both backends in one run) | terminal |
| `node --test test/entertainment.test.mjs` (after the fix in `c71964b`) | 30 tests, 30 pass | `/tmp/s35e-ent.log` |

Earlier full-suite runs at `c71964b` (before the directory lock), for comparison: PostgreSQL 1533 tests, 1528 pass, 0 fail,
4 skip, 1 todo (the race-1 residual, which is now a passing test); file backend 1303 tests, 1261 pass, 0 fail, 41 skip,
1 todo. The difference is +2 tests (the two new race tests) and −1 todo.

The 41 file-run skips are PostgreSQL-only tests that need `DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true`. The 4
PostgreSQL-run skips are the TLS live tests that need `TLS_TEST_DATABASE_URL`. A skip is not a pass.

CI history and load-sensitive tests.

- `825e0e8` (run `38196196114`) and `c71964b` (run `38196966222`) each FAILED in the live-PostgreSQL job. The job logs
  could not be downloaded (the log service returned EOF or nothing), and the runs could not be re-run. The failing test
  was not identified. The entertainment flake (item 1 below) was real, but at about 1 run in 100 it does not by itself
  explain two failures in a row, and `825e0e8` is a documentation-only change over `ed06f27`, which passed CI.
- `cbcd72e` (run `38198636400`) SUCCEEDED in both jobs. This is one passing run after the 20 s wait budgets. It is not
  enough to say the cause was fixed, because the earlier failures were not reproduced on demand either.

Local reproduction, in order:

1. `entertainment.test.mjs`, "createNewsReport and publishNewsReport", asserted `published.views > 0`.
   `publishNewsReport` gives initial views as `Math.floor(Math.random() * 100)`, so a draw of 0 fails the test (about
   1 run in 100). It reproduced once in two full local runs. The test now fixes the random draw for its own duration and
   restores it. The assertion and the game code are unchanged. This is in `c71964b`.
2. Under CI-like concurrency (`node --test --test-concurrency=3`, the sandbox has 2 CPUs, CI has 4) with two extra busy
   processes, two tests failed on a 5-second WebSocket wait: `property-actions-stage35` "an open listing whose owner is no
   longer the owner is closed on load" (5.27 s), and `world-capacity-notify` "R5 notify-once" (8.6 s). Both were timeouts,
   not assertion failures.
3. The explicit `waitFor` budgets were raised from 5000 ms to 20000 ms in `cbcd72e` (the test files that use them, and the
   harness default). Only the timeout literal changed. A reply that never arrives still fails, only later.
4. R5 (`world-capacity-notify.test.mjs`, "a new episode after a successful save notifies once") fails under CPU load with
   a 17 MiB padded world (3 of 3 runs with four busy processes, on the uncommitted directory-lock tree). It passes without
   extra load (1 run with two busy processes passed, and the full PostgreSQL and file suites passed without load). On the pre-stage code `f45b80f`, under the
   same load, it failed in 1 of 2 runs, so it predates this stage.
5. The R5 mechanism, as far as it was isolated. With temporary diagnostics (removed; the tree was restored and rebuilt):
   the second over-limit episode did open. The refused save logged the episode line, and the online socket was open at
   that moment. The notice was queued behind multi-megabyte snapshot frames. Partway through the episode the online socket
   closed (logged as "Client disconnected"), so the notice was never delivered. The close reason was not captured. The
   likely cause is the server's 15-second liveness check (`src/app.ts`), which terminates a socket that has not answered a
   ping, with the frames delaying the pong under load. This is a diagnosis, not a proven cause. The test is not changed.
   R5 is open. Its notice logic is not shown to be wrong.

Open: the live-PostgreSQL job's cause on `825e0e8` and `c71964b` is unknown. R5 is a load-sensitive test that may be part
of it, but this is not shown. The final report records the CI results. Mitigations are in section 10.

## 10. Limitations and TODOs

0. CI: the live-PostgreSQL job failed on `825e0e8` and `c71964b`, and succeeded on `cbcd72e` (one run). The failing test was
   not identified on CI. R5 (`world-capacity-notify.test.mjs`) is a known load-sensitive test (section 9, items 4 and 5).
   Not fixed.
1. Race 1: resolved for protocol-following writers on one Linux host (section 7). Not resolved for a writer outside the
   protocol, and not tested on other platforms or network filesystems.
12. One file-backend writer per directory. Two world files in one directory cannot be served at once (section 6).
2. Multi-host and network-filesystem use of the file backend: not supported and not tested.
3. Power loss: the file backend's fsync and directory sync are written, but a power-loss test has not been run
   (`docs/STAGE_28_DIRECTORY_SYNC.md`, section 6).
4. Request-ID retention is 256 changing requests per player. An older ID can be applied again. A count, not a time, bounds
   this.
5. Socket tests cover all eight changing actions on both backends (the contract cases, not every service branch). The
   fuzzing of sequences of mixed actions is not done.
6. A cross-process property test on PostgreSQL does not exist.
7. The one-time treasury allocation is not recreated by a restart, a retry, or a repeat. Evidence: `applyInitialTreasuryFunding`
   checks the ledger rows (`funding_rule_id`, and `source_reference` `treasury-funding:<rule_id>`); no code deletes
   `governmentRevenue` rows; `treasury-funding-stage35.test.mjs` checks the rows after repeats, a restart, a definite save
   failure with a retry, and a committed save with a lost reply, on both backends. Caveats: (a) the allocation is applied when
   a player joins (`reconcileGovernmentStructure` runs on the join path), not when a world is created or loaded, so a world
   with no joins has no allocation yet. This was found by the new test, and it is documented, not changed in this stage.
   (b) A restore of an older snapshot that lacks the row would apply the grant again. Restores must be reviewed by hand
   (`docs/PERSISTENCE_FILE_BACKEND.md`, section 4).
8. `pay_rent` is suspended at the socket. Its socket refusal, and its race with a termination, are tested. Its service
   ordering is fixed but is not reachable from the socket.
9. Furnishing and maintenance debit money to no account (a spending sink). This is existing game design and was not
   changed.
10. Business payments remain out of scope and unchanged. No organisation payments were added.
11. Government, treasury, election, justice, police, and life/NPC routes were not re-audited in this stage beyond their
    existing tests.

## 11. Operations that still mutate or reply before confirmation

- Reply before confirmation: none for changing property actions. Their replies wait for a save.
- Changed in memory and possibly stored before the client retries: a change whose save failed (`property_not_saved`)
  stays in memory. A later successful save (any action, or the shutdown save) can store it. The reply says it is not
  confirmed, and a retry returns `command.duplicate`. This is the known window of the design (section 4).
- Changed without a request ID: none for changing property actions (refused).
- Read-only property actions reply directly, with no change.
- Money routes outside property: confirmed-after-save since Stage 34 (economy, shop, transport, clinic, education,
  business, and career). Government, treasury, election, justice, police, and life/NPC routes: not re-audited here.

## 12. Next stage

Stage 36 candidates, in priority order:

1. A cross-process PostgreSQL property test (two servers, one world).
2. Decide whether the file backend stays a development-only backend. Race 1 is resolved only for protocol-following writers on one host.
3. Decide whether the treasury allocation should be applied at world creation rather than on the first join. This changes
   when the funds appear, so it needs a design decision.
4. Re-audit government, treasury, election, justice, police, and life/NPC routes with the same outcome contract.
5. A power-loss test on a disposable host.
6. A redesign of `pay_rent` before it is reopened.
