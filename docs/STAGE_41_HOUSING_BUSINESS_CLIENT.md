# Stage 41: housing and business client

Status: implemented in the working tree on `arena/00cdea0e-naija`. Godot was not available in the sandbox, so the
Godot screens have NOT been run. Server behaviour was verified with Node tests. Read `docs/PHASE_1_FEATURE_INVENTORY.md`
for the status of each row. This stage does not mark housing or business as complete.

## 1. What this stage does

The server already had housing and business operations (Stages 35, 39, 40). A player could not reach them from the Godot
client, so they were only usable by sending raw socket messages. This stage adds two screens, a request tracker, and the
server fixes found while checking the contract.

## 2. Server changes

1. `purchaseFromBusiness` (`services/world-api/src/businesses/service.ts`) checks the product's `category`:
   - `buy_service` on a stock product is refused with `business_sale_not_service`. Before this, the stock check was
     skipped, so a stock product could be bought without stock being reduced.
   - `buy_product` on a service is refused with `business_sale_is_service`.
   The category is the same rule the NPC seeding uses (service-model templates seed `category: "service"` products and
   other templates seed non-service products). The rule is by `category`, not by ID prefix. For example,
   `biz-service:jollof-rice` has category `food`, so it is a stock product.
   Both codes have user-facing messages in `businessErrorMessage`.
2. `characterSnapshot` (`services/world-api/src/multiplayer/world-engine.ts`) lists `business_profiles` only for
   businesses where the character is an active `owner` or `co_owner`. Before this, the list could include other
   businesses.

Balances and ledger rows were not changed. The buyer is always the session character. A payload cannot name another
payer. A seller cannot record a sale. These rules were already in place and are covered by the Stage 40 tests.

Seeded NPC businesses are not affected. No internal code path calls `purchaseProduct` or `purchaseService` except the
engine's own `buy_product` and `buy_service` cases.

## 3. Client changes

| File | Role |
|---|---|
| `game/scripts/services/multiplayer_client.gd` | `send_command` takes an optional `request_id` and returns whether the message was sent. Lint is at the 11-finding baseline. |
| `game/scripts/services/server_request_tracker.gd` | `ServerRequestTracker`: idle, waiting, or unconfirmed. Methods: `begin`, `retry`, `apply_reply`, `apply_duplicate`, `apply_transport_loss`, `apply_timeout`, `apply_send_failure`. A 20 s timeout marks a waiting request unconfirmed. A send failure resolves the request, because the server never received it. |
| `game/scripts/domain/property_business_contract.gd` | `PropertyBusinessContract`: the action tables, changing-action lists, roles, rent periods, condition levels, catalog loaders, and formatting. The contract test reads these tables. |
| `game/scripts/ui/housing_panel.gd` | Housing screen with market, mine, and rentals tabs. Emits `housing_action_requested(action, payload, request_id)`. |
| `game/scripts/ui/business_panel.gd` | Business screen. Emits `business_action_requested(action, payload, request_id)`. Restock choices come only from the business's existing products. |
| `game/scripts/prototype_game.gd` | Wiring: profile storage from the snapshot, the 20 s timer, reply routing, connection-lost handling, and the `housing` and `businesses` panel routes. |
| `game/scripts/ui/prototype_ui.gd` | Housing and Businesses menu buttons, panel ownership, and the tracker calls. Trackers live here, so a reply that arrives while a panel is closed still updates the request state. |

### 3.1 Behaviour rules

- A success message appears only when the server sends a `property.result` or `business.result` with the pending request
  ID. A `property.error` shows the server's own message.
- While a changing request is pending, every changing button is disabled. A second changing request is refused locally
  with a notice.
- Changing actions send a unique request ID. The server applies a repeated ID at most once and answers `command.duplicate`,
  which releases the matching request and refreshes the snapshot.
- A timeout or connection loss marks the request unconfirmed. The player can then resend it with the same ID, and the
  server applies it at most once.
- Money-moving actions show a confirmation first.
- Integers are checked locally before sending. Rejected values never reach the server. The server still validates
  everything.
- Read-only requests (`market`, `view`, `my_properties`, `my_rentals` for housing; `discover` and `view` for business)
  do not use the tracker.

### 3.2 Housing operations exposed

Read: `market` (with filters), `view`, `my_properties`, `my_rentals`.
Changing: `purchase`, `rent`, `list_for_sale`, `list_for_rent`, `pay_rent`, `terminate_rental`, `maintain`, `furnish`,
`remove_furnishing`, `transfer`.

Owner-only operations (`list_for_sale`, `list_for_rent`, `maintain`, `furnish`, `remove_furnishing`, `transfer`) appear
only to the owner. Tenant-only `pay_rent` appears only to the tenant. `terminate_rental` appears to the tenant or landlord.
The server still decides every case.

Transfer takes the recipient's character ID typed in. There is no player lookup, so transfer is usable only when the
player knows that ID.

### 3.3 Business operations exposed

Read: `discover`, `view`.
Changing: `buy_product`, `buy_service`, `restock`, `pay_salary`, `transfer_funds`, `contribute_capital`, `withdraw`,
`close`.

Gaps (server-supported, no client in this stage, recorded rather than faked): `create`, `add_product`,
`record_expense`, `produce`, `add_branch`, `transfer_ownership`, `hire_employee`, `fire_employee`.

Roles follow `authorizeBusinessAction` in `businesses/service.ts`. Withdrawals go to the caller's own cash. Shares are not
enforced (`docs/STAGE_40_BUSINESS_ACCOUNTS.md` section 2.2).

## 4. Tests

| Test | Result |
|---|---|
| `services/world-api/test/business-client-stage41.test.mjs` (server: category refusals over the socket and function level, snapshot filter, stock is not reduced by a refused purchase) | 4 pass, 0 fail |
| `services/world-api/test/client-housing-business-stage41.test.mjs` (client contract: parses the GDScript and TypeScript as text) | 28 pass, 0 fail |
| Full world-api suite, `node --test test/*.test.mjs` (file backend) | 1404 total, 1350 pass, 0 fail, 54 skipped, 0 todo |

The 54 skips are the PostgreSQL-dependent tests: 48 need `DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true`, and 4 need
`TLS_TEST_DATABASE_URL`. They were not run in this sandbox. CI's live PostgreSQL job covers them on push. The total is
the Stage 40 file-backend total (1372) plus the 32 new tests.

Client contract test mutations, run and restored:
- Widening the `withdraw` role list in `property_business_contract.gd` makes the role test fail.
- Adding a `buyer_character_id` key to the `rent` payload makes the payload test fail.

Earlier checks, before the stage was complete: a reverted snapshot filter fails the server contract test (1 of 4).

GDScript checks: `gdparse` passes for all changed files. `gdlint` finds 0 issues in the four new files. The three files
that already had findings are at their baseline: `prototype_game.gd` 14, `prototype_ui.gd` 5, `multiplayer_client.gd` 11.

Server checks: `npm run build` and `npm run lint` passed after the server edits.

## 5. Not verified

- No Godot run. The screens have not been loaded, clicked, or connected to a live server. A script error in a `.gd` file
  would be found only by a Godot run. `gdparse` checks syntax only.
- No scene or layout check on the existing screen sizes or input devices.
- No CI step for GDScript. CI runs only the Node build, lint, and tests.

### 5.1 Exact verification still needed

1. Install Godot 4.7.2 (`Godot_v4.7.2-stable_linux.x86_64.zip`). The sandbox could not download it, so it needs a
   network route that allows the release asset host.
2. Load the project headless (for example `godot --headless --path game --quit`) and check the output for script errors in the new files. Confirm the exact flags against the installed Godot version.
3. Start `services/world-api` against a test world. Log in as a seeded test character with the Godot client.
4. Open Housing and Businesses. Confirm the market, my properties, and rentals lists load from the server.
5. Buy or rent a listing. Confirm the success message appears only after the server reply, the balance updates, and a
   second submit is blocked while the first is pending.
6. Try a refused operation (for example, `buy_service` on a stock product, or a business action without a role). Confirm
   the server's message is shown and nothing changes.
7. Disconnect during a changing request. Confirm the request is marked unconfirmed, and that retrying with the same ID
   does not apply the change twice.
8. Confirm `business.error` `business_sale_is_service` over the socket. It is covered only at function level now.

## 6. Remaining gaps

- Business lifecycle operations have no client (listed in section 3.3).
- Housing has no arrears, eviction, or automatic rent collection. None were invented.
- Shares are not enforced; the shared-account decision is in STAGE_40 section 2.2.
- Station ownership (decision 10) and the other open decisions (9 and 11) are unchanged.
- Suspended systems (government writes, elections, police, crime, military, justice) stay fail-closed.

## 7. Next group

See `docs/PHASE_1_FEATURE_INVENTORY.md`, "Next Phase 1 feature group". The recommendation is NPC simulation and social
relationships (rows 23–24). Business lifecycle client and server checks are the smaller follow-on.
