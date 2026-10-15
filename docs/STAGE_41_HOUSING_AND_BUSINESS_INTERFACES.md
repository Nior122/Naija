# Stage 41 — Housing and Business Client Integration

Stage 41 integrates the shared-world **Housing & Property** (`property.action`) and **Businesses & Storefronts** (`business.action`) systems into the Godot 4.7 client (`game/`), connecting them to the Stage 39 housing rent/counterparty rules and Stage 40 business economy accounts over the existing authenticated WebSocket session.

---

## 1. Client Architecture & Files Added/Updated

- **`game/scripts/ui/housing_panel.gd` (`HousingPanel`)**:
  - New `VBoxContainer` modal panel following the established `CareerPanel` pattern (`configure`, `request_initial_data`, `apply_server_response`, `show_transport_error`, `update_records`, `update_world_context`).
  - Loads `res://data/properties/catalog.json` for location, category, property type, condition, and furniture labels/rules.
  - Provides four tabs (`Marketplace`, `My Properties`, `My Rentals`, and `Inspect`) plus a `Refresh` button.
- **`game/scripts/ui/business_panel.gd` (`BusinessPanel`)**:
  - New `VBoxContainer` modal panel following the same non-blocking request/response lifecycle.
  - Loads `res://data/businesses/catalog.json` for business templates, categories, premises types, product/service definitions, and production recipes.
  - Provides four tabs (`My Businesses`, `Directory & Shop`, `Launch Business`, and `Inspect`) plus a `Refresh` button.
- **`game/scripts/ui/prototype_ui.gd` (`PrototypeUI`)**:
  - Adds `"Housing"` (`"housing"`) and `"Businesses"` (`"businesses"`) buttons to the left HUD 2-column `menu_grid`.
  - Adds `property_action_requested(action, payload)` and `business_action_requested(action, payload)` signals.
  - Adds `show_housing`, `show_property_response`, `show_property_transport_error`, `update_housing_records`, and `update_housing_world_context` for `HousingPanel`.
  - Adds `show_businesses`, `show_business_response`, `show_business_transport_error`, `update_business_records`, and `update_business_world_context` for `BusinessPanel`.
  - Extends `_open_modal` with an optional `minimum_size` parameter (`Vector2(860.0, 620.0)` for Housing and Businesses).
- **`game/scripts/prototype_game.gd`**:
  - Tracks `_online_property_profiles`, `_online_rental_agreements`, `_online_business_profiles`, and `_online_players_snapshot` from `session.ready`, `character.snapshot`, and `world.snapshot`.
  - Preserves housing and business profiles across 2D/3D mode transitions (`get_shared_state` / `set_shared_state`).
  - Routes `property_action_requested` and `business_action_requested` through `multiplayer_client.send_command("property.action", ...)` and `multiplayer_client.send_command("business.action", ...)`, which attach a 32-character hex `requestId` matching `[A-Za-z0-9._:-]+`.
  - Routes `property.result` / `property.error` and `business.result` / `business.error` to `PrototypeUI`, and forwards fatal session/transport errors (`character_deceased`, `rate_limited`) to open panels.
- **`game/tests/ui_flow_headless.gd`**:
  - Extends step 2b to open and close the `"Housing"` and `"Businesses"` HUD modals and verify their offline state notices.
- **`services/world-api/test/housing-business-client-stage41.test.mjs`**:
  - Automated Node.js test suite verifying GDScript contract alignment and end-to-end WebSocket client flows for `HousingPanel` and `BusinessPanel` across configured persistence backends.

---

## 2. Supported Server Operations Exposed in the Client

### 2.1 Housing Panel (`property.action`)

| Action | Payload Keys Sent by `HousingPanel` | UI Surface & Authority Rules |
|---|---|---|
| `market` | `filters` (`location_id?`, `category_id?`, `listing_type?`, `condition?`, `min_bedrooms?`, `max_price_ngn?`) | Marketplace tab filter bar and automatic post-mutation refresh. |
| `view` | `property_id` | Inspect button on any marketplace listing, owned property, or rental agreement. |
| `my_properties` | `{}` | Initial panel load and post-mutation refresh; populates `My Properties`. |
| `my_rentals` | `{}` | Initial panel load and post-mutation refresh; populates `My Rentals`. |
| `purchase` | `listing_id` | Shown on available `sale` listings when the caller does not already own the property. |
| `rent` | `listing_id` | Shown on available `rent` listings when the caller does not own the property. |
| `pay_rent` | `agreement_id` | Shown on active tenant agreements only when `world_date >= paid_through_world_date` (Stage 39 due-date rule). Displays a clear notice when rent is not yet due. |
| `terminate_rental` | `agreement_id`, `reason` | Shown to the active tenant (in `My Rentals` and `Inspect`) or the property owner (in `Inspect`). |
| `list_for_sale` | `property_id`, `asking_price_ngn` | Shown in `Inspect` only when the authenticated character is the active player owner. |
| `list_for_rent` | `property_id`, `rent_price_ngn`, `rent_period`, `deposit_ngn` | Shown in `Inspect` only to the active player owner on non-land properties (`is_land == false`). |
| `maintain` | `property_id`, `description`, `cost_ngn`, `condition` | Shown in `Inspect` only to the active player owner. |
| `furnish` | `property_id`, `furniture_id`, `quantity` | Shown in `Inspect` only to the active player owner on non-land properties (`is_land == false`). |
| `remove_furnishing` | `property_id`, `furnishing_id` | Shown next to each placed furniture item in `Inspect` for the active player owner. |
| `transfer` | `property_id`, `to_character_id` | Shown in `Inspect` only to the active player owner, with quick-fill buttons for nearby online players. |

### 2.2 Business Panel (`business.action`)

| Action | Payload Keys Sent by `BusinessPanel` | UI Surface & Authority Rules |
|---|---|---|
| `discover` | `location_id?` | Directory & Shop tab filter bar, initial load, and post-mutation refresh. |
| `view` | `business_id` | Inspect button on any owned or discovered business. |
| `create` | `template_id`, `name`, `description`, `location_id`, `initial_capital_ngn` | Launch Business tab; initial capital funds the business economy account (`kind: "current"`). |
| `add_product` | `business_id`, `product_definition_id`, `custom_price_ngn?` | Inspect tab (`owner`, `co_owner`, `manager`) for both physical goods (`biz-goods:*`) and services (`biz-service:*`). |
| `restock` | `business_id`, `product_definition_id`, `quantity`, `unit_cost_ngn` | Inspect tab (`owner`, `co_owner`, `manager`) for physical products, paid from the business account. |
| `buy_product` | `business_id`, `product_record_id`, `quantity` | Buyer storefront in Inspect tab for non-owner customers when stock > 0; paid from the buyer's own cash account. |
| `buy_service` | `business_id`, `product_record_id` | Buyer storefront in Inspect tab for non-owner customers on `biz-service:*` offerings; paid from the buyer's own cash account. |
| `pay_salary` | `business_id`, `employee_character_id`, `amount_ngn` | Staff & Payroll card in Inspect tab (`owner`, `co_owner`, `manager`) for active employees (`role == "employee"`). |
| `transfer_funds` | `business_id`, `to_business_id`, `amount_ngn` | Treasury card in Inspect tab (`owner`, `co_owner`) when the player owns at least two active businesses. |
| `contribute_capital` | `business_id`, `amount_ngn` | Treasury card in Inspect tab (`owner`, `co_owner`); moves personal cash into the business account. |
| `withdraw` | `business_id`, `amount_ngn` | Treasury card in Inspect tab (`owner`, `co_owner`); moves business account funds to personal cash. |
| `record_expense` | `business_id`, `kind`, `amount_ngn`, `description` | Treasury card in Inspect tab (`owner`, `co_owner`, `manager`). |
| `produce` | `business_id`, `recipe_id` | Catalogue, Restocking & Production card in Inspect tab (`owner`, `co_owner`, `manager`). |
| `add_branch` | `business_id`, `name`, `location_id`, `premises_type` | Expansion & Closure card in Inspect tab (`owner`, `co_owner`). |
| `transfer_ownership` | `business_id`, `to_character_id`, `new_role`, `share_percent` | Expansion & Closure card in Inspect tab (`owner`, `co_owner`). |
| `hire_employee` | `business_id`, `employee_character_id` | Staff & Payroll card in Inspect tab (`owner`, `co_owner`, `manager`). |
| `fire_employee` | `business_id`, `employee_character_id` | Staff & Payroll card in Inspect tab (`owner`, `co_owner`). |
| `close` | `business_id`, `reason` | Expansion & Closure card in Inspect tab (`owner` only). Button is enabled only when `balance_ngn == 0`; otherwise displays a warning to withdraw or transfer the remaining balance first. |

---

## 3. Remaining Backend / Feature Gaps (Not Faked in the UI)

### 3.1 Housing Gaps
1. **No `unlist` / `cancel_listing` action on the server**: Once an owner lists a property for sale or rent, the server has no action to withdraw the listing without completing a sale/rental or transferring ownership. The UI does not show a fake cancel button.
2. **No automatic rent collection, arrears, late fees, or eviction**: `processPropertyWorldDate` on the server is a no-op; rent is paid only when a tenant initiates `pay_rent` on or after `paid_through_world_date`.
3. **`my_rentals` returns tenant agreements only**: Landlord-side active rentals are surfaced on each owned property's `active_rental` field in `My Properties` and `Inspect`.
4. **No land-development mutation route**: `development_status` is read-only in `PropertyRecord`; no server action transitions undeveloped land to developed buildings.

### 3.2 Business Gaps
1. **No `update_product` or `remove_product` action on the server**: Once a product/service is added to a business, its price or availability cannot be mutated via a dedicated action.
2. **No settlement action for `pending_expenses`**: `record_expense` records and debits an immediate paid expense; `pending_expenses` in `BusinessProfileSnapshot` has no separate pay/settle route.
3. **`transfer_ownership` deactivates the caller's ownership record**: On the server, `transferOwnership` marks the caller's ownership row `active = false` and creates a new row for `to_character_id` rather than keeping both as active co-owners.
4. **`character.business_profiles` in `character.snapshot` filters by `owner_character_id === character_id`**: Co-owned or employee-associated businesses where the player is not `owner_character_id` are inspected via `Directory & Shop` (`discover` / `view`).

---

## 4. Runtime Verification Required with Godot 4.7

Because no Godot binary (`godot`, `godot4`, `godot-4.7`) is installed in the sandbox environment, the GDScript changes were verified statically (`gdformat --check`, `gdlint`) and through the Node.js contract and WebSocket integration suite (`services/world-api/test/housing-business-client-stage41.test.mjs`). Before marking the Godot UI runtime-verified, run:

1. **Headless Godot smoke & UI flow tests**:
   ```bash
   godot --headless --path game --script res://tests/domain_smoke.gd
   godot --headless --path game --script res://tests/ui_flow_headless.gd
   ```
2. **Live connected client walkthrough against `@naija/world-api`**:
   - Start `@naija/world-api` (`npm start`) and launch the Godot client (`godot --path game`), then connect an adult character (age 18+) in online mode.
   - Open **Housing**, filter the Marketplace, inspect a listing, purchase or rent a property, verify `My Properties` / `My Rentals`, test `furnish`, `remove_furnishing`, `maintain`, `list_for_rent`, `pay_rent` (verifying due-date gating), and `terminate_rental`.
   - Open **Businesses**, launch a business on `Launch Business`, verify the business economy account balance in `Inspect`, add a physical product and a service, restock inventory, connect a second client to buy the product (`buy_product`) and service (`buy_service`), hire the second character (`hire_employee`), pay salary (`pay_salary`), transfer funds between two owned businesses (`transfer_funds`), withdraw remaining balance to `₦0`, and close the business (`close`).
