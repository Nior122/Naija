# Stage 43 — Business lifecycle, validation, and economic integration

> **Future agents: read this before changing businesses.** It records what Stage 43 implemented, what is tested, what
> is only implemented, and what is still blocked by an owner decision. Money rules are in
> [`STAGE_40_BUSINESS_ACCOUNTS.md`](STAGE_40_BUSINESS_ACCOUNTS.md), which this stage builds on and does not replace.
> Source of truth for each row is `docs/PHASE_1_FEATURE_INVENTORY.md` (row 11 and row 12).

This is a bounded, fictional business simulation. It is not a complete economy, and it does not make the game
production-ready.

## 1. Status summary

| Category | Items |
|---|---|
| **Implemented and tested on the server (file and PostgreSQL)** | Business creation (template, location, capital, setup fee from the founder's cash). Separate goods and service listing routes. One listing per definition. Listing on and off, and price changes within limits. Restocking (goods only; validated quantity and cost; paid from the business account). Buyer-paid goods and service purchases. Contributions, owner withdrawals, transfers between a caller's own businesses. Hiring, pay, and firing of employees, with the career conflict rules. Branch opening. Ownership transfer to a verified recipient. Operating and rent expenses. Production. Closure with a zero-balance rule and a defined wind-down. Insolvency and recovery. Snapshot rollback for failed changes. Persistence after reload and restart. Duplicate and concurrent-request tests. |
| **Implemented in the Godot panel, not runtime-verified** | Create (with confirmation). Goods listing (list, deactivate, reactivate, price change). Service listing. Restock. Buy product and buy service. Hire (no confirmation; no money moves). Fire (with confirmation). Branch list and opening. Ownership transfer (with confirmation, owner handover only). Pay salary, transfer funds, contribute capital, withdraw, close (existing from Stage 41, now in the same panel). Godot was not run (see section 9). |
| **Partial** | Employment: hire and fire are server-tested, and a client form exists, but there is no consent step for the hired person. Ownership transfer: only the owner can transfer, so a co-owner-held business cannot be transferred onward (section 6). NPC integration: NPC-owned businesses and NPC purchases work through the ledger in service tests, but nothing creates NPC businesses in the running world, and NPCs cannot be hired (section 7). |
| **Missing (no server operation)** | Co-owner add and remove. Recipient consent for hiring and ownership transfer. Branch setup cost. Supplier, landlord, and tax accounts. Revenue and taxation (kept closed by the user's constraints). A stock-count view and a price-history view. |
| **Blocked (owner decision needed)** | Seed-capital policy for NPC businesses (`business_seed_capital`). Service price ceiling. Co-owner-only ownership state. Recipient consent for transfers and hires. Open decisions 9, 10, and 11 are unchanged. |
| **Suspended (unchanged)** | Government writes, elections, police, crime, military, and justice remain fail-closed. Stage 43 does not touch them. |

## 2. Client operations

The business panel (`game/scripts/ui/business_panel.gd`) is the only business screen. It was extended, not replaced.
The contract is in `game/scripts/domain/property_business_contract.gd`. The contract test is
`services/world-api/test/client-housing-business-stage41.test.mjs` (Stage 41 file, extended in Stage 43).

| Operation (`business.action`) | Who may use it (server) | Confirmation in the panel | Money moved |
|---|---|---|---|
| `create` | Any adult founder, with own cash | Yes (names the setup fee and the capital) | Setup fee and capital from the founder's cash |
| `add_product` | owner, co_owner, manager, inventory_manager | No | None |
| `add_service` | owner, co_owner, manager, inventory_manager | No | None |
| `set_listing` (on/off) | owner, co_owner, manager | No | None |
| `update_price` | owner, co_owner, manager | No | None |
| `restock` | owner, co_owner, manager, inventory_manager | Yes | Business pays supplier from its account |
| `buy_product` | Anyone except the owner or co-owner of that business | Yes | Buyer's cash to the business account |
| `buy_service` | Anyone except the owner or co-owner of that business | Yes | Buyer's cash to the business account |
| `hire_employee` | owner, co_owner, manager | No (no money moves) | None |
| `fire_employee` | owner, co_owner, manager | Yes | None |
| `add_branch` | owner, co_owner | No (opening costs nothing) | None |
| `transfer_ownership` | owner only; the panel sends `new_role: owner`, `share_percent: 100` | Yes (names the recipient and the warning) | None |
| `pay_salary` | owner, co_owner | Yes | Business account to employee's cash |
| `transfer_funds` | owner, co_owner | Yes | Between the caller's own businesses |
| `contribute_capital` | owner, co_owner | Yes | Caller's cash to the business account |
| `withdraw` | owner, co_owner | Yes | Business account to the caller's own cash |
| `close` | owner, co_owner | Yes | None (the balance must already be zero) |

Each changing request carries a request ID through the existing `ServerRequestTracker`. The panel disables the
changing buttons while a request is pending, shows the server's message, and shows the unconfirmed state for
`*_not_saved` and `*_outcome_unknown`. Nothing is shown as successful until the server confirms it.

**Deliberately not in the panel:** `produce` and `record_expense` (not in the Stage 43 scope), co-owner add and remove
(no server operation), and any service ceiling or consent step that the server does not enforce.

The server also refuses anything the panel hides. A panel that is out of date cannot bypass a rule.

## 3. Server rules and safeguards

### 3.1 Routes and listings

- **Separate routes.** `add_product` refuses a service (`business_product_is_service`). `add_service` refuses a stock
  good (`business_service_is_product`). Restock refuses a service (`business_restock_is_service`). Buying routes are
  also separate (`buy_product` for goods, `buy_service` for services).
- **One listing per definition** per business.
- **Goods price** must be between `minimum_price_markup_percent` (1%) and `maximum_price_markup_percent` (500%) of
  the unit cost (`validateListingPrice`).
- **Service price.** A service with a catalogue cost of 0 is capped at 500% of its catalogue `base_price_ngn`. A
  service with a nonzero cost uses the cost-based bounds above. This ceiling is a provisional rule; the owner has not
  confirmed it (open decision, section 8).
- **Listing on and off, and price change**, are owner, co_owner, or manager actions. A price change must stay within
  the limits above.

### 3.2 Stock and purchases

- Stock is never negative. A purchase, restock, or production run checks the quantity before it writes.
- Restock needs a positive integer quantity, a safe-integer total cost, and funds in the business account. It does not
  need a listing: raw stock may be held before it is sold.
- Output from production is checked against `maximum_stock_per_product` before anything changes. The earlier silent
  skip of over-capacity output was removed.
- A purchase is refused for: insufficient stock; insufficient buyer cash; an unlisted or unavailable product; a bad
  quantity; or the owner or co-owner buying their own goods (`business_self_purchase`).
- The buyer's own cash is debited. A client-supplied buyer identity is not used.

### 3.3 Creation and authority

- Founder must be adult (`minimum_owner_age_years`, 18), must hold a cash account, and must have enough cash for the
  setup fee plus capital. Refusals change nothing.
- Location must be in the template's `allowed_locations` (`business_location_invalid`). Premises must be in
  `catalog.premises_types` (`business_premises_invalid`).
- A character may own at most `maximum_businesses_per_character` (3).
- Strangers are refused with `business_unauthorized`, and the refusal changes nothing (tested over the socket).

### 3.4 Failure safety

- Every changing action runs through `runBusinessChange` (`service.ts`). It takes a snapshot of the business maps,
  the economy accounts, the economy ledger, and each player's cash. If the change throws after its first write, the
  snapshot is restored and the error is rethrown unchanged.
- The business functions check before writing, so most refusals change nothing even without the snapshot.
- Cost: the snapshot copies every business record and every economy account on each changing request. This is a
  known scaling limit for the single-process file backend and for PostgreSQL alike.

## 4. Economic integrity and ledger behaviour

Every business money movement goes through `postBusinessMoney` (Stage 40). Stage 43 does not add a second financial
system.

| Ledger kind | Movement | Notes |
|---|---|---|
| `business_setup_fee` | founder cash to the business account | Creation |
| `business_capital` | owner cash to the business account | Contribution |
| `business_withdrawal` | business account to the caller's cash | Owner or co-owner only; the caller's own cash |
| `business_sale` | buyer cash to the business account | Buyer-paid only; seller-initiated sales are refused |
| `business_purchase` | business account to supplier | Restock |
| `business_salary` | business account to employee cash | Owner or co-owner only |
| `business_expense` | business account to nothing (sink) | Operating or rent only; salary-type expenses must use payroll |
| `business_transfer` | business account to another business account | Caller owns both |
| `business_seed_capital` | issuance to an NPC-owned business | Unresolved policy (section 7) |
| `business_legacy_import` | Stage 40 migration of older balances | Unchanged |

Rules:

- **Authority** is checked before the ledger is written. Every owner or co-owner is equally authorised.
- **Idempotency.** Each money move carries an idempotency key derived from its transaction ID. Repeating a request ID
  returns the duplicate notice and posts nothing more (tested for creation and for a repeated buy).
- **Concurrency.** Two buyers racing for the last unit: exactly one sale succeeds, and stock never goes negative
  (socket test).
- **Conservation.** A long mixed sequence (creation, restock, sales, salary, transfers, expenses, withdrawals,
  closure) keeps total money equal to the recorded issuance and sinks. Each account reconciles. The saved world is
  refused at load if a business account does not reconcile (`businessAccountMismatches`, Stage 40).
- **Shares are not enforced.** `share_percent` is recorded but not used for withdrawals or salary (Stage 40 section 2.2).

### 4.1 Employment and the career system

- **One full commitment at a time.** A character with active career employment cannot be hired
  (`hireEmployee` refuses). A character with active business employment cannot apply for a career job
  (`careers/commitments.ts`, `careers/service.ts`). The career decision path re-runs the eligibility check when an
  application is reviewed, so a business hire made after the application blocks it at review.
- **Owners are not employees.** The owner cannot be hired as their own staff.
- **Hire checks**, in order: business active; employer authority; staff limit (the smaller of the template
  `maximum_employees` and `maximum_employees_per_business`); employee exists; not the employer; living; age at least
  `minimum_employee_age_years` (18); no active business place; no active career employment; cash account present.
- **Salary** is paid from the business account to the employee's cash through `business_salary`. Only an owner or
  co-owner can pay it. Managers cannot.
- **Career salaries** are unchanged: they are issuance into the economy cash account through `economyAccountPort`,
  with no employer debit. This is the existing Stage 6/7 policy and is recorded here, not changed.
- **Firing** ends the employment record. No money moves. A fired employee cannot be paid afterwards. Rehiring is
  allowed.

## 5. Branches, ownership, and closure

### 5.1 Branches

- A branch has a name, a location in the template's allowed locations, and a premises type from the catalogue. It has
  no separate account, stock, or staff.
- **Opening costs nothing.** No branch setup cost is defined in the catalogue. This is a recorded gap (section 8),
  not a silent choice.
- The branch limit is `maximum_branches_per_business` (5).
- There is no rule against two branches in the same location. This is also recorded.

### 5.2 Ownership transfer

- Only the **current owner** may transfer (`owner` role). A co_owner, manager, employee, or stranger is refused.
- The recipient must be living, of eligible age, hold a cash account, have no active place in the business, and be
  under the businesses-per-character limit.
- The recipient's new role must be `owner` or `co_owner` (`share_percent` 0–100, integer).
- The former owner's record is kept and deactivated, not deleted. `owner_character_id` is set to the recipient.
  `crime/targets.ts` reads `owner_character_id`, so it stays correct.
- No money moves.
- **No recipient consent step.** This is an open decision (section 8).
- **Limitation.** A business whose only active holder is a co_owner cannot be transferred onward, because transfer
  requires `owner`. The socket test records this as a limitation. The Stage 41 contract still expects a co_owner
  transfer to be accepted, so the rule cannot be tightened here without changing that contract (see section 8).

### 5.3 Closure

Closure is refused while the business account holds money (`business_balance_not_empty`). The owner must withdraw
first. This rule is kept from Stage 40.

Once the balance is zero, closure:

- releases each active employee with an `employee_released` event (no money moves);
- closes each active branch with a `branch_closed` event;
- writes off remaining stock with quantity zero and an `adjustment` movement, with the description "No money was
  recovered";
- sets every product unavailable;
- records a `business_closed` event;
- keeps the ownership records, the business account, and all ledger and event history. Nothing is deleted.

A closed business refuses every further action, and a second closure is refused.

## 6. Insolvency

A business that cannot pay a day's operating cost becomes insolvent, refuses sales, and returns to active once its
balance covers a day again (`business_solvent_again`). Only owner capital or a transfer in can restore it. Tested.

## 7. NPC integration

**Completed (service level, both backends):**

- `seedNpcBusinesses` creates an NPC-owned business through the same business rules and records a seed issuance. It
  does not create a second business for an NPC that already has one.
- A player can buy from an NPC-owned business through the ledger. The NPC restocks from its own account through the same
  restock rule. A player cannot run the NPC's business.

**Outstanding:**

- **Nothing creates NPC businesses in the running world.** `seedNpcBusinesses` has no caller in production code. It is
  exported and used only by tests.
- **Seed capital policy is unresolved.** `business_seed_capital` is issuance with no source. It is not a bypass, but it
  is also not a policy. The owner has not chosen a source (section 8).
- **NPCs cannot be hired.** The hiring path resolves only player characters. There is a test that records this as a
  dependency. Auto-assignment to player-reserved vacancies is not implemented and is not planned without a documented
  rule.
- **NPC employment and NPC salaries do not run.** No NPC is an employee of any business in the running world.
- **No NPC business simulation.** NPC-owned businesses do not trade, restock, or grow on their own.

The shared NPC economy is therefore a **foundation**, not a finished system.

## 8. Decisions

### 8.1 Documented decisions (implemented, owner may revisit)

1. Every owner or co-owner is equally authorised (Stage 40 section 2.2).
2. Withdrawals go to the caller's own cash.
3. `share_percent` is recorded, not enforced.
4. Opening a branch costs nothing, and there is no duplicate-location rule.
5. Restock does not require a listing.
6. A goods price is bounded by the markup limits on cost; a service with no cost is capped at 500% of its base price.
7. Career salary remains issuance with no employer debit.
8. One full work commitment at a time, across career and business employment.
9. Transfer requires the current owner, and the recipient role is `owner` or `co_owner`.

### 8.2 Open decisions (blockers, not implemented)

| Decision | Current behaviour | Why it is open |
|---|---|---|
| Recipient consent for ownership transfer and hiring | No consent step. The recipient is not asked. | Changes the authority model. |
| Service price ceiling | 500% of catalogue `base_price_ngn` for zero-cost services. | The number is a provisional catalogue rule. |
| Seed capital for NPC businesses | Issuance `business_seed_capital`, with no source. | Needs a world-issuance policy. |
| Co-owner-only ownership state | Transfer to `co_owner` is allowed by the server. A co_owner-only business cannot be transferred onward. | Needs a rule and a contract change. |
| Branch setup cost | None. | Needs a catalogue value. |
| Open decisions 9, 10, 11 | Unchanged. | Not in Stage 43's scope. |

These are recorded as blockers. The client does not show a fake action for any of them.

## 9. Tests and results

Test files:

- `services/world-api/test/business-lifecycle-stage43.test.mjs` (new). 38 service-level tests run on both backends,
  and 13 socket tests run on each backend. Totals: 51 on the file backend, 64 with PostgreSQL.
- `services/world-api/test/support/business-socket.mjs` (new). Socket helpers for Stage 43. The Stage 40 and 41 tests
  were not refactored.
- `services/world-api/test/businesses.test.mjs`. One fixture changed (see below).
- `services/world-api/test/business-money-stage34.test.mjs`. One fixture changed (see below).
- `services/world-api/test/client-housing-business-stage41.test.mjs`. Counts and role map updated; 5 Stage 43 checks
  added.

Fixture changes (no assertion weakened):

- `businesses.test.mjs`, `addBranch`: the location was `lekki-market`, which the provision-store template does not
  allow. Stage 43 now refuses that location (`business_location_invalid`). The fixture uses `market`, which the
  template allows. The branch-limit assertion is unchanged.
- `business-money-stage34.test.mjs`, `record_expense` fixture: the kind was `utilities`, which the Stage 40 rule
  refuses for expenses. The fixture uses `operating`. The rule was not relaxed.
- `client-housing-business-stage41.test.mjs`: the business action count changed from 10 to 19, and the changing count
  from 8 to 17. The new actions are the nine added in Stage 43. The role map now includes the new actions. For
  `set_listing` and `update_price`, the role list is resolved from the `LISTING_ROLES` constant, because the server
  names it there. The gated-action list includes the new financial and destructive actions.

Results (run on 2026-10-13 against the working tree at the time of the run; see the commit list below):

| Check | Result |
|---|---|
| Full suite, file backend (`node --test test/*.test.mjs`) | **1514 total, 1460 pass, 0 fail, 54 skipped** (PostgreSQL-only tests), exit 0 |
| Full suite, PostgreSQL (`DATABASE_URL` set, `NAIJA_ALLOW_DB_TESTS=true`, `DB_SSL=false`) | **1812 total, 1808 pass, 0 fail, 4 skipped**, exit 0 |
| Stage 43 lifecycle test | File backend 51 of 51. PostgreSQL 64 of 64. |
| Business and career files | File backend 182 of 182. PostgreSQL 230 of 230 (before the last comment-only edit to `businesses.test.mjs`; the full run includes it). |
| Client contract tests (`client-housing-business-stage41`, `client-npc-stage42`, `businesses`) | 77 of 77 pass |
| `npm run build` (root) | exit 0 |
| `npm run lint` (ESLint on `services/world-api/src`) | exit 0 |
| `tsc` | exit 0 (part of the build) |
| GDScript: `gdparse` on all 28 tracked `game/scripts/*.gd` | All parse. Three known-bad samples are rejected. |
| GDScript: `gdlint` on the two edited files | **One finding:** `business_panel.gd` is 1188 lines, above the 1000-line limit (`max-file-lines`). It was clean before Stage 43. The file was not split because the new forms share private helpers and state with the panel, and that split cannot be checked without Godot. It is a known finding for the next Godot pass. |
| Godot 4.7 | **Not run.** Not installed; the release asset host is blocked from the sandbox. No screen was loaded or clicked. |
| CI | **Not yet recorded.** A run ID and tested SHA are recorded here only once a run is identified after the push. |

Coverage of the required test areas:

- Creation and authorisation: yes (creation refusals, stranger refusal, per-character limit, socket `business_unauthorized`).
- Product and service creation, route separation, listing rules: yes.
- Stock validation and restocking: yes (negative, fractional, service, and no-listing restock).
- Insufficient funds: yes (buyer and restock).
- Buyer debit and seller credit: yes (ledger and cash checked together).
- Salary and employee eligibility: yes (owner-only pay, paid to employee cash, child, deceased, unbanked, career conflict).
- Hiring and termination: yes (limit, owner-as-staff, stranger, firing with no pay afterwards, rehiring).
- Branch creation: yes (allowed location, limit, no cost).
- Ownership transfer: yes (verified recipient, old record kept inactive, refusals, socket handover).
- Contributions and withdrawals: yes (own cash only, manager refused, limit).
- Transfers: yes (own businesses only; unowned destination refused).
- Closure restrictions: yes (non-zero balance refused, wind-down, further actions refused, second closure refused).
- Ledger correctness and conservation: yes.
- Duplicate and idempotency: yes (repeated request ID, repeated buy).
- Invalid ownership and unauthorised requests: yes.
- Persistence after reload and restart: yes (socket reconnect and saved-world read-back).
- Concurrency: yes (two buyers, one unit).
- NPC invariants: yes, at service level only (section 7).

## 10. Commits

Stage 43 is recorded in focused commits on `arena/00cdea0e-naija`. The commit list and the pushed SHA are recorded in
the handoff (`docs/ARENA_HANDOFF.md`) and `docs/DEVELOPMENT_STATUS.md` after the push. Nothing is claimed as pushed
or as CI-verified until the remote SHA is checked.

## 11. Next steps

1. Run the Godot 4.7 client against the business panel, the Stage 41 housing screens, and the Stage 42 People panel. Until then, none of them is runtime-verified.
2. Split `business_panel.gd` to clear the `max-file-lines` finding, once a Godot run is available to check the split.
3. Resolve the open decisions in section 8.2 with the owner, starting with recipient consent and the co-owner-only state.
4. Decide the NPC seed-capital source before any NPC business is created in the running world.
5. Decide whether NPCs can be employees, and under what documented rule, before any NPC hiring is added.

Catalogue note (not changed): two food items, `biz-service:jollof-rice` and `biz-service:grilled-fish`, have a
`biz-service:` ID prefix but the `food` category. Both the server and the client classify by category, so behaviour is
correct. The IDs are not renamed, because saved state and recipes refer to them.
