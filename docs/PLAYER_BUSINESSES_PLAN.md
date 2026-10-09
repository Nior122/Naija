# Stage 8 — Player Businesses and Entrepreneurship

> **Future agents: read this file before changing the business system.** It documents the implemented bounded business simulation, its integration with Stage 6 (careers) and Stage 7 (economy), and the boundaries that later stages (property, government, etc.) must respect.

## Scope

Stage 8 adds a configurable business simulation where players can establish, own, operate, and grow businesses within the shared Nigerian world. Businesses connect to Stage 6 (employment) for hiring and Stage 7 (economy) for financial operations. It is implemented inside the same `nigeria-main` world and does not introduce a second business or payment system.

### Implemented

- **Business catalogue:** Configurable templates across 10 categories (retail, food, tech, trades, agriculture, transport, creative, professional, manufacturing, other) with 13 active templates, 22 business products, and 5 production recipes.
- **Business creation:** Server-validated name, description, template, location, setup cost, and initial capital. Atomic creation with setup-cost deduction from the owner's personal cash account and capital contribution to the business ledger.
- **Ownership:** Sole ownership with role-based permissions (owner, co-owner, manager, accountant, inventory-manager, employee). 100% share for sole owners. Authorization checks on every sensitive action.
- **Products and services:** Businesses can add catalogue products with custom pricing within configured markup bounds. Both product-based (inventory) and service-based sales are supported.
- **Inventory and stock:** Persistent stock records with restocking, sale deductions, production outputs/inputs, and movement history. No negative stock, no free stock, no client-side creation.
- **Business financial accounts:** Separate business ledger distinct from owner's personal wallet. Capital contributions, owner withdrawals, sales revenue, operating expenses, rent, salary, and production costs — all through the shared Stage 7 economy transaction ledger.
- **Production:** Configurable recipe system that consumes input inventory, charges operating costs, and produces output inventory. Atomic production runs with idempotent deduplication.
- **Operating costs:** Daily operating and premises costs charged on world-date rollover. Insufficient funds lead to business insolvency status.
- **Business lifecycle:** Active, suspended, closed, and insolvent statuses. Closure preserves all history.
- **Business discovery:** Server-side listing of active businesses by location, sorted by reputation.
- **Schema v5 persistence:** `PersistentWorldState` upgraded from schema 4 to schema 5, adding eleven new business maps. Schema 1–4 states auto-migrate to v5.
- **Reputation:** Starting score of 50, incremented on successful product/service sales, capped at catalogue maximum.
- **Age eligibility:** Configurable minimum owner age per template (18+). Young characters (15–16) cannot create formal businesses.
- **Branches and expansion:** Business owners can open up to 5 branches with configurable name, location, and premises type. Branch records are persisted and appear in business profiles.
- **Ownership transfer:** Original owner can transfer full ownership to another character with configurable role and share percentage. Previous ownership is deactivated and an event is recorded.
- **Employee hiring/firing:** Owners, co-owners, and managers can hire characters as employees (respecting per-template employee limits). Employees can be released with a reason. All changes are event-recorded.
- **NPC business seeding:** `seedNpcBusinesses` creates NPC-owned businesses from the template catalogue with initial products. Idempotent — calling again does not duplicate businesses for NPCs that already own one.

### Not implemented

- No multi-owner share distribution (only single-owner transfer is supported; splitting shares among multiple co-owners is not yet wired).
- No property/real-estate integration (Stage 9).
- No government, taxation integration, or business licensing beyond template-level age rules.
- No scheduled NPC business simulation (NPC businesses are seeded but do not autonomously trade or grow).
- Godot client/runtime verification remains blocked (same as Stages 1–7).

## Data boundaries

All business data is fictional, configurable, and game-balanced. No real Nigerian regulatory, tax, or market data is referenced. The business catalog at [`game/data/businesses/catalog.json`](../game/data/businesses/catalog.json) configures:

- **Rules:** Max businesses per character (3), max branches (5), max employees (20), max products (50), max stock per product (10,000), name/description length limits, price markup bounds, reputation range, withdrawal/contribution caps.
- **Categories:** 10 categories (A–J) covering retail, food, tech, trades, agriculture, transport, creative, professional, manufacturing, and other.
- **Templates:** 13 active templates with setup costs (₦50K–₦250K), monthly operating costs, rent costs, employee limits, location restrictions, and production recipe requirements.
- **Business products:** 22 products across food, health, clothing, utilities, furniture, and service categories with base cost and base price.
- **Production recipes:** 5 recipes for jollof rice, grilled fish, eggs, wooden chairs, and tailored shirts with input/output quantities and operating costs.

## Authority and integration

- The server owns all business state. The Godot client sends `business.action` commands over the existing authenticated WebSocket session and receives server-validated results.
- Business financial operations use the business's internal ledger (balance, revenue, expenses, capital, withdrawals) which is separate from the Stage 7 economy accounts. Capital contributions debit the owner's cash account; owner withdrawals credit it.
- `processBusinessWorldDate` runs on every world-date rollover and charges daily operating/rent costs, detecting insolvency.
- Business profiles are included in the private `character.snapshot` projection for owned businesses.

## Persistence

Schema version 5 adds eleven new maps:

| Map | Purpose |
|---|---|
| `businesses` | Business records with name, status, balance, reputation, totals. |
| `businessOwnership` | Ownership records with role, share, founder status. |
| `businessBranches` | Branch records (foundation, not yet wired). |
| `businessProducts` | Product offerings with custom pricing. |
| `businessInventory` | Stock records per product per location. |
| `businessInventoryMovements` | Stock movement audit trail. |
| `businessTransactions` | Internal financial ledger with idempotency keys. |
| `businessExpenses` | Expense records (foundation). |
| `businessSales` | Sale records with buyer, quantity, price. |
| `businessProductionRuns` | Production run records with inputs/outputs. |
| `businessEvents` | Business lifecycle event log. |

Schema 4 → 5 migration initializes empty business maps. Schema 1–3 states continue to migrate through 4 to 5 as before.

## WebSocket commands

| Action | Description |
|---|---|
| `discover` | List active businesses by location plus catalogue templates/categories. |
| `create` | Create a new business with template, name, description, location, and initial capital. |
| `view` | View a full business profile. |
| `add_product` | Add a catalogue product to the business with optional custom price. |
| `restock` | Restock inventory by purchasing units at a given cost. |
| `sell_product` | Sell product units to a buyer (or anonymous). |
| `sell_service` | Sell a service to a buyer (or anonymous). |
| `contribute_capital` | Owner contributes personal funds to the business. |
| `withdraw` | Owner withdraws eligible funds from the business. |
| `record_expense` | Record an operating expense (rent, salary, other). |
| `produce` | Run a production recipe consuming inputs and producing outputs. |
| `close` | Close the business, preserving all history. |
| `add_branch` | Open a new branch at a location with a given premises type. |
| `transfer_ownership` | Transfer full ownership to another character with a new role and share. |
| `hire_employee` | Hire a character as an employee (respects per-template employee limits). |
| `fire_employee` | Release an employee from the business with an optional reason. |

## Checks

```sh
npm run check                    # lint + 86 Node tests (48 retained + 16 economy + 22 business)
node --test services/world-api/test/businesses.test.mjs   # focused Stage 8 suite
```

## Next roadmap line

**Stage 9 — Housing and Property.** Stage 8's business premise types are placeholder references; Stage 9 will provide real property ownership and rental contracts that businesses can connect to.
