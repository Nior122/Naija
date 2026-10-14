# Stage 45: business production (client and integration)

**Status:** implemented on the server (no behaviour change) and in the existing Businesses panel. Server behaviour is
tested through the socket on both backends. **The Godot panel has not been run in Godot.** Godot 4.7.2 is not available
in this sandbox, so the production form has been parse-checked and linted only. Do not treat it as runtime-verified.

## 1. Why this feature

`produce` was the one business operation with a complete server route and no client. Phase 1 inventory row 11 and
Stage 43 section 2 both list it as a gap. Without it, a business can buy stock but cannot turn that stock into the goods
and food it sells, so the business loop is incomplete.

Other candidates were not chosen, for these reasons:

- **`record_expense`.** It is a money sink with no rule of its own. A button would only let a player burn balance, so
  it stays a gap.
- **Co-owner add and remove.** Recipient consent is an open owner decision, and the co-owner rules are unresolved.
- **NPC jobs, hiring, and production.** NPC seed capital, hiring consent, and autonomous NPC activity are not enabled.
  Nothing here enables NPC activity.
- **World events and transport.** Both are MISSING, and both need a design or economic policy first.

## 2. What was implemented

- **Client contract** (`game/scripts/domain/property_business_contract.gd`): `produce` takes `business_id` and
  `recipe_id`. It is a changing action. The owner, co-owner, and manager roles match the server's `runProduction`.
  `production_recipes_for(template_id)` reads the recipes from `game/data/businesses/catalog.json`, the same file the
  server reads.
- **Panel** (`game/scripts/ui/business_panel.gd`): a "Production" section in the owner's actions. It appears only for
  templates that require production. Each row shows the inputs, the output, and the operating cost. Produce asks for
  confirmation. It then uses the existing change tracker, so one request is pending at a time and the button is disabled
  while it waits. The panel refreshes from the server's `business.result`. A refusal shows the server's message.
- **Server:** no change to any rule. The `produce` case in `world-engine.ts` and `runProduction` in
  `businesses/service.ts` are unchanged.
- **Tests:**
  - `services/world-api/test/business-production-stage45.test.mjs` is new: five socket tests on each backend.
  - `services/world-api/test/client-housing-business-stage41.test.mjs` is updated. The action counts are 20 (was 19)
    and the changing count is 18 (was 17). The role-agreement check now includes `produce` against `runProduction`.

## 3. Rules as implemented (the server decides every run)

| Recipe (catalogue ID) | Templates | Inputs | Output | Operating cost |
|---|---|---|---|---|
| Crate of Eggs (`recipe:eggs-tray`) | poultry farm | none | 2 × eggs tray (goods) | ₦300 |
| Wooden Chair (`recipe:wooden-chair`) | furniture workshop | none | 1 × wooden chair (goods) | ₦2,000 |
| Tailored Shirt (`recipe:tailored-shirt`) | tailoring shop | none | 1 × tailored shirt (goods) | ₦500 |
| Jollof Rice Plate (`recipe:jollof-rice`) | restaurant | 1 × rice 5 kg, 1 × palm oil 1 l | 5 × jollof rice plate (food) | ₦500 |
| Grilled Fish Plate (`recipe:grilled-fish`) | restaurant, food stall | 1 × whole chicken | 3 × grilled fish plate (food) | ₦400 |

- **Who:** an owner, co-owner, or manager of an active business. A stranger is refused with
  `business_unauthorized` (tested). The server applies the same role check to every other character, including an
  employee. That case is not tested separately.
- **Inputs:** the stock must already be held at the business's primary location. A shortfall is refused with
  `business_insufficient_input_stock`.
- **Funds:** the operating cost is taken from the business account before any stock moves. A shortfall is refused with
  `business_insufficient_funds`.
- **Stock limit:** the output must fit under the 10,000-unit limit. Otherwise it is refused with
  `business_stock_limit_exceeded`.
- **Atomicity:** every refusal runs inside the existing `runBusinessChange` snapshot. Stock, the business account, the
  buyer's cash, and the history are all unchanged.
- **Duplicates:** the same request ID runs once and gets `command.duplicate` the second time.
- **Ledger:** a run posts an economy debit (`business_expense`), a `production_cost` business transaction, a
  `production_output` inventory movement, and a `production_completed` event.
- **Timing:** a run completes at once. The catalogue's `duration_minutes` is not used. It is not enforced by the server
  and the panel does not show it.

### Produced goods are sold from stock

Every current recipe output is a stock product (category `goods` or `food`). A sale of such a product uses
`buy_product`, which takes units from the same inventory that production fills. The socket test runs the full path:
produce, list, buy, and check the stock and balances.

**Naming inconsistency, not changed.** Jollof rice and grilled fish have `biz-service:` IDs, but their category is
`food`. The server and client both route by category, so both treat them as stock products. `add_service` refuses them
(`business_service_is_product`). Renaming the IDs would change persisted product references, so it needs a migration and
an owner decision. It is recorded here and in the test file, and nothing else was changed.

## 4. Verification

| Command (run from the repository, or `services/world-api` where stated) | Result |
|---|---|
| `npm run build` (root; `tsc`) | exit 0 |
| `npm run lint` (root; ESLint on `services/world-api/src`) | exit 0 |
| `cd services/world-api && NAIJA_ENV=test node --test test/business-production-stage45.test.mjs` (file backend) | exit 0: 5 tests, 5 pass |
| Same file with `DATABASE_URL=postgres://naija@127.0.0.1:5432/naija_test?sslmode=disable DB_SSL=false NAIJA_ENV=test NAIJA_ALLOW_DB_TESTS=true` (PostgreSQL 18.4) | exit 0: 10 tests, 10 pass (5 per backend) |
| `cd services/world-api && NAIJA_ENV=test node --test test/client-housing-business-stage41.test.mjs test/business-errors-stage44.test.mjs test/business-client-stage41.test.mjs test/client-business-errors-stage44.test.mjs` | exit 0: 47 tests, 47 pass |
| Full file suite: `cd services/world-api && env -u DATABASE_URL NAIJA_ENV=test node --test test/*.test.mjs` | exit 0: **1565 tests, 1511 pass, 0 fail, 54 skipped** |
| Full PostgreSQL suite (same environment as the CI live job, PostgreSQL 18.4) | exit 0: **1871 tests, 1867 pass, 0 fail, 4 skipped** (the 4 are TLS live tests) |
| `gdparse` on `game/scripts/domain/property_business_contract.gd` and `game/scripts/ui/business_panel.gd` | exit 0 |
| `gdlint` on the same two files | no findings in the new code. The one finding is `business_panel.gd` at 1,227 lines (limit 1,000). It was 1,188 before this stage. The Stage 44 rule is not to split the panel for the lint threshold, so this stays a documented follow-up. |

## 5. Not verified, and limits

- **Godot.** The panel's production form has not run in Godot. Nothing here shows that the button, the confirmation, the
  refresh, or the layout works on screen.
- **Duration.** Production is instant. The catalogue's `duration_minutes` is ignored.
- **NPC businesses.** NPC-owned businesses have no controller, so they do not run production. No NPC production is
  enabled.
- **Recipes.** The catalogue has five recipes, all for existing templates. No new recipes were added.
- **Costs.** The operating cost is removed from the economy (a sink), as before. Stage 45 does not change the sink
  policy.
- **`record_expense`** still has no client.
- **Panel length.** `business_panel.gd` is over the 1,000-line lint limit (see section 4).

## 6. Decisions that remain open (not made here)

1. Whether production should take real time (a timer or queue) rather than completing at once.
2. Whether operating costs should stay a sink, or be paid to a supplier or landlord account.
3. Whether a produced good should be sold only after it is listed. The current route is `add_product`, and a listing is
   needed before it can be sold.
4. Whether to rename the two `biz-service:` food IDs (a migration is needed).

## 7. Next step

In Godot 4.7.2, open a poultry-farm business with stock inputs and a balance. Run Produce, then check the stock and
balance readback, then list the eggs and sell one. Record each action as verified or not verified in this document.
