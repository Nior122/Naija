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
- Godot client/runtime verification remains blocked (same as Stages 1–6).

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
