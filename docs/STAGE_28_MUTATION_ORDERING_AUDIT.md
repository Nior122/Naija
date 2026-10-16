# Stage 28: mutation response-ordering audit

Status: audit and characterization tests only. **No ordering change in this stage.** The warning-only policy stays.
Stage 28 remains OPEN — PRODUCTION NOT READY.

Scope: every gameplay mutation handler in `services/world-api/src/multiplayer/world-engine.ts`, the save call that follows
each one, and what a client is told. Files referenced are line numbers in the working tree for this audit.

## 1. How the engine saves and replies

- A handler changes the live world, then (for most handlers) sends the success reply or a character snapshot, then
  `await this.flushDirty()`.
- `flushDirty` awaits the store's save (`store.flush()`), inside the persistence queue. It then catches any error. On failure
  it sets `dirty` again, counts the failed attempt, and — once per failure episode — broadcasts `persistence_failed` to every
  online player. **The handler never receives the failure**: `flushDirty` does not rethrow.
- A few handlers use `void this.flushDirty()` (fire-and-forget). The outcome is the same, and nothing awaits it.
- The periodic tick saves through `void this.flushDirty()` when `dirty` is set and at least a second has passed.
- Identity creation is the exception: `commitIdentity` awaits `store.saveState(draft)` **before** it replies, and a failed save
  returns `persistence_failed` to the request. `recoverIdentity` (existing key) is also save-then-reply.
- `session.resume` replies `session.ready` **before** its background save commits (observed: the write is still in flight when
  the reply arrives; see the `quiet()` barrier in `test/directory-sync-states.test.mjs`).

Consequence: **for every gameplay handler, a success reply (or a snapshot that shows new money, inventory, or position) is sent
before the save completes, and a save failure can happen after the success reply.** A success reply therefore means "applied in
the current process", not "saved".

## 2. Table

Columns: handler (message type → function, line); authoritative mutation (state family); success reply (line); save call
(line) and completion; can persistence fail after the reply; does the reply imply durability; reversible; deduplicated by
`requestId`; recommended correction. "Verified" means checked by a test; "code" means checked by reading the code and the
reply/save line order (scripted scan). Per-action guard tests were **not** written for the rows marked *unverified*.

| # | Handler (message type) | Authoritative mutation | Success reply (line) | Save call (line), completion | Failure after reply? | Reply implies durable? | Reversible? | Dedupe (`IDEMPOTENT_COMMANDS`) | Recommended correction |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `world.travel` → `travel` (~1377) | player position, `geographic_location`, input; `touchPlayer` | snapshot (1411) | `await flushDirty` (1413), awaited, errors swallowed | yes | no | no reversal; position is re-derivable by moving | yes | none this stage (code) |
| 2 | `world.bus` → `takeBus` (~1416) | fare `money -= 150` (1427); position/location | snapshot (1434) | `await flushDirty` (1436) | yes | no | no; fare not refunded on failure | yes | **priority: money** — narrow follow-up candidate (code, unverified) |
| 3 | `geography.enter` → `enterGeographicRegion` | geographic region state | snapshot (1458) | `await flushDirty` (1460) | yes | no | no | **no** | none this stage (code, unverified) |
| 4 | `geography.leave` → `leaveGeographicRegion` | geographic region state | snapshot (1474) | `await flushDirty` (1476) | yes | no | no | **no** | none this stage (code, unverified) |
| 5 | `shop.purchase` → `purchaseItem` (~1479) | `money -= price` (1501); inventory add | snapshot (1504) | `await flushDirty` (1505) | **yes (verified)** | no | no; no compensation | yes | **priority: money + inventory.** Narrow follow-up (`command.persisted` / `command.unconfirmed`) is the candidate; design in §5 |
| 6 | `inventory.consume` → `consumeItem` (~1508) | inventory removal; effects | snapshot (1525) | `await flushDirty` (1526) | yes | no | no | yes | **priority: inventory** (code, unverified) |
| 7 | `clinic.care` → `visitClinic` (~1529) | `money -= 300` (1544); health effects | snapshot (1547) | `await flushDirty` (1548) | yes | no | no | yes | **priority: money** (code, unverified) |
| 8 | `character.rest` → `rest` (~1550) | character energy/time state | snapshot (1562) | `await flushDirty` (1563) | yes | no | no | yes | none this stage (code, unverified) |
| 9 | `school.begin` → `beginLesson` (~1566) | lesson session state | quiz message (1601) | `void flushDirty` (1607): fire-and-forget | yes | no | no | **no** | **education**: review; a re-sent `school.begin` may re-start a lesson (unverified) |
| 10 | `school.answer` → `answerLesson` (~1700) | quiz progress, score | snapshot (1764) | `await flushDirty` (1765) | yes | no | no | yes | education review (code, unverified) |
| 11 | `education.action` → `educationAction` (~1775) | enrolment, exam state | snapshot (1802) | `void flushDirty` (1781, after `begin_final_exam`); `await flushDirty` (1803) | yes | no | no | yes | **priority: education** (code, unverified) |
| 12 | `career.action` → `careerAction` (~1812) | career maps (employers, applications, employment, work sessions, salary) | `career.result` (~1948) then snapshot (1951) | `await flushDirty` (1952) | yes | no | no | yes | **priority: employment** (code, unverified) |
| 13 | `economy.action` → `economyAction` (~1955) | economy maps (accounts, transactions, loans, credit) | `economy.result` (2102) then snapshot (2104) | `await flushDirty` (2105) | yes | no | no | yes | **priority: money** (code, unverified) |
| 14 | `business.action` → `businessAction` (~2108) | business maps (business, ownership, transactions, sales, events) | `business.result` (2315) | `await flushDirty` (2316) | yes | no | no | yes | **priority: business / ownership** (code, unverified) |
| 15 | `property.action` → `propertyAction` (~2319) | property maps (titles, ownership, transfers, tenancies) | snapshot (2497) | `await flushDirty` (2498) | yes | no | no | **no** | **priority: property / ownership**. Not deduplicated: a re-sent command depends on the handler's own guard (unverified) |
| 16 | `government.action` → `governmentAction` (~2501) | government maps | snapshot (2699) | `await flushDirty` (2700) | yes | no | no | **no** | **priority: legal / fines**. Not deduplicated (unverified) |
| 17 | `election.action` → `electionAction` (~2703) | election maps | snapshot (2973) | `await flushDirty` (2974) | yes | no | no | **no** | review (unverified) |
| 18 | `justice.action` → `justiceAction` (~2977) | justice maps (cases, filings, fines) | snapshot (3179) | `await flushDirty` (3180) | yes | no | no | **no** | **priority: legal and fines**. Not deduplicated (unverified) |
| 19 | `police.action` → `policeAction` (~3183) | police maps | snapshot (3477) | `await flushDirty` (3478) | yes | no | no | **no** | review (unverified) |
| 20 | `military.action` → `militaryAction` (~3481) | military maps (branches, bases) | snapshot (3749) | `await flushDirty` (3750) | yes | no | no | **no** | review (unverified) |
| 21 | `crime.action` → `crimeAction` (~3753) | crime maps | snapshot (3945) | `await flushDirty` (3946) | yes | no | no | **no** | review (unverified) |
| 22 | `culture.action` → `cultureAction` (~3949) | culture maps | snapshot (4238) | `await flushDirty` (4239) | yes | no | no | **no** | review (unverified) |
| 23 | `entertainment.action` → `entertainmentAction` (~4242) | entertainment maps | snapshot (4500) | `await flushDirty` (4501) | yes | no | no | **no** | review (unverified) |
| 24 | `relationship.progress` → `progressRelationship` (~4598) | relationships (`relationships` map) | snapshot to the **target** context (4642) | `await flushDirty` (4643) | yes | no | no | yes | review (code, unverified) |
| 25 | `family.childbirth` → `recordChildbirth` (~4646) | people, households, families, life events | payload to the spouse if online, and to the actor when the parent is offline (4694–4700) | `await flushDirty` (4701) | yes | no | no | yes | **priority: family / childbirth** (code, unverified) |
| 26 | `chat.send` → `handleChat` (~4530) | none persistent (broadcast only) | broadcast | **no save** | n/a | n/a | n/a | no | none; not a persistence risk (code) |
| 27 | `player.interact` → `handlePlayerInteraction` (~4561) | none persistent (broadcast only) | broadcast | **no save** | n/a | n/a | n/a | no | none; not a persistence risk (code) |
| 28 | `movement.input` → `handleMovement` | position and direction in memory | none (broadcast on the tick) | saved only through the tick's `changed` flag (`void flushDirty`, tick ~803) | yes | no | no | no | none; movement is not money or ownership |
| 29 | `identity.create` → `commitIdentity` (~1080) | new player, household, family, starter records | `identity.created` (1219), after the save and the merge | `await store.saveState(draft)` (1161), **before** reply | yes — reply is `persistence_failed` / `identity_creation_pending` | **yes** | creation is undone only by a later save (see SAME_KEY_CONFLICT) | key reservation (R1) | none this stage (correct ordering) |
| 30 | existing-key recovery → `recoverIdentity` (~1256) | session token hash and timestamps | `identity.created` (1298), after `await store.flush()` (~1282) | save before reply; restores the old hash on failure | yes — reply is `persistence_failed` | **yes** | token rotation is not reversed | key-based | none this stage |
| 31 | `session.resume` → `resumeSession` (~1301) | online state, `lastSeen` | `session.ready` (1343) | `await flushDirty` (1349), **after** reply; in-flight when reply arrives (observed) | yes | no | n/a | n/a | none this stage |
| 32 | socket close → `disconnect` (~4900) | online state, `lastSeen` | none (no reply) | `await flushDirty` (4915) | yes | n/a | n/a | n/a | none this stage |
| 33 | death / retirement events → `recordDeathEvent` (~655), `recordRetirementEvent` (~690) | life state, career end | `presence.left` broadcast; snapshot (703) | `await flushDirty` (685, 707) | yes | no | no | n/a | review under life-event work (unverified) |

Rows 2, 5 and 7 touch money or inventory. Rows 12–18 and 25 are the employment, business, property, legal, and family groups in
the priority list. Row 9 and row 11 use fire-and-forget saves. For every row, "failure after reply" is possible: the reply is
sent before the save, and a failed save is not returned to the handler.

### Limits of this table

- Only row 5 (`shop.purchase`) is **verified** by a test. The rest are verified by code order (reply line before save line, from
  a scripted scan of `world-engine.ts`), and the state family named in each row is the family the handler's domain module
  owns, not a per-field check.
- The per-action guard tests for the non-deduplicated handlers (rows 3, 4, 9, 15–23) were **not written**. These rows are
  recorded as unverified. They need a test per handler: a repeated `requestId` must not apply a second mutation.
- No gameplay handler returns a durability field. A client cannot tell "applied" from "saved".

## 3. Duplicate commands

`IDEMPOTENT_COMMANDS` lists 13 types: `world.travel`, `world.bus`, `shop.purchase`, `inventory.consume`, `clinic.care`,
`character.rest`, `school.answer`, `education.action`, `career.action`, `economy.action`, `business.action`,
`relationship.progress`, `family.childbirth`. For these, a repeated `requestId` in the same process returns `command.duplicate`
and the handler does not run again.

The record of a processed request is `player.recentRequestIds`, in memory and persisted only with the player record. Two
consequences:

1. **In process**: a repeated command after a successful reply is `command.duplicate`, charged once (verified, row 5).
2. **After a failed save and a restart**: the saved file may lack the purchase and its `requestId`, so the same `requestId`
   applies the purchase again. Verified (row 5, restart test): the purchase applies once after the restart, because the file
   predates it. This is the intended "lost change is re-applied" case, but it shows the reply cannot be trusted as a receipt.

Commands **not** deduplicated (`school.begin`, `geography.enter`, `geography.leave`, `property.action`, `government.action`,
`election.action`, `justice.action`, `police.action`, `military.action`, `crime.action`, `culture.action`,
`entertainment.action`, `chat.send`, `player.interact`): a repeated `requestId` runs the handler again. Each handler's own guard
decides whether the second run applies, and those guards are **unverified**. This is the largest unverified risk in this audit.

No general exactly-once claim is made. The decision in the brief (no claim of general exactly-once execution) stands.

## 4. Persistence and failure propagation (answers to the brief)

- **Does save await completion?** Yes. `flushDirty` awaits `store.flush()` inside the persistence queue. The handler's `await`
  returns when the save has completed or failed.
- **Do failures propagate?** No, for gameplay handlers. `flushDirty` catches the error and does not rethrow. The effect is the
  episode-level `persistence_failed` broadcast to online players, once per episode, plus the retry loop. Identity creation and
  recovery are the only paths that return a save failure to the requester.
- **Does the save-failure report reach the actor?** Yes, if the actor is online, because `persistence_failed` goes to every online
  player. It is not tied to the request, so the actor cannot match it to a specific purchase.

## 5. Proposed response design (NOT implemented)

Backward-compatible, additive fields are the preferred route. Two options, with the tradeoffs:

- **Option A — follow-up message (narrow, for `shop.purchase` first):** after the save completes, send `command.persisted`
  with the `requestId`; on failure, send `command.unconfirmed` with the `requestId` and a message that the purchase is
  applied in the current process but not confirmed as saved. Older clients ignore unknown types (verified, §6). Costs: a new
  message type, a duplicate-path design (a re-sent `requestId` after `command.unconfirmed` must return the same outcome, not
  charge again), and client UI work. **Needs client tests and review before any change.**
- **Option B — await the save before the reply:** the reply then implies durability. Costs: latency on every action, a change to
  the response timing that current clients may rely on, and the same duplicate design. Rejected for this stage.

The three states the brief asks for (applied in process; persisted; persistence failed with possible loss) map to Option A as:
the snapshot (applied), `command.persisted` (persisted), `command.unconfirmed` (possible loss).

## 6. Client handling of `persistence.restored` (item 3)

Architecture read in the client:

- Server messages arrive in `_handle_packet` (`game/scripts/services/multiplayer_client.gd`) and are emitted on
  `message_received`, which `_on_online_message` (`game/scripts/prototype_game.gd`) handles with a `match` on the type.
- `_on_online_message` has **no default arm** (verified: the function ends after the match, and the only `_:` arm in the
  file belongs to another function). Unknown message types are therefore a no-op, so older clients ignore a new type.
- `ui.notify(message)` (`game/scripts/ui/prototype_ui.gd`) writes the text to the HUD message label, or to the online status
  label if there is no HUD. It replaces the text; it does not stack notices.

Changes in this stage:

- `multiplayer_client.gd`: constant `PERSISTENCE_RESTORED_NOTICE` and a static `persistence_notice(message)` that returns the
  notice only for `persistence.restored`. The text: "Server saving is working again. This does not confirm changes made while
  saving was failing."
- `prototype_game.gd`: a `"persistence.restored"` arm in `_on_online_message` that calls `ui.notify` with the non-empty notice.

What the notice does and does not do:

- It is sent by the server once per failure episode, on the first successful save, to players who are online at that time.
  Ordinary saves do not repeat it.
- It never claims recovery of outage-period changes, and it does not say everything is saved. The server's counters
  (`failedAttempts`, `outageSeconds`) are not shown.
- It contains no credentials, paths, connection strings, or world data.
- Older servers never send it, and older clients ignore it.
- Reconnect and duplicate delivery: a player who reconnects after the episode does not receive it. A duplicate delivery replaces
  the text with the same text; it is not stacked.

**Verification status:**

- `services/world-api/test/client-persistence-notice.test.mjs`: **6/6 pass** (source contract). Includes an indentation check
  on the dispatch arms. This check was added after a real defect was found in the diff (the `player.interaction` arm was indented
  one tab short, which is a GDScript syntax error). The check fails with the broken file and passes with the fixed one.
- `game/tests/persistence_notice.gd` (headless `SceneTree`): **NOT RUN.** Godot 4.7.2 is not available in this sandbox (see the
  final report). It is the behavioural test and must be run on a machine with Godot:
  `godot --headless --path game --script res://tests/persistence_notice.gd`.
- No runtime check of the HUD text, the timing, or the reconnect path has been made.

## 7. Recommendations (for review, not implemented)

1. Keep the warning-only policy for this stage. Do not block writes.
2. Next stage: a narrow change for `shop.purchase` only (Option A, §5), after client tests and a duplicate-path design are
   reviewed.
3. Write per-action guard tests for rows 3, 4, 9, 15–23 (the non-deduplicated handlers) before any change to them.
4. Review the money and legal handlers (rows 2, 5, 7, 13, 16, 18) first when the next ordering change is scoped.

## 8. Guard tests for re-sent requests (added 2026-10-11)

File: `services/world-api/test/mutation-resend-guards.test.mjs`. Each test sends a mutating request twice with the same
`requestId` and checks the saved state. Run results: default suite (file backend) 4/4; PostgreSQL loopback
(`naija_stage28_test`, `DB_SSL=false`, trust auth, disposable) 8/8, including the file backend cases.

| Handler | Test result | What it shows |
| --- | --- | --- |
| `property.purchase` | guard passes | A re-sent purchase returns `property.error`, and the price is charged once. The test asserts the reply type and the balance, not the error code. |
| `justice.file_case` | characterisation passes | **Gap, current behaviour.** A re-sent filing creates a second case. The test asserts `2` so the gap stays visible. Change it when the handler is deduplicated. |
| `government.create_budget` | characterisation passes | **Gap, current behaviour, needs review.** A character with no office and no appointment can create a budget, and a re-sent request creates a second one. The handler checks the organisation and the fields, but not the character's authority. This is not a mutation-ordering issue. It is a confirmed authorization gap: see `docs/STAGE_28_GOVERNMENT_AUTHORIZATION.md`. |
| `school.begin` (classroom) | guard passes | A re-sent request while the quiz is pending returns `quiz_in_progress`, and one attendance record is written. The test places the character at the desk in disposable in-memory state; the walking route is covered by `education.test.mjs`. |

Not written: guards for `government.publish_announcement` and the other justice actions. Their setup (appointments, a
court with a judge, or a filed case) is larger than the scope of this pass.

These tests characterise current behaviour. They do not claim it is correct. No handler was changed.
