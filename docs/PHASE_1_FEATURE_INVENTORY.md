# Phase 1 feature inventory

Status of each planned system at the start of Phase 1 (Stage 39), with evidence from the repository. Rows 11 and 12 and the
priority and dependency lists were updated in Stage 40. This is an
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
- Client calls were read from `game/scripts/**/*.gd`. Godot is not installed in this sandbox, so the GDScript was
  read but not run.
- Economy, property, and suspension evidence was read in full. Other areas were checked for route, persistence, and
  test presence, and were not re-audited line by line in this pass. Those rows are marked "not re-audited".

## Inventory

| # | System | Status | Evidence in the repository | Gaps |
|---|---|---|---|---|
| 1 | Sessions, identity, persistence (file and PostgreSQL), restart | COMPLETE | `src/multiplayer/persistence.ts`, `record-validation.ts`; socket tests in `test/*-stage35`, `*-stage38`; both backends | Multi-host safety is not proven (Stage 35 and 38 reports). Client UI for sessions exists (logout). |
| 2 | World clock and calendar | COMPLETE | `src/life/calendar.ts`; `addMonthsClamped` added in Stage 39 | None found in this pass. |
| 3 | Cash ledger: balances, deposits, withdrawals, transfers, monthly interest and fees | COMPLETE (simulated ledger) | `src/economy/service.ts`; interest and fee loops skip accounts without a bank product; economy tests | Not real banking. Loans (`economyLoans`) not re-audited. |
| 4 | Salary credit (careers) | PARTIAL | `src/careers/service.ts` `creditSalary` credits the existing cash account, de-duplicated by `salaryPayments` | Other career actions not re-audited. Career UI exists (`career_panel.gd`). |
| 5 | Bus fare and clinic care (money routes) | COMPLETE | `money-routes-stage34.test.mjs` (both backends); client sends `world.bus` and `clinic.care` | None found in this pass. |
| 6 | Housing: purchase, listing for sale, transfer | PARTIAL | `src/properties/service.ts`; `property-actions-stage35.test.mjs` | No client UI (`game/scripts` contains no `property.action`). |
| 7 | Housing: rent start, termination, maintenance, furnishing | PARTIAL | As row 6; Stage 35 tests | No client UI. |
| 8 | Housing: rent payment (`pay_rent`) | COMPLETE for the rules, PARTIAL overall | Stage 39: per-period due date, `property_rent_not_due`, per-period idempotency, counterparty checks, ledger rows; `test/housing-rent-stage39.test.mjs` | Rent is not collected automatically. No arrears, eviction, or late fees. No client UI. |
| 9 | Housing counterparties: NPC landlords and sellers | COMPLETE (Stage 39) | NPC cash account in `economyAccounts` with no bank product; refusal before debit for any other owner kind | Business and organisation owners are refused (row 11). |
| 10 | Ledger rows for property money | COMPLETE (Stage 39) | `property_purchase`, `property_sale_proceeds`, `rent_payment`, `rent_receipt`, `property_furnishing`, `property_maintenance` | Before Stage 39, property money moves wrote no ledger row. |
| 11 | Businesses: creation, products, stock, sales, capital, withdrawals, expenses, payroll, transfers, production, closure, branches, ownership, staff | PARTIAL (Stage 40) | `src/businesses/service.ts` with `postBusinessMoney`; 16 action cases in the engine, including `buy_product`, `buy_service`, `pay_salary`, `transfer_funds`; `test/business-accounts-stage40.test.mjs`, `businesses.test.mjs`, `business-money-stage34.test.mjs`; both backends | No client UI. Shares are not enforced (co-owners share the account). Operating costs and supplier stock are sinks. NPC seed capital is unexplained issuance (`business_seed_capital`). Legacy revenue cannot be verified. Single writer only. See `docs/STAGE_40_BUSINESS_ACCOUNTS.md` section 7.4. |
| 12 | Business payments: revenue, wages, capital, and any transfer to or from a business | COMPLETE on the server (Stage 40), PARTIAL overall | Shared business account (economy account, `kind: current`, holder = business id) in the same ledger; buyer-paid sales; owner capital and withdrawal; salaries to active employees; transfers between businesses the caller owns; every movement is an economy ledger row; the saved world is refused at load if a business does not reconcile (`businessAccountMismatches`); seller-initiated sales are refused | No client UI. Owner decision on the shared account is recorded in STAGE_40 section 2.2 (every owner or co-owner is equally authorised; withdrawals go to the caller). Revenue, tax, fines, borrowing, and minting remain closed. |
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
| 23 | Relationships and social | MISSING | `relationship` dispatch case exists; the `social` module has 0 engine references | Persisted type only. |
| 24 | NPC simulation | MISSING | `npc` module: 0 engine references | Seeded NPC landlords exist as property owners (data only). |
| 25 | World events | MISSING | `world-events` module: 0 engine references | Persisted type only. |
| 26 | Transportation (beyond bus fare) | MISSING | `transportation` module: 0 engine references | Bus fare route is row 5. |
| 27 | Chat, inventory, shop, movement, geography, entertainment, culture | PARTIAL, not re-audited | Dispatch cases exist; `chat.send`, `inventory.consume`, `shop.purchase`, `geography.enter` and `geography.leave` are client calls | Per-feature tests not verified in this pass. |
| 28 | Authority model (stations, organisations, judges) | PARTIAL | `docs/STAGE_28_AUTHORITY_MODEL.md`; Stage 38 authority tests | Open decisions 9 (education), 10 (station assignment), 11 (justice socket routes). |

## Missing and partial systems that matter most

1. **Business client UI (rows 11–12, server COMPLETE in Stage 40).** Business money now works on the server, but the Godot
   client has no business screen, so a player cannot use it yet.
2. **Station and jurisdiction model (rows 15–17, BLOCKED).** Police and crime mutations stay suspended until an
   assignment model exists that the server can check.
3. **Authority for military and justice mutations (rows 18–19, SUSPENDED).** Needs judge assignment and the
   authority model.
4. **Client UI for housing and businesses (rows 6–8, 11).** The Godot client has no property or business commands.
5. **Simulation of NPCs, social, world events, and transportation (rows 24–26, MISSING).** Persisted types only.
6. **Rent collection, arrears, and eviction (row 8).** Not implemented. Rent is paid only when a tenant sends
   `pay_rent`.

## Next Phase 1 feature group

Recommended next group: **client surfaces for housing and businesses (rows 6–8 and 11–12)**. Both server features are
complete enough to use, and neither is playable without a client. It needs no new server decision, and it is not blocked.
Godot is not installed in this sandbox, so the work needs a Godot run before it can be called done.

The station and jurisdiction model (rows 15–17) is the other candidate, but it is blocked on open owner decision 10 in
row 28, and it should follow once that decision is recorded.

Stage 40 remaining business work, for the record: a client business screen; a share-based split of withdrawals (its own
design decision); a source policy for NPC seed capital; and reconciliation of legacy revenue recorded before Stage 40.

## Dependency order for Phase 1

1. Housing rent contract and counterparties (done in Stage 39: rows 8–10).
   Business account model and business payments (done on the server in Stage 40: rows 11–12).
2. Station and jurisdiction model, then police and crime enablement (rows 15–17), with negative tests.
3. Judge assignment and the authority model, then justice and military mutations (rows 18–19).
4. Client UI for housing and businesses (rows 6–8, 11–12). The recommended next group, above.
5. Simulation of NPC, social, world events, and transportation (rows 23–26).
6. Remaining authority and suspended mechanisms, as the owner decides.

Revenue, taxation, fines, borrowing, minting, and organisation payments are outside this order, by the user's
constraints.
