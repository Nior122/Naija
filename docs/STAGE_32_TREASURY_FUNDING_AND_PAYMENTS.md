# Stage 32: Treasury Funding and Payments

Date: 2026-10-11. Branch: `arena/00cdea0e-naija`. Starting commit: `42bc518` (the Stage 31 CI record on this branch).
The commit that adds this file is listed in the final report, not here.

Status: **Two things now move money, and both are narrow.** A one-time catalogue grant puts ₦100m into the Federal
Ministry of Finance treasury. `spend_budget` can pay a character from that treasury, and the payment is credited to the
character's existing cash account in the same write. Everything else that moves money stays refused. This is not a
production finance system. It has one funded treasury, one payee type, and no revenue, tax, fine, or borrowing route.

Read with `docs/STAGE_31_TREASURY_AUTHORITY.md` (the treasury ledger, authority, and hierarchy rules, which still apply)
and `docs/STAGE_28_AUTHORITY_MODEL.md`.

## 1. What is open, and what stays closed

| Route | State after Stage 32 | Why |
|---|---|---|
| Initial treasury funding | **Applied by the server, once per world, from the catalogue.** No player or client route. | Section 3. |
| `spend_budget` to a **character** | **Open** (server authority, `requestId` required, character with a cash account) | Section 4. |
| `spend_budget` to a **business** or **organisation** | Refused: `treasury_destination_unsupported` | No receiving rule yet. Refused before any write, so no money leaves a treasury without a credit. |
| `record_revenue`, `record_expenditure`, `create_budget` | Suspended (`government_writes_suspended`) | No player route, as in Stage 31. |
| Revenue, taxation, fines, borrowing, minting, unapproved transfers | **Unavailable.** No route exists. | Mission constraint. |
| `appoint`, `remove_official`, `create_project`, `update_project`, `fund_project`, `publish_announcement` | Suspended | Unchanged from Stage 31. |

The gate is unchanged: `GOVERNMENT_TREASURY_ACTIONS` in `services/world-api/src/multiplayer/world-engine.ts` lists the
open treasury actions. Every other government write is refused before its payload is parsed.

## 2. Rules at a glance

- A payment needs a request ID, an approved and allocated budget, an active organisation, and enough money in the
  treasury.
- The payee must be a living character with an **existing, active cash account**. No account is created for a payee.
- A single payment is limited by the economy's transaction limit (₦50,000,000 in `game/data/economy/catalog.json`), and
  the payee's cash balance may not go over the economy's balance limit (₦500,000,000).
- The actor may not pay themselves, or a character they are actively related to (`parent_of`, `guardian_of`,
  `sibling_of`, `spouse`), or an active marriage partner. Ended ties do not count.
- A retry with the same request ID returns the first result (`replayed: true`). The same ID with a different payload is
  refused (`treasury_idempotency_conflict`).

## 3. Initial treasury funding

**Source of the amount.** `game/data/government/catalog.json`, new field `treasury_funding`:

| Field | Value |
|---|---|
| `rule_id` | `treasury-initial-allocation-v1` |
| `organisation_id` | `gov:min:finance` (Federal Ministry of Finance) |
| `category_id` | `rev:grant` ("Grants and Aid") |
| `amount_ngn` | `100000000` (₦100,000,000) |
| `reason` | "One-time initial allocation to the Federal Ministry of Finance treasury, set by the world catalogue." |

**How it is applied.**

- `applyInitialTreasuryFunding` (`src/government/service.ts`) runs inside `reconcileGovernmentStructure`. That runs on
  world seed and on every identity resume, as the Stage 31 reconcile did.
- For each rule, if its organisation exists and is active, and no revenue row already carries that `funding_rule_id`
  (or the legacy source marker `treasury-funding:<rule_id>` on that organisation), one revenue row is written with
  `funding_rule_id` set. Then the treasury balance is credited through the existing `recordGovernmentRevenue`.
- The amount is read from the catalogue only. No request field is read, and no action applies a rule.
- The check reads the ledger that is saved with the world. A rule that has already been applied changes nothing, and
  that holds across restarts (tests 2 and 21 in the new file).

**Validation.** `validateCatalog` (`src/government/catalog.ts`) refuses a rule whose ID is duplicated, whose
organisation is not `gov:`, whose reason is empty, whose amount is outside the revenue bounds, or whose revenue category
does not exist. A bad rule stops the catalogue from loading, so nothing is written (test 4).

**Legacy ledgers.** Funding adds one row and changes no existing row. A legacy ledger with no funding row is preserved,
and the only addition is the funding row (test 3). The new optional field `funding_rule_id` is checked by the record
validator (`src/multiplayer/record-validation.ts`), and a forged marker or payment link fails the load (test 14).

**Exactly-once, and what it depends on.** The grant is applied at most once in the durable world state, because the
durable ledger row is the only evidence the check reads:

- A failed save does not confirm anything, because the funding row is not in storage. After a restart the next resume
  applies the rule again, so it is still applied once.
- On PostgreSQL, two processes cannot both save their own copy: the version check fences the stale one, and it never
  confirms a save it did not make (test 29). The funding row is written once in the durable state.
- The file backend has no version check and no lock. It is safe with one server process per world file, and it is not
  safe with two. This is a limit of the file backend, and it is recorded in section 8.

## 4. Payments: rules and checks

`spendBudget` (`src/government/service.ts`) runs its checks in this order. Nothing is written until the last one passes:

1. Request ID present; budget and organisation exist; the actor has `budget_spend` over this organisation (server
   authority, Stage 31 rules).
2. Replay: an earlier spend with the same request ID returns its result, or is refused if the payload differs.
3. Amount is a safe integer and at least the catalogue minimum. Reason is 1 to 200 characters.
4. Organisation is active; budget is not draft and not closed.
5. Destination kind is `character`, `business`, or `organisation`. Any other value is `treasury_destination_invalid`.
   Business and organisation are then refused as `treasury_destination_unsupported`.
6. The character exists (`treasury_destination_not_found`). The actor is not the payee and has no active family or
   marriage tie with them (`treasury_conflict_of_interest`).
7. Allocated budget left is at least the amount (`government_insufficient_budget`). The treasury balance is at least the
   amount (`treasury_insufficient_funds`).
8. The payee can take the credit: the account exists (`economy_payee_account_missing`), is active
   (`economy_payee_account_inactive`), the character is not deceased (`economy_payee_deceased`), the amount is within the
   per-payment limit (`economy_payment_over_transaction_limit`), and the balance stays within the limit
   (`economy_payee_balance_limit`). This is `planGovernmentPaymentCredit` (`src/economy/service.ts`).

**The write.** Once every check passes, `postExpenditure` writes the debit (treasury balance, budget spent, ledger row)
and then `credit.apply` writes the credit (cash account balance, the economy transaction, the economy event, and the
character's cash figure). Both run in one synchronous block with no `await` between them. The transaction carries
`kind: "government_payment"`, `reference_id` = the expenditure ID, and `counterparty_account_id` = the treasury account.
The expenditure row records `recipient_account_id` and `recipient_transaction_id`.

**What the claim is.** The debit and the credit are made in one synchronous step in memory, and they are saved as one
unit, so a saved world holds both or neither. The persistence unit is the whole world (section 5), not a database
transaction spanning two tables. There is only one table with a row for the world. The claim is not "two independent
writes are atomic", and this document does not make that claim.

**Economy checks are not bypassed.** The credit goes through the economy's own account and transaction records, and it
does not use a second ledger. The existing `creditSalary` is not reused, because it creates a cash account when a
character has none (`src/economy/service.ts`). The new function refuses where the economy would refuse, and it never
creates an account for the payee.

**Audit.** `auditTreasuryLedger` now also checks, for every payment to a character, that the recipient transaction exists,
is a `government_payment`, has the same amount and account, and references the expenditure. It also reports a credit
with no payment. It reports a payment recorded without a recipient credit as a problem. A legacy payment has no
recipient fields, and the audit reports it. It is not rewritten (test 13).

## 5. Persistence and failure containment

### 5.1 What is persisted, and how

| Backend | Unit of a save | Atomicity of a save | Cross-process safety |
|---|---|---|---|
| File (`WorldStore`) | Whole world JSON | Temp file, fsync, rename over the old file, directory fsync (`writeFileDurably`). A failed write leaves the old file. | **None.** Single server process per file. |
| PostgreSQL (`PostgresWorldStore`) | Whole world JSON in one `world_state` row | One `UPDATE ... WHERE version = $n`. Zero rows updated means another writer saved first, so this instance is fenced and refuses further saves. | **Yes.** Stale writers are fenced, so no lost update. |

Saves are serialised per process (`serialize`), so each save captures every change made before it was queued.

### 5.2 Treasury replies wait for the save

A treasury action (`GOVERNMENT_TREASURY_ACTIONS`) bumps `changeGeneration` after its change. It is answered with
`government.result` only when `ensureDurable()` has seen a successful save that covers that change. Otherwise the reply
is `government.error` with `treasury_not_saved`, which says the change is recorded but not confirmed, and the client
retries with the same request ID. The same gate covers a replay. A replay of a payment whose save failed is therefore
not confirmed until a save succeeds.

Memory is **not** rolled back after a failed save, so that a concurrent change made by another player is not overwritten.
A later successful save writes all of memory, including the treasury change. The reply is not sent until then.

### 5.3 Failure cases, and the test that proves each

| Case | Result | Test (both backends unless noted) |
|---|---|---|
| Save fails; process keeps running; retry with the same ID | Reply is `treasury_not_saved`. The retry's save succeeds, and the payee is credited once. | 17 (file), 24 (PG) |
| Save commits, reply is lost; client retries | Retry is a replay. Payee is credited once. | 18 (file), 25 (PG) |
| Save fails, then the process crashes; restart; retry | Restarted world has no payment. Retry pays once. | 19 (file), 26 (PG) |
| Save commits, reply is lost, then the process crashes; restart; retry | Restarted world holds the payment. Retry replays it. | 20 (file), 27 (PG) |
| Funding applied, then restart | Funding is not applied a second time. | 21 (file), 28 (PG) |
| Stale writer (another writer saved first) | Its payment is never confirmed (`treasury_not_saved`). Its saved world has no payment. | 29 (PG only) |
| Any refused check (section 4) | No write of any kind: treasury, budget, economy, events, idempotency record. Full-snapshot equality. | 11 (service) |
| Client sends a funding-style action | Refused. Nothing changes. | 16 (file), 23 (PG) |

**Crash simulation.** The tests do not use a graceful stop for crashes. `crash()` kills the store first, so nothing can
write from the abandoned process, including the save that a closing socket would trigger. Then it closes the server
without its shutdown save. A graceful stop is used only for the restart-after-clean-shutdown test, and it waits for the
old process's in-flight saves before the new process loads (see the comment on `restart()`).

**Fault-injection proof.** Removing the wait in `governmentAction` (so a reply is sent before the save) makes five file
tests fail (15, 17, 18, 19, 20). That run was on the compiled output and was reverted afterwards. The save-failure tests
therefore check the gate, and do not pass by chance.

### 5.4 Known condition: memory is ahead of storage until a save succeeds

Between a failed save and the next successful one, memory holds the payment, and other reads in that process can show
it. The payer is not told it is confirmed, and no client is told the payment is final. If the process crashes in that
window, the payment is lost in full, both the debit and the credit. The durable state is never half of a payment.

This is the existing persistence behaviour (retries, the persistence notice, and no rollback), and it is kept on purpose
so no concurrent change is lost. It is not removed by this stage.

## 6. Validation and security (carried from Stage 31, extended)

- The actor, approver, and organisation come from the session and the server records. The payment destination is the only
  client field that names a payee, and it is checked for kind, existence, and conflict.
- Funding-style actions over the socket (`fund_treasury`, `record_revenue`, `fund_budget`, `mint_funds`) are refused with
  `government_writes_suspended`, with an amount, organisation, budget, and category in the request. Nothing changes
  (test 16 and test 23). The Stage 31 socket test that sends client-chosen actor, approver, owner, organisation, and
  account fields still passes, so those fields are still ignored. Stage 32 does not add a test for the new recipient
  and funding fields being ignored; the record validator covers them when they are present in saved data.
- Economy catalogue limits are read from `game/data/economy/catalog.json`, the same file the economy uses.
- No schema version changed (`schema_version` stays at its Stage 31 value). The only persistence change is the new
  `government_payment` transaction kind in the economy's allowed-kinds list (`src/multiplayer/persistence.ts`), and the
  two optional recipient fields and `funding_rule_id`, which are checked only when present. **No migration was needed**,
  and no migration test was added, because nothing was migrated.

## 7. Tests and results

New file `services/world-api/test/government-treasury-payments.test.mjs` (29 tests with PostgreSQL, 21 without). Part A
(tests 1 to 14) runs in memory and does not depend on a backend. Part B (tests 15 to 29) runs over the socket. Its file
variants run always. Its PostgreSQL variants run only when `DATABASE_URL` is set and PostgreSQL is allowed.

Test-support change: `test/support/faulty-store.mjs` gains `kill()`. This is used only by crash tests, and its default
behaviour is unchanged.

Updated tests (each comment explains the change):

- `government-treasury.test.mjs`: fixtures seeded with the funding where the test needs it. Socket tests expect
  `treasury_destination_unsupported` for a business. The payment-limit and payee-account tests use the real economy
  catalogue.
- `government.test.mjs`: the seed expectation for treasury balances changed from zero everywhere to ₦100m on
  `gov:min:finance` and zero elsewhere.
- `government-treasury.test.mjs`: its `makeState({ withFunding: true })` fixture applies the real catalogue funding, and
  is used by the tests that need a funded treasury. The default fixture keeps the funding out.

### 7.1 Results

| Run | Total | Pass | Fail | Skip | Notes |
|---|---|---|---|---|---|
| Stage 31 (`npm test`, file backend), as recorded in the Stage 31 doc | 1123 | 1085 | 0 | 38 | Baseline for the file backend. |
| Stage 32 `npm test`, file backend (no `DATABASE_URL`) | 1144 | 1106 | 0 | 38 | `npm test` runs `npm run build` first; exit 0. +21 new tests. |
| PostgreSQL baseline, commit `42bc518` (earlier local run) | 1230 | 1226 | 0 | 4 | Recorded before any Stage 32 change. |
| Stage 32 `npm test`, PostgreSQL (`DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true`, disposable local PostgreSQL) | 1259 | 1255 | 0 | 4 | Exit 0. +29 new tests, including 8 PostgreSQL-only. The 4 skips are the same as the baseline. |
| New file, file-backend run | 21 | 21 | 0 | 0 | |
| New file, PostgreSQL run | 29 | 29 | 0 | 0 | 8 of these run only against PostgreSQL. |
| Mutation: reply sent before the save | 21 | 16 | 5 | 0 | Section 5.3. Reverted. |
| `npm run lint` (root, eslint on `services/world-api/src`) | - | - | - | - | Exit 0. |
| Typecheck and build (`tsc --project tsconfig.json`, run by `npm run build` and `npm test`) | - | - | - | - | Exit 0. |

Migration tests: not applicable. No schema change, and no migration was run.

CI results are recorded in the final report, after the push.

## 8. Known defects and residual risks

- **Single-writer file backend.** Exactly-once funding and the no-lost-update guarantee depend on one server process per
  file. PostgreSQL enforces this across processes. The file backend does not.
- **Memory ahead of storage** (section 5.4). A crash in that window loses the payment in full, and the payer was never
  told it was confirmed.
- **One funded treasury, one payee type.** Only `gov:min:finance` is funded. Only characters can be paid.
- **Older engine actions.** Only the treasury functions were reviewed for validate-then-write and for the durability
  gate. The older government and economy actions still change memory before a failure can occur.
- **Ambiguous legacy seats** (from Stage 31): pre-Stage 31 minister records at `gov:federal` are still left unchanged
  and carry no authority.
- **Carried, not changed:** session expiry (D-06), plaintext client credentials (CRED-1), unwired touch controls, mutation
  M4 not run, TLS live suite not run, multi-instance safety beyond the PostgreSQL version check untested.

## 9. Remaining blockers

1. **Business and organisation payees.** Refused. A receiving rule for a business (the owner's account) and for an
   organisation (its treasury) is needed. Each must be credited through the existing system, in the same write.
2. **Revenue, tax, fines, borrowing.** Still no route, and still unavailable by mission constraint.
3. **Funding amount and source.** ₦100m is the value chosen in the catalogue. The owner must confirm the amount and the
   source (the `rev:grant` category), or replace it.
4. **Single-writer file backend.** If the file backend is used with more than one process, one-time funding is not
   guaranteed. Either run one process per world file, or add a version check to the file backend. This is not done here.
5. **Governors and local officials** are still not seeded (Stage 31 blocker 4).

## 10. Owner decisions still required

1. Confirm the ₦100,000,000 initial grant to `gov:min:finance`, and its `rev:grant` category.
2. Confirm the self-dealing scope: the actor, active `parent_of`, `guardian_of`, `sibling_of`, `spouse`, and active
   marriages are refused. A broader conflict definition (G-7) is still open.
3. Confirm the per-payment limit: the economy's transaction limit applies to government payments.
4. Confirm the choice of payee rules for businesses and organisations before they are opened.

## 11. Next recommended stage

Stage 33 should open **business payees** through the existing economy, in the same atomic write and with the same
refusal rules. It should either leave the file backend single-process and say so, or add a version check to it before
any multi-process use. Revenue routes should stay closed until the funding source is decided.
