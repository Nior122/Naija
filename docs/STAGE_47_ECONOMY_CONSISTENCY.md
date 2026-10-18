# Stage 47: economy consistency (ledger-posted fixed fees, shelf catalogue, buyer location)

Branch `arena/00cdea0e-naija`, based on `3f9b63c`. Uncommitted at the time of writing. Nothing was committed or pushed.

This stage is a read-only audit of the economy's purchase routes, followed by three confirmed defect fixes and one
consistency change. It adds no new economic rule, changes no established price, and creates no tax, supplier cost,
seller inventory, or NPC capital. Godot was not run in this stage.

## 1. Audit findings

Each finding below was checked against code, and the defects were checked by tests on the real socket path. "Verified"
means a failing test, recorded before the fix, showed the behaviour.

| # | Finding | Evidence | Status |
|---|---|---|---|
| A1 | **Town bus fare bypassed the cash ledger.** `world.bus` debited `character.money -= 150` with no ledger row. Any later ledger sync (`syncCharacterCashFromEconomy`, from a bank or market action) reset `character.money` to the cash account, so the fare was never paid. A restart also lost it. | Red test: after a fare and a ₦1,500 purchase, money was 8,500 where 8,350 was expected. After a restart the cash account read 10,000, not 9,850. | **Fixed.** |
| A2 | **Clinic basic care bypassed the cash ledger** in the same way (`clinic.care`, `-= 300`). | Red test: cash stayed at 10,000 after care. | **Fixed.** |
| A3 | **Multi-unit market purchases restored no hunger.** The engine restored hunger only when `quantity === 1`, but the buyer was still charged for every unit. | Red test: two loaves from hunger 40 gave 40, where 80 was expected. | **Fixed:** every unit bought is eaten. |
| A4 | **A market purchase did not check where the buyer is.** The payload's `location_id` was trusted. A buyer in town could buy bread from the market. | Red test: `economy.result` for a buyer in town buying at the market. | **Fixed:** the buyer must stand at the location they buy from. No distance rule was added. |
| A5 | **Shelf items and prices were hardcoded** in the engine (`meat_pie` ₦350, `bottled_water` ₦100), and the bus fare (₦150) and clinic fee (₦300) were hardcoded too. | Source reads of `world-engine.ts`. | **Fixed:** moved into the economy catalogue with the same values (`shelf_items`, `fixed_charges`). |
| A6 | **Two bus fares exist.** The bus stop charges ₦150 (A1). The catalogue's market good `goods:bus-fare-town` costs ₦300 at the town. The two are not reconciled. Reconciling would change a price. | Catalogue and engine values. | **Open decision.** Documented, not changed. |
| A7 | **The shelf's bottled water (₦100, hunger 8) and the catalogue's market water (`goods:water-50cl`, ₦200, hunger 5) are different goods** with different prices. | Catalogue and engine values. | **Open decision.** Documented, not changed. |
| A8 | **Education writes `character.money` directly**: school fees (`education/service.ts` ~821, `-= remainder`) and family study support (~1213, `+= amount`, money with no source). Both bypass the ledger. | Code reads only. Not tested in this stage. A fee would be reversed by a later sync, by the same mechanism A1 verified. | **Open.** Changing it touches scholarship funds and open decision 9. Not changed. |
| A9 | **Careers keep a default that writes `character.money`** (`prototypeSalaryAccountPort`, in several exported careers functions). The engine's paths pass the ledger port. | Code reads, as in Stage 46. | **Open.** Not changed in this stage. |
| A10 | **Market goods have no stock.** Any buyer may buy any quantity up to 100 per request, with no limit. | Code reads. | **Open policy.** No stock rule was invented. |
| A11 | **No Godot client sends `economy.action`.** The market purchase route is reachable only through the socket API. The Godot client has no market purchase screen. The shelf (`shop.purchase`) is the only shop in the client. | `grep` over `game/`. | **Finding, not changed.** It is the next recommended feature (section 8). |

Confirmed fine, with evidence from this stage's tests:

- **Persistence of charges and sales.** Bus, clinic, shelf, and market charges survive a restart on both backends.
  The seller's balance and its `market_sale` row survive a restart (socket tests, both backends).
- **Failed saves.** A bus fare whose save fails is refused with `bus_not_saved`. Its retry charges once, in the ledger.
  A market purchase whose save fails is refused with `economy_not_saved`. Its retry charges once and feeds once.
- **Duplicate requests.** A repeated bus request, and a repeated market purchase, with the same request ID are duplicates
  and charge once. `economy.action` is in `IDEMPOTENT_COMMANDS`.
- **Insufficient funds.** A bus fare the citizen cannot pay is refused with `insufficient_funds`, and nothing moves.
  A market purchase with insufficient funds is refused with `economy_insufficient_funds` (Stage 46 tests).

## 2. What changed

### Fixed charges, posted to the ledger (A1, A2)

- `chargeFixedFee` (`services/world-api/src/economy/service.ts`) debits the cash account and posts one ledger row of the
  charge's kind (`bus_fare` or `clinic_payment`, both already valid ledger kinds). The counterparty is `null`, because no
  operator is decided. `character.money` is set to the cash balance. A refused charge changes nothing.
- The engine's bus and clinic routes check the cash balance, post the charge **before** the request is recorded as
  processed, then confirm through the existing `chargeAndConfirm` path. The refusal messages are unchanged in wording,
  and the prices are unchanged (₦150 and ₦300).

### Catalogue as the source of prices (A5)

- `game/data/economy/catalog.json` gains `shelf_items` (meat pie 350, bottled water 100, with their labels, category,
  and hunger restore) and `fixed_charges` (town bus stop fare 150, basic clinic care 300). Values were copied from the
  engine. Nothing changed.
- `services/world-api/src/economy/catalog.ts` validates both: unique IDs, valid categories, price bounds, hunger bounds,
  and fixed-charge kinds limited to `bus_fare` and `clinic_payment`. An invalid entry fails the catalogue at load.
- The engine's shelf reads `shelf_items`. Its `purchaseShopItem` path is unchanged.

### Buyer location and hunger (A3, A4)

- In the `economy.action` `purchase` case, the engine refuses a purchase when `location_id` (or the default, the
  buyer's own location) is not the buyer's `current_location`. The refusal is `economy_buyer_not_at_location`, with the
  message "Go to that market to buy its goods." This is a location-equality rule with no distance check.
- Hunger is restored by `hunger_restore × quantity`, capped at 100. Market goods are eaten on purchase, because there is
  no carried stock.

### Error text

- `economy_buyer_not_at_location` is added to the economy error messages in `services/world-api/src/economy/service.ts`.

## 3. Files changed in this stage

- `services/world-api/src/economy/types.ts`: `EconomyShelfItem`, `EconomyFixedCharge`, and two catalogue fields.
- `services/world-api/src/economy/catalog.ts`: validation of the two new sections.
- `services/world-api/src/economy/service.ts`: `chargeFixedFee`, and the buyer-location error message.
- `services/world-api/src/multiplayer/world-engine.ts`: bus and clinic through the ledger; shelf from the catalogue;
  buyer-location check; per-unit hunger.
- `game/data/economy/catalog.json`: `shelf_items` and `fixed_charges`. The file was rewritten in its existing layout
  (`git show HEAD` reproduces it byte-for-byte with the same formatter). The diff also includes the Stage 46 seller
  changes, which are still uncommitted.
- `services/world-api/test/economy-consistency-stage47.test.mjs` (new): 16 file-backend tests, 28 with PostgreSQL.
- Fixtures and existing tests (assertions unchanged except where noted):
  - `test/money-routes-stage34.test.mjs`: the bus and clinic fixtures also set the cash account (`fundCash`).
  - `test/npc-market-sellers-stage46.test.mjs`: the buyer fixture stands at the market.
  - `test/economy.test.mjs`: the negative catalogue fixture gains `shelf_items` and `fixed_charges`, as Stage 46 added
    `market_sellers`. **The online purchase test changed its assertion.** It previously expected a purchase from the
    market by a character who starts at home. That purchase is now refused by the new rule, so the test asserts the
    refusal with the cash balance unchanged. The positive socket purchase is covered by the Stage 46 socket tests, which
    place the buyer at the market.
  - `test/economy-money-durability.test.mjs`: not changed in this stage.

## 4. Tests

Red-first: the first 10 socket tests in `economy-consistency-stage47.test.mjs` were run against the unfixed code. Eight
failed for the defects in section 1, including the duplicate bus request, which failed because its first fare never
reached the ledger. Two passed before the fix: the unaffordable bus refusal, and the market seller's restart, both of
which were already correct. The four service-level tests cover the new `chargeFixedFee` and the new catalogue checks, so
they could not be red before the fix. The two market tests added last (a failed save, and a duplicate purchase) guard
behaviour that was already correct. They are regression guards, not red tests.

| Test | File | PostgreSQL |
|---|---|---|
| Bus fare is debited from the cash ledger once, and recorded | ✓ | ✓ |
| Clinic care is debited from the cash ledger and still heals | ✓ | ✓ |
| A later market purchase keeps the bus fare (ledger and `character.money` agree) | ✓ | ✓ |
| A bus fare the citizen cannot pay is refused, and nothing moves | ✓ | ✓ |
| A bus fare whose save fails is not confirmed; its retry charges once | ✓ | ✓ |
| A repeated bus request charges once | ✓ | ✓ |
| The bus fare and cash survive a restart | ✓ | ✓ |
| A multi-unit market purchase restores hunger for each unit | ✓ | ✓ |
| A market purchase is refused when the buyer is not at that location | ✓ | ✓ |
| A market sale and the seller's account survive a restart | ✓ | ✓ |
| A market purchase whose save fails is not confirmed; its retry charges and feeds once | ✓ | ✓ |
| A repeated market purchase is a duplicate, not a second charge | ✓ | ✓ |
| Service: a refused fixed fee changes nothing (`chargeFixedFee`) | ✓ | (in-memory, once) |
| Service: a fixed fee posts once, with no receiving account | ✓ | (in-memory, once) |
| Catalogue: shelf and fixed-fee prices equal the prices charged before | ✓ | (in-memory, once) |
| Catalogue: an invalid shelf item, fee kind, missing array, or duplicate ID is refused at load | ✓ | (in-memory, once) |

The file-backend count is 16 (12 socket and 4 service). The PostgreSQL run covers 28 (both backends' socket tests plus the
4 service tests, counted once).

## 5. Results

| Command | Result |
|---|---|
| `npm run build` (root) | exit 0 |
| `npm run lint` (root) | exit 0 |
| New Stage 47 file, file backend | exit 0: 16 tests, 16 pass |
| New Stage 47 file, PostgreSQL 18.4 | exit 0: 28 tests, 28 pass |
| Stage 46 file, file backend | exit 0: 11 tests, 11 pass |
| Stage 46 file, PostgreSQL 18.4 | exit 0: 15 tests, 15 pass |
| Money, housing, property, business, and client suites, file backend (`money-routes-stage34`, `housing-rent-stage39`, `properties`, `property-*`, `business*`, `client-*`) | exit 0: 324 tests, 324 pass |
| Economy suites, file backend (`economy.test`, `economy-money-durability`) | exit 0: 33 tests, 33 pass |
| Economy and money files, PostgreSQL 18.4 (`economy.test`, `economy-money-durability`, `money-routes-stage34`, `npc-market-sellers-stage46`, `economy-consistency-stage47`) | exit 0: 115 tests, 115 pass |
| Full file suite (`env -u DATABASE_URL NAIJA_ENV=test node --test test/*.test.mjs`) | exit 0: **1592 tests, 1538 pass, 0 fail, 54 skipped** |
| Full PostgreSQL suite (PostgreSQL 18.4, `DATABASE_URL` set, `NAIJA_ALLOW_DB_TESTS=true`) | exit 0: **1914 tests, 1910 pass, 0 fail, 4 skipped** (the 4 are TLS live tests) |
| `git diff --check` | clean |
| `gdparse` on `property_business_contract.gd` and `business_panel.gd` | exit 0 |

The full PostgreSQL count replaces the figure in the Stage 46 record, which was never read from a log.
The Stage 46 record's count for the full suite is not a measured value.

## 6. Limits and what remains unverified

- **Godot was not run.** The market purchase has no client screen (A11), so there is nothing to run for it. The bus and
  clinic routes are the same socket messages as before, so their client behaviour is unchanged. The shelf's client
  behaviour is unchanged. None of this is runtime-verified.
- **Buyer location is an equality check.** It is not a distance check, and it is not a rule about which market a citizen
  must use, beyond the goods' own `location_ids`.
- **Market goods are eaten on purchase.** There is no carried inventory for market goods. A purchase of several units
  restores hunger for each unit, up to 100.
- **The fixed-fee counterparty is `null`.** A fare or fee leaves the economy. Who should receive it is not decided.
- **Two bus fares, and two bottled waters**, are not reconciled (A6, A7).
- **Education and careers writes** (A8, A9) still write `character.money` directly. They are not fixed here.
- **Stock.** Market goods have no stock, so they can be bought without limit (A10).

## 7. Decisions that remain open (not made here)

1. Whether the two bus fares (₦150 at the stop, ₦300 as a market good) should be one price, and which is correct.
2. Whether the shelf's bottled water (₦100, hunger 8) and the market's water (₦200, hunger 5) should be one good.
3. Who receives the bus and clinic fees, if anyone (currently no receiver).
4. Education fees and family study support: whether they should post to the ledger, and their source of money (decision 9).
5. Careers: whether `prototypeSalaryAccountPort` should be removed as a default (fail closed).
6. Market stock: whether goods should have a stock limit and restocking.

## 8. Next recommended gameplay feature

Add a Godot market screen for the existing `economy.action` `list_goods` and `purchase` routes. A player at the market can
then see the goods, the price, the hunger effect, and the seller's name, and buy a quantity, with the server's reply
shown. It uses the economy's existing envelopes and the buyer's own cash, and invents no rule. Until it exists, the market
can be used only through the socket API, which means the Stage 46 seller and this stage's fixes are not playable.
