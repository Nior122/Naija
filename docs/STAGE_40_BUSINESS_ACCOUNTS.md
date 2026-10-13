# Stage 40: business accounts and money-safe business operations

Status: design written before implementation. Implementation and its results are recorded at the end of this document.

## 1. Why this stage exists

Stage 33 (section 5 and section 11) and Stage 34 kept business payments closed until a shared business-account model
existed. The inspection in this stage found two problems that were worse than "payments closed":

1. **Business money was not in the economy ledger.** A business held money only as `business.balance_ngn`. Capital,
   withdrawals, expenses, production, and daily costs changed that number, or a player's cash account, with no ledger row
   for the business side. The business journal (`businessTransactions`) was a second, unreconciled record of money.
2. **Revenue could be created from nothing.** The engine action `sell_product` (and `sell_service`) accepted a
   `buyer_character_id` from the client and credited the business. `sellProduct` did not check that the caller owned the
   business, did not debit any buyer, and did not check that the buyer existed. Any connected player could credit any
   business's balance, and its owner could then withdraw the money.

Other money defects found in the same code, all fixed here:

- `restockInventory` changed stock before checking that the business could pay the cost, so a refusal could leave
  inventory changed.
- `closeBusiness` did not require a zero balance, so money could be left in a closed business that no one could withdraw.
- `seedNpcBusinesses` set `balance_ngn` directly, so NPC businesses started with money that no ledger row recorded.
- `createBusiness` contained a fallback that debited the legacy `character.money` field. It was unreachable, because the
  cash-balance check ran first, but it was a second money path and is removed.

## 2. Decisions

### 2.1 One economy account per business (the shared account)

Each business has exactly one economy account, `kind: "current"`, `bank_product_id: null`, and `status: "active"`. It is
opened when the business is created, when an NPC business is seeded, or by the legacy migration (section 4). Its key is
`accountKey(business_id, "current", "business")`.

The account is the only place business money is held. The economy's `character_id` field holds the account's holder id.
For a business that holder is the `business_id`, following the same convention as Stage 39 NPC cash accounts. No player
endpoint lists or spends a business account, because player routes look accounts up by the caller's own character id.

### 2.2 Ownership rule for the shared account

Stage 33 asked for one of three rules: one owner, all owners, or a designated account. The rule chosen is:

- **Every active `owner` or `co_owner` of the business is equally authorised to move business money.** Authority is
  checked on the server for every action, against the business's active ownership records.
- **Money paid out of the business goes to the acting person's own cash account.** An owner who withdraws receives the
  money in their own cash account. A business never pays "to the owner" in general, so no single receiving account has to
  be chosen.
- **`share_percent` is not enforced for withdrawals.** Stage 40 does not distribute profit by share. A co-owner can
  withdraw up to the account balance. This is a documented limit (section 5). It matches the authority that `withdraw`
  already gave co-owners before this stage.
- Managers, accountants, and inventory managers cannot withdraw, pay salaries, or transfer money. They can still spend
  business money on the operations in section 2.4 (stock, production, and operating expenses), as before.

### 2.3 Money moves only through the economy ledger

Every money movement is written as one economy transaction row per affected account, in the same mutation as the balance
change. The helper that does this is the only way to change a business account or a cash account from business code.
It:

- checks that every account involved is `active`;
- checks that the debited account has enough funds and that the credited account stays under
  `maximum_account_balance_ngn`, **before** it changes anything;
- changes both balances, sets `total_deposited_ngn` and `total_withdrawn_ngn`, writes each row with `balance_before_ngn`
  and `balance_after_ngn`, and sets `counterparty_account_id` when there are two sides;
- refreshes `business.balance_ngn` from the account, so that the business record shows the same figure (a projection,
  not a second balance);
- refreshes the player's `character.money` from its cash account, as `syncCharacterCashFromEconomy` already does.

The business journal (`businessTransactions`) is kept as the business-facing history. Each journal entry for a movement
now carries `economy_transaction_id`, which points to the ledger row on the business account. The journal is not a
ledger: its amounts and balances are copies of the ledger rows.

### 2.4 Which operations exist, and where their money goes

| Operation (engine action) | Debit | Credit | Who may do it | Ledger kinds |
|---|---|---|---|---|
| `create` (setup fee) | owner cash | none (fee, sink) | any eligible character | `business_setup_fee` |
| `create` (initial capital) and `contribute_capital` | owner cash | business account | owner, co-owner | `business_capital` |
| `withdraw` | business account | caller's cash | owner, co-owner | `business_withdrawal` |
| `buy_product` / `buy_service` (replaces `sell_product` / `sell_service`) | buyer cash | business account | any character other than the business's owners | `business_purchase` / `business_sale` |
| `pay_salary` (new) | business account | employee's cash | owner, co-owner; the employee must be an active employee of this business | `business_salary` |
| `transfer_funds` (new) | source business account | destination business account | owner or co-owner of both businesses | `business_transfer` |
| `record_expense` (kinds `operating` and `rent` only) | business account | none (expense, sink) | owner, co-owner, manager, accountant | `business_expense` |
| `restock` (stock cost) | business account | none (supplier cost, sink) | owner, co-owner, manager, inventory manager | `business_expense` |
| `produce` (operating cost) | business account | none (sink) | owner, co-owner, manager | `business_expense` |
| daily operating cost (world date) | business account | none (sink) | system | `business_expense` |
| NPC seeding (initial capital) | none | NPC business account | system | `business_seed_capital` (issuance, see 2.6) |
| legacy import | none | business account | system, once per business | `business_legacy_import` (see section 4) |

Sinks are payments to something the model does not hold: an operating cost, a supplier, or a setup fee. The economy
already treats market purchases this way, so Stage 40 does not add new sinks. They are listed so that the total money
in the world can be explained.

The following are **not** supported, and each is refused with a stable code:

- Any `sell_product` or `sell_service` action from a seller. The code is `business_sale_must_be_purchase`. Sales happen only
  when a buyer pays from their own cash account.
- A purchase by an owner of the same business (`business_self_purchase`).
- `record_expense` with kind `salary`. Salaries use `pay_salary`, which has a destination (`business_salary_use_payroll`).
- A salary to anyone who is not an active employee of that business (`business_salary_employee_invalid`).
- A transfer to a business the caller does not own (`business_transfer_not_permitted`).
- Closing a business while its balance is not zero (`business_balance_not_empty`). The owner must withdraw first.

### 2.5 Income: the only source is a buyer's payment

Business revenue exists only when a buyer's cash moves into the business account in the same mutation. Nothing else
creates revenue. There is no seller-side sale, no unpaid sale, and no automatic income.

The client identifier never credits a business on its own. The buyer is the authenticated session character. A
`buyer_character_id` in the payload is ignored.

### 2.6 Remaining issuance: NPC seed capital

`seedNpcBusinesses` still credits each new NPC business with three times its setup cost, because NPC businesses have no
income and would otherwise be insolvent on creation. That credit is money that has no source. Stage 40 does not remove it
(doing so would make every NPC business insolvent and change world behaviour without a decision). It is now an explicit
ledger row, `business_seed_capital`, with no counterparty, so that it is visible and totals can be reconciled. It is
recorded as a known issuance and is a remaining gap (section 5).

### 2.7 Authority, idempotency, and persistence

- Identity and authority are derived on the server. The engine uses the session character for every action. Payload
  character ids are used only as the named counterparty (a salary employee, or a transfer destination), and each one is
  checked.
- Duplicate application is prevented by the existing request gate, which the Stage 34 and Stage 36 tests already cover:
  a repeated request ID with the same action and payload is answered as a duplicate, and a repeated ID with a different
  payload is refused. Business changes use that gate. The ledger rows also carry an idempotency key, but it is a unique
  key for each movement, not a lookup key. The request gate is the control.
- Every business change is confirmed only after a save covers it (Stage 34). A failed save is `business_not_saved`, and a
  save that may have committed is `business_outcome_unknown`.
- **Single writer.** The file backend supports one process (Stage 33 section 3, the lock). PostgreSQL is the only multi-host
  path. Stage 40 does not add any multi-host guarantee for business money, and the tests do not claim one.

### 2.8 Validation at load

A world whose business record shows one balance and whose account shows another is refused at load, with the same kind
of message used for treasury mismatches (Stage 31). A world without an account for a business is not refused; the
migration in section 4 creates the account.

## 3. Invariants

These must hold after every business action, and the tests check them:

1. For each business account, `balance_ngn` equals the sum of its credit rows minus the sum of its debit rows, and
   `total_deposited_ngn` and `total_withdrawn_ngn` equal those sums.
2. `business.balance_ngn` equals its account's `balance_ngn`.
3. Money is conserved across each action: the sum of all cash and business account balances changes only by the
   documented issuance (`business_seed_capital`, `business_legacy_import`) and sinks (`business_setup_fee`,
   `business_expense`).
4. No business balance and no player cash balance goes negative.
5. A refused action changes no account, ledger row, inventory record, or business record.
6. A business revenue increase is always matched by a buyer debit in the same mutation.

## 4. Migration of legacy business balances

The existing saves contain businesses with `balance_ngn` and no business account. Stage 40 converts them with an explicit,
logged step, `migrateLegacyBusinessAccounts`, which runs when a world is loaded and is safe to run more than once:

- A business with no account gets one. If its `balance_ngn` is positive, the migration writes one
  `business_legacy_import` credit row for exactly that amount, with no counterparty, and a business event
  `legacy_balance_imported` that records the amount.
- The import changes no player money. The amount was already recorded on the business, so the world's total is unchanged.
  The migration also records `legacy_recorded_revenue_ngn` (the business's old `total_revenue_ngn`) in the event. Some
  of that revenue came from the unrestricted `sell_product` path, so a later reconciliation has to check it.
- A business that already has an account is not touched. If its record and its account disagree, the world is refused at
  load (section 2.8). Nothing is converted silently.
- A repeated migration finds the account and does nothing.

## 5. Scope limits (remaining gaps)

- **Client UI.** The Godot client has no business commands or screens. The server operations are the only player-facing
  surface for businesses in this stage. Client integration is a remaining gap (section 6).
- **Shares.** No profit distribution by `share_percent`. Co-owners share the account without a split.
- **Supplier and operating costs** are sinks. There are no supplier or landlord accounts for businesses.
- **NPC seed capital** is issuance without a source (section 2.6).
- **Legacy unverified revenue** cannot be separated from valid revenue (section 4).
- **Single writer.** No multi-host guarantee for business money.
- **Taxes, fines, borrowing, minting, and revenue** remain suspended. Stage 40 does not activate any of them.

> **Stage 43 update.** The client for these actions is now implemented in the business panel (not runtime-verified
> in Godot). See `docs/STAGE_43_BUSINESS_LIFECYCLE.md` section 2. The text below is the Stage 40 record of what was needed.

## 6. Client integration still needed

The Godot client needs a business screen. It must call `business.action`, with these actions and payloads:

- `discover`, `view` (read only)
- `create` (`template_id`, `name`, `description`, `location_id`, `initial_capital_ngn`)
- `contribute_capital`, `withdraw` (`business_id`, `amount_ngn`)
- `buy_product`, `buy_service` (`business_id`, `product_record_id`, and `quantity` for products). These replace `sell_product`
  and `sell_service`.
- `pay_salary` (`business_id`, `employee_character_id`, `amount_ngn`)
- `transfer_funds` (`business_id`, `to_business_id`, `amount_ngn`)
- `record_expense` (`business_id`, `kind`, `amount_ngn`, `description`)

Every changing action must send a unique `requestId`. The client must show a result only after `business.result`, and it
must show `business_not_saved` and `business_outcome_unknown` as failures. Godot is not installed in this sandbox, so this
client work is not tested here.

## 7. Implementation results

### 7.1 What changed

- **Ledger:** every business money movement writes economy ledger rows (`business_*` kinds, added to the economy types and
  the persistence allow-list). The business account is an economy account (`kind: "current"`, `bank_product_id: null`).
- **Money helper:** `postBusinessMoney` is the one path that changes a business or cash account. It checks everything
  before it changes anything.
- **Journal:** each `businessTransactions` entry carries `economy_transaction_id`. Its balances are copied from the ledger row.
- **Operations:** create (setup fee and capital), capital, withdraw, `buy_product` and `buy_service` (replacing
  `sell_product` and `sell_service`), `pay_salary`, `transfer_funds`, expenses (`operating` and `rent` only), restock,
  production, daily operating cost, NPC seeding, and close (which now needs a zero balance).
- **Load:** `validateState` runs `migrateLegacyBusinessAccounts` and then `businessAccountMismatches`. A world that does not
  reconcile is refused.
- **Client:** unchanged. There is no business UI in the Godot client (section 6).

### 7.2 Defects found and fixed

| Defect (before Stage 40) | Fix |
|---|---|
| A client could credit any business with a sale. `sell_product` took the buyer from the payload and did not check ownership. | Revenue exists only as a buyer's payment. The payload buyer is ignored, and a seller's sale is refused. |
| Restock changed stock before checking that the cost could be paid. | Every check comes first, and a refused restock changes nothing. |
| Close did not require a zero balance, so money could be stranded. | Close refuses while the balance is above zero. |
| NPC seeding set the balance directly, with no ledger row. | An explicit `business_seed_capital` issuance row. |
| The daily operating cost was counted twice in `total_expenses_ngn`. | The journal alone updates totals. |
| Create had an unreachable fallback to `character.money`. | Removed. |
| Business money was not in the economy ledger. | Business accounts are economy accounts, and every move writes rows. |

### 7.3 Tests and results

- `test/business-accounts-stage40.test.mjs`: 13 service tests on the in-memory fixture, and 8 socket tests per backend. On the
  file backend this is 21 tests, and with PostgreSQL it is 29. The socket tests cover buyer payment, the refused sale, the
  payer identity, a repeated request ID, a reused ID with a different payload, a failed save, payroll and transfers, a
  tampered saved world refused at load, and a restart.
- `test/businesses.test.mjs`: updated for buyer-paid sales and the zero-balance close. 22 of 22 pass.
- `test/business-money-stage34.test.mjs`: unchanged. 8 of 8 on the file backend, and its PostgreSQL variant ran in the live run.
- `test/support/business-world.mjs`: the in-memory world fixture, moved from `businesses.test.mjs`.
- Full run, file backend (`npm test`, no database): 1372 tests, 1318 pass, 0 fail, 54 skipped (PostgreSQL-only), 0 TODO.
- Full run, live PostgreSQL 18 (an embedded server from the npm package `@embedded-postgres/linux-x64` 18.4, on a scratch
  database `naija_test`, with `NAIJA_ALLOW_DB_TESTS=true`): 1638 tests, 1634 pass, 0 fail, 4 skipped, 0 TODO. The 4 skips
  need a separate TLS-enabled server (`TLS_TEST_DATABASE_URL`), which was not available.
- `eslint services/world-api/src`: clean.

### 7.4 Remaining business gaps (see also `docs/PHASE_1_FEATURE_INVENTORY.md`, row 11)

- **No client UI.** The Godot client cannot run any business action (section 6). Godot is not installed in this
  sandbox, so the client work is not tested.
- **Shares are not enforced.** `share_percent` is recorded, but co-owners can withdraw without a split (section 2.2).
- **Sinks, not counterparties.** Operating costs, supplier stock, and setup fees are sinks, because no supplier or landlord
  accounts exist.
- **NPC seed issuance.** NPC businesses still start with money that has no source (section 2.6). A world-issuance policy is needed.
- **Legacy revenue cannot be verified.** A business that earned revenue through the removed `sell_product` path keeps its
  recorded total. The `legacy_recorded_revenue_ngn` figure is kept so that an operator can reconcile it.
- **Single writer only.** The file backend supports one process. No multi-host guarantee is claimed for business money.
- **NPC businesses have no income** of their own. They earn only what players buy, so they become insolvent without buyers.
- **Suspended mechanisms unchanged.** Tax, fines, borrowing, minting, and revenue remain closed.
