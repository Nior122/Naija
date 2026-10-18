# Stage 7 — Full Nigerian Economy

> **Future agents: read this file before changing the economy.** It distinguishes the implemented bounded Naira-denominated prototype from future-stage plans, and documents authority, persistence, and client integration boundaries.

## Scope

Stage 7 replaces the Stage 6 prototype salary adapter with an atomic canonical Naira ledger and adds a bounded simulation for prices, banking, transactions, tax estimation, and credit. It is implemented inside the same `nigeria-main` world and does not introduce a duplicate economy, external payment service, real banking integration, or production financial system.

### Implemented

- **Canonical Naira ledger:** Every character's cash balance is owned by an `economyAccounts` cash-account record. Salary credits from Stage 6 payroll flow through `economyAccountPort`, the same seam the careers service uses for idempotent payment posting.
- **Bank accounts:** Configurable savings, current, and fixed-deposit products with interest rates, monthly fees, withdrawal/transfer fees, daily withdrawal limits, and minimum balances.
- **Deposits, withdrawals, and transfers:** Atomic ledger entries that debit one account and credit another in the same JSON snapshot, with idempotency keys per transaction.
- **Market goods catalogue:** Food, health, transport, utilities, clothing, and other goods with Naira prices, hunger restoration values, and location availability. Purchases deduct from the cash account and restore hunger for food items.
- **Progressive PAYE income tax estimation:** Six configurable tax bands for monthly income; used for UI display only — no automatic deduction.
- **Credit scoring:** Per-character credit score (300–850 range) initialized at 500. Loans increase or decrease the score based on approval, repayment, and default events.
- **Loan products:** Personal, student, and business loans with configurable interest rates, term limits, origination fees, late-payment penalties, credit-score requirements, and employment checks.
- **Transaction history:** Every transaction is persisted with before/after balances, idempotency keys, references, and counterparty links.
- **Schema v4 persistence:** `PersistentWorldState` upgraded from schema 3 to schema 4, adding five new economy maps. Schema 1, 2, and 3 states auto-migrate to v4.

### Not implemented

- No real banking integration, payment gateway, or production ledger.
- No automatic tax deduction — tax estimation is display-only.
- No businesses, property, or government simulation (Stages 8–14).
- No inter-player transfers — all accounts are character-owned.
- No estate wage settlement, asset inheritance, or life-insurance flows.
- No price volatility, inflation modelling, or dynamic supply/demand.
- Godot client verification is partial. Headless runs of the existing scripts pass in the sandbox build, and the
  economy screens have not been run in Godot.

## Data boundaries

All economic data is fictional, configurable, and game-balanced. No real Nigerian bank, tax authority, employer, or financial-regulation data is referenced. The economy catalog at [`game/data/economy/catalog.json`](../game/data/economy/catalog.json) configures:

- **Rules:** Currency (NGN), balance/transaction limits, credit-score range, idempotency window.
- **Tax bands:** Six progressive PAYE bands from 7% to 26%.
- **Bank products:** Savings (0.35% monthly interest), current (0% interest, ₦100 monthly fee), fixed deposit (0.75% monthly interest).
- **Loan products:** Personal (2.5% monthly, up to ₦1M), student (0.5% monthly, up to ₦500K), business (3.0% monthly, up to ₦5M).
- **Market goods:** 12 items across food, health, transport, utilities, and clothing categories.

## Authority and integration

- The server owns all economy state. The Godot client sends `economy.action` commands over the existing authenticated WebSocket session and receives server-validated results.
- `economyAccountPort` replaces `prototypeSalaryAccountPort` as the career-to-economy seam. It credits salary into the character's cash ledger with idempotent deduplication.
- `processEconomyWorldDate` runs on every world-date rollover and accrues interest, charges monthly bank fees, and processes missed loan payments.
- The economy profile is included in the private `character.snapshot` projection — it is not part of public presence or world snapshots.

## Persistence

Schema version 4 adds five new maps:

| Map | Purpose |
|---|---|
| `economyAccounts` | Cash, savings, current, and fixed-deposit accounts per character. |
| `economyTransactions` | Atomic ledger entries with idempotency keys. |
| `economyLoans` | Loan records with principal, payments, and status. |
| `economyCreditScores` | Per-character credit scores with history. |
| `economyEvents` | Economy-specific lifecycle events. |

Schema 3 → 4 migration initializes empty economy maps and creates cash accounts with existing character balances. Schema 1 and 2 states continue to migrate through 3 to 4 as before.

## Checks

```sh
npm run check                    # lint + 64 Node tests (48 retained + 16 economy)
node --test services/world-api/test/economy.test.mjs   # focused Stage 7 suite
```

## Next roadmap line

**Stage 8 — Player Businesses.** Stage 7 must remain the economic authority before businesses add staffing, costs, stock, compliance, and customer demand.

## Business money and employment (Stage 43)

- Every business money movement is an `economyTransactions` row with one of these kinds: `business_setup_fee`,
  `business_capital`, `business_withdrawal`, `business_sale`, `business_purchase`, `business_salary`, `business_expense`,
  `business_transfer`, `business_seed_capital`, `business_legacy_import`. Each row carries an idempotency key derived from
  its transaction ID. Business money is refused, with no change, if the authority, funds, or account checks fail.
- **Salary** is paid from the business account to the employee's cash through `business_salary`. Only an owner or
  co-owner can pay. A career salary is still issuance into the employee's cash, with no employer debit. That policy is
  unchanged in Stage 43 and is recorded in `docs/STAGE_43_BUSINESS_LIFECYCLE.md` section 4.1.
- **Seed capital** (`business_seed_capital`) is issuance with no source. It is used only by `seedNpcBusinesses`, which
  nothing calls in the running world. A source policy is an open decision.
- **Closure** requires a zero business balance. Stock is written off without money, and no money is recovered. Nothing
  financial is deleted.
- **Failed changes** leave no partial money or ledger change. Every changing business request is run under a snapshot of
  the business maps, the economy accounts and ledger, and each player's cash.
- The check that the saved world reconciles (`businessAccountMismatches`, Stage 40) still applies.

## Non-player cash accounts and property money (Stage 39)

- A non-player holder that receives property money (an NPC landlord or seller) gets one cash account in `economyAccounts`, with `character_id` set to the NPC's ID and `bank_product_id` null. It is opened when first credited. The interest and fee loops skip it, because they only charge accounts with a bank product. No player route can act on it, because player routes act only on the session character's accounts.
- Property money moves write `economyTransactions` rows with the kinds `rent_payment`, `rent_receipt`, `property_purchase`, `property_sale_proceeds`, `property_furnishing`, and `property_maintenance`. Each row is written in the same mutation as its balance change.
- Business, government, and other organisation holders are not credited. Their property payments are refused before any debit. The shared business-account model is still outstanding (Stage 34).

## Market stall holder and market sales (Stage 46)

- The economy catalogue lists `market_sellers`. Stage 46 adds one, `market-seller:idera-market` ("Market stalls"), at the
  `market` location. It is a non-player holder, like the Stage 39 landlords and sellers: it has one cash account in the
  ledger and no character record. No NPC decides its prices, stock, or spending.
- Nine market goods name that seller with `seller_id`. Every other good has no seller. Paracetamol is sold at the market
  and at the clinic, and the clinic has no seller, so it has none. The two bus fares at the town are not stall goods.
- A purchase of a seller's good (`economy.action` `purchase`) debits the buyer and credits the seller by the same amount.
  The buyer's row names the seller account as its counterparty. The seller's row has the kind `market_sale`, and the
  buyer's account as its counterparty. No money is created or destroyed by a sale.
- The seller's balance limit is checked before any debit. A sale that would take the seller over
  `maximum_account_balance_ngn` is refused with `economy_seller_balance_limit`, and nothing changes.
- The seller account is outside player reach. A withdrawal or a transfer from a player's own accounts to it is refused
  with `economy_account_not_found`. Interest and fee processing skip it, because it has no bank product.
- Goods without a seller still leave the economy, as before. This is a documented gap for the owner to decide, not a new
  rule. The same applies to the bus fares and paracetamol.
- The market shelf (`shop.purchase`) was a defect before Stage 46. The price was taken from `character.money` only, with
  no ledger row. The cash account, which the ledger uses, stayed unchanged, so the two balances disagreed. Any later sync
  from the ledger (`syncCharacterCashFromEconomy`) overwrites `character.money` with the account balance. It now debits the cash
  account with a `market_purchase` row and pays the market seller. Stage 47 moved the item list and prices into the
  catalogue (`shelf_items`, values unchanged). Bottled water is 100 on the shelf and 200 as a market good. Those are
  different goods, and the difference is an open decision.
- Revenue is the full price, with no supplier cost, no tax, and no stock limit for stall goods. Those are unresolved
  economy policies. Stage 46 does not decide them.

## Fixed fees, the shelf catalogue, and buyer location (Stage 47)

- **Fixed fees are ledger rows.** The town bus stop fare (₦150) and basic clinic care (₦300) are catalogue entries in
  `fixed_charges`, with kinds `bus_fare` and `clinic_payment`. Each charge debits the cash account and posts one ledger
  row with no receiving account. No operator is decided. Before Stage 47 these were debited from `character.money` only,
  and any later ledger sync reversed them.
- **Shelf items are catalogue entries.** `shelf_items` holds meat pie (₦350) and bottled water (₦100), with their hunger
  restore. The shelf route reads them. The values are unchanged.
- **Buyer location.** A market purchase requires the buyer's current location to be the market they buy from. This is a
  location-equality check, not a distance rule.
- **Hunger.** A market purchase restores hunger for each unit bought, capped at 100. Goods are eaten on purchase.
- **Open:** whether the bus stop fare and the market's town bus good (₦300) should be one price; who receives fees;
  whether market goods need stock. Education and careers money writes still bypass the ledger.
