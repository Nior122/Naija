# Stage 28 Task 2: Persistence-Unavailable Policy (mapping and recommendation)

Status: **Design and mapping only. No write block is implemented.** Stage 28 remains OPEN. Line numbers refer to
`services/world-api/src/multiplayer/world-engine.ts` at commit `af45a21`.

## 1. Current behaviour (verified by the Task 1 tests)

- A gameplay command changes live memory, marks the world dirty, and returns its normal result. **No success
  response says the change is saved, and none reports a save result.**
- The periodic save (tick) retries the failed save and keeps the live change. Live state keeps moving.
- On the first non-capacity save failure in an episode, every online player receives one `persistence_failed`
  notice. On the first capacity refusal, every online player receives one `world_capacity_reached` notice.
  The notice is re-armed by the next successful save (D1, fixed in `af45a21`).
- A restart loads the last successful save. Everything after it is lost (Task 1, C4).
- `/health` does not report the save state (Task 1, G1).
- The client shows every server `error` through the generic handler (`prototype_game.gd` `_on_online_error` →
  `ui.notify`). A new error code would reach players without client changes, but no persistent "unsaved" state
  exists, and no "saved again" signal exists (G3).

So the present policy is: **continue with a one-time warning; the player's progress is not shown as unsaved.**
That is the case the directive asks us to prevent.

## 2. Action paths that write persistent state

Each row is a path that changes the saved world document. The "consequence" column is a first-pass classification
from the action names and handler code. It is not a per-action legal or game-design review.

| Path | Lines (world-engine.ts) | Persisted by | Consequence if lost on restart | Class |
|---|---|---|---|---|
| `world.travel` (location and position change) | 1323–1332 | periodic save | position and location revert | Movement |
| `world.bus` | 1345–1355 | periodic save | money and position revert | Money |
| `shop.purchase` | 1419–1424 | periodic save | money and inventory revert | **Money and goods** |
| `inventory.consume` | 1439–1445 | periodic save | inventory and needs revert | Needs |
| `clinic.care` | 1462–1467 | periodic save | money and health revert | **Money** |
| `character.rest` | 1476–1482 | periodic save | energy and needs revert | Needs |
| `geography.enter` / `geography.leave` | 1379, 1395 | immediate `flushDirty` (awaited, but `flushDirty` catches its own errors, so the reply is sent whether or not the save succeeded) | region presence | Presence |
| `school.begin` | 1526 | immediate `flushDirty` (not awaited) | lesson start | Education |
| `school.answer` | 1638–1684 | periodic save | lesson progress and rewards | Education |
| `education.action` | 1698–1722 | periodic save | education records | Education |
| `career.action` (apply, shifts, promotion, resign, retire) | 1864–1871 | periodic save | employment and pay | **Employment and pay** |
| `economy.action` (accounts, deposit, withdraw, transfer, purchase, loans) | 2017–2024 | periodic save | **balances, transfers, loans** | **Financial (highest)** |
| `business.action` (create, close, transfer ownership, hire, fire, produce, sell) | 2229–2235 | periodic save | **business ownership and ledger** | **Financial (highest)** |
| `property.action` (purchase, rent, sell, transfer) | 2411–2417 | periodic save | **property ownership and money** | **Financial (highest)** |
| `government.action` | 2613–2619 | periodic save | government records | Administrative |
| `election.action` (candidacy, campaign, voting if present) | 2887–2893 | periodic save | political records | Administrative |
| `justice.action` (cases, filings, fines) | 3093–3099 | periodic save | **court records, fines** | Legal |
| `police.action` | 3391–3397 | periodic save | police records | Legal |
| `military.action` | 3663–3669 | periodic save | military records | Administrative |
| `crime.action` | 3859–3865 | periodic save | criminal records | Legal |
| `culture.action` | 4152–4158 | periodic save | cultural records | Low |
| `entertainment.action` | 4414–4420 | periodic save | entertainment records | Low |
| `family.childbirth` | 4595–4620 | periodic save | family records | **Family (irreversible in practice)** |
| `relationship.progress` (`progressRelationship`, starts at 4517) | 4546–4562 | periodic save | relationship stage | Social |
| Identity creation (`commitIdentity`) | 1087–1118 | **synchronous** save; reply only after success | none (reply is refused if save fails) | Already safe |
| Session resume (`resumeSession`) | 1260–1268 | periodic save | session token state | Session |
| Identity recovery (`recoverIdentity`) | 1201–1206 | immediate `store.flush()`; reverts on failure | none (reply is an error if save fails) | Already safe |
| Tick: movement, world clock, needs | 786–787 | periodic save | position, clock, needs revert | **Time (cannot be stopped by blocking commands)** |
| Life events (death, retirement) | 651–691 | periodic save | death and retirement state | **Life state (irreversible in practice)** |
| Presence (`touchPlayer`, `disconnect`) | 4689, 4830–4834 | periodic save | last seen | Presence |
| Shutdown | 796 | synchronous `store.flush()` | the whole unsaved window | Terminal |

Paths that do **not** change persisted state: `chat.send` and `player.interact` (broadcast only; `handlePlayerInteraction` at line 4480 marks nothing dirty). Read-only views inside each family do
not reach `touchPlayer` (the exclusion lists, for example line 1865).

## 3. Consequences that shape the policy

1. **Time is not a player action.** The tick advances the world clock, needs, and movement with no command. Blocking
   commands does not stop the world from changing in memory, so a restart still reverts time-based progress.
   Any policy that promises "nothing is lost" must also stop or suspend the tick, which is a larger decision.
2. **Financial and ownership paths are the most damaging to lose.** A player who buys, transfers, or takes a loan
   and then loses the change on restart may be charged or credited for something that no longer exists in the
   saved world. These paths need the earliest and strictest handling.
3. **Some losses are irreversible in practice.** Childbirth, death, retirement, and court filings have downstream
   effects on other players' records. These are as serious as financial paths.
4. **The notice is the only signal, and it is one-time.** A player who misses it, or joins during an outage, has
   no way to see the state. A new notice on each action would be noisy; a single notice is easy to miss.
5. **Recovery is silent.** When saves resume, nothing tells the player that earlier changes are now saved, or that
   the earlier ones were lost. This needs a defined signal before any "you are safe" claim is made.

## 4. Options compared

| Option | What happens | Protects against misleading progress? | Costs and risks | Assessment |
|---|---|---|---|---|
| **A. Continue with warnings** (current) | All commands succeed in memory; one notice per episode. | No. Players are not told each change is unsaved. Changes made after the notice are lost silently on restart. | No gameplay disruption. Losses can be large (financial paths). | Not acceptable as the long-term policy. Acceptable only as the interim state. |
| **B. Reject state-changing commands while saves fail** | After an episode has lasted a set time, every write-path command returns `persistence_unavailable` (reads still work). The tick continues. | Yes, for commands. Players are told at the point of action. | Time-based and movement changes still occur (Consequence 1). Players lose the ability to act during an outage. A new error code must be shown; generic display works, but copy is not reviewed. A threshold must be chosen. | Recommended as the **first enforced step**, limited to financial, ownership, legal, and family paths. |
| **C. Controlled read-only (degraded) mode** | An operator or automatic switch puts the whole world into read-only mode: all write-path commands are refused, and the tick's time and needs changes are suspended or documented as unsaved. Exit when a save succeeds. | Strongest. Nothing new is written in memory that the player could believe is saved. | Needs a clear operator switch, a decision on the tick, and a client message for mode changes. Larger change; affects all players during an outage. | Recommended as the **second stage**, after B is tested and the tick decision is made. |

## 5. Recommendation: staged approach

No stage below is implemented by this document. Each stage needs its own review and tests.

**Stage 1 (interim, documentation and visibility; no gameplay block).**
- Keep option A's behaviour, and state it in the operator documentation.
- Decide the threshold for "an outage": for example, the first failed save in an episode that lasts more than one
  tick interval. Make it a configuration value, not a constant.
- Decide who sees the state: the operator dashboard, the players, or both. Do not change `/health` semantics to
  satisfy this; add a separate, clearly named field if one is approved (Task 1, G1).

**Stage 2 (reject write paths for financial, ownership, legal, and family commands).**
- Scope: `economy.action`, `business.action`, `property.action`, `justice.action`, `family.childbirth`,
  and `shop.purchase` / `clinic.care` (money paths). Other paths keep option A until reviewed.
- Behaviour: after the outage threshold, these commands return `persistence_unavailable` with a fixed message that
  says the change was not made. No change is applied in memory, so nothing needs to be rolled back.
- Reads stay available. Movement and needs continue (Consequence 1 is accepted for this stage and documented).
- Tests: each refused command leaves the world and the saved file unchanged; the first command after recovery succeeds;
  a concurrent command during an outage is refused; no command is refused while saves succeed; the threshold works.

**Stage 3 (degraded read-only mode).**
- Requires: the tick decision (suspend time and needs, or accept and document the loss); an operator switch; a
  client message for mode changes; and a recovery signal ("saved again") that also answers Consequence 5.
- Tests: mode entry and exit; a restart during read-only mode loads the last save and nothing else; the operator
  switch is authenticated and audited.

## 6. What must not happen

- No success message may say that progress is saved while a save is failing.
- No command may be silently refused or silently accepted during an outage. Each refusal must say why.
- No state may be removed from memory to make a save fit (the capacity rule, Task 1).
- The policy must not depend on a client change that has not been reviewed (the client release question stays open).

## 7. Open decisions for the owner

1. The outage threshold (time and count).
2. Whether Stage 2 applies to the money and family paths only, or to every write path.
3. Whether the tick's time and needs changes are suspended in Stage 3, or continue and are documented as at risk.
4. Whether `/health` should show the save state, and under which field name.
5. The player-facing wording for refused commands and for recovery. This needs a product owner, not an engineer.
