# Stage 33: Persistence Concurrency, Save Outcomes, and Treasury Writers

Starts from `72dd85e` on `arena/00cdea0e-naija` (the Stage 32 head, identical to `origin`). Stage 32 kept treasury
replies behind a successful save. This stage asks the harder question: when a save fails, or two writers share one
world, what is known about the saved state, and can a treasury change be confirmed wrongly?

Short answer: the PostgreSQL path is fenced by a version check, and that check now also tells a financial request
whether its change was certainly not saved or possibly saved. The file backend had no cross-process protection. It now
has one: a lock file that a second server process cannot take, and a token that every save verifies. The guarantees,
their exact limits, and the windows that remain are below.

## 1. Scope, and what stays closed

| Area | Stage 33 result |
|---|---|
| File backend, second server process on the same world file | **Refused at startup** (lock file). No longer relied on as "single-instance only". |
| File backend, stale writer inside one process | **Fenced**: its save is refused, the file is not touched, and it is never confirmed. |
| Save outcome of a failed save | **Classified**: `not_saved` (the saved world is unchanged) or `unknown` (the new world may be saved). |
| Treasury reply after a failed save | `treasury_not_saved` or `treasury_outcome_unknown`. Both are retried with the same request ID. |
| New treasury change while saving is failing or the writer is fenced | **Refused before any change**: `treasury_persistence_unavailable`. Recorded requests still replay. |
| PostgreSQL version fencing | Kept. Two-writer treasury and funding tests added. |
| Business payments | **Deferred** (section 5). Refused as unsupported, as before. |
| Organisation payments | **Closed**. Refused as unsupported. |
| Revenue, taxation, fines, borrowing, minting | **Not added.** |
| Older snapshots | **Not restored.** No blind rollback of any kind. |

## 2. Part 1: investigation

The persistence path before this stage, as read in the code:

- **Writes are serialised per process.** The engine's `serialize()` queue and the file store's `writeQueue` each run one
  save at a time. Within one process, a save captures every change made before it was queued, so there are no
  overlapping stale snapshots inside one process.
- **Writes are whole-world.** Every save writes the complete in-memory world. Two processes holding different copies
  would therefore overwrite each other: the last writer wins, and the earlier writer's changes are lost without any
  error. This is the real hazard, and it was not guarded on the file backend.
- **The file save sequence** is: write a temporary file, fsync it, rename it over the world file, fsync the directory.
  Before this stage, a failure after the rename was reported as a failed save, which is correct, but the caller could
  not tell that the new world was already visible.
- **PostgreSQL** saves with `UPDATE ... WHERE version = $n`. A save that matches no row is refused as a conflict, and
  the store is fenced. Nothing was changed by the refused save.
- **Treasury replies** waited for a save since Stage 32, but a failed save produced one code, `treasury_not_saved`,
  whatever had happened on the storage side.

What was **not** done, deliberately: restoring an older snapshot over the current one. That would erase any valid
change that another writer made since. The fix is to stop the second writer, not to roll back the first.

## 3. File backend

### 3.1 The lock

- Taken in `openWorldPersistence` (the production entry point), before the server listens. Not taken in the `WorldStore`
  constructor, so that the many in-process tests which reopen a path to model a restart keep working.
- The lock is `<world file>.lock`, created exclusively (`O_EXCL`). It records the holder's process ID, a random token,
  and the time it was taken.
- **A live holder refuses the lock.** This includes the same process taking the lock a second time. The refusal names
  the holder's PID, and the second process exits without listening.
- **A stale lock is taken over only when its holder's PID is dead.** A lock file that cannot be parsed is refused for
  ten seconds, then taken over, so that a process killed while writing the lock does not block the next start forever.
- **Every save verifies the token before it writes.** If the lock file no longer holds this writer's token, the store
  becomes fenced. A fenced store refuses every later save without touching the file.
- The lock is released by `close()`, which `index.ts` calls after the final save. A crash leaves the lock behind, and
  the next start takes it over because the PID is dead.

### 3.2 Save outcomes

Every failed save is classified by `classifySaveFailure` (for health) and by `saveOutcomeOf` (for the reply):

| Where the save fails | Saved world afterwards | Outcome | Reply to a treasury request |
|---|---|---|---|
| Fenced, or the lock was lost | Previous | `not_saved` | `treasury_not_saved` |
| Capacity limit | Previous | `not_saved` | `treasury_not_saved` |
| Temporary file, write, or fsync | Previous | `not_saved` | `treasury_not_saved` |
| Rename | Previous | `not_saved` | `treasury_not_saved` |
| After the rename (for example, the directory sync fails) | New (visible) | `unknown` | `treasury_outcome_unknown` |
| PostgreSQL version check matches no row | Previous | `not_saved` | `treasury_not_saved` |
| PostgreSQL: connection lost or error after the UPDATE was sent | Unknown | `unknown` | `treasury_outcome_unknown` |
| PostgreSQL: committed, reply lost | New | `unknown` | `treasury_outcome_unknown` |

An error that is not classified is treated as `unknown`. That is the safe reading: the client retries with the same ID.

The existing test that a post-rename failure still reports failure (`file-save-durability.test.mjs`) is unchanged and
still passes. Stage 33 changed only the label carried with the failure.

### 3.3 Engine gate

While the last save failed, or the store is fenced, a new `approve_budget`, `allocate_budget`, or `spend_budget` is
refused with `treasury_persistence_unavailable` **before any change is made**. The refusal records nothing and saves
nothing. Replays of recorded requests are still answered, because a replay changes nothing; the replay is confirmed
only after a save succeeds.

Two consequences to know:

- The gate is closed by any failed save, including one caused by a non-treasury change. That is intended: a treasury
  change made while storage is failing widens the gap between memory and storage.
- The fence check and the failure count overlap. A fence always comes from a failed save, so the failure count alone
  would close the gate. The explicit fence check is kept so that the gate does not depend on that ordering.

### 3.4 Ordering, from mutation to reply

1. The request is authorised and validated against the in-memory world.
2. If it is a new financial write and the gate is open, the change is applied in memory. Otherwise it is refused.
3. The change is saved. Saves are serialised, and each save captures the state at the time it runs.
4. The reply is `government.result` only after a save that covers the change. Otherwise it is an error with an
   outcome code (section 3.2).
5. A retry with the same request ID returns the recorded result if the first request was applied; otherwise it applies
   the change once.

Non-treasury actions still reply before their save, as in Stage 32 (section 5.5 of that stage). This is unchanged.

### 3.5 Limits of the file lock, exactly

- **Same host, local file system only.** The liveness check is a process-ID check. It means nothing across machines, and
  a lock file on a network share is not covered. Use PostgreSQL for more than one host.
- **Two starts racing for the same stale lock.** Each may remove the dead holder's lock and create its own. The one
  that created last holds the lock, and the other is fenced on its first save, after it has reported that it started.
  The same window as below applies: a save that checked the token just before the other start replaced the lock can
  still rename. **Reproduced in Stage 34 and still open** (Stage 34 section 5.2).
- **PID reuse fails closed.** If the dead holder's PID is reused by an unrelated live process, the lock is refused, and
  the world stays locked until someone removes the lock file by hand. No write happens in that case.
- **A window between the token check and the rename.** The check and the rename are separate system calls. A replacement
  of the lock file in that window is not detected by this process. A stale takeover can only replace a lock whose
  holder is dead, and this process is alive while it saves, so the window opens only if someone removes or rewrites the
  lock file by hand. **Reproduced in Stage 34 and still open** (Stage 34 section 5.1). The fence tests in Stage 33
  replaced the lock file between saves, not inside a save.
- **Power loss.** As in Stage 28, a SIGKILL leaves the page cache intact, so the process tests cannot show what a power
  cut does. A save reported as `unknown` may or may not survive a power cut.
- **Temporary files** left by a killed save remain in the data directory, as before. The next save writes a new one.

## 4. PostgreSQL

The version check is the fence. Stage 33 adds the outcome classification and the gate, and tests two writers.

What is verified (test names are in `government-treasury-payments.test.mjs` and `postgres-treasury-writers.test.mjs`):

- **Stale writer, two writers on one world.** The first writer's payment is saved. The second writer, loaded at the same
  version, applies its own payment. Its save is refused as `not_saved`, it is fenced, and it never saves again. The
  saved world holds only the first payment, the ledger audit is clean, and the balance is the first payment only.
- **Restart after a refused save.** A new process loads the saved world, which holds the first payment and not the
  refused one. The refused payment, made again under its own request ID, is applied once.
- **Fenced writer through the socket.** A fenced server refuses the next treasury change before it changes anything.
- **Failed save, then retry.** A failed save gives `treasury_not_saved`. A new change is refused while saving fails. The
  recorded request is replayed once saving works, and the payee is credited once.
- **Committed save, lost reply, then restart.** The restarted world holds the payment, and the retry replays it.
- **Uncommitted save, then restart.** The restarted world has no payment, and the retry applies it once.
- **Initial funding, two writers.** Both writers set up the government and apply the funding in memory. Only one save
  lands. The saved world has one funding row and the catalogue amount. A later restart and a reconciliation add nothing.

Limits, stated plainly:

- **The two writers are two store instances in one Node test process.** Each has its own copy of the world and its own
  version, and the database applies the same version check it applies to separate processes. Separate processes are
  covered by the existing `multiprocess-persistence.test.mjs`, which runs real child processes against the version
  check. The treasury-level two-writer tests do not themselves start two processes.
- **Uncertain outcomes are not resolved by the database.** A connection lost after the UPDATE was sent is reported as
  `unknown`. The database may have committed it. The client retries with the same request ID, and the replay returns
  the recorded result. That is the only resolution, and it is retry-safe, not automatic.

## 5. Business payments: deferred

Business payments are **not** implemented in this stage. The foundation is not safe enough, for these reasons, which
were checked in the code:

1. **A business's money is not in an economy account.** A business has a `balance_ngn` field on its own record, changed
   by its own transaction path (`src/businesses/service.ts`, the balance changes around lines 89 to 113 and 185 to 248).
2. **Economy accounts are keyed by character only.** `src/economy/service.ts` creates accounts with a `character_id`.
   There is no account kind or owner kind for a business.
3. **Ownership is not one person.** A business can have more than one active owner or co-owner, so a credit "to the
   owner" has no single receiving account.

Crediting a business from the treasury would therefore need either a second ledger for business money, which the stage
rules forbid, or a new account model for businesses, which is a larger change than this stage. Until then:

- A business destination is refused as unsupported. Test 10 (service level, full-snapshot equality) verifies it, with no writes.
- A client identifier alone never credits a business. No code path credits a business from the treasury.
- An organisation destination is refused as unsupported and stays closed.
- An unknown destination kind is refused as invalid.

## 6. Funding: verification

The initial allocation is the catalogue rule (`treasury_funding`): ₦100,000,000 to `gov:min:finance`, with its reason
recorded. It is an **initial game-world allocation, not revenue**. It is not tax, not a fine, not borrowing, and not a
route for any other money.

| Requirement | How it is verified |
|---|---|
| Applied once per world | In-memory and saved marker checks (`applyInitialTreasuryFunding`). Test 1 and 2 (service); 21 (file); 30 (PG). |
| Two writers cannot apply it twice | Two PostgreSQL writers, each funding in memory: one save lands. (`postgres-treasury-writers.test.mjs`) |
| Not re-added on restart or reconciliation | Restart and reconcile return 0 and leave one row (tests 2, 21, 30, and the two-writer test). |
| Legacy ledger unchanged | Test 3: a legacy revenue row is kept, and the funding row is the only addition. |
| Malformed rules fail safely | Test 4: a bad rule is refused when the catalogue loads, and nothing is written. |
| File backend limit | Once-only holds for one process per file, because the lock refuses a second process. A copy of the file used on another host is not covered. |

## 7. Tests and results

Results on this branch, after the final changes:

| Run | Tests | Pass | Fail | Skipped | Notes |
|---|---|---|---|---|---|
| File backend (`npm test`, no database) | 1164 | 1123 | 0 | 41 | 40 PostgreSQL-only tests and 1 new PostgreSQL-only funding test are skipped, not passed. |
| PostgreSQL (`npm test`, disposable `naija_s33_test`) | 1283 | 1279 | 0 | 4 | The 4 skips are the TLS live tests, which need `TLS_TEST_DATABASE_URL`. |
| Focused: file lock (`file-writer-lock.test.mjs`) | 15 | 15 | 0 | 0 | In-process lock, fencing, outcomes; child processes for refusal, stale takeover, SIGKILL before and after the rename. |
| Focused: treasury payments (PostgreSQL run) | 35 | 35 | 0 | 0 | 23 file, 12 PostgreSQL. |
| Focused: two-writer funding (PostgreSQL run) | 1 | 1 | 0 | 0 | |
| Build (`tsc`), lint (`eslint`) | — | pass | — | — | |

Baseline from Stage 32: file 1146 / 1106 / 0 / 40; PostgreSQL 1261 / 1257 / 0 / 4.

New regression tests, each for a behavior that was not guaranteed before:

- A second process refused while the first holds the world, and a killed holder released for the next start.
- SIGKILL during a save before the rename leaves the previous world; after the rename it leaves the new one, and the
  restart holds the new one (which the client never saw confirmed).
- A store that loses its lock is fenced, refuses later saves, and does not remove the other writer's lock.
- A failure before the rename is `not_saved`; a failure after it is `unknown`; a capacity refusal is `not_saved`.
- A new treasury change is refused while saving fails, with nothing changed, and the recorded request is confirmed later.
- A fenced writer refuses new treasury changes (file and PostgreSQL).
- Two PostgreSQL writers: the stale payment is refused; a restart holds only the saved payment; funding is saved once.
- A world in a data directory that does not exist yet can be locked (the directory is created).

Changed expectations, with the reason:

- Two Stage 32 file tests (`a save that commits but loses its reply...` and `a crash after a committed save with a lost
  reply...`) now expect `treasury_outcome_unknown` for a save that committed and then reported failure. Their comments
  say why. The assertion that the reply is never a success is kept. The old `treasury_not_saved` was not true for a save
  that had committed.

Unverified, and not reproduced: the race in section 3.5 (a lock replaced between the token check and the rename). The
migration race of Stage 32 section 5.4 was reproduced and fixed in Stage 32; it is covered by the live test and passed
in this run.

## 8. Known defects and residual risks

- **Non-treasury changes are still answered before their save**, as in Stage 32 section 5.5, except the money, business,
  education, and career families, which Stage 34 changed (see `docs/STAGE_34_MUTATION_OUTCOMES_AND_RISK_CONTAINMENT.md`).
  The rest of the non-treasury routes are unchanged. A crash in that window
  loses the change. This is unchanged, and the persistence notice still warns the player.
- **Memory is ahead of storage until a save succeeds** (Stage 32 section 5.5). A crash in that window loses a treasury
  payment in full, both the debit and the credit, and the payer was never told it was confirmed.
- **File lock limits** (section 3.5): same host only, PID reuse fails closed, and a window between the check and the
  rename that is not reproduced.
- **Treasury gate closes on any failed save**, so one storage failure refuses all new treasury changes until a save
  succeeds. This is intended, and it is visible to the client as `treasury_persistence_unavailable`.
- **Older engine actions** are still not reviewed for validate-then-write, as in Stage 32.

## 9. Remaining blockers

1. **Business payees.** Need a business account model, or a decision that business money stays in `balance_ngn` and
   payments to a business are not offered. Owner decision needed (section 11).
2. **Organisation payees.** Closed. Need the same complete model.
3. **Multi-host file use.** Not supported. PostgreSQL is the only multi-host path.
4. **Revenue, taxation, fines, borrowing.** Still no route, by mission constraint.

## 10. Stage 32 documents that this stage changes

- `docs/STAGE_32_TREASURY_FUNDING_AND_PAYMENTS.md`: the file backend is no longer "single-instance only" by convention;
  it is single-process by a lock. The reply codes for an uncertain save are `treasury_outcome_unknown`, not
  `treasury_not_saved`. Business payees are deferred, not the next step. Each of these is marked in that document.

## 11. Owner decisions still required

1. Business payments: keep them closed, or define a business account model? If it is defined, the ownership rule
   (one owner, all owners, or a designated account) must be chosen first.
2. Whether a treasury change should be refused while any save is failing (the current rule), or only while the save
   that would cover it is failing.

## 12. Next recommended stage

Stage 34 should decide the business account model (section 11, question 1). It should not open business payments until
that model exists, and it should not add a second business ledger. If the owner chooses to keep business payments
closed, Stage 34 can instead take the older government and economy actions, which are the remaining validate-then-write
gap (section 8).
