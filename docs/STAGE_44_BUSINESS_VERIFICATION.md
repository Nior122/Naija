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

**Provenance.** Each result below is labelled by where it came from:
- **Verification pass (2026-10-14, sections 7.4 and 7.6):** backend, PostgreSQL, contract, lint, and parse checks, and
  stub runs of the Godot runner, at `79932db` plus the files this pass committed. No Godot was run. Section 7.5 is the
  runbook for a machine with Godot.
- **Inherited, pre-restart (2026-10-13, section 7.2):** Godot 4.7.2 runs, built from source in an earlier sandbox. They
  have **not** been re-run. Rows marked (U) come from those runs. They predate the career-panel change in `79932db`.
- **Inherited, backend only:** socket and unit tests that are part of the suites in section 7.4. They show server
  behaviour, not client behaviour.

| Area | Result |
|---|---|
| Godot check runner (`tools/godot/run-godot-checks.sh`) and the save backup | **Written and tested with stubs only** (17 contract and stub tests, section 7.6). It has **not** been run with Godot. Its path through Godot is unverified. |
| Career-panel recovery after a refused `career.action` (new in `79932db`) | **Server side verified in this run** (socket tests on the file and PostgreSQL backends): the refusal is a generic `error` with `rate_limited` and the same request ID, and the next career action after the window resets is answered with `career.result`. **Client side not verified in Godot.** The source-contract test passes; the scenario `career_rate_limit_ui_headless.gd` is written and not executed (section 7.4). |
| Stage 44 business UI phases re-run (2026-10-14) | **Not re-run.** No Godot binary (section 7.4). The (U) rows below are inherited from 2026-10-13. |
| Shutdown lock loss (`WorldFileLockLostError`) | Confirmed and fixed. Regression tests fail before the fix and pass after it. The holder's exit behaviour is now tested (section 5.1). |
| Business error wording | Confirmed and fixed (section 5.2). |
| Generic `error` replies not reaching the business panel | Confirmed and fixed. The UI test fails before the fix (section 5.3). |
| Business creation, goods and service listing, restock, buyer purchases (goods and service), refusals of over-stock and over-funds purchases, hiring, salary, dismissal, branch opening, ownership transfer, closure refused with a balance, withdrawal, closure | **Verified in the Godot panel (U), inherited from 2026-10-13**, with server readback, on the isolated fixture (section 3; not re-run). |
| Command-limit refusal through the panel (business) | Verified (U), inherited from 2026-10-13. Fails before the fix, passes after it. Not re-run; it predates the career change. |
| Stranger and employee see no owner controls | Verified (U, inherited from 2026-10-13) for the controls that the panel shows. The server's refusal of a stranger's changing action is backend-only (socket tests), because the panel offers no such control to a stranger. |
| Restart keeps balance, stock, employment, ownership | Backend socket read-back only. Not driven through the UI. |
| Goods price change, out-of-range price refusal, deactivate and reactivate, five branches and a sixth refused, transfer refusals to self and to an unknown character, closure refused with a balance, withdrawal, closure, and "Open branch" on a closed business | **Verified in the Godot panel (U), inherited from 2026-10-13**, 67 checks, `remaining` phase, with server readback (section 3, items 4, 10a, 11b, 12, 13, 13b). |
| Career conflict, goods price ceiling and service price bounds, transfer refusals other than self and unknown, branch location rules | Backend and socket tests only. Not driven through the UI. |
| Shutdown save window (Stage 43 section 8.3) | **Partly fixed.** A released file-backend store could still write and replace another writer's world (reproduced, then fixed). It is now fenced and refuses with `world_file_lock_lost`, with a regression test (section 5.4). The production shutdown paths tested all saved before exit. The bounded wait in `shutdown()` is not made (section 6.2). |
| WebSocket session handling and the command limit | Finding recorded. `rate_limited` is notify-only (decided, section 6.1). A career action refused by the limit now reaches the career panel by its own request ID, so the panel is not left busy (section 6.1). Neither change has been run in Godot (section 7.3). |

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
  The wiring is covered by a source-contract test (`client-business-errors-stage44.test.mjs`). It has **not been run
  in Godot** since the change (section 7.2).
- **Defect found in that change and fixed (this pass): the career panel stayed busy.** The career panel sets `_busy`
  when it sends `career.action`, and clears it only on `career.result`, `career.error` or a transport error. A refused
  `career.action` is answered with a generic `error` carrying the request ID, not `career.error`. With notify-only
  routing, nothing cleared `_busy`, so the panel stayed busy, and `update_profile` (server profile updates) was
  suppressed until the panel was reopened. Server behaviour was checked against `world-engine.ts`: a refused changing
  career action gets `error` with `rate_limited` and the same request ID. The fix is client-side only:
  - `prototype_game.gd` keeps the request ID of the one in-flight career action (`_career_request_id`), sent through
    `multiplayer_client.new_request_id()` and `send_command(..., request_id)`.
  - A generic `error` whose request ID matches goes to the career panel (`show_career_transport_error`). The panel
    clears `_busy` and shows the server's message. The toast still shows. A refusal with any other ID goes only to the
    trackers, as before, so the rule stays notify-only for every other family.
  - `career.result` and `career.error` clear the stored ID only when it is theirs.
  - Tests: `services/world-api/test/career-errors-stage44.test.mjs` (socket, file and PostgreSQL: a career action
    refused by the command limit gets `error`, `rate_limited`, and its ID, and no `career.error`), and
    `services/world-api/test/client-career-routing-stage44.test.mjs` (source contract: matched-ID routing, clearing,
    the notify-only `rate_limited` rule, and the busy flag). The Godot panel behaviour is **not** verified here: no
    Godot run was possible (section 7.3).

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

- **Runner.** `tools/business-fixture/run-business-ui.sh` replaces the `/tmp` scripts. It refuses to start if the port
  is busy, and it validates `PORT`. It copies the fixture to `WORK_DIR` and never writes the source file. It writes the
  role configs with mode 0600 and never prints tokens. It stops only a server that it started (a server that was already
  running is left alone), on EXIT, INT, and TERM. Both runners create `WORK_DIR` with mode 700 only when it does not
  exist, and they make their files private with `umask 077`. An existing directory keeps its permissions. The Godot
  runner stops starting new checks on INT or TERM (section 7.5, Step 4). Each optional phase (`lifecycle`, `rate_limit`, `remaining`,
  `career_rate_limit`) needs a fresh owner balance, so each one gets its own copy. `tools/godot/run-godot-checks.sh`
  runs every phase in that way.
- **Local saves (new in this pass).** The headless tests use the developer's real save slot. `ui_flow_headless.gd`
  removes `user://naija-stage1-save.json` at line 185 if it exists. `load_confirmation_headless.gd` and `return_path.gd`
  also use that real file. `domain_smoke.gd` writes its own file, `user://naija-stage1-test-save.json`, not the real
  save. The game's own `save_service.gd` uses the real file. The guard in
  `game/tests/support/save_slot_guard.gd` backs up and restores the slot, but only within one run. The runner now
  copies every `naija-*` file in Godot's user data directory into `WORK_DIR` before any Godot test runs, records
  SHA-256 values, and reports `FAIL` if a file changed or disappeared. It does not restore a file itself. The
  directory is found by asking Godot (the project name is `Naija: One World`), or by `GODOT_USER_DIR`. Online UI phases
  do not write the local save (`_save_game` returns early online), and the online tests set
  `NAIJA_MULTIPLAYER_SESSION_PATH`, so they leave the developer's session file alone. Headless runs do not set it, so
  the runner backs up `naija-multiplayer.cfg` (the session file, a `naija-*` name) with the same pattern as the saves.
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

### 7.2 Before the restart (Godot and UI results) — inherited, not re-run

**Provenance:** these runs were made on 2026-10-13 (UTC) with a Godot 4.7.2 build from source in an earlier sandbox, which
no longer exists. They were **not re-run** on 2026-10-14 and are not evidence about the current code. The career-panel
change in `79932db` is not covered by them.

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

### 7.3 This pass (career routing fix; backend and contract only)

Run after the career-panel fix. The Godot checks were **not** run in this pass. The sandbox has no Godot binary, and a
Godot build from source needs X11, GL, ALSA and scons, which are not installed. apt is not reachable. The Godot
release download host is also blocked from this sandbox. Nothing in this table is a Godot result.

| Command | Result |
|---|---|
| `npm ci --include=dev` (repository root, which holds the lockfile) | exit 0 |
| `npm run lint` (repository root) | exit 0 |
| `npm run build` (`services/world-api`) | exit 0 |
| `NAIJA_ENV=test node --test test/*.test.mjs` (file backend) | exit 0: **1537 tests, 1483 pass, 0 fail, 54 skipped** (PostgreSQL-only) |
| `DATABASE_URL=postgres://naija@127.0.0.1:5432/naija_test?sslmode=disable DB_SSL=false NAIJA_ALLOW_DB_TESTS=true npm test` (`services/world-api`, PostgreSQL 18.4 from `@embedded-postgres/linux-x64@18.4.0-beta.17`, installed outside the repository in `/tmp/pgrun`) | exit 0: **1838 tests, 1834 pass, 0 fail, 4 skipped** (the four are the TLS live tests, which need a TLS-enabled server) |
| `node --test test/client-career-routing-stage44.test.mjs test/client-business-errors-stage44.test.mjs` | 13 tests, 13 pass, 0 fail |
| `node --test test/career-errors-stage44.test.mjs` (file backend) | 1 test, 1 pass |
| `gdparse` on the changed GDScript files | exit 0 |
| `gdlint` on `prototype_game.gd` and `multiplayer_client.gd` | 14 and 25 findings, the same as `HEAD`. The new lines add none. |
| `gdformat --check` on the same files | reports both files as differing, as `HEAD` does. Not reformatted, to avoid churn in unrelated lines. |

The four skipped TLS tests and the Godot checks in section 7.2 remain unverified in this pass.

### 7.4 Verification run, 2026-10-14 (repository at `79932db`; no Godot run)

**Provenance:** this run. No Godot binary was available, so **no Godot check was run in this pass**. Every row below is
a backend, contract, parse, or lint result. None of them shows that the Godot client works.

#### Godot: how it was looked for, and why it is still missing

| Option | Result |
|---|---|
| A Godot executable already on the system | None. `which godot`, `godot4`, and a filesystem search outside the repository found none. |
| Official Linux 4.7.2 build | The asset is `Godot_v4.7.2-stable_linux.x86_64.zip` (77,860,424 bytes). `github.com` answers, then redirects to `objects.githubusercontent.com`, which gets no response from this sandbox (curl 000). That host is not on the sandbox's allowed-host list. **This is the exact access limitation.** GitHub's API gives the asset's digest as `sha256:cadd3204e728a35d3f13adb7fd0d7902636b79f6b95c40c265eb73b6c35329e4`. The file could not be downloaded, so nothing was verified against it. |
| Other trustworthy distribution | `downloads.godotengine.org`: no response (000). npm: `@ringozz/godot` ships Node-API bindings, with optional packages only for Windows, macOS, and web, so no Linux executable. PyPI: no Godot executable package found (`godot-bin`, `godot-engine`, `godot4`, `godot-linux`, `godotengine`). No unknown binary was run. |
| Another installed environment that can run the project | None. Docker is not installed. |
| Source build | Not attempted. This is a 2-core, 3 GB machine, and X11, GL, ALSA, and scons are missing (section 7.2). apt is not reachable. |
| Existing CI runner | `.github/workflows/ci.yml` has no Godot job. A Godot job needs a workflow change, which needs a push. None was made. |

**Prepared for a machine that has Godot 4.7.2 (not run here):**
- `tools/godot/run-godot-checks.sh` checks the binary's version (it must be `4.7.2.stable`), parses the GDScript,
  runs the headless scripts, and runs the server-backed UI phases on fresh isolated copies of the fixture. Its guard
  paths are tested (below). Its Godot paths are **not** tested.
- `game/tests/career_rate_limit_ui_headless.gd` is the career-panel scenario. It has been **parse-checked only**.
- `tools/business-fixture/run-business-ui.sh` has a new phase, `career_rate_limit`.
- Steps for that machine: download the official zip from the 4.7.2-stable release page, confirm its SHA-256 against the
  API digest above, extract it, set `GODOT_BIN` to the binary, set `FIXTURE_WORLD` and `SESSIONS` (made by
  `tools/business-fixture/provision.mjs`), and run `tools/godot/run-godot-checks.sh`. Logs go to `WORK_DIR`.
- The save-slot tests (`ui_flow_headless`, `load_confirmation_headless`) use the local save slot. They back it up and
  restore it through `game/tests/support/save_slot_guard.gd`. Back up the Godot user data directory first anyway.

#### Commands and results (this run)

| Command | Result |
|---|---|
| `git` baseline before any change | branch `arena/00cdea0e-naija`, HEAD `79932db`, equal to `origin/arena/00cdea0e-naija`; no tracked changes; 53 untracked `.gd.uid` files |
| `npm run lint` (repository root) | exit 0 |
| `NAIJA_ENV=test node --test test/*.test.mjs` (`services/world-api`, file backend) | exit 0: **1543 tests, 1489 pass, 0 fail, 54 skipped** (PostgreSQL-only) |
| `DATABASE_URL=postgres://naija@127.0.0.1:5432/naija_test?sslmode=disable DB_SSL=false NAIJA_ALLOW_DB_TESTS=true npm test` (`services/world-api`; PostgreSQL 18.4 from `@embedded-postgres/linux-x64@18.4.0-beta.17`, cluster in `/tmp/pgrun`) | exit 0: **1844 tests, 1840 pass, 0 fail, 4 skipped** (the four are TLS live tests) |
| `node --test test/client-career-routing-stage44.test.mjs test/client-business-errors-stage44.test.mjs` | 13 pass, 0 fail |
| `node --test test/career-errors-stage44.test.mjs` (file and PostgreSQL, including the new recovery step) | 2 pass, 0 fail (one per backend) |
| `node --test test/godot-checks-runner-stage44.test.mjs` | 6 pass, 0 fail |
| `gdparse` on all 62 GDScript files on disk | exit 0 |
| `gdlint` on `career_rate_limit_ui_headless.gd` | no problems |
| `gdlint` on `prototype_game.gd` and `multiplayer_client.gd`, compared with `HEAD` | same count of `Error:` lines as `HEAD` (14 and 11). No new findings. |
| `bash -n` on `run-godot-checks.sh` and `run-business-ui.sh` | exit 0 |
| `run-godot-checks.sh` with `GODOT_BIN` unset | exit 3, and it says where to get Godot. Tested. |
| `run-godot-checks.sh` with a binary whose version is `4.6.0.stable` | exit 3, and no check runs. Tested with a stub that only prints a version line. |
| `run-godot-checks.sh` with a stub that reports `4.7.2.stable` and fails everything else | exit 1: 0 passed, 15 failed, 2 skipped. No check is reported as passed. Tested. |
| Any Godot headless script, the business UI phases, or the career scenario | **NOT RUN** (no Godot) |

Fail count: 0 in every backend and contract run. Skip count: 54 (file) and 4 (PostgreSQL), as listed. The Godot checks
are not counted, because they did not run.

#### Career-panel recovery scenario (items 1–10), status by item

| # | Item | Status in this run |
|---|---|---|
| 1 | Isolated session and test character | Scripted in `career_rate_limit_ui_headless.gd`. **Not run.** |
| 2 | Open the career interface | Scripted (the Careers menu button). **Not run.** |
| 3 | Submit a career action | Scripted (Search presses, each waiting for its answer). **Not run.** |
| 4 | Cause the command to be refused | Server side: **verified** by `career-errors-stage44.test.mjs` on the file and PostgreSQL backends (the 21st command in the window is refused). Client side: **not run.** |
| 5 | Refusal carries the original request ID | Server side: **verified** (the socket test compares `requestId`). Client side: the source-contract test checks the matching, and the scenario checks that the stored ID is cleared. **Not run in Godot.** |
| 6 | Panel receives the matching refusal and clears busy | Source contract **passes**. The scenario checks it. **Not run.** |
| 7 | Global toast remains visible | `ui.notify` is kept (source contract). The scenario checks the HUD message. **Not run.** |
| 8 | Later profile updates and career interactions still work | Server side: **verified**. A career search after the 10-second window reset is answered with `career.result` (socket test, both backends). Client side (`update_profile` after clearing busy): **not run.** |
| 9 | Unrelated business, housing, and NPC refusals do not reach the career panel | Source contract: the `error` branch routes only the matching ID to the career panel (**passes**). The scenario checks a synthetic refusal with another ID, which is not a socket refusal. **Not run.** A real business refusal is covered only by `business_rate_limit_ui_headless.gd`, which does not look at the career panel. Housing and NPC refusals are not covered. |
| 10 | `character_deceased` keeps the career route | Source contract **passes** (`_on_online_error`). Not covered by any UI test: it needs a deceased character. **Not run.** |

No Godot failure was observed, because no Godot run happened. No defect was confirmed in this pass.

#### Stage 44 business UI reruns (the list in the task), status

No business UI phase was re-run on 2026-10-14. The runner is ready (`tools/business-fixture/run-business-ui.sh`, and the
wrapper `tools/godot/run-godot-checks.sh`). The existing (U) results are inherited from 2026-10-13 (sections 3 and 7.2),
and the rows of section 1 say so. The items that have only backend or socket coverage are listed there.

#### Not verified in this pass

- Every Godot check: headless scripts, the business UI phases, `online_businesses_headless`, and the career scenario.
- Rendered appearance and layout: no rendered window was used, and none would be used by the headless tests.
- The PostgreSQL released-store path (section 6.2).
- Shutdown semantics, fixture cleanup under failure, and the WebSocket burst behaviour in a live Godot session. They
  were checked earlier (sections 5 and 6), and were not probed again here.

### 7.5 Runbook: Godot checks on a machine with Godot 4.7.2

**Status: not run.** No Godot binary was available in the Stage 44 sandbox, so nothing in this section has been
executed. It is written so that a person with Godot can reproduce the checks, and record each result against the
evidence category it belongs to.

**Evidence categories.** Keep these apart in any record. A result in one category is not evidence for another.

| Code | Category | What it shows | What it does not show |
|---|---|---|---|
| B | Backend tests (`node --test`, file and PostgreSQL) | Server rules, atomicity, ledger, authority | Anything the Godot client does |
| H | Headless Godot logic and integration (`--headless --script`, direct calls) | Client logic: trackers, routing, parsing, the save guard | That a panel button works |
| U | Headless UI with simulated input (real scenes; buttons activated by focus and `ui_accept`; server state read back from the world file) | The panel's controls drive the server and show its replies | Layout, rendering, anything a person sees |
| P | Live server probe (a script sends commands to a running server) | The server's replies to a sequence of commands | The client |
| R | Rendered, real UI, a person at a screen | (none recorded) | (none recorded) |

Only U and R show that a business operation can be used from the game's panel. As of this record, no R check exists.

**Step 1. Get Godot 4.7.2-stable (Linux x86_64).**

- Release page: `https://github.com/godotengine/godot/releases/tag/4.7.2-stable`. Asset:
  `Godot_v4.7.2-stable_linux.x86_64.zip` (77,860,424 bytes).
- The GitHub API reported this digest in the sandbox (section 7.4): `sha256:cadd3204e728a35d3f13adb7fd0d7902636b79f6b95c40c265eb73b6c35329e4`.
  That digest was read from the API, not from the file. Check it yourself against the release page, then run
  `sha256sum Godot_v4.7.2-stable_linux.x86_64.zip`. Stop if they differ.
- `unzip` the file, `chmod +x Godot_v4.7.2-stable_linux.x86_64`, and set
  `GODOT_BIN=/path/to/Godot_v4.7.2-stable_linux.x86_64`.
- `"$GODOT_BIN" --version` must start with `4.7.2.stable`. The runner refuses any other version and runs nothing.

**Step 2. Tools.**

- Node 22 (`engines`: `>=22.13.0 <23`). From the repository root: `npm ci`. Then
  `(cd services/world-api && npm run build)`.
- gdtoolkit 4.x, for the parse step: `python3 -m venv /tmp/gdvenv && /tmp/gdvenv/bin/pip install 'gdtoolkit==4.*'`.
  The sandbox used gdtoolkit 4.5.0. Put `gdparse` on `PATH`, or set `GDPARSE=/tmp/gdvenv/bin/gdparse`. If it is not
  found, the runner reports `SKIP gdparse`, and the run is not complete.

**Step 3. Fixture world and sessions.** Use files outside the repository. Tokens in the sessions file are secrets.

1. Start a server on a new world file, on port 3000:
   `NAIJA_ENV=development PERSISTENCE_BACKEND=file DATA_FILE=/tmp/naija-fixture/world.json PORT=3000 node services/world-api/dist/index.js`
2. With that server running, create the four roles over the socket:
   `node tools/business-fixture/provision.mjs create --url ws://127.0.0.1:3000/ws --out /tmp/naija-fixture/sessions.json`
3. Stop the server (Ctrl-C). Wait for `Multiplayer world state saved; API stopped.` in its output.
4. Fund the roles. The server must be stopped, and the command refuses to run while a server is listening:
   `node tools/business-fixture/provision.mjs fund --data /tmp/naija-fixture/world.json --sessions /tmp/naija-fixture/sessions.json`
5. Keep `world.json` unchanged. The runner copies it for every phase and never writes the original.

**Step 4. Run the checks.**

```
GODOT_BIN=/path/to/Godot_v4.7.2-stable_linux.x86_64 \
FIXTURE_WORLD=/tmp/naija-fixture/world.json \
SESSIONS=/tmp/naija-fixture/sessions.json \
WORK_DIR=/tmp/naija-godot-checks PORT=3200 \
tools/godot/run-godot-checks.sh
```

The runner does the following, in order:

- checks that `GODOT_BIN`, `PORT`, `WORK_DIR`, and every required file are present (nothing runs if one is not);
- checks the Godot version;
- parses every `game/**/*.gd` file on disk (`gdparse`, parse only, not lint);
- **backs up the local `naija-*` saves** before any Godot test runs (section 6.3). It prints the folder that holds the
  backup. The originals are not moved or deleted;
- runs the 14 headless scripts that need no server (the 13 from Stage 44, plus `new_game_confirmation_headless`, added with the new-life save confirmation), plus `save_restart` as two processes (write, then read);
- runs the server-backed UI phases on a fresh copy of the fixture for each optional phase: the default six-phase
  chain, `career_rate_limit`, `lifecycle`, `rate_limit`, and `remaining`;
- checks again that the backed-up saves are unchanged, and reports `FAIL` if any changed.

Expected for a complete pass: exit 0, with `SUMMARY: 23 passed, 0 failed, 0 skipped`. That is one gdparse, one save
protection, 15 headless, five UI runs, and one save check. The save check needs at least one `naija-*` file to exist
before the run. On a machine where none exists yet, the runner prints a `NOTE` in place of the save check and the
expected count is 22, with exit 0 (the NOTE is not a skip). Exit 2 means the run is incomplete (some checks were skipped). Exit 1 means at least one check
failed. Exit 3 means the run did not start. Exit 130 means it was interrupted: a check that had not started is not
run, the check that was running is counted as a `FAIL`, and the save check still runs.

The runner also prints a `NOTE` for any `naija-*` file that exists after the run but did not exist before it. A note
is not counted. Check the log that wrote the file, because the tests normally remove their own files.

Each `PASS` means the process exited 0 and its log had no `SCRIPT ERROR`, `Parse Error`, or `Compile Error`. Some
headless scripts print no `PASS` line, so read the log for the detail. Each UI phase prints its own `PASS:` lines
in `WORK_DIR/ui-<phase>/phase_<name>.log`. Count those lines from the logs and record the number. A count alone is not a business result: read
what each check asserts.

**Step 5. The online smoke test (not in the runner).** `online_businesses_headless.gd` needs a server at the client's
default URL, `ws://127.0.0.1:3000/ws`, and it creates a new character. It keeps its session in its own file,
`user://naija-online-businesses-test.cfg`, in Godot's user data directory. It deletes that file before it starts, and it
does not read or change the developer's `naija-multiplayer.cfg`. It sets `NAIJA_MULTIPLAYER_SESSION_PATH` itself, so
setting that variable in the command has no effect. Give it a fresh world:

1. Start a server on port 3000 with a new `DATA_FILE` under `WORK_DIR`, as in Step 3.1.
2. `"$GODOT_BIN" --headless --path game --script res://tests/online_businesses_headless.gd`
3. Stop the server. Record the exit code and the PASS count.

The earlier count (section 7.2, not re-run) was 11 PASS.

**Step 6. Record the result.** For each command, record: the exact command, the Godot version line, the SHA-256 of the
binary, the exit code, the `SUMMARY` line, the PASS count for each UI phase, and the log folder. Keep the logs. Do not
edit an expected count to match a result. If the save check fails, restore each changed file from the backup folder
(`cp -p <backup>/<name> <save dir>/<name>`) before doing anything else. The script prints the exact paths.

**What this runbook does not check, even when it passes:**

- Rendered layout and appearance (R). No person has seen the panel on a screen.
- The career-conflict refusal, the goods price ceiling and the service price bounds at their boundary values, transfer
  refusals to a manager, an employee, a child, a deceased, or an unbanked recipient, a stranger's refused changing
  action, and restart through the UI. Backend or socket tests cover some of these only (section 3).
- `character_deceased` routing in the career panel. A source-contract test covers the wiring only.
- The bounded wait in `shutdown()` (section 6.2), and the PostgreSQL released-store path.
- Anything that needs a deceased or a manager character, or a second live client.
- Engine `ERROR:` lines. The log scan fails a run only on `SCRIPT ERROR`, `Parse Error`, and `Compile Error`. Two
  tests print expected engine errors (`Parse JSON failed`, section 6.4), so an `ERROR:` line alone is not a failure.
  Read the logs for those.

### 7.6 Final pass, 2026-10-14 (runner rewrite and backend re-run; no Godot run)

**Provenance:** this pass. Godot was **not** run. Every result below is a backend, contract, parse, lint, or stub result.
The stub is a shell script that prints a version line and a fixed answer. It is not Godot, and it can never make a
Godot check pass.

| Command | Result |
|---|---|
| `npm run build` (`services/world-api`) | exit 0 |
| `env -u DATABASE_URL NAIJA_ENV=test node --test test/*.test.mjs` (`services/world-api`, file backend) | exit 0: **1554 tests, 1500 pass, 0 fail, 54 skipped** (PostgreSQL-only) |
| `DATABASE_URL=postgres://naija@127.0.0.1:5432/naija_test?sslmode=disable DB_SSL=false NAIJA_ENV=test NAIJA_ALLOW_DB_TESTS=true node --test test/*.test.mjs` (`services/world-api`; PostgreSQL 18.4 from `@embedded-postgres/linux-x64@18.4.0-beta.17`, cluster in `/tmp/pgrun`) | exit 0: **1855 tests, 1851 pass, 0 fail, 4 skipped** (the four are TLS live tests) |
| `npm run lint` (repository root; `eslint services/world-api/src`) | exit 0 (note: `npm test` does not run lint) |
| `node --test test/client-*.test.mjs test/business*.test.mjs test/godot-checks-runner-stage44.test.mjs` | 213 tests, 213 pass, 0 fail |
| `node --test test/godot-checks-runner-stage44.test.mjs` | 17 tests, 17 pass, 0 fail |
| `gdparse` on all 63 `game/**/*.gd` files on disk | exit 0 |
| `gdlint` on `career_rate_limit_ui_headless.gd` and `user_data_dir_headless.gd` | no problems |
| `bash -n` on `tools/godot/run-godot-checks.sh` and `tools/business-fixture/run-business-ui.sh` | exit 0 |
| `tools/godot/run-godot-checks.sh` with a stub binary that reports `4.7.2.stable` and fails every Godot call (`STUB_MODE=fail`) | exit 1: 2 passed (save protection, save check), 15 failed, 2 skipped. The backup folder holds the `naija-*` files, byte-identical. |
| Same runner, stub that writes to a save during a test (`savewrite`) | exit 1: `FAIL save check`, with the restore path printed. The runner does not restore by itself. |
| Same runner, stub that prints `SCRIPT ERROR` and exits 0 (`scripterror`) | exit 1: `FAIL domain_smoke (exit 0, but its log has a script error)` |
| Same runner, stub that passes everything it ran (`clean`) with no fixture | exit 2 (`Incomplete`), never 0 |
| Runner with a missing required file, a bad `PORT`, a wrong version, `GODOT_BIN` unset | exit 3 each, nothing run |
| Run of `tools/business-fixture/run-business-ui.sh` with a bad `PORT` | exit 3, nothing started |
| Any Godot headless script, UI phase, `online_businesses_headless`, or the career scenario | **NOT RUN** (no Godot 4.7.2 binary) |

Earlier logs, for the record. `/tmp/v3-backend-file.log` (file suite 1543 / 1489 / 0 / 54, exit 0) and
`/tmp/v3-backend-pg.log` (PostgreSQL 1844 / 1840 / 0 / 4, exit 0) were read. They were made before the runner test was
rewritten, so the final runs above supersede them.

**What changed in this pass (found by auditing the runner before it was committed):**

1. Optional business phases shared one copy of the world. `remaining` asserts a fresh-world cash balance, so it
   failed after another phase had run. Each optional phase now gets its own copy (`ui_run`).
2. The gdparse list came from `git ls-files`, which skips untracked files. It now uses `find` on disk.
3. Missing required files were found only when a test failed. They are now checked before any test runs.
4. A script that printed `SCRIPT ERROR` and exited 0 counted as a pass. The runner and the business runner now scan
   each log for `SCRIPT ERROR`, `Parse Error`, and `Compile Error`.
5. `PORT` was not checked. It must be a number from 1024 to 65535.
6. A relative `WORK_DIR` broke the server (it runs from the repository root). Both runners make it absolute.
7. The business runner trapped only EXIT. It now traps INT and TERM too, and the trap is set before the server starts.
8. A run with skipped checks exited 0. It now exits 2. A run that did not start exits 3.
9. The local saves were not protected. The runner now copies the `naija-*` files before any Godot test, and checks
   their SHA-256 afterwards (section 6.3).
10. Godot's user data directory was hard-coded in no place. It is found by asking Godot (`user_data_dir_headless.gd`),
    or set by `GODOT_USER_DIR`.
11. The business runner stopped any server on the port. It now stops only a server that was not running before this run
    and that has `PORT` set to this run's port.
12. The business runner's wrapper log was cut to 20 PASS lines. It now keeps every line.

**Not verified in this pass:** every Godot check, including `user_data_dir_headless.gd` (never run, so the save
protection has not been run against a real Godot user data directory). Section 7.5 gives the steps.

### 7.7 Review of the pushed changes (`115edfb`, `641a2b0`), 2026-10-14; no Godot run

**Provenance:** a review of the two commits pushed after `79932db`, followed by fixes for confirmed defects. Godot was
**not** run. Every result below is CI, backend, contract, parse, lint, or stub-harness output. The stub harness runs
shell scripts with a fake Godot that sleeps or exits. It shows the runner's own behaviour, not the game's.

**CI.** Run `38490105054` (event `push`, head `641a2b0`, workflow "Foundation checks") completed with conclusion
`success`. Its jobs: "World API build, lint, and tests" = `success`, and "World API live PostgreSQL tests (disposable
service)" = `success`. The job logs could not be downloaded from the sandbox (the log host returned EOF), so the test
counts inside CI are not known from CI. No CI run was found for `115edfb` as its own head. The run for `641a2b0` is the
one that covers both commits.

**Findings and fixes** (each has a regression test in `services/world-api/test/godot-checks-runner-stage44.test.mjs`):

| # | Finding | How it was shown | Fix |
|---|---|---|---|
| 1 | Ctrl-C to the Godot runner did not stop it. Every check still started, and a check that was interrupted but exited 0 was recorded as `PASS`. | Stub harness: SIGINT to the run's process group. Before the fix: all 15 headless checks started and the run exited 2. | The runner traps INT and TERM and sets a flag. No new check starts, the interrupted check is a `FAIL`, the save check still runs, and the exit code is 130. Test: "Ctrl-C to the run's process group". |
| 2 | Both runners ran `chmod 700` on any `WORK_DIR`, including one that already existed. `WORK_DIR=$HOME` would make the home directory private. | Stub run with an existing 755 directory: 700 afterwards. | Only a directory the runner creates is set to 700. Both runners use `umask 077` for the files they write. Tests: "a WORK_DIR that already exists keeps its permissions" and the static check for both runners. |
| 3 | On a machine with no `naija-*` files yet, the save check was silently missing. The count was 16 with no save-check line. A `naija-*` file a test left behind was not reported. | Stub run on an empty user-data directory. | An explicit note replaces the missing line (not counted). Any `naija-*` file that exists after the run and not before it is listed in a note. Tests: "no naija-* files before the run" and "a naija-* file that a run leaves behind". |
| 4 | Runbook step 5 told the reader to set `NAIJA_MULTIPLAYER_SESSION_PATH` to isolate the online test. `online_businesses_headless.gd` sets that variable itself, to `user://naija-online-businesses-test.cfg`, and deletes that file before it starts. The instruction did nothing. | Read `game/tests/online_businesses_headless.gd` (lines 22, 104–107). | The runbook now names the file the test uses and says the variable is overridden. Test: the runbook does not contain the inert command. |
| 5 | Section 6.3 said `domain_smoke.gd` used the real Stage 1 save. It uses `user://naija-stage1-test-save.json`. | Grep of the test files. | Wording corrected. The file is still a `naija-*` file, so the runner backs it up. |
| 6 | The runner header said it checks "every required script", but the business UI scripts it runs were not in the required list. A missing one was found only as a phase failure. | Read the required list. | The seven `business_*_ui_headless.gd` files and `save_slot_guard.gd` are in the list. |
| 7 | (Checked, no change.) `push_error` in the tests is not in the log scan, so a test that used it and still exited 0 would pass. | Read each call and the lines after it. Each one is followed by a non-zero `quit` or a failing return. | None needed. The exit code catches these. |
| 8 | (Checked, no change.) shellcheck (`shellcheck-py` 0.11.0, from PyPI, in `/tmp`) reports SC2155 on three `export VAR="$(node ...)"` lines in `run-business-ui.sh`. | shellcheck output. | Not changed. The role-config step earlier in the same script reads the same sessions file and exits 4 on failure. A missing `characterId` would reach Godot as the string `undefined`, and that fails the phase. The Godot runner has no shellcheck warnings. |

**Checked and found correct:**

- The business runner's Ctrl-C path: with a valid world, the server it started was stopped, the port was free afterwards,
  the run exited 130, and only one Godot call started.
- The fresh-copy rule: each optional UI phase gets its own copy (`ui_run`), and the default run shares one copy for its
  six chained phases, as designed.
- Port and work-directory validation: `PORT` must be 1024–65535; the business runner refuses a bad `PORT` before it
  starts anything.
- Exit codes: 0 only when nothing failed or was skipped; 2 for skips; 1 for failures; 3 when nothing ran; 130 for an
  interrupt.
- Godot user-data discovery and the save backup, including a directory name with a colon and a space
  (`Naija: One World`).
- Every identifier that `career_rate_limit_ui_headless.gd` uses exists in the source (`_on_online_message`,
  `_career_request_id`, `_busy`, `_notice`, `_hud`, `_career_panel`, `mode_2d_instance`, `playing`, `notify`). The scenario
  itself has not run.
- `game/scripts` is unchanged since `79932db`, so the two commits change tests, tools, and docs only.

**Commands and results (final working tree, after the fixes above):**

| Command | Result |
|---|---|
| `bash -n tools/godot/run-godot-checks.sh`, `bash -n tools/business-fixture/run-business-ui.sh` | exit 0, exit 0 |
| `shellcheck -S warning` on both runners (shellcheck-py 0.11.0) | Godot runner: no findings. Business runner: 3 SC2155 warnings (finding 8), exit 1 |
| `NAIJA_ENV=test node --test test/godot-checks-runner-stage44.test.mjs` | 23 tests, 23 pass, 0 fail (17 before this review; 6 added) |
| File backend suite: `env -u DATABASE_URL NAIJA_ENV=test node --test test/*.test.mjs` (`services/world-api`) | exit 0: **1560 tests, 1506 pass, 0 fail, 54 skipped** (PostgreSQL-only) |
| PostgreSQL suite: `DATABASE_URL=postgres://naija@127.0.0.1:5432/naija_test?sslmode=disable DB_SSL=false NAIJA_ENV=test NAIJA_ALLOW_DB_TESTS=true node --test test/*.test.mjs` (PostgreSQL 18.4, `/tmp/pgrun`) | exit 0: **1861 tests, 1857 pass, 0 fail, 4 skipped** (TLS live tests) |
| Client, business, runner, and career contract tests: `node --test test/client-*.test.mjs test/business*.test.mjs test/godot-checks-runner-stage44.test.mjs test/career-errors-stage44.test.mjs` | **220 tests, 220 pass, 0 fail, 0 skipped** |
| `npm run lint` (repository root) | exit 0 |
| `gdparse` on all 63 `game/**/*.gd` files on disk | exit 0 |
| `gdlint` on `career_rate_limit_ui_headless.gd` and `user_data_dir_headless.gd` | no problems |
| Stub harness: Ctrl-C to the Godot runner (before the fix: 15 checks started; after: 1) | exit 130, one check started, the rest skipped |
| Stub harness: Ctrl-C to the business runner with a valid world | exit 130, server stopped, port free, no leftover server |
| Stub harness: fresh user-data directory | exit 2; `NOTE` in place of the save check; 16 passed |
| Stub harness: existing `WORK_DIR` at mode 755 | still 755 after the run; exit 2 |
| Stub harness, full path: `GODOT_BIN` = a stub that exits 0 for every call, `GDPARSE` = a stub that exits 0, a valid world, the business fixture server, and a pre-existing `naija-stage1-save.json`. The stub is not Godot. | exit 0, `SUMMARY: 23 passed, 0 failed, 0 skipped`, the save check passes, port 3297 closed afterwards. This shows the runner's count and exit path only. |
| Final tree re-run after the last edits (one blank line in the runner, the exact exit-2 assertion, this section and the status paragraph) | Every row above gives the same result. The runner test was re-run: 23 of 23. |

**Limit of the interrupt handling.** The runner does not kill a child process. If a Godot process ignores SIGINT, the runner waits for it to end (its timeout is 900 s for a headless script and 600 s for a UI phase). A second Ctrl-C does not stop it. Stop such a process by hand, then the runner will exit 130 at its next check.

**Not verified:** every Godot check. The fixes to the runner and the signal behaviour were tested with stub binaries
only. The real Godot path, including `user_data_dir_headless.gd`, `career_rate_limit_ui_headless.gd`, and the save
protection against a real Godot user-data directory, has not run.

## 8. Decisions that remain open (not made here)

- Recipient consent for hiring and ownership transfer.
- The provisional 500% service price ceiling.
- Co-owner-only ownership states.
- Seed capital for NPC businesses.
- Branch setup cost.
- Whether an **insolvent** business may be transferred (section 6.4). The docs do not say.
- Whether an **employee** should see the business under "My businesses" (section 6.4).
- Routing of `rate_limited`: decided as notify only (section 6.1). The career-panel fix for its own refused request is
  in place. Godot re-run pending (section 7.5).
- Shutdown semantics for section 8.3: a bounded wait in `shutdown()` (section 6.2). The released-store case is fixed.
- Open decisions 9, 10, and 11.

NPC business creation, NPC hiring, and autonomous NPC business activity are not enabled.

## 9. Remaining work

1. Drive the remaining refusals through the panel with simulated input: the career-conflict refusal (needs a seeded
   employment made through the server's domain functions, because the review happens on a future date), the goods price
   ceiling and service bounds at their boundary values, transfers to a manager, an employee, a child, a deceased, or an
   unbanked recipient, a stranger's refused changing action, and restart with UI readback.
2. Run the Godot checks on a machine with Godot 4.7.2: `tools/godot/run-godot-checks.sh` (runbook, section 7.5). It covers the
   headless scripts, the business UI phases, and the new career-panel scenario, and `online_businesses_headless` on its own server. No Godot binary is available here, and a
   headless server-platform build is not practical on this 2-core, 3 GB sandbox.
3. Decide the shutdown semantics for section 8.3 (section 6.2). Probe the PostgreSQL released-store path.
4. Decide the insolvent-transfer and employee-visibility questions (section 8).
5. Decide whether the panel hides owner actions on a closed business (section 6.4). The cosmetic "Actions for your role"
   heading is not changed.
6. `game/scripts/ui/business_panel.gd` is over gdlint's 1,000-line limit. It is not split: no confirmed fix needed the
   split. This is follow-up work.
7. Rendered (non-headless) verification has not been done. No person has looked at the panel on a screen.
8. Godot checks for the whole Stage 44 set need a Godot 4.7.2 binary in a new sandbox. Those checks are in section 7.2.

## 10. Repository state

- Branch `arena/00cdea0e-naija`. Pushed as fast-forward commits on top of `fa9c0d6` (the Stage 43 handoff commit):
  - `40a3f42` fix(world-api): stop shutdown lock loss and refuse late saves from a released store
  - `761f3b9` fix(world-api): business action errors use business wording
  - `e4653f8` fix(game): generic error replies reach request trackers; `rate_limited` is not a career error
  - `0601093` test(game): Stage 44 business UI phases and the isolated fixture runner
  - `493dd64` docs: Stage 44 business lifecycle verification record, status, and inventory
  - This section was corrected in a later commit on the same branch.
- Working tree: clean, apart from the 53 generated `game/**/*.gd.uid` files, which are not committed. They are left in
  place. Decide whether to commit them or add a rule to ignore them.
- This verification pass (2026-10-14) starts at `79932db`. It adds, **committed on this branch** (the SHA is in `git log`): `game/tests/career_rate_limit_ui_headless.gd`
  (not executed), `tools/godot/run-godot-checks.sh`, `services/world-api/test/godot-checks-runner-stage44.test.mjs`, a
  career recovery step in `services/world-api/test/career-errors-stage44.test.mjs`, a `career_rate_limit` phase in
  `tools/business-fixture/run-business-ui.sh`, the runner's save protection and its contract tests, the `user_data_dir`
  probe, and this document's sections 6.3, 7.4, 7.5 (runbook), and 7.6. The 53 `.gd.uid` files remain untracked and are
  not committed.
- No secrets or session tokens are in the repository. Fixture sessions and the fixture world are outside it.
- The repair of the local branch after the sandbox restart (section 2) was a local ref and index update only. It is not in
  the history.
