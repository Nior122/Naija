# Stage 44: business lifecycle verification

Stage 44 checks the Stage 43 business lifecycle through the Godot client and its server connection. It fixes the
defects that were confirmed, and it records what was not verified. Four kinds of evidence are kept apart:

- **Backend tests**: `node --test` against the server code. Some use real WebSocket connections (socket tests). They
  do not run Godot.
- **Headless Godot logic tests**: Godot 4.7.2 runs without a window and calls client code directly.
- **Headless UI tests (U)**: the real scenes and panels are driven with simulated input (button presses, typed values,
  option selections). The server state is then read back from the world file. Nothing is rendered and no person looked
  at a screen, so layout and visual behaviour are not verified.
- **Live server probe (P)**: a script connects to a running server and sends commands. It is not the client.

No business operation is claimed to work in Godot unless a headless UI test drove it through the panel and the server
state was then read back. Section 3 gives the level of evidence for each operation.

## 1. Status summary

| Area | Result |
|---|---|
| Shutdown lock loss (`WorldFileLockLostError`) | Confirmed and fixed. Regression tests fail before the fix and pass after it. The holder's exit behaviour is now tested (section 5.1). |
| Business error wording | Confirmed and fixed (section 5.2). |
| Generic `error` replies not reaching the business panel | Confirmed and fixed. The UI test fails before the fix (section 5.3). |
| Business creation, goods and service listing, restock, buyer purchases (goods and service), refusals of over-stock and over-funds purchases, hiring, salary, dismissal, branch opening, ownership transfer, closure refused with a balance, withdrawal, closure | **Verified in the Godot panel (U)**, with server readback, on the isolated fixture (section 3). |
| Command-limit refusal through the panel | Verified (U). Fails before the fix, passes after it. |
| Stranger and employee see no owner controls | Verified (U) for the controls that the panel shows. The server's refusal of a stranger's changing action is backend-only (socket tests), because the panel offers no such control to a stranger. |
| Restart keeps balance, stock, employment, ownership | Backend socket read-back only. Not driven through the UI. |
| Goods price change, out-of-range price refusal, deactivate and reactivate, five branches and a sixth refused, transfer refusals to self and to an unknown character, closure refused with a balance, withdrawal, closure, and "Open branch" on a closed business | **Verified in the Godot panel (U)**, 67 checks, `remaining` phase, with server readback (section 3, items 4, 10a, 11b, 12, 13, 13b). |
| Career conflict, goods price ceiling and service price bounds, transfer refusals other than self and unknown, branch location rules | Backend and socket tests only. Not driven through the UI. |
| Shutdown save window (Stage 43 section 8.3) | **Partly fixed.** A released file-backend store could still write and replace another writer's world (reproduced, then fixed). It is now fenced and refuses with `world_file_lock_lost`, with a regression test (section 5.4). The production shutdown paths tested all saved before exit. The bounded wait in `shutdown()` is not made (section 6.2). |
| WebSocket session handling and the command limit | Finding recorded. `rate_limited` is no longer routed to the career panel (decided: notify only, section 6.1). The Godot side of that change has not been re-run (section 7.2). |

## 2. Environment

- Godot: **4.7.2.stable.custom_build**, built from the 4.7.2-stable source tarball (`codeload.github.com`), outside the
  repository at `/tmp/s44/godot-4.7.2-stable/bin/godot.linuxbsd.editor.x86_64`. Editor target, linuxbsd, x86_64.
  Built without `use_volk=no`; that flag failed to link. Godot runs used `--headless`; no window was rendered.
- Godot's editor import (`godot --headless --editor --path game --quit`) created 53 untracked `game/**/*.gd.uid` files.
  They are generated and not committed. They have not been deleted.
- Backend: Node 22.22.3. File backend, and PostgreSQL 18.4 (`@embedded-postgres/linux-x64@18.4.0-beta.17`, local, the
  `naija_test` database on 127.0.0.1:5432).
- `gdtoolkit` 4.x (`gdparse`, `gdlint`) was installed in `/tmp/gdvenv`. It is not a repository tool.
- **Sandbox restart (after the Godot runs).** The sandbox was restarted, and `/tmp` was cleared. Lost: the Godot binary
  build, the fixture world and sessions file, the gdlint venv, the embedded PostgreSQL data, and every log under
  `/tmp/s44/` that section 7 cites. The repository was re-cloned: the local branch pointed at `44483b4` (the `main`
  base) while `origin/arena/00cdea0e-naija` is at `fa9c0d6`. The branch was moved to `fa9c0d6` with `git update-ref`
  (old value checked) and the index was refreshed with `git read-tree`. No working-tree file was changed. The working
  tree was compared with `git archive` of `fa9c0d6`: the only differences are the Stage 44 changes listed in section 10.
  After the restart, the file and PostgreSQL suites were re-run on re-installed dependencies (section 7.1). The Godot
  checks were not re-run, because no Godot binary is available in this sandbox (section 7.2).
- UI runs use an **isolated copy** of the funded fixture world on port 3200. The runner
  `tools/business-fixture/run-business-ui.sh` makes the copy, starts a server on that copy, runs the phases, and stops
  the server. The fixture file itself was checked before and after the final runs (MD5 prefix `56e29da3a522`) and
  was not changed.

## 3. Operations and results

Levels: **B** = backend `node --test` (file and PostgreSQL), **S** = backend socket test, **H** = headless Godot logic,
**U** = headless Godot UI with simulated input and server readback, **P** = live probe.

Sources for U are the phase tests listed in section 7 (owner_ops, buyer_ops, staff_view, stranger_view, owner_finish,
new_owner_view, and the optional remaining, lifecycle, and rate_limit tests).

| # | Operation | Evidence | Result |
|---|---|---|---|
| 1 | Create a business (template, name, description, starting capital; confirmation) | U (owner_ops) | Passes. Founder's cash N400,000 → N270,000 for business A: N80,000 setup fee and N50,000 starting capital (ledger). The server's registration notice is shown. Business names carry a per-run suffix. |
| 2 | List a goods product at a price | U (owner_ops) | Passes. Beans (2 kg) listed at N4,000. Server notice "Added 'Beans (2 kg)' to the business at ₦4,000." |
| 3 | List a service | U (owner_ops) | Passes. Local Delivery listed at its catalogue price (N1,500). Server notice "Listed the service 'Local Delivery' at ₦1,500." |
| 4 | Price change to N4,500; price N999,999 refused as outside the permitted range; deactivate and reactivate a listing | U (remaining) | Passes. "'Beans (2 kg)' now sells at ₦4,500." Refusal: "The price is outside the permitted range." "…was taken off sale." then "…is back on sale." The final price in the world file is N4,500. The goods ceiling (14000 accepted, 14001 refused) and service bounds (75000 accepted, 75001 refused) are covered by backend and probe runs only; the UI test does not try the boundary values. |
| 5 | Restock (goods only, units and unit cost; confirmation) | U (owner_ops) | Passes. 5 units at N1,000 each. Server notice "Restocked 5 units." Business account −N5,000 (ledger). Zero and negative quantities are refused by the server (B, S). The panel does not offer zero. |
| 6 | Ledger after capital and restock | U (report) | Passes. `business_capital` +N50,000 (balance N50,000), `business_expense` −N5,000 (balance N45,000). |
| 7 | Buyer-paid goods purchase | U (buyer_ops) | Passes. The buyer buys 1 bean at N4,000: cash N60,000 → N56,000, server notice "Purchase of 1 for ₦4,000 completed." |
| 7a | Goods purchase refused for stock (10 units; 4 were left after 5 restocked and 1 sold) | U (buyer_ops) | Passes. The server's refusal "There is not enough stock to complete this sale." is shown. The buyer's cash is unchanged, checked after the refusal. Stock is not read back in the UI; the refusal's atomicity is covered by backend tests (B, S). |
| 7b | Goods purchase refused for funds (2 units at N4,000 = N8,000 with N5,000 cash) | U (stranger_view) | Passes. The server's refusal "...does not have enough funds." is shown. The stranger's cash is unchanged (N5,000). |
| 7c | Unlisted product, bad quantity, owner buying own goods, two buyers racing for the last unit | B, S | Backend and socket tests only. Not driven through the UI. |
| 8 | Buyer-paid service purchase (no stock moves) | U (buyer_ops) | Passes. "Service bought for ₦1,500." Cash N56,000 → N54,500. |
| 9 | Hire (no confirmation, no money moves) | U (owner_ops) | Passes. "Employee <character> hired." |
| 9a | Salary (confirmation) | U (owner_ops) | Passes. "Salary of ₦2,000 paid." The employee's cash is N2,000 afterwards (report). Business account −N2,000 (ledger). |
| 9b | Dismissal (confirmation) | U (owner_finish) | Passes. "Employee <character> released." The employee's ownership row is inactive (report). |
| 9c | Career-conflict refusal, employee already employed | B, S | Not driven through the UI. |
| 10 | Branch opening (no cost; location and premises options; no confirmation) | U (owner_ops) | Passes. "Branch '…' opened." Branch closed when its business closed (report). |
| 10a | Branch limit: five branches opened, sixth refused | U (remaining) | Passes. "Branch '…' opened." five times, then "This business has reached its branch limit." The world file has five branches. Location rules: B, S only. |
| 11 | Ownership transfer to the stranger (confirmation) | U (owner_finish, new_owner_view) | Passes. "Ownership transferred to <character> (owner)." The new owner sees C under "My businesses" with "Your role: Owner". The old owner's row is inactive (report). |
| 11a | A stranger's changing actions refused (`business_unauthorized`) | B, S | Backend and socket tests only. The stranger's panel shows no owner control, so the UI cannot send them. Not probed live in this session. |
| 11b | Transfer refusals: self and an unknown character | U (remaining) | Passes. "Choose someone other than yourself to receive the business." and "That character does not exist in this world." The owner is unchanged in the world file. Manager, employee, child, deceased, and unbanked recipients: B, S only. |
| 12 | Closure refused while the balance is nonzero | U (owner_ops, remaining) | Passes. "Withdraw the business balance before closing it." The business stays open. The refusal is `business_balance_not_empty` (server). |
| 13 | Withdrawal, then closure | U (owner_finish) | Passes. "Withdrew ₦47,334 from the business." Balance N0. "Business '…' has been closed." Stock written off at closure (quantity 0, adjustment movement, by design). |
| 13a | Business B (zero balance) closed directly | U (owner_ops) | Passes. Closed with no balance. |
| 13b | A closed business refuses further actions | U (remaining) for "Open branch"; B, S for the rest | The panel still offers "Open branch" on the closed business D. The server refuses it, and the panel shows "That business is not currently active." The world file still has five branches. Other owner actions on a closed business: B, S. |
| 13c | Withdraw D's whole balance (N20,000), then close D | U (remaining) | Passes. "Withdrew ₦20,000 from the business." Then "Business '…' has been closed." Closure also makes every listing unavailable (by design). |
| 14 | Command-limit refusal shown in the panel; no partial state; "Start business" enabled again | U (rate_limit, a separate run) | Passes, 20 of 20 checks. On the pre-fix client, 4 of 20 fail (section 5.3). |
| 15 | Restart keeps balance, stock, employment, ownership | S | Socket read-back test in `business-lifecycle-stage43.test.mjs`. Not driven through the UI. |
| 16 | Session resume for the owner, buyer, candidate, and stranger | U (each phase), P (earlier) | Passes. Each phase reaches "session ready" with the expected cash. |
| 17 | Insolvency: a business that cannot pay a day's operating cost | Observed in U | Observed, not asserted. Business C, created with no capital, became `insolvent` during the run (daily operating cost, by design). It was then transferred to the stranger without a refusal (section 6.4). |

Items 7c, 9c, 11a, and 15 have backend coverage only. Item 4 (goods ceiling and service bounds), item 10a (location rules),
and the other refusals in item 11b have backend coverage only. Their checks in section 4 say nothing about the panel's
behaviour. They must not be described as working in Godot.

### 3.1 Financial integrity (final UI run, server world file read back by `provision.mjs report`)

| Account | Start | Movements (ledger) | End |
|---|---|---|---|
| Owner's cash | N400,000 (fixture baseline) | −N80,000 × 3 setup fees (A, B, C); −N50,000 capital (A); +N47,334 withdrawal (A) | **N157,334** |
| Buyer's cash | N60,000 | −N4,000 goods; −N1,500 service | **N54,500** |
| Candidate's cash (employee) | N0 | +N2,000 salary | **N2,000** |
| Stranger's cash | N5,000 | none (its one purchase is refused for funds) | **N5,000** |
| Business A balance | N0 | +N50,000 capital; −N5,000 restock; −N2,000 salary; −N1,166 operating cost (automatic); +N4,000 and +N1,500 sales; −N47,334 withdrawal | **N0** |
| Business A stock, beans | 0 | +5 restock; −1 sale; written off at closure | **0** |
| Business B balance | N0 | none | **N0**, closed |
| Business C balance | N0 | none | **N0**, `insolvent` |

Checks: N400,000 − N240,000 setup − N50,000 capital + N47,334 withdrawal = N157,334. The business A ledger sums to
zero after its withdrawal. The owner's N400,000 baseline is set by the fixture tool (`provision.mjs fund`) with no
ledger row. Every movement after it is a ledger row. The refused purchases changed neither cash nor the ledger.

### 3.2 Remaining operations (business D, `remaining` phase, server readback)

| Item | Start | Movements | End |
|---|---|---|---|
| Owner cash | N400,000 (fixture) | setup fee −N80,000; capital −N20,000; withdrawal +N20,000 | **N320,000** (report) |
| Business D balance | N0 | capital +N20,000; withdrawal −N20,000 (ledger) | **N0**, `closed` |
| Business D stock | none | none | none |
| Beans listing | listed at N4,000 | price N4,500; deactivated and reactivated; unavailable after closure | N4,500, unavailable (closure) |
| Branches | none | five opened; sixth refused | five, all `closed` by closure |
| Ownership | owner | transfers to self and to an unknown character refused | owner only, active |

Checks: N400,000 − N80,000 − N20,000 + N20,000 = N320,000. Business D's ledger has only the capital and the withdrawal. The
refused price (N999,999), the refused transfers, the refused closure, and the refused branch all left no ledger row and did
not change the price, the ownership, or the branch count.

## 4. Backend test coverage

- Files: `services/world-api/test/business-lifecycle-stage43.test.mjs` (creation and authority, route separation,
  stock, purchases, hiring, pay, firing, branches, ownership, closure, socket tests), `business-accounts-stage40.test.mjs`,
  `businesses.test.mjs`, `business-client-stage41.test.mjs`, `property-mutation-stage35.test.mjs`.
- Stage 44 additions:
  - `business-errors-stage44.test.mjs` (4 tests): business wording for action errors, the fallback for unmapped codes,
    a zero-unit restock refusal with no change, and a command-limit refusal with its request ID.
  - `client-business-errors-stage44.test.mjs` (5 source-text contract tests). These check the wiring of the client
    files. They do not run Godot.
  - `file-writer-lock-races.test.mjs`: 2 tests, "the lock holder ends when its server ends (exit / SIGKILL), and the
    lock is then free" (section 5.1).

## 5. Defects found and fixed

### 5.1 Shutdown lock loss (`WorldFileLockLostError`)

- **Cause.** The world-file lock is held by a shell process (the "holder") that the server starts. The holder is in the
  server's process group. A Ctrl-C or a group `SIGTERM` reached the holder first, and the holder exited before the
  server's final save. The save then failed with `world_file_lock_lost`.
- **Fix.** `services/world-api/src/persistence/writer-lock.ts`: the holder script starts with `trap '' INT TERM`. The
  server still handles both signals, saves, and then releases the holder.
- **The holder's exit when the server ends (verified).** The holder script ends with `exec cat > /dev/null`, so the
  holder ends when its stdin pipe closes. The pipe closes when the server exits, normally or by SIGKILL. Two tests check
  this in `file-writer-lock-races.test.mjs`, with `test/support/writer-lock-holder-child.mjs` as the stand-in server.
  The test takes the lock, reports the holder pid, and then exits by `QUIT` on stdin or by SIGKILL. It then checks that
  the holder has ended and that the lock can be taken again. Both pass on the file backend and on PostgreSQL.
  - Control: with `exec cat > /dev/null` changed to `exec sleep 600` in the built file, both tests fail ("not ok").
    The build was then restored from source, and the file is byte-identical to the backup.
- **Evidence for the group-signal fix.** The group SIGTERM and SIGINT tests in `file-writer-lock-races.test.mjs`. Earlier
  control run on a copy at `/tmp/s44/rp` with only `writer-lock.ts` reverted to HEAD: before the fix, the group SIGTERM
  test fails with `code: 'world_file_lock_lost'`; after the fix both pass.
- **Real shutdowns in this session.** Every UI run in section 7 ended with `Multiplayer world state saved; API stopped.`
  and no `world_file_lock_lost` line in the server log (final UI runs: 0 matches in three logs).

### 5.2 Business error wording

- **Cause.** `businessErrorMessage` returned `economyErrorMessage(code)` for any code it did not map. That function
  always returns text, so business codes such as `business_action_invalid` showed economy wording.
- **Fix.** `services/world-api/src/businesses/service.ts`. The two action codes are mapped to business wording. Only
  `economy_*` codes use the economy text. The fallback is the business message.
- **Evidence.** `business-errors-stage44.test.mjs` (4 backend tests, pass). A zero-unit restock now reads "A value in
  this business request is missing or outside the allowed range. Nothing was changed."

### 5.3 Generic `error` replies not reaching the business panel

- **Cause.** The server answers a refused command with a generic `error` message that carries the `requestId` (for
  example `rate_limited`). The client had no `error` branch in the message handler, and the tracker ignored the type. The
  business panel therefore showed "waiting" until its 20-second timeout, then said the change "may or may not have been
  saved". Nothing had been saved.
- **Fix.**
  - `game/scripts/services/server_request_tracker.gd`: `apply_reply` accepts type `error`. `internal_error` counts as
    unconfirmed.
  - `game/scripts/prototype_game.gd`: the `"error"` branch in `_on_online_message` calls `ui.show_request_error` when a
    `requestId` is present.
  - `game/scripts/ui/prototype_ui.gd`: `show_request_error(message)` routes to the housing, business, and NPC trackers.
- **Evidence.**
  - `game/tests/business_request_errors_headless.gd`: 18 pass (tracker logic).
  - `services/world-api/test/client-business-errors-stage44.test.mjs`: 5 pass (wiring, source text).
  - `game/tests/business_rate_limit_ui_headless.gd`: 20 of 20 pass with the fix. On a copy with the three client scripts
    reverted to HEAD, 4 fail: "the refused create is no longer pending within 5 seconds", "the business panel shows the
    server's rate_limited message", "no change is shown as waiting after the refusal", and "'Start business' is enabled
    again after the refusal".

### 5.4 Released store saved after release (Stage 43 section 8.3, file backend)

- **Cause.** `WorldStore.releaseWriterLock()` released the lock but left the store able to write. A save that was queued
  before the close, or started during shutdown, then ran with no lock check. The file could by then belong to another
  writer. Reproduced deterministically with `/tmp/s44/s83/released_store.mjs` (outside the repository): the late save
  reported "saved" and replaced the other writer's world at minute 200 with its own snapshot at minute 300.
- **Fix.** `services/world-api/src/multiplayer/persistence.ts`. `releaseWriterLock()` sets `fenced` when a lock was
  held. The check before the rename now throws `WorldFileLockLostError` (`not_saved`) when the store is fenced. The
  check before the file operation already refused fenced stores.
- **Regression test.** `file-writer-lock-races.test.mjs`, "a store whose lock was released is fenced". Before the fix:
  `not ok`, "Missing expected rejection", pass 0, fail 1. After the fix: `ok`. The probe now reports
  `refused: world_file_lock_lost` and the file stays at minute 200.
- **Production-path probes (file backend, a real server process, scripted WebSocket clients, outside the repository).**
  - `/tmp/s44/s83/experiment.mjs`: a client still connected at SIGTERM, and a client that closed before SIGTERM. Both
    disconnect saves were written before exit, before and after the fix.
  - `/tmp/s44/s83/stalled.mjs`: a client that stalls and never closes. The save was written and the process exited after
    about 30 s, the WebSocket close timeout. Before and after the fix.
  - The claim that the server exits before the disconnect save is written was **not reproduced** in these runs.
- **Business results.** Business results are sent only after the save covers the change (`world-engine.ts`, about
  line 474). A refused save becomes `business_not_saved`, so the client does not report success. This was read in the
  code for the business families. The economy, career, and other families were not checked one by one.
- **Not checked.** The released-store case on PostgreSQL was not probed in this pass.

### 5.5 Not a defect: the probe's missing reply

An earlier probe got no reply to a zero-balance closure. The cause was the server's per-connection command limit
(`allowCommand`: 20 commands per 10 seconds, counting `session.resume` and `identity.create`). The refused close got
`error rate_limited` and applied nothing. The probe was reading only the expected reply type. The server behaved
correctly.

## 6. Findings not fixed

### 6.1 WebSocket session handling and the command limit

- `session.resume` and `identity.create` count against the 20-per-10-second limit on each connection. A client that
  resumes and then sends a burst of commands can be refused. A refused command is applied to nothing and is answered with
  `error rate_limited` and its request ID.
- The UI test shows the effect: 30 "Refresh list" presses fill the window, and the next create is refused. The UI test
  pauses between actions for this reason.
- **Decided (user, Stage 44): notify only.** `_on_online_error` no longer sends `rate_limited` to the career transport
  panel. The refused request still gets its refusal through the `error` branch (`ui.show_request_error`), and the
  notice (`ui.notify`) still shows. `character_deceased` keeps the career route. The change is in `prototype_game.gd`.
  The wiring is covered by a source-contract test (`client-business-errors-stage44.test.mjs`, which failed before the
  change). It has **not been run in Godot** since the change (section 7.2).

### 6.2 Shutdown save window (Stage 43 section 8.3): partly fixed, decision open

- **Fixed:** a released file-backend store can no longer write (section 5.4). Section 5.1 is a different cause (the
  holder's signal handling).
- **Still open:** `shutdown()` still does not wait for saves that a closing socket starts. The probes in section 5.4 all
  saved before exit, but the code has no bound on that wait. Adding a bounded wait is a shutdown-semantics decision
  (Stage 43 section 8.3), so it is not made here. The PostgreSQL released-store path has not been probed.
- **Probe hygiene.** Earlier probe runs left two server processes running (ppid 1, ports 3606 and 3498, data under
  `/tmp/s83-*`). Their cause was not established. They were stopped with SIGTERM. Both saved their temporary worlds and
  exited.

### 6.3 Fixture startup, cleanup, and data isolation

- **Runner.** `tools/business-fixture/run-business-ui.sh` (in the repository, untracked) replaces the `/tmp` scripts. It
  refuses to start if the port is busy. It copies the fixture to `WORK_DIR` and never writes the source file. It writes
  the role configs with mode 0600 and never prints tokens. It stops the server it started (EXIT trap). The optional
  phases `lifecycle` and `rate_limit` are run separately because each expects a fresh owner balance.
- **Fixture baseline.** `provision.mjs fund` sets each role's cash directly in the world file (no ledger row). It refuses
  to run while a server is listening on the probe URL. The owner's N400,000 baseline is therefore not in the ledger. Only
  movements after it are. This is a test-fixture shortcut, not a game path, and it is stated here so that nobody reads
  the owner's ledger as the complete history.
- **Report.** `provision.mjs report` now prints per business `products`, `branches`, `ownership` (with `active`),
  `sales_count`, and the ledger. Section 3.1 is built from it.
- **Cleanup.** No cleanup beyond the next run's copy. The runner's `WORK_DIR` keeps the last run's world copy and logs.
- The tests do not read the developer's saved session. They use `NAIJA_WS_URL` and `NAIJA_MULTIPLAYER_SESSION_PATH`.

### 6.4 Other observations

- **Employee's business list.** An employee does not see business A under "My businesses" (observed, not asserted). The
  employee reaches it through Discover. Whether an employee should see the business there is not decided here (section 8).
- **Action heading shown to members with no controls.** Every member sees the "Actions for your role" heading, including
  an employee who has no controls under it (observed, not asserted). The cosmetic issue is in `business_panel.gd`
  (`_add_owner_actions`, called when `is_member`). Not changed in Stage 44. No owner control is shown to an employee.
- **Insolvent business transferred.** Business C was `insolvent` (zero balance, daily operating cost) when the owner
  transferred it to the stranger, and the transfer was accepted. The Stage 43 rules say that only owner capital or a
  transfer in restores an insolvent business. They do not say whether an insolvent business may be transferred. Not
  decided here (section 8).
- **Cash line lag.** The cash line updates after the server's reply, not with it. The UI tests poll the cash line
  (`_wait_cash`) rather than read it once.
- **Godot stderr.** "Parse JSON failed" lines appear for `load_confirmation_headless` and `save_guard_headless`. Both pass.
  Not investigated.
- **Owner actions on a closed business.** The panel offers owner actions on a closed business, including "Open branch".
  The server refuses them (`business_not_active`, shown in the panel: section 3, item 13b). The list of owner actions is
  not gated by business status (`business_panel.gd`). Not changed. Whether the panel should hide them is a UI decision.
- **Pre-existing gdlint findings (not part of the repository's lint gate).** `prototype_game.gd` has 14 gdlint errors and
  `prototype_ui.gd` has 5. Both counts are the same at `HEAD`, so Stage 44 did not add them. The repository's
  `npm run lint` covers only the TypeScript source. The business test files pass gdlint.

## 7. Commands and results

Two sets of runs. They are kept apart because the sandbox restart (section 2) sits between them.

### 7.1 After the restart (this record's backend and lint results)

Run on 2026-10-13 (UTC) after the `rate_limited` routing change. Logs are in `/tmp/s44/final6/`, which is not part of the
repository. They will not survive another sandbox restart.

| Command | Result |
|---|---|
| `npm run lint` (repository root; eslint over `services/world-api/src`) | exit 0 |
| `npm run build` (`services/world-api`) | exit 0 (also run by `npm test`) |
| `NAIJA_ENV=test npm test` (`services/world-api`, file backend; build, then `node --test test/*.test.mjs`) | exit 0: **1529 tests, 1475 pass, 0 fail, 54 skipped** (PostgreSQL-only) |
| Same command with `DATABASE_URL=postgres://naija@127.0.0.1:5432/naija_test?sslmode=disable DB_SSL=false NAIJA_ALLOW_DB_TESTS=true` on local PostgreSQL 18.4 (`@embedded-postgres/linux-x64@18.4.0-beta.17`, reinstalled) | exit 0: **1829 tests, 1825 pass, 0 fail, 4 skipped** (TLS) |
| `node --test` on `client-business-errors-stage44.test.mjs`, `business-errors-stage44.test.mjs`, `file-writer-lock-races.test.mjs` | 24 tests, 24 pass, 0 fail |
| `/tmp/gdvenv/bin/gdlint game/scripts/prototype_game.gd` (gdtoolkit 4.5.0) | 14 findings, all already present at HEAD; none in the lines changed for the routing change |

### 7.2 Before the restart (Godot and UI results)

Run on 2026-10-13 (UTC) after the fence fix and before the routing change. The logs for these runs were under
`/tmp/s44/final5/` and `/tmp/s44/ui-*` and are **no longer available**. The counts below were read from those logs before
the restart. They are not re-run now.

| Command | Result (before the restart) |
|---|---|
| `/tmp/gdvenv/bin/gdlint` on the business test files, `online_businesses_headless.gd`, `server_request_tracker.gd`, `prototype_game.gd`, `prototype_ui.gd` | exit 1: 19 findings, all in `prototype_game.gd` (14) and `prototype_ui.gd` (5), which were already failing at HEAD. The business test files, `online_businesses_headless.gd`, and `server_request_tracker.gd` had no findings. |
| `godot --headless --path game --script res://tests/business_request_errors_headless.gd` | exit 0, 18 PASS |
| `godot` headless: domain_smoke, player_movement, persistence_notice, ui_flow_headless, input_bindings_headless, load_confirmation_headless, performance_metrics, regional_handoff, regional_visual_profiles, return_path, save_guard_headless | all exit 0. Counts: 99, 4, 11, 57, 26, 104, 11, 41, 43, 47, 77 PASS |
| `godot` headless: session_policy | exit 0 (the script prints no count) |
| `save_restart.gd -- write`, then `-- read` in a new process | both exit 0; read prints "saved character state survived a fresh Godot process." |
| `online_businesses_headless.gd`, fresh server copy on port 3201 | exit 0, **11 PASS** |
| `tools/business-fixture/run-business-ui.sh` (six phases, default order, fresh copy) | exit 0, OVERALL=0: owner_ops 57 PASS; buyer_ops 25 PASS; staff_view 20 PASS; stranger_view 25 PASS; owner_finish 24 PASS; new_owner_view 12 PASS. **163 checks in total.** |
| `run-business-ui.sh remaining` (fresh copy) | exit 0, **67 PASS**. Re-run once more after a comment-only edit, also 67 PASS. |
| `run-business-ui.sh lifecycle` (fresh copy) | exit 0, 32 PASS |
| `run-business-ui.sh rate_limit` (fresh copy) | exit 0, 20 PASS |
| Server logs of the UI and online runs | 0 lines containing `world_file_lock_lost`. Every server ended with `Multiplayer world state saved; API stopped.` |

Not run after the routing change: every row above, including the `rate_limit` phase that shows the refusal in the business
panel. The routing change is one line in `prototype_game.gd` plus a comment. The source-contract test covers it. The
Godot checks must be re-run before this change is described as tested in Godot.

Each UI run used its own copy of the fixture, so no run depended on the previous one. The fixture file was not written
(MD5 prefix `56e29da3a522`, checked before the restart).

## 8. Decisions that remain open (not made here)

- Recipient consent for hiring and ownership transfer.
- The provisional 500% service price ceiling.
- Co-owner-only ownership states.
- Seed capital for NPC businesses.
- Branch setup cost.
- Whether an **insolvent** business may be transferred (section 6.4). The docs do not say.
- Whether an **employee** should see the business under "My businesses" (section 6.4).
- Routing of `rate_limited`: decided as notify only (section 6.1). Godot re-run pending.
- Shutdown semantics for section 8.3: a bounded wait in `shutdown()` (section 6.2). The released-store case is fixed.
- Open decisions 9, 10, and 11.

NPC business creation, NPC hiring, and autonomous NPC business activity are not enabled.

## 9. Remaining work

1. Drive the remaining refusals through the panel with simulated input: the career-conflict refusal (needs a seeded
   employment made through the server's domain functions, because the review happens on a future date), the goods price
   ceiling and service bounds at their boundary values, transfers to a manager, an employee, a child, a deceased, or an
   unbanked recipient, a stranger's refused changing action, and restart with UI readback.
2. Re-run the Godot checks after the `rate_limited` routing change (section 6.1). No Godot binary is available here.
3. Decide the shutdown semantics for section 8.3 (section 6.2). Probe the PostgreSQL released-store path.
4. Decide the insolvent-transfer and employee-visibility questions (section 8).
5. Decide whether the panel hides owner actions on a closed business (section 6.4). The cosmetic "Actions for your role"
   heading is not changed.
6. `game/scripts/ui/business_panel.gd` is over gdlint's 1,000-line limit. It is not split: no confirmed fix needed the
   split. This is follow-up work.
7. Rendered (non-headless) verification has not been done. No person has looked at the panel on a screen.
8. Godot checks for the whole Stage 44 set need a Godot 4.7.2 binary in a new sandbox. Those checks are in section 7.2.

## 10. Repository state

- Branch `arena/00cdea0e-naija`, HEAD `fa9c0d6` (the Stage 43 handoff commit, also the remote tip; see section 2 for the
  repair after the restart). Stage 44 changes are uncommitted until the commit step recorded in the final report.
- Modified, uncommitted:
  - `docs/DEVELOPMENT_STATUS.md`, `docs/PHASE_1_FEATURE_INVENTORY.md`
  - `services/world-api/src/multiplayer/persistence.ts` (section 5.4 fence)
  - `game/scripts/prototype_game.gd` (`rate_limited` routing, section 6.1)
  - `game/scripts/prototype_game.gd`, `game/scripts/services/server_request_tracker.gd`, `game/scripts/ui/prototype_ui.gd`
  - `services/world-api/src/businesses/service.ts`, `services/world-api/src/persistence/writer-lock.ts`
  - `services/world-api/test/file-writer-lock-races.test.mjs`
- Untracked, new:
  - `docs/STAGE_44_BUSINESS_VERIFICATION.md` (this document)
  - `game/tests/business_buyer_ui_headless.gd`, `business_lifecycle_ui_headless.gd`, `business_owner_finish_ui_headless.gd`,
    `business_owner_ops_ui_headless.gd`, `business_rate_limit_ui_headless.gd`, `business_request_errors_headless.gd`,
    `business_ui_driver.gd`, `business_ui_flow.gd`, `business_view_ui_headless.gd`, `business_remaining_ui_headless.gd`
  - `services/world-api/test/business-errors-stage44.test.mjs`, `client-business-errors-stage44.test.mjs`
  - `services/world-api/test/support/writer-lock-holder-child.mjs`
  - `tools/business-fixture/` (the directory is untracked as a whole: `provision.mjs` and `run-business-ui.sh`)
- Untracked, generated by Godot's import: 53 `game/**/*.gd.uid` files. Not deleted. Decide whether to commit them or
  ignore them.
