# Phase 1 feature inventory

Status of each planned system at the start of Phase 1 (Stage 39), with evidence from the repository. Rows 11 and 12 and the
priority and dependency lists were updated in Stage 40, rows 6–8 and 11–12 and the next-group note in Stage 41, rows
23–24 and the next-group note in Stage 42, and rows 11–12 and the Stage 43 status in Stage 43. This is an
audit, not a claim of completion. The game is not finished, and this inventory does not make it production-ready.

Statuses:
- **COMPLETE**: server route, service, state, persistence, and tests on the configured backends. A client UI is noted
  separately, because a server feature without a UI is not playable.
- **PARTIAL**: some of the above exists, with named gaps.
- **MISSING**: no simulation behaviour. A persisted type or a placeholder does not count.
- **SUSPENDED**: a route exists but is refused by a stable suspension code, on purpose (see the suspension maps in
  `services/world-api/src/multiplayer/world-engine.ts`).
- **BLOCKED**: cannot be built safely until a named prerequisite exists.

## Method and limits

- Dispatch was read from `world-engine.ts` (the socket dispatcher, about 6,000 lines). Action counts are from `case`
  labels, and reference counts are from `grep` of each module name. A reference count is not a behaviour check.
- Client calls were read from `game/scripts/**/*.gd`. Godot 4.7.2 was built from source in the sandbox on 2026-10-13. The
  existing headless scripts were run, and one online business smoke test. See the Godot notes in each status below.
- Economy, property, and suspension evidence was read in full. Other areas were checked for route, persistence, and
  test presence, and were not re-audited line by line in this pass. Those rows are marked "not re-audited".

## Inventory

| # | System | Status | Evidence in the repository | Gaps |
|---|---|---|---|---|
| 1 | Sessions, identity, persistence (file and PostgreSQL), restart | COMPLETE | `src/multiplayer/persistence.ts`, `record-validation.ts`; socket tests in `test/*-stage35`, `*-stage38`; both backends | Multi-host safety is not proven (Stage 35 and 38 reports). Client UI for sessions exists (logout). |
| 2 | World clock and calendar | COMPLETE | `src/life/calendar.ts`; `addMonthsClamped` added in Stage 39 | None found in this pass. |
| 3 | Cash ledger: balances, deposits, withdrawals, transfers, monthly interest and fees | COMPLETE (simulated ledger) | `src/economy/service.ts`; interest and fee loops skip accounts without a bank product; economy tests | Not real banking. Loans (`economyLoans`) not re-audited. |
| 4 | Salary credit (careers) | PARTIAL | `src/careers/service.ts` `creditSalary` credits the existing cash account, de-duplicated by `salaryPayments` | Other career actions not re-audited. Career UI exists (`career_panel.gd`). |
| 5 | Bus fare and clinic care (money routes) | COMPLETE for the ledger path (Stage 47). Both post to the cash ledger; refusals and retries are tested | `money-routes-stage34.test.mjs` and `economy-consistency-stage47.test.mjs` (both backends); client sends `world.bus` and `clinic.care` | Open: the stop charges ₦150 while the market good `goods:bus-fare-town` costs ₦300. Fees have no receiver (decision). |
| 6 | Housing: purchase, listing for sale, transfer | IMPLEMENTED, NOT RUNTIME-VERIFIED (Stage 41 client) | `src/properties/service.ts`; `property-actions-stage35.test.mjs`; Stage 41 client: `game/scripts/ui/housing_panel.gd` (Purchase, List for sale, Transfer), `game/scripts/domain/property_business_contract.gd`, `game/scripts/services/server_request_tracker.gd`; contract test `client-housing-business-stage41.test.mjs` | Godot has not been run, so the screen is unverified in the engine. Listing and transfer appear only to the owner; the server still decides. Transfer needs the recipient's character ID typed in; there is no player lookup. |
| 7 | Housing: rent start, termination, maintenance, furnishing | IMPLEMENTED, NOT RUNTIME-VERIFIED (Stage 41 client) | As row 6; Stage 35 tests; Stage 41 client: rent a listing, end a rental (optional reason, server decides), record maintenance (cost from the owner's cash), furnish (quantity 1–10), remove furnishing | Godot has not been run. The screen cannot record a landlord's or tenant's dispute, because no such operation exists. |
| 8 | Housing: rent payment (`pay_rent`) | COMPLETE for the rules; IMPLEMENTED, NOT RUNTIME-VERIFIED (Stage 41 client) | Stage 39: per-period due date, `property_rent_not_due`, per-period idempotency, counterparty checks, ledger rows; `test/housing-rent-stage39.test.mjs`; Stage 41: "Pay rent" on the rental list, shows the server's paid-through date from the property record | Rent is not collected automatically. No arrears, eviction, or late fees exist, and none are invented. Godot has not been run. |
| 9 | Housing counterparties: NPC landlords and sellers | COMPLETE (Stage 39) | NPC cash account in `economyAccounts` with no bank product; refusal before debit for any other owner kind | Business and organisation owners are refused (row 11). |
| 10 | Ledger rows for property money | COMPLETE (Stage 39) | `property_purchase`, `property_sale_proceeds`, `rent_payment`, `rent_receipt`, `property_furnishing`, `property_maintenance` | Before Stage 39, property money moves wrote no ledger row. |
| 11 | Businesses: creation, products, services, stock, sales, capital, withdrawals, expenses, payroll, transfers, production, closure, branches, ownership, staff | PARTIAL (server COMPLETE for the Stage 40 and Stage 43 operations; Godot panel implemented in Stages 41, 43, and 45 (production, Stage 45, not run in Godot); Godot runtime: headless UI with simulated input verified for creation, listings, restock, purchases, hiring, salary, dismissal, branch opening, ownership transfer, and closure (Stage 44); price changes, listing deactivation, several refusals, and any rendered view not verified in Godot) | `src/businesses/service.ts` (`postBusinessMoney`, `runBusinessChange`, `hireEmployee`, `transferOwnership`, `closeBusiness`, `addBranch`, `seedNpcBusinesses`); `src/careers/commitments.ts`; 19 `business.action` cases in the engine. Tests: `test/business-lifecycle-stage43.test.mjs` (51 file, 64 PostgreSQL), `business-accounts-stage40.test.mjs`, `businesses.test.mjs`, `business-money-stage34.test.mjs`, `client-housing-business-stage41.test.mjs`; both backends. Client: `game/scripts/ui/business_panel.gd` (create, listing, restock, buy, hire, fire, branch, transfer ownership, pay salary, transfer funds, capital, withdraw, close). See `docs/STAGE_43_BUSINESS_LIFECYCLE.md` section 2. | Godot: verified headless with simulated input and server readback (`docs/STAGE_44_BUSINESS_VERIFICATION.md`), including the refusals listed there. Not verified in Godot: price changes, listing deactivation, career-conflict and branch-limit refusals, transfer and closed-business refusals, a stranger's refused changing action (backend and socket tests only), and any rendered view. The command-limit refusal shows the server message in the panel (verified). Co-owner add and remove have no server operation. `produce` now has a client form (Stage 45; not run in Godot). `record_expense` is supported by the server and has no client. Recipient consent for hiring and ownership transfer is an open decision. A business held only by a co-owner cannot be transferred onward (blocker). Branch setup cost is undefined. The service price ceiling is provisional. No NPC business is created in the running world, and NPCs cannot be hired. Shares are not enforced. NPC seed-capital policy is unresolved. Operating costs and supplier stock are sinks. Single writer only. Each changing request copies every business record (scaling limit). See `docs/STAGE_40_BUSINESS_ACCOUNTS.md` section 7.4. |
| 12 | Business payments: revenue, wages, capital, and any transfer to or from a business | COMPLETE on the server (Stage 40); client IMPLEMENTED in Stages 41 and 43, not runtime-verified for money actions; PARTIAL overall | Shared business account (economy account, `kind: current`, holder = business id) in the same ledger; buyer-paid sales from the buyer's own cash; owner capital and withdrawal; salaries to active employees; transfers between businesses the caller owns; every movement is an economy ledger row; the saved world is refused at load if a business does not reconcile (`businessAccountMismatches`); seller-initiated sales are refused; Stage 41: a sale kind must match its product (`business_sale_not_service`, `business_sale_is_service`), with a stock-bypass fix on `buy_service` | Client gaps: `produce` and `record_expense` (server supports them; no client). Revenue, tax, fines, borrowing, and minting remain closed. Owner decision on the shared account is recorded in STAGE_40 section 2.2 (every owner or co-owner is equally authorised; withdrawals go to the caller). Stage 43: seed capital for NPC businesses has no policy (blocker). Legacy revenue cannot be verified. |
| 13 | Government | SUSPENDED (writes) | `government_writes_suspended`; reads are open. 56 engine references | Not re-audited. |
| 14 | Elections | SUSPENDED (writes) | `election_writes_suspended` | No elections are enabled. Not re-audited. |
| 15 | Police: wanted requests and arrests | SUSPENDED | `request_wanted`, `execute_arrest` refused (`police_*_suspended`) | Prerequisite: station ownership and jurisdiction model (Stage 38, decision 10, open). |
| 16 | Police: other routes (85 engine references) | PARTIAL, not re-audited | Reads are open; other mutations are not individually verified | Education keys (`EDUCATION_HIERARCHY` in `police/service.ts`) are keyed by code, while `education_level` is free text. Unknown values count as 0. |
| 17 | Crime: incidents and evidence | SUSPENDED (mutations) | `transition_incident`, `add_evidence`, `create_restitution`, `create_criminal_record`, `link_to_justice`, `link_to_police` refused | Prerequisite: authority model and incident assignment. Victim checks are authoritative (`crime/targets.ts`, Stage 38). |
| 18 | Military | SUSPENDED (mutations) | Nine mutations refused (`military_*_suspended`) | Prerequisite: authority model. Reads are open. |
| 19 | Justice: judgments, appeals, fines | SUSPENDED (partly) | `decide_appeal` (no judge assignment), `pay_fine` (no economy linkage) refused | Stage 38 socket gaps: `submit_evidence`, `issue_judgment`, `file_appeal`. Fines are not to be enabled (user constraint). |
| 20 | Revenue, taxation, borrowing, unrestricted minting | MISSING, not to be enabled | `tax_payment` and loan kinds exist in the ledger type; no enabled route | Excluded from Phase 1 by the user's constraints. |
| 21 | Education (school) | PARTIAL | `school.begin` is a client call and a dispatch case | `EDUCATION_HIERARCHY` mismatch (row 16). |
| 22 | Family (46 engine references) | PARTIAL, not re-audited | Handled in the engine; no `family` module directory | Not re-audited. |
| 23 | Relationships and social | PARTIAL (Stage 42: player-to-NPC relationships implemented and server-tested; Godot not run) | Player-to-NPC bonds on the person records (`npc_social.bonds`): affinity, acquaintance, greet, talk, acquaint, argue, apologise, bounded history, cooldowns. `npc.action` and `npc.view` in the engine. `test/npc-social-stage42.test.mjs` (file 17, PostgreSQL 34), `npc-social-rules-stage42.test.mjs` (15), `client-npc-stage42.test.mjs` (22). See `docs/STAGE_42_NPC_SOCIAL.md`. | Player-to-player `relationship.progress` is unchanged and still needs an online, nearby partner. No family generation. The `social/` module is the Stage 18 social-media network and is not used for this. No effect on money, jobs, or housing. |
| 24 | NPC simulation | PARTIAL (Stage 42: six fixed neighbours with clock-derived activity implemented and server-tested; Godot not run) | Residents `npc-nb-*` in `game/data/npc/social_catalog.json`, seeded and validated with the people records (no schema bump). Activity (asleep, at school, socialising, relaxing) derived from `state.worldClock` in the existing minute tick. Visibility and presence rules. Careers exclusion for neighbours in `careers/service.ts`. Tests: see row 23. | Not runtime-verified in Godot. Entry is the People menu only; world avatars are not linked to server IDs. NPCs do not move. No job, housing, or quest effect. Stage 46: the market stall holder is a non-player account, not a resident. It is paid for market goods, and no resident has money or buys anything. No distance rule. The dormant `npc/catalog.ts` is not used. Seeded NPC landlords remain property owners (data only). |
| 25 | World events | MISSING | `world-events` module: 0 engine references | Persisted type only. |
| 26 | Transportation (beyond bus fare) | MISSING | `transportation` module: 0 engine references | Bus fare route is row 5. |
| 27 | Chat, inventory, shop, movement, geography, entertainment, culture | PARTIAL, not re-audited. Stage 46: the market shelf and market goods settle in the cash ledger, and the stall holder is paid. Stage 47: shelf items and prices come from the catalogue, and the buyer must be at the market. | Dispatch cases exist; `chat.send`, `inventory.consume`, `shop.purchase`, `geography.enter` and `geography.leave` are client calls. Stage 46 fixed `shop.purchase`, which debited only `character.money` and had no ledger row. Market purchases (`economy.action` `purchase`) have no Godot client. | Per-feature tests not verified in this pass, apart from the Stage 46 and Stage 47 economy tests. Shelf prices are catalogue values, not reconciled with the market goods (bottled water). |
| 28 | Authority model (stations, organisations, judges) | PARTIAL | `docs/STAGE_28_AUTHORITY_MODEL.md`; Stage 38 authority tests | Open decisions 9 (education), 10 (station assignment), 11 (justice socket routes). |

## Launch-readiness prep status (2026-10-14, uncommitted)

This pass made no feature change. It checked the Godot project's launch path by source inspection and
ran the backend checks again. It did not run Godot.

| Category | Items |
|---|---|
| Implemented and tested | Backend build, lint, and the full file and PostgreSQL suites on the current tree (`docs/DEVELOPMENT_STATUS.md`). |
| Implemented, not runtime-verified | 3D mode remote players: `multiplayer_3d_manager.gd` looked up `/root/World3D/Characters`, a path that does not exist in the scene tree (`World3D` is instanced under `Main/Mode3D`). It would fail whenever another player was present in 3D mode. The lookup now uses the manager's parent. Source-corrected only; not run in Godot. |
| Partial | Windows launch: external runbook `docs/WINDOWS_LAUNCH_RUNBOOK.md`. The export preset is a template only (`game/export_presets.template.cfg`). No export has been produced. |
| Missing | None found in this pass. Autoload-style identifiers were checked: none are used without a registered autoload, and the project registers none. |
| Fixed, run in Godot (headless) | Starting a new life while a local save exists used to overwrite it at once. Begin your life now asks first (`prototype_ui.gd` `show_replace_save_confirmation`). Cancel keeps the save and the form. `prototype_game.gd` `_start_new_game` also refuses any new life without the explicit replacement mark. Tests: `game/tests/new_game_confirmation_headless.gd` (Godot 4.7.2 build from source, headless, simulated input, 43 checks, exit 0) and `test/client-new-game-confirmation.test.mjs` (source contract, 8 checks). Not run on Windows or with a window. |
| Finding, not changed | Local saves are written directly, not through a temporary file and rename. The writer checks the file error, but an interrupted write could leave a damaged save. |
| Suspended or blocked | Unchanged. Godot runtime verification is blocked: no Godot binary is installed in the build sandbox, and the release asset host is not reachable from it. |

## Stage 41 status (housing and business client)

Stage 41 added the Godot housing and business screens and the server-backed contract tests. An earlier note says Godot 4.7.2 was built from source in the sandbox on 2026-10-13. Stage 47 did not reproduce this, and no Godot binary is present (unverified). The Stage 41 housing screens have not been run in an engine. The Businesses panel
was opened once, headless, against the live server (Stage 43).

| Category | Items |
|---|---|
| Implemented and runtime-verified | None for the Stage 41 screens. Server behaviour remains covered by Node tests (row 6 to 12 evidence). |
| Implemented, not runtime-verified | Housing screen: browse market, property details, buy, rent, my properties, my rentals, pay rent, end rental, list for sale or rent, maintenance, furnish, remove furnishing, transfer. Business screen: discover, view, buy product, buy service, restock, pay salary, transfer funds, contribute capital, withdraw, close. |
| Partial | Business screen: lifecycle operations have no client (create, add product, hire, fire, add branch, transfer ownership, produce, record expense). Housing transfer takes a typed character ID. |
| Missing | Socket-level tests for `my_rentals` (function-level only), `add_branch` and `fire_employee` (function-level only), and `buy_product` on a service (function-level refusal only). No Godot runtime test, scene test, or GDScript parse or lint step in CI. |
| Suspended or blocked | Unchanged: government writes, elections, police, crime, military, justice (fail-closed). Stations (decision 10), shares (STAGE_40 2.2), and rent arrears (not designed). |

## Stage 42 status (NPC simulation and social relationships)

Stage 42 added six fixed neighbours with clock-derived activity, and player-to-NPC relationships with server-validated
social actions. The server is tested on both backends. The Godot People panel is written and statically checked, but
Godot has not been run.

| Category | Items |
|---|---|
| Implemented and tested | Stable resident identities that survive a restart (`npc-nb-*`). Clock-derived activity in four states, synced in the existing minute tick. Presence and visibility rules. `npc.action` for greet, talk, acquaint, argue, and apologise, with cooldowns, refusals, idempotence by request ID, and `npc_not_saved` and `npc_outcome_unknown` handling. `npc.view` with bounded history (20). `npc_profiles` in the snapshot (at most 24). Dialogue that varies by tier and recognition. Validation of the persisted records. Covered on the file backend and on PostgreSQL. |
| Implemented, not runtime-verified | Godot People panel (`game/scripts/ui/npc_panel.gd`): visible list, detail, five actions, confirmation before argue, pending, success, failure, and timeout states through `ServerRequestTracker`, and history. Checked by `gdparse`, `gdlint`, and the Node contract test only. |
| Partial | Player-to-NPC relationships (no family, no economy effect). NPC activity (locations change, but NPCs do not move). The panel is reached from the menu only. |
| Missing | Interacting with a neighbour's avatar in the world. NPC movement. NPC-driven events, quests, jobs, or housing. Residents beyond the six. Distance-based rules. |
| Suspended or blocked | No new suspension. Suspended systems remain fail-closed. Open decisions 9, 10, and 11 are unchanged. Godot runtime verification is blocked in the sandbox (no Godot binary can be downloaded). |

## Stage 43 status (business lifecycle, validation, and economic integration)

Stage 43 extended the business server and the existing business panel to the lifecycle operations. Its record is
`docs/STAGE_43_BUSINESS_LIFECYCLE.md`. In Godot, the online start and the Businesses panel's open and read path are
verified (headless, 11 of 11). No business action was clicked, so no action counts as runtime-verified.

| Category | Items |
|---|---|
| Implemented and tested | Creation with setup fee and capital from the founder's cash. Separate goods and service routes, one listing per definition, listing on and off, price changes within limits. Restock (goods only), purchases from the buyer's own cash, stock never negative. Contributions, withdrawals, transfers between the caller's own businesses. Hire, pay, and fire with career conflict rules. Branch opening. Ownership transfer to a verified recipient. Operating and rent expenses, production, insolvency and recovery. Closure with a zero-balance rule and a defined wind-down. Snapshot rollback for failed changes. Duplicate, concurrency, persistence, and restart tests. NPC seeding and NPC purchases at service level. |
| Runtime-verified (open and read only) | The online start reaches the session, and the Businesses panel opens with the server's cash line, the create form, and the Discover tab (`game/tests/online_businesses_headless.gd`). |
| Implemented, not runtime-verified | Godot business panel: create, goods and service listing, restock, buy, hire, fire, branch, ownership transfer, and the Stage 41 money actions. Confirmation for financial and destructive actions. Checked by `gdparse`, `gdlint` (one finding: file length), and the Node contract test only. |
| Partial | Employment: hire and fire are tested, but there is no recipient consent. Ownership: only the owner can transfer. NPC integration: a foundation at service level only. |
| Missing | Co-owner add and remove. Branch setup cost. Supplier, landlord, and tax accounts. A stock-count view and a price-history view. Client for `produce` and `record_expense`. |
| Blocked (owner decision) | Recipient consent. Service price ceiling. Co-owner-only ownership state. NPC seed-capital policy. Open decisions 9, 10, and 11 are unchanged. |
| Suspended | Unchanged: government writes, elections, police, crime, military, justice (fail-closed). |

## Stage 44 status (business lifecycle verification)

Stage 44 verified the business lifecycle through the Godot client. Its record is `docs/STAGE_44_BUSINESS_VERIFICATION.md`.
Godot 4.7.2 was built from source. The UI runs were headless, with simulated input, server readback of an isolated world copy, and no rendered window.

| Category | Operations |
|---|---|
| Verified in the Godot panel (headless UI, server readback) | Create a business; goods and service listing; goods price change; refused out-of-range price; restock; deactivate and reactivate a listing; buyer goods and service purchases; refused over-stock and over-funds purchases; hire; salary; dismissal; branch opening, with the five-branch limit enforced; ownership transfer to a stranger and the new owner's view; transfer refused to self and to an unknown character; refused closure with a balance; withdrawal and closure; "Open branch" refused on a closed business; the command-limit refusal shown in the panel with no partial change. |
| Implemented and tested on the server, not verified in Godot | Career-conflict refusal; goods price ceiling and service price bounds at their boundary values; transfer refusals for managers, employees, children, deceased, and unbanked recipients; a stranger's refused changing action; restart with UI readback. Backend and socket tests only. |
| Fixed in Stage 44 | Shutdown lock loss (`WorldFileLockLostError`) on group SIGTERM; a released file-backend store writing after release (Stage 43 section 8.3); business action errors with economy wording; generic `error` replies not reaching the business panel; `rate_limited` routed to the career panel (now notify only; Godot re-run pending). |
| Open | Bounded wait in `shutdown()` for saves that a closing socket starts (Stage 43 section 8.3). Whether an insolvent business may be transferred. Whether an employee sees the business under "My businesses". Whether the panel hides owner actions on a closed business. |

## Stage 47 status (economy consistency)

Stage 47 is an audit with fixes. Its record is `docs/STAGE_47_ECONOMY_CONSISTENCY.md`.

| Category | Items |
|---|---|
| Implemented and tested | The bus fare and clinic care post to the cash ledger (`bus_fare` and `clinic_payment`) and survive later syncs and a restart. A failed save is refused and its retry charges once. A market purchase of several units restores hunger for each unit. A market purchase needs the buyer at that market. Shelf items and fixed fees come from `game/data/economy/catalog.json`, validated at load. Socket tests on both backends. |
| Implemented, not runtime-verified | Nothing new in Godot. The shelf and the bus and clinic messages are the same as before. |
| Partial | Market purchases are server-only: no Godot client sends `economy.action`. Market goods have no stock. Education fees and family study support still write `character.money` directly (decision 9). Careers keep the `prototypeSalaryAccountPort` default. |
| Missing | A Godot market screen. A decision on who receives bus and clinic fees. A stock model. |
| Open decisions | Two bus fares (₦150 at the stop, ₦300 as a market good). Bottled water (₦100 on the shelf, ₦200 as a market good). Fee receivers. Education and careers money writes. Market stock. |

## Stage 46 status (NPC economic participation through market sales)

Stage 46 makes a non-player market stall holder a participant in the same ledger. Its record is `docs/STAGE_46_NPC_MARKET_SELLERS.md`.

| Category | Items |
|---|---|
| Implemented and tested | A market sale of a stall good moves the price from the buyer to the holder's cash account, with a ledger row on each side and no money created. Refusals (funds, balance limit, unknown goods) change nothing. Player withdrawals and transfers to the holder are refused. Monthly processing does not charge or pay it. The shelf (`shop.purchase`) debits the cash ledger. Socket tests on both backends. |
| Implemented, not runtime-verified | Nothing new in Godot. The economy purchase reply has a `seller` field, which no panel reads. |
| Partial | Nine stall goods have a seller. Other goods (paracetamol, bus fares) still leave the economy. Revenue is the full price. No stock model for stall goods. |
| Missing | Any NPC that earns from work (no wage source, see the Stage 46 record). Any NPC that spends. NPC businesses (`seedNpcBusinesses` is still uncalled). |
| Open decisions | NPC wage funding source. NPC seed capital. Whether stall revenue has costs or tax. The shelf prices and item list. |

## Stage 45 status (business production)

Stage 45 added the owner's production form to the Businesses panel and the socket tests for `produce`. Its record is
`docs/STAGE_45_BUSINESS_PRODUCTION.md`. The server behaviour was not changed.

| Category | Items |
|---|---|
| Implemented and tested | Production through the socket on both backends (five tests each): a run changes stock, the business account, and the history together; produced stock is listed and sold from stock; refusals for funds, stock limit, business type, recipe, inputs, closure, and a stranger change nothing; a repeated request ID runs once. |
| Implemented, not runtime-verified | Godot production form in the Businesses panel: recipe rows, Produce confirmation, pending state, refresh, and refusal text. Checked by `gdparse`, `gdlint` (no findings in the new code), and the Node contract test only. |
| Partial | Production is instant (the catalogue duration is not used). Five recipes exist. NPC-owned businesses have no controller, so they do not produce. |
| Missing | `record_expense` client. Co-owner add and remove. |
| Open decisions | Whether production should take time. Whether operating costs stay a sink. Whether to rename the two `biz-service:` food IDs, which are stock products (category `food`). |

## Missing and partial systems that matter most

1. **Business client UI (rows 11–12).** Stages 41 and 43 added the business panel, covering the lifecycle operations
   except `record_expense` and co-owner add and remove (`produce` was added in Stage 45). Stage 44 verified the main lifecycle operations and most of the remaining ones headlessly (not rendered). The career-conflict and boundary-value refusals are backend-only.
2. **Station and jurisdiction model (rows 15–17, BLOCKED).** Police and crime mutations stay suspended until an
   assignment model exists that the server can check.
3. **Authority for military and justice mutations (rows 18–19, SUSPENDED).** Needs judge assignment and the
   authority model.
4. **Client UI for housing and businesses (rows 6–8, 11–12).** Implemented (Stages 41 and 43). Stage 44 verified the main
   Businesses panel operations headlessly. `record_expense` has no client yet. `produce` has a form (Stage 45), not run in Godot.
5. **World events and transportation (rows 25–26, MISSING), and NPC movement and effects (row 24, PARTIAL).** Stage 42
   gives six fixed neighbours with activity and player relationships. They do not move and have no economy effect.
6. **Rent collection, arrears, and eviction (row 8).** Not implemented, and not invented on the client. Rent is paid only
   when a tenant sends `pay_rent`.

## Next Phase 1 feature group

Stage 41 implemented the housing and business screens. Stage 42 implemented NPC simulation and social relationships
(rows 23–24, PARTIAL). Stage 43 implemented the business lifecycle client and server checks (row 11). Godot 4.7.2 headless runs
were added on 2026-10-13: the existing scripts pass, and the online business smoke test passes (11 of 11). Their records are
`docs/STAGE_41_HOUSING_BUSINESS_CLIENT.md`, `docs/STAGE_42_NPC_SOCIAL.md`, and `docs/STAGE_43_BUSINESS_LIFECYCLE.md`.

Next Phase 1 priority: **Godot runtime verification** of the business actions (create, listing, buy, hire, transfer,
closure), then the Stage 41 housing screens and the Stage 42 People panel. Godot now runs in the sandbox (built from
source), so these can be run. The Stage 43 panel's file-length finding (1188 lines) should be resolved after those runs.

Then the owner decisions that block further business work need answers (`docs/STAGE_43_BUSINESS_LIFECYCLE.md` section 8.2):
recipient consent for hiring and ownership transfer, the service price ceiling, the co-owner-only ownership state, the
NPC seed-capital source, and the branch setup cost. World events (row 25) can read the NPC activity state, but they are
not designed yet and need a plan first.

Not to be started without an owner decision: the station and jurisdiction model (rows 15–17) is blocked on open owner
decision 10 in row 28. Housing arrears and eviction are not designed (the user has not asked for them).

## Dependency order for Phase 1

1. Housing rent contract and counterparties (done in Stage 39: rows 8–10).
   Business account model and business payments (done on the server in Stage 40: rows 11–12).
2. Station and jurisdiction model, then police and crime enablement (rows 15–17), with negative tests.
3. Judge assignment and the authority model, then justice and military mutations (rows 18–19).
4. Client UI for housing and businesses (rows 6–8, 11–12). Implemented in Stage 41; Godot run pending for housing and for the business actions (the Businesses open path has run).
5. NPC simulation and social relationships (rows 23–24). Implemented in Stage 42 (PARTIAL; Godot run pending). World
   events and transportation (rows 25–26) remain MISSING.
5a. Business lifecycle (row 11). Implemented in Stage 43 (server tested on both backends; Godot open path run; actions pending). NPC
   employment and NPC-owned businesses in the running world remain open.
6. Remaining authority and suspended mechanisms, as the owner decides.

Revenue, taxation, fines, borrowing, minting, and organisation payments are outside this order, by the user's
constraints.
