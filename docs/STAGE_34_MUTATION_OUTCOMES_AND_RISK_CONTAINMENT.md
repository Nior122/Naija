# Stage 34: Mutation Outcomes, Risk Containment, and File-Lock Races

Starts from `39885d8` on `arena/00cdea0e-naija` (the Stage 33 head). Stage 33 made treasury replies wait for a save and
gave the file backend a writer lock. This stage asks the next question across the money paths: **when the reply says
"done", has the change been saved?** Before this stage, most money routes sent the success reply and then tried to save.
A failed save left the client with a success it had been told about and a world that did not contain it.

Short answer: every changing money route now waits for a save that covers its change before it confirms success. A failed
save is an explicit error (`not_saved`), an uncertain save is another explicit error (`outcome_unknown`), and a retry with
the same request ID is answered once and never applies twice. Routes that cannot be made safe in this stage are
contained, not left open. The two file-lock races from Stage 33 are **reproduced and still open**. They are not fixed.

Production readiness is **not** claimed. See section 9.

## 1. Scope and summary

| Area | Stage 34 result |
|---|---|
| Economy money actions (open account, deposit, withdraw, transfer, purchase, loans) | **Confirmed only after save.** Gated while saving fails. Replays are answered once. |
| Monthly account fee | **Fixed.** It was charged again on every world-date change and session resume. Now once per calendar month (`last_fee_date`). |
| Daily withdrawal total | **Fixed.** Checks now run before any write, so a refused withdrawal no longer resets the day's total. |
| Shop purchase, bus fare, clinic charge | **Confirmed only after save.** Errors `shop_not_saved`, `bus_not_saved`, `clinic_not_saved`, and their `_outcome_unknown` and `_persistence_unavailable` forms. |
| Business changing actions (create, stock, sales, capital, withdrawal, expense, production, close, branches, ownership, staff) | **Confirmed only after save.** Gated while saving fails. Reads (`discover`, `view`) are not gated. |
| Education changing actions (every `education.action` except `begin_final_exam`) | **Confirmed only after save.** Gated. |
| Career changing actions (every `career.action` except `search_jobs`) | **Confirmed only after save.** Gated. |
| Rent payment (`property.action` `pay_rent`) | **Contained.** Refused with `property_rent_payment_suspended`. Nothing changes. The service function is unchanged for trusted callers. |
| Other property actions (purchase, sale, transfer, and others) | **Not changed.** Still reply before the save (section 6). |
| Government treasury (budget approval, allocation, spending, initial funding) | **Not changed in this stage.** Stage 33 already confirms after save. Regression tests pass. |
| File-lock races (Stage 33 section 3.5) | **Reproduced.** Both are **open**. Documented as open with failing tests marked `todo`. |
| Lock release on normal shutdown | **Verified** for a clean SIGTERM. A failed final save keeps the lock (limitation, section 5.4). |
| Business payments, organisation payments | **Still closed.** Not started. No route added. |
| Taxation, revenue, fines, borrowing, minting | **Not added.** |
| Older snapshots | **Not restored.** No blind rollback. |

## 2. Audit: high-risk operations

Risk is the potential harm to the economy or to a player if the reply and the saved world disagree. "Before" is the
state at `39885d8`.

| Operation | Route | Risk | Before Stage 34 | After Stage 34 |
|---|---|---|---|---|
| Economy money actions (7 actions) | `economy.action` | High | Reply sent before save | Confirmed after save; `economy_not_saved` / `economy_outcome_unknown`; gate |
| Monthly account fee | world-date processing | High (money) | Charged on every date change and session resume | Once per calendar month |
| Daily withdrawal total | `economy.action withdraw` | Medium | Total reset before a later refusal could occur | Checks first, write last |
| Shop purchase (money and inventory) | `shop.purchase` | High | Reply sent before save; failed save seen only as a connection-wide notice | Confirmed after save; `shop_not_saved`; gate |
| Bus fare | `world.bus` | Medium | Reply sent before save | Confirmed after save; `bus_not_saved`; gate |
| Clinic charge | `clinic.care` | Medium | Reply sent before save | Confirmed after save; `clinic_not_saved`; gate |
| Business changing actions (14) | `business.action` | High (capital, stock, staff, ownership) | Reply sent before save | Confirmed after save; `business_not_saved`; gate |
| Education changing actions | `education.action` | High (tuition, family support, subject record) | Reply sent before save | Confirmed after save; `education_not_saved`; gate |
| Career changing actions | `career.action` | High (applications, shifts, payroll, resignation, retirement) | Reply sent before save | Confirmed after save; `career_not_saved`; gate |
| Rent payment | `property.action pay_rent` | High | Reply before save; no per-period check; idempotency key from request time, so a retry is not recognised | **Refused** (`property_rent_payment_suspended`) |
| Other property actions | `property.action` | High | Reply sent before save | **Unchanged** (section 6) |
| Government treasury: approve, allocate, spend, initial funding | `government.action` | High | Stage 33: confirmed after save; gated | **Unchanged**; regression passing |
| Military appointments (`create_appointment`, `assign`) | `military.action` | High | Already refused: `military_appointment_suspended`, `military_assignment_suspended` | **Unchanged** (suspension from an earlier stage). Not re-audited here. |
| Police arrest (`execute_arrest`) | `police.action` | High | Already refused: `police_arrest_suspended` | **Unchanged**. Not re-audited here. |
| Other government appointment routes | `government.action` | High | Not reviewed in this stage | **Not reviewed.** Listed as remaining (section 6). |

What was checked to classify each row: the handler's order of mutation, reply, and save, read in the code, and the
existing tests for each family. Where a route was not read in full in this stage, the table says so.

## 3. Mutation outcome contract

### 3.1 The states

Every changing request ends in exactly one of four states. The client's reply matches the state.

| State | What the world holds | Reply to the client | Retry with the same request ID |
|---|---|---|---|
| Rejected before mutation | Unchanged, in memory and in storage | A validation, authority, or gate error (`*_persistence_unavailable`) | Applied as a first request |
| Mutated in memory, not saved | Changed in memory; storage unchanged | `*_not_saved` | Replays the recorded result once it is saved (no second change) |
| Saved and confirmed | Changed in memory and in storage | Success, after the save | Duplicate notice, or the first result replayed (see 3.3) |
| Outcome unknown | May or may not be in storage (the save may have committed) | `*_outcome_unknown` | Replays the recorded result if the save committed; applies once if it did not |

`not_saved` and `outcome_unknown` are kept distinct wherever the persistence layer can tell them apart. Section 4 says
where it can.

### 3.2 The order for a changing request

1. Authenticate from the server session. Client-supplied identity fields are ignored.
2. Require a request ID (`request_id_required` if absent).
3. Refuse while saving is failing or this writer is fenced (`*_persistence_unavailable`). Nothing has changed yet.
4. Validate the full request, check authority, ownership, scope, and resource state. A refusal here changes nothing.
5. Mutate the in-memory world, record the request ID as processed, and create a replay record (kind, generation, reply).
6. Save through the existing durability path. The save serialises behind earlier saves, and it captures every change made before it is queued.
7. Confirm, or report the outcome:
   - a save that covers the change: send the success reply (and the character snapshot), once;
   - a save known to have failed before any write: `*_not_saved`;
   - a save that may have committed: `*_outcome_unknown`.

Step 6 can run up to three times within one request. A change is answered only when a save covers its generation.

### 3.3 Retries

- **First success already delivered**: a resend gets `command.duplicate` and a character snapshot. The replay record is
  removed at delivery, so memory does not grow with confirmed requests.
- **Not yet delivered** (the first attempt returned an error): the retry is answered once the save covers the change. For
  economy, business, education, and career, that is the original result with `replayed: true`. For shop, bus, and clinic,
  it is the character snapshot carrying the request ID.
- **Same request ID, different content**: the first request's recorded result is replayed, as for any idempotent command.
  Nothing new is applied.
- **Restart**: the request ID is kept in the saved world, so a request that was saved is a duplicate after restart. A
  request that was not saved is not recorded, so its retry applies it once.

### 3.4 Gate

While the last save failed, or the writer is fenced, a new changing request is refused before it changes anything. A
retry of a recorded request is still answered, because it changes nothing. The gate closes on any failed save, including
one caused by a non-money change. That is deliberate (Stage 33 section 3.3).

### 3.5 Changed expectations, with the reason

The contract above changes what a client sees. These existing tests pinned the old behaviour and were updated on purpose:

- `test/mutation-ordering.test.mjs`, the four `shop.purchase` tests per backend. They pinned "the success reply is sent
  before the save" and "a resend while saving fails is a duplicate". The header of that file says ordering changes must be
  deliberate. The new assertions are:
  1. A failed save sends `shop_not_saved` for the request, never a success, and the saved file does not hold the charge.
  2. A repeated request while the save is failing is answered once the save succeeds, and is charged once.
  3. While saving fails, a new purchase is refused before any change. The background retry (run with a real tick
     interval) saves the unsaved purchase, and the player gets one `persistence.restored` signal.
  4. A restart that loses the unsaved purchase applies the same request ID once.

  The scenarios are the same. The expected replies changed. Nothing was made weaker.

No other existing test was changed. `authority-matrix`, `businesses`, `careers`, `education`, and the treasury tests
pass unchanged.

### 3.6 New tests written to this contract

- `economy-money-durability.test.mjs` (30 with PostgreSQL configured): service-level refusals leave no trace; the monthly
  fee is charged once per month; socket-level confirmation, failed save, lost reply, restart, crash, concurrency, and the
  fenced writer, on both backends. A reused request ID with a different amount is a `command.duplicate`, not a replay of
  a new change.
- `money-routes-stage34.test.mjs` (26): bus and clinic: validation refusals change nothing; a failed save is not confirmed
  and the retry charges once; a commit that loses its reply is `outcome_unknown` and the retry charges once; a new charge
  while saving fails is refused; a confirmed charge survives a restart; a crash after an uncertain commit does not charge
  again. `pay_rent` is refused and the world content (excluding request bookkeeping) is unchanged.
- `business-money-stage34.test.mjs` (16): `contribute_capital`, `withdraw`, and `record_expense` on the same scenarios;
  a read is still answered while saving fails; a changing action is refused before any change while saving fails.
- `careers-education-stage34.test.mjs` (8): a career application (`apply`) with a failed save, retry, gate, and restart;
  an education elective (`choose_elective`) with a failed save and retry.

## 4. Per-backend guarantees

### 4.1 File backend

- **Writer lock** (Stage 33, kept): one live process per world file. A second start is refused while the first holds the
  lock. Every save checks the token before it writes. A store that loses its token is fenced and never saves again.
- **Outcome classification** (Stage 33, kept): failures before the rename are `not_saved`; a failure after the rename is
  `unknown`. A crash between the two is covered by the process-kill tests (Stage 33).
- **Stage 34 addition**: the outcome is used by every changing family above, so a client is never told "saved" for a
  change that may not be.
- **Limits**: same host, local file system only. The lock uses a process-ID liveness check. Two file-lock races are open
  (section 5).

### 4.2 PostgreSQL

- **Version fence** (Stage 32, kept): a save is `UPDATE ... WHERE version = $n`. A save that matches no row is refused as a
  conflict, `not_saved`, and the store is fenced.
- **Uncertain saves**: a connection lost after the `UPDATE` was sent, or a commit whose reply is lost, is `unknown`. The
  retry with the same request ID is answered from the saved request record. It never applies a second time.
- **Verified in tests** (both backends where the test runs on both):
  - two writers on one world: the stale writer's save is refused, it never confirms a change it failed to save, and it
    is fenced (`economy-money-durability`, fenced-writer test; Stage 33 treasury two-writer tests);
  - a failed save, then a retry with the same request ID, applies once: economy, shop, bus, clinic, business
    (`contribute_capital`, `withdraw`, `record_expense`), education (`choose_elective`), and career (`apply`);
  - a commit whose reply is lost, then a retry, applies once in the same process: economy, bus, clinic, business,
    education, and career;
  - after a crash that follows a failed save, the restarted world lacks the change and the retry applies it once:
    economy and shop;
  - after a crash that follows a committed save with a lost reply, the restarted world holds the change and the retry is
    not applied again: economy, bus, and clinic. Business, education, and career are tested for the lost reply in one
    process, not across a crash;
  - a restart after a confirmed change keeps it, and the request ID is then a duplicate: bus, clinic, business
    (`contribute_capital`, `withdraw`), and career (`apply`). Economy and education have no separate confirmed-restart test
    in this stage;
  - concurrent identical requests are applied once and get consistent replies (economy);
  - the saved balances and transaction records match the in-memory ones after each economy scenario. No separate ledger
    audit is run in this stage.
- **Not verified**: multi-host safety. The writers in these tests are store instances in one Node process, with the same
  version check the database applies to separate processes. The separate-process test (Stage 33 `multiprocess-persistence`)
  is unchanged. No claim is made beyond that.

## 5. File-lock races and lock release

### 5.1 Race 1: lock replaced between the token check and the rename

> Status update (Stage 35): race 1 is resolved for protocol-following writers on one Linux host, by a directory lock. See `docs/STAGE_35_PROPERTY_MUTATION_SAFETY_AND_FILE_PERSISTENCE.md`, section 7. The text below is the Stage 34 record.

- **Status: reproduced, OPEN.** `test/file-writer-lock-races.test.mjs`, race 1, marked `todo`. Result: the save renames
  after the lock has been replaced by a token this writer does not hold. The expected refusal does not happen.
- **Why it is open**: the token check and the rename are two system calls. Node's `fs` API has no atomic
  compare-and-rename keyed on the lock's identity, and no advisory lock (`flock`) without a native addon. No reliable
  primitive is available in this runtime to close the window.
- **Exposure**: a stale takeover only replaces a lock whose holder is dead, and this writer is alive while it saves. The
  window therefore opens only if a person or another tool replaces the lock file by hand during a save.
- **Not claimed**: no fix. No claim that the window cannot be hit.

### 5.2 Race 2: two starters racing for one stale lock

- **Status: reproduced, OPEN.** `test/file-writer-lock-races.test.mjs`, race 2, marked `todo`. Result: a starter that read
  a stale lock removes a live lock that another starter created in the meantime. The second starter is then not refused.
- **Why it is open**: as in race 1, Node has no atomic compare-and-delete for a file.
- **Exposure**: two processes started at once against one stale lock. The second starter then runs alongside the first.
  The first writer's next save is refused only if the token check sees the replaced lock, which is race 1's window.
  Together these two windows mean the file backend is **not** safe for two concurrent starts on one world. Production
  should run one process per world file.

### 5.3 Test evidence

| Test | Result |
|---|---|
| A lock file that cannot be read refuses only that save; it is not a fence; the next save works | Pass |
| A clean SIGTERM saves, exits 0, removes the lock, and a new start can take it | Pass |
| Race 1 (todo) | Fails as expected: the save renames after the lock was replaced |
| Race 2 (todo) | Fails as expected: the second starter is not refused |

The `todo` tests run and report their failure. They are counted as todo, not as passes. If either starts passing, the
race is closed and the todo, the comment, and this section must change together.

### 5.4 Lock release

- A clean shutdown (SIGTERM) runs the final save, then releases the lock. The test asserts exit 0, no lock file, and that a
  new `WorldFileWriterLock.acquire` succeeds.
- **Limitation**: if the final save fails at shutdown, the release is skipped, so the lock keeps the dead process's ID. The
  next start takes it over, because the PID is dead. That is documented, not fixed. It is the same window as race 2 in a
  different form.
- The fresh-directory fix from Stage 33 is kept: the data directory is created before the lock is taken.
- The lock hook used by the race tests (`WorldFileLockHooks.afterStaleRead`) is a test seam. Production never sets it.

## 6. Operations that still respond before confirmed persistence

These routes were not changed in Stage 34. Each replies before its save, as before (Stage 28 and Stage 32 section 5.5).
Each is a known gap and is listed here so that it is not mistaken for a guarantee.

| Route | Why it is listed | Money involved | Blocker |
|---|---|---|---|
| `property.action` other than `pay_rent` (purchase, sale, transfer, and others) | Changes ownership and money. Reply and snapshot are sent, then the save runs. | Yes | Each action needs the same gate and replay as the economy family. Not done in this stage. |
| `school.answer` and class quizzes | Records attendance and assessments. | No | Not a money path. Needs the same pattern for consistency. |
| `character.rest`, `inventory.consume`, `world.travel`, `geography.enter`, `geography.leave`, movement | Persistent gameplay state. | No | Non-money. Stage 28 policy. |
| `begin_final_exam` | Marks the request processed and saves without a confirmation. | No | Starts a quiz. Not a change to records. |
| Government, justice, police, military, crime, elections, social, relationships, family (non-treasury) | Not re-audited in this stage, except the suspension codes above. | Some | Needs its own review. |

### 6.1 What is not started, deliberately

- **Business payments and organisation payments**: still closed. No route is added. The business account model (Stage 33
  section 5) is still needed first.
- **Taxation, revenue, fines, borrowing, unrestricted minting**: not added.

## 7. Treasury safeguards: preserved

No file in the government or treasury path changed in this stage. The safeguards from Stage 31 to 33 remain in force and
their tests pass in the full run: one-time initial funding, treasury authority checks, budget ceilings, jurisdiction
restrictions, self-dealing and conflict checks, idempotent requests, the PostgreSQL version fence, the file-lock checks,
and ledger validation.

## 8. Tests and results

### 8.1 Full suite

| Run | Tests | Pass | Fail | Skipped | Todo | Notes |
|---|---|---|---|---|---|---|
| File backend only (no `DATABASE_URL`) | 1210 | 1167 | 0 | 41 | 2 | 41 skipped are PostgreSQL-only tests, not passed. 2 todo are the open races. |
| File backend and PostgreSQL (disposable `naija_s34_test`) | 1367 | 1361 | 0 | 4 | 2 | 4 skipped are TLS live tests that need `TLS_TEST_DATABASE_URL`. |
| Mission 6 baseline, file | 1164 | 1123 | 0 | 41 | — | From the Mission 6 record |
| Mission 6 baseline, PostgreSQL | 1283 | 1279 | 0 | 4 | — | From the Mission 6 record |

Build (`npm run build`, `tsc --project tsconfig.json`): exit 0. Type check (`tsc --noEmit`): exit 0. Lint
(`eslint services/world-api/src --ext .ts`): exit 0.

### 8.2 Focused suites on the changed behaviour

| Suite | Tests | Result (both backends where applicable) |
|---|---|---|
| `economy-money-durability.test.mjs` | 30 (PostgreSQL configured) / 17 (file only) | 30/30 pass with PostgreSQL configured |
| `mutation-ordering.test.mjs` (shop) | 8 | 8/8 pass |
| `money-routes-stage34.test.mjs` | 26 | 26/26 pass |
| `business-money-stage34.test.mjs` | 16 | 16/16 pass |
| `careers-education-stage34.test.mjs` | 8 | 8/8 pass |
| `file-writer-lock-races.test.mjs` | 4 | 2 pass, 0 fail, 2 todo (open races) |
| `authority-matrix`, `businesses`, `careers`, `education`, treasury tests | — | Pass in the full runs, unchanged |

### 8.3 Failures during development, fixed

Recorded so that the history is clear. None of these was left as a skip or a todo.

- A shop ordering test assumed a background retry that does not run under the no-tick test server. It now uses a real tick
  interval for that case only.
- A gate test assumed the refused request would reach the save gate. A failed bus fare had moved the character in memory,
  so the next request was refused by the location check first. The test now places the character back as a setup step.
- A `pay_rent` containment test compared whole-world JSON, which includes request bookkeeping (`lastSeen`,
  `updated_at`). It now compares world content with bookkeeping excluded, and says so.

## 9. Limitations and residual risks

- **Production readiness is not claimed.** The tests above are in-process and against one disposable database.
- **Two file-lock races are open** (section 5). The file backend is not safe for two concurrent starts on one world. Use
  one process per world file.
- **Gate scope**: a failed save closes the gate for every changing family until a save succeeds. This is intended and
  visible to the client as `*_persistence_unavailable`.
- **Replay records are in memory.** A restart keeps a change only if its save succeeded, and then its request ID is saved
  with it. A change whose save failed is not recorded and is applied once if retried after restart.
- **Replay record capacity**: 256 unconfirmed or recently confirmed records. Unconfirmed records are never pruned.
- **Remaining routes** (section 6) still reply before their save.
- **Some legacy idempotency keys include the request time**: the business capital contribution and the property rent
  payment. The request ID is the guard against a second change. These keys are not relied on for retries, and the
  rent route is contained (section 2).
- **Power loss** is not tested. As in Stage 28 and 33, process-kill tests cannot show what a power cut does.
- **Business payments remain closed.** Organisation payments remain closed.

## 10. Remaining blockers

1. **File-lock races**: no reliable primitive in this runtime. Needs either a supported advisory lock or a different
   storage design for file-backed worlds.
2. **Other property actions** (section 6): need the economy-style gate and replay.
3. **Government non-treasury and appointment routes**: need their own review.
4. **Business account model**: needed before any business payment. Owner decision (Stage 33 section 11).
5. **Multi-host file use**: not supported. PostgreSQL is the only multi-host path.

## 11. Changes to earlier documents

- `docs/STAGE_33_PERSISTENCE_CONCURRENCY_AND_TREASURY_WRITERS.md`: section 3.5 said the two races were "unverified, not
  reproduced". Both are now reproduced and open (section 5 here). Section 3.4 said non-treasury changes still reply before
  their save. That is no longer true for the money, business, education, and career families (section 3 here).

## 12. Next recommended stage

Two choices, in order of value:

1. **Finish the outcome contract for the remaining money-moving routes**, starting with the other property actions. Each
   gets the gate and replay pattern and a test set on both backends.
2. **Decide the file-lock design** for single-host file worlds, or make PostgreSQL the required backend for any world
   that may be started twice. The races cannot be closed by more tests alone.

Business payments should stay closed until the account model in Stage 33 section 5 exists.
