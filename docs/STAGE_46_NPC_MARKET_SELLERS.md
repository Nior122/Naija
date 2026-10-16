# Stage 46: NPC economic participation through market sales

**Status:** implemented and server-tested on both backends. The Godot client has no change for this stage and has not
been run. Treat any claim about the Godot market or shop screens as unverified.

## 1. What was inspected

Before choosing a feature, the NPC, employment, business, economy, and persistence code was read. This is the state
found at `3f9b63c` plus the Stage 45 working tree.

| Capability | State | Evidence |
|---|---|---|
| NPC residents (`npc-nb-*`) | Fixed neighbours with no money, no job, and no purchases | `docs/STAGE_42_NPC_SOCIAL.md`; no economy call in `npc/` |
| NPC occupations (`npcCareers`) | Scaffolding. Deterministic fixture status with no work sessions, no payroll, and no wage source | `careers/service.ts` `refreshNpcCareers`; `docs/CAREERS_AND_EMPLOYMENT_PLAN.md` "NPC foundation" |
| Career payroll for players | Works. Salary is posted through the ledger as `salary_credit` (`economyAccountPort`) | `careers/service.ts` `postSalaryPayment`; engine passes `economyAccountPort` |
| NPC-owned businesses (`seedNpcBusinesses`) | Exported and tested, but **not called** in the running world. Seed capital is an open issuance decision | `businesses/service.ts`; `docs/ECONOMY_PLAN.md` |
| NPC landlords and sellers (Stage 39) | Works. A non-player holder receives property money from players in the same ledger | `properties/service.ts` `creditHolder`; `openNonPlayerCashAccount` |
| Market purchases (`economy.action` `purchase`) | **Defect.** The buyer was debited and the ledger row had `counterparty_account_id: null`. Money left the economy with no receiver | `economy/service.ts` `purchaseMarketGood` (before Stage 46) |
| Market shelf (`shop.purchase`) | **Defect.** The price was taken from `character.money` only, with no ledger row. The cash account stayed unchanged, so the two balances disagreed | `multiplayer/world-engine.ts` `purchaseItem`; the new test fails on `cash account was debited: 1000 !== 900` before the fix |
| Careers salary helpers | A default `prototypeSalaryAccountPort` still exists. Every engine path passes the ledger port. `terminateCareerEmploymentAsEmployer` has no route, so it is dormant | `careers/service.ts` |

Conclusion: NPCs had no income and no spending. Two existing routes took money with no receiver, and the shelf did not
reach the ledger at all.

## 2. Why this feature

The long-term goal is that NPCs and players share one economy. NPC jobs, NPC wages, NPC-run businesses, and NPC
spending all depend on open decisions:

- **NPC wages.** Employers hold no funds. Paying a wage without a source would mint money, which is forbidden. The
  source of wage money is an open decision.
- **NPC seed capital and NPC business creation.** Open decision, and production NPC business creation is excluded by the
  Stage 44 rule.
- **NPC hiring.** Consent and vacancy rules are open decisions.
- **NPC spending.** Any spending rule, amount, or frequency would be an invented gameplay rule.

The one unblocked step is the receiving side. Money that players spend on market goods should reach a holder that
exists in the ledger, instead of disappearing. That gives NPC holders their first real income, through the same route
players already use, and it conserves money. It needs one provisional decision, that the seller receives the full price,
and that decision is recorded below.

## 3. What was implemented

- **Catalogue** (`game/data/economy/catalog.json`): a new `market_sellers` list with one entry,
  `market-seller:idera-market` ("Market stalls"), at the `market` location. Nine stall goods carry
  `seller_id`. Paracetamol, which is also sold at the clinic, and the two town bus fares have no seller.
- **Validation** (`services/world-api/src/economy/catalog.ts`): sellers need a label, a description, and valid
  locations. A good that names an unknown seller is refused, and so is a good sold at a location its seller does not
  cover. The catalogue requires `market_sellers`.
- **Sales** (`services/world-api/src/economy/service.ts`):
  - `purchaseMarketGood` checks the seller's balance limit before any debit. It then debits the buyer and credits the
    seller's cash account by the same amount. The buyer's row names the seller account as its counterparty. The
    seller's row has the new kind `market_sale`. The reply includes `seller`.
  - `purchaseShopItem` settles the market shelf in the same way. It debits the cash account with `market_purchase`,
    credits the market seller, and sets `character.money` from the account.
  - `cashBalanceForCharacter` is exported for the engine's pre-check.
- **Shelf** (`services/world-api/src/multiplayer/world-engine.ts`): `shop.purchase` checks and debits the cash account
  before the request is marked as processed. A failure returns the economy error code.
- **Persistence:** `market_sale` is added to the ledger kinds in `multiplayer/persistence.ts`. The holder's account is an
  ordinary economy account, and the existing validator accepts it.
- **Types:** `EconomyMarketSeller`, `EconomyMarketGood.seller_id`, `EconomyCatalog.market_sellers`, and the
  `market_sale` transaction kind.

### Rules as implemented

| Case | Result |
|---|---|
| Stall good at the market | Buyer debited, seller credited, both ledger rows linked. No money created. |
| Balance limit would be exceeded | `economy_seller_balance_limit`. Nothing changes. |
| Buyer cannot pay | `economy_insufficient_funds`. Nothing changes. |
| Withdrawal or transfer from the buyer's accounts to the holder | `economy_account_not_found`. |
| Interest, fees, or monthly processing on the holder | None. It has no bank product. |
| Good without a seller (paracetamol, bus fares) | Money leaves, as before. A documented gap. |
| Shelf item (`shop.purchase`) | Cash account debited and the market seller paid. Shelf prices and items are still hardcoded. |

## 4. Integration points

- Economy ledger and cash accounts (`economyAccounts`, `economyTransactions`, `economyEvents`).
- The economy purchase route (`economy.action` `purchase`) and the shelf route (`shop.purchase`).
- The Stage 39 non-player holder model (`openNonPlayerCashAccount`).
- Persistence validation, and the saved world (`durableState`).
- The engine's money reply and the character snapshot (`character.money` is set from the account).

## 5. Tests

`services/world-api/test/npc-market-sellers-stage46.test.mjs` has 11 tests on the file backend and 15 on PostgreSQL,
because the four socket tests run once per backend. It covers:

- **Catalogue:** stall goods point at the registered seller. Goods without one are listed as the documented gap. A bad
  seller reference is refused by validation.
- **Ledger:** a purchase moves money, and the total is unchanged. Repeated sales accumulate, with one row per sale.
  The balance-limit refusal happens before any debit. Withdrawals and transfers to the holder are refused. Monthly
  processing leaves the holder unchanged. A good without a seller still leaves the economy.
- **Socket (each backend):** a purchase pays the holder, and the saved world holds the holder's balance and the sale. A
  refused purchase changes nothing. A withdrawal from the holder is refused. The shelf debits the cash account and pays
  the holder.

Two existing fixtures were updated to match the new rules. Neither assertion was changed:

- `test/economy.test.mjs`: the catalogue negative case now includes the required `market_sellers` field, so it still
  reaches the rules check it targets.
- `test/economy-money-durability.test.mjs`: the shelf test sets the cash account as well as `character.money`, because
  the ledger is now the source of the shelf's debit.

The shared world builders are copied unchanged into `test/support/economy-world.mjs`.

## 6. Results

Recorded in `docs/DEVELOPMENT_STATUS.md`. The counts below were measured at the Stage 47 state, which includes the Stage 46
code and the Stage 47 changes. The Stage 46 run recorded the earlier figures, shown in brackets where they differ.

| Command | Result |
|---|---|
| `npm run build` (root) | exit 0 |
| `npm run lint` (root) | exit 0 |
| New test file, file backend | exit 0: 11 tests, 11 pass |
| New test file, PostgreSQL 18.4 | exit 0: 15 tests, 15 pass (per-file count measured after Stage 47) |
| Money, housing, property, business, and client suites, file backend (`money-routes-stage34`, `housing-rent-stage39`, `properties`, `property-*`, `business*`, `client-*`) | exit 0: 324 tests, 324 pass (the Stage 46 run recorded 288 for a similar but not identical file list) |
| Economy suites, file backend (`economy.test`, `economy-money-durability`) | exit 0: 33 tests, 33 pass |
| Economy and money files, PostgreSQL 18.4 | exit 0: 115 tests, 115 pass (Stage 46 run: 87, a smaller set) |
| Full file suite | exit 0: **1592 tests, 1538 pass, 0 fail, 54 skipped** (Stage 46 run: 1576, 1522, 0, 54) |
| Full PostgreSQL suite (PostgreSQL 18.4) | exit 0: **1914 tests, 1910 pass, 0 fail, 4 skipped** (the 4 are TLS live tests). The Stage 46 record's earlier figure of 1886 was never read from a log and is withdrawn. |

Godot 4.7.2: not run. No Godot binary is available in this sandbox.

## 7. Not verified, and limits

- **Godot.** No Godot run in this stage. Godot 4.7.2 is not available in this sandbox.
- **NPC earning is passive.** The holder receives money. No NPC chooses to sell, sets a price, restocks, or spends.
- **Revenue policy is provisional.** The seller receives the full price, with no supplier cost, tax, or stock limit.
- **Only nine goods** have a seller. Paracetamol and the bus fares still leave the economy.
- **Shelf items and prices** now come from the economy catalogue (Stage 47; values unchanged). The shelf's bottled water
  (₦100) and the market's `goods:water-50cl` (₦200) are still separate goods. This is an open decision (Stage 47 record).
- **Careers:** `prototypeSalaryAccountPort` is still the default in several exported careers functions.
  `terminateCareerEmploymentAsEmployer` has no engine route. The engine's paths pass the ledger port. Making the port
  required would make any future caller fail closed. That change is recorded as a follow-up and was not made here.
- **Restart.** Stage 47 adds a socket test that restarts the server and checks the seller's balance and the `market_sale`
  row on both backends.
- **Client display.** No panel shows the seller, and no panel reads the new `seller` field.
- **No Godot market screen.** The market is reachable only through the socket API (Stage 47 record, A11).

## 8. Decisions that remain open (not made here)

1. The NPC wage funding source. Until one exists, NPC jobs must not pay.
2. NPC seed capital and whether NPC businesses should exist.
3. Whether stall revenue carries supplier cost, tax, or a stock limit.
4. Resolved in Stage 47: the shelf's prices and items come from the catalogue. Their values are unchanged, and the
   bottled-water difference remains open (Stage 47 record, A7).
5. Whether paracetamol and the bus fares need sellers.

## 9. Next gameplay feature

The next step that depends on no open decision is to let the market holder's balance be seen by players, as a read-only
"Sold by" line in the market list, so the NPC earning is observable. After that, the Godot market flow needs a real
run. If open decision 1 is decided, the NPC wage path is the next economic feature. Until then, NPC work stays
scaffolding.
