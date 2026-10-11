# Stage 31: Treasury and Financial Authority

Date: 2026-10-11. Branch: `arena/00cdea0e-naija`. Starting commit: `2244457` (the Stage 30 commit on this branch, which started from `main` at `44483b4`).

Status: **Three treasury routes are open, behind server-side authority. Everything else that moves money stays
refused.** This stage builds the government treasury ledger, the hierarchy rule that decides which office governs which
organisation, and the budget-approval age rule. It is not production-ready. It has no funding source, and money paid to
a character does not reach that character's economy account (see section 8).

Read this with `docs/STAGE_28_AUTHORITY_MODEL.md` (the rules G-1 to G-8 and R-a to R-f) and
`docs/STAGE_30_GOVERNMENT_ELECTION_AUTHORITY.md` (the resolver and the term and suspension rules). Both are updated to
point here.

## 1. What is open, and what stays closed

| Engine action | State after Stage 31 | Why |
|---|---|---|
| `approve_budget` | **Open** (server authority, age 25 or over) | Sets a ceiling on a budget. Moves no money. |
| `allocate_budget` | **Open** (server authority, `requestId` required) | Commits part of an approved ceiling. Moves no money. |
| `spend_budget` | **Open** (server authority, `requestId` required, destination checks) | Debits the organisation's treasury ledger. |
| `record_revenue` | Suspended (`government_writes_suspended`) | No funding source has been decided. Revenue has no player route. |
| `record_expenditure` | Suspended | Replaced by the scoped `spend_budget`. Also needs the treasury debit. |
| `create_budget` | Suspended | Trusted seeding path only (see section 4). |
| `appoint`, `remove_official` | Suspended | R-a (appointing-office table) is still an owner decision. |
| `create_project`, `update_project`, `fund_project`, `publish_announcement` | Suspended | R-b, G-5, G-6. |

The gate is in `services/world-api/src/multiplayer/world-engine.ts` (`GOVERNMENT_TREASURY_ACTIONS`, next to
`GOVERNMENT_READ_ACTIONS`). Any action not in one of the two sets is refused before its payload is parsed. The
`GOVERNMENT_WRITE_ACTIONS` list in `test/government-authorization.test.mjs` names only the suspended writes.

Trusted functions with no player route: `recordGovernmentRevenue`, `recordGovernmentExpenditure`, `createBudget`,
`reconcileGovernmentStructure`, `auditTreasuryLedger`.

## 2. Governance rules implemented

| Rule | Implementation |
|---|---|
| Authority is server-derived | `authorizeOfficePermission` (`src/government/authority.ts`) takes the actor from the session and reads the office, appointment, and birth date from server records. Request fields are never read for actor, owner, organisation, account, or independence. Tests send all of these and check they are ignored. |
| Office must grant the permission | `office_permissions` in `game/data/government/catalog.json`. The president and each minister hold `budget_approve`, `budget_allocate`, and `budget_spend` over their own organisation. The vice-president and every other office hold none. |
| Exact scope | An office confers authority only over its own organisation. A minister of finance has no authority over the health budget, the federal budget, or another ministry's budget. A parent may not spend from a child budget, or the reverse (`government_budget_wrong_organisation` in the trusted path, `government_authority_scope` on the route). |
| Approval age (R-f) | `budget_approval_minimum_age_years: 25`, checked against the server's `date_of_birth` with `ageOnDate`. Refused as `treasury_approval_age_ineligible`. A missing or invalid birth date is refused as `government_age_unknown`. |
| Age rule is approval only | Allocation and spending are not age-gated. The rule is not applied to all financial transactions. A test proves a 20-year-old minister may allocate and spend, while being refused approval. |
| Self-dealing | A payment to the actor, or to a business whose `owner_character_id` is the actor, is refused (`treasury_conflict_of_interest`). This is the narrow G-7 rule. Broader conflicts remain an owner decision. |
| Requests are idempotent where money moves | Spend is keyed by a hash of actor and `requestId`, with a payload fingerprint. A retry replays the first result (`replayed: true`). The same key with a different payload is refused (`treasury_idempotency_conflict`). Allocation uses the same scheme, held in event details. |
| Ceilings are absolute | `approve_budget` sets the ceiling. It cannot go below what is already allocated (`treasury_approval_below_allocation`). |
| Refusals change nothing | Each treasury function validates the whole request before its first write. Tests take a full state snapshot before and after every refusal and require equality. |

Decisions taken from the mission and recorded in the catalogue, not guessed: the 25-year approval age, the
`office_permissions` table (president and minister only), the per-ministry minister seat, and the self-dealing rule.
Owner review of these is listed in section 9.

## 3. Hierarchy handling

`src/government/hierarchy.ts` decides what an organisation is, from its own record and its parent chain
(`organisationKind`), and whether an office fits it (`officePlacement`). Organisation kinds:

| Kind | Required shape |
|---|---|
| `federal_government` | Federal level, no ministry, no jurisdiction, no parent. |
| `federal_ministry` | Federal, `ministry_id` in the catalogue, id `gov:<ministry>`, parent `gov:federal`. |
| `state_government` | State level, parent `gov:federal`, jurisdiction `ng:state:*`. |
| `local_government` | Local level, `ng:lga:<state>:*`, parent is a state government whose jurisdiction matches the LGA's state. |
| `electoral_commission` | Electoral institution, standalone federal, listed in `independent_institutions`. |

Placement checks run in this order, and the first failure is reported: definition exists, organisation exists, level
matches (`office_level_mismatch`, kept for the existing test), institution matches (`office_institution_incompatible`),
the organisation's kind is recognised (`organisation_kind_unrecognised`), and the office's scope matches the kind
(`office_scope_incompatible`).

- **Seed.** Only reliably placed offices are created: the president and vice-president at `gov:federal`, one minister
  per federal ministry, and the electoral commissioner at `gov:electoral`. The seed has no state or local
  organisations, so governors, deputy governors, LG chairmen, commissioners, and directors are **not seeded**. Their
  definitions remain in the catalogue for later.
- **Ambiguous offices are not guessed.** `office:perm-secretary` and `office:agency-director` have no seed organisation
  in the catalogue, so they are not created. A minister is placed only in a named ministry.
- **Legacy records are not rewritten.** A pre-Stage 31 `office:minister` at `gov:federal` is not placed
  (`office_scope_incompatible`), so it confers no authority. The fail-closed default is applied, and the record stays as
  it was. A test proves the record is unchanged after reconciliation.
- **Reconciliation on load.** `reconcileGovernmentStructure` runs on seed and on every identity resume. It is idempotent,
  adds missing organisations, offices, treasury accounts, and ministry budgets, and marks the world dirty only when it
  adds something.
- **New appointments to a misplaced office are refused** (`government_office_placement_invalid`). This is a deliberate
  tightening. The resolver also refuses existing misplaced appointments.

## 4. Treasury model

- **Accounts.** An optional `treasury_account` on each organisation record, with id `treasury:<org_id>`. It holds
  `balance_ngn`, `total_credited_ngn`, and `total_debited_ngn`. It has no separate map and no schema bump (the schema
  stays at 18). Economy accounts are character-owned and are not reused.
- **Ledger.** Existing `governmentRevenue` and `governmentExpenditure` maps, with optional new fields: `account_id`,
  `actor_character_id`, `balance_after_ngn`, and for spending `destination_kind`, `destination_id`, and
  `request_fingerprint`. Legacy rows have none of these and are valid as they are.
- **Invariant.** For every account, balance equals credited minus debited, and both equal the sums of its ledger rows.
  `auditTreasuryLedger` checks this. It also checks `0 <= spent <= allocated <= approved` on every budget.
- **Budgets.** Ministry budgets `bud:<ministry id>:<year>` (for example `bud:min:finance:2026`) are created as draft with 0 approved. The federal budget is
  approved by the trusted path, as before. `createBudget` keeps its trusted behaviour (allocated equals approved) and
  has no route.
- **Spend order.** A request ID is required. The budget is looked up. Authority is checked **before** any replay lookup.
  Then the replay check runs, followed by amount, reason (1 to 200 characters), organisation status, budget status
  (not draft, not closed), destination (kind, existence, and conflict), available budget, and finally treasury funds.
  Nothing is written until every check passes.
- **Destinations.** `character`, `business`, or `organisation` only. Anything else is `treasury_destination_invalid`.
  A character must exist. A business must exist. An organisation must exist.
- **Funding.** There is none. Revenue has no route, and the trusted intake has no caller, so every treasury starts at 0.
  Spending from it is therefore refused (`treasury_insufficient_funds`) until a funding source is decided.

## 5. Database and security guarantees (verified)

| Guarantee | How it is enforced | Verified by |
|---|---|---|
| Validate, then write | Each treasury function checks everything before the first assignment. | Snapshot-equality tests on every refusal (service and socket). |
| No double debit on retry | Spend idempotency key stored on the ledger row, with a fingerprint. | Service and socket replay tests. |
| No double debit under concurrency | Each spend runs its checks and its write with no `await` between them, so a second identical request that arrives while the first is still in flight sees the first's write and replays. | "two identical spends sent together" (both backends). |
| No overdraft under concurrency | Each spend checks funds against the current balance at write time. | "two different spends that together exceed the treasury" (both backends). |
| Persisted ledger is checked on load | `validateGovernmentRecords` checks account shape and the balance-to-ledger sum. A mismatch fails the load (`assertRecordsValid`). | Record-validation tests, including a forged balance. |
| Legacy rows are not altered | Optional fields are checked only when present (`v.invariant`), not normalised. | Legacy-row test: no field added. |
| Client fields are ignored | Actor from session, approver from session, organisation from the budget. | Socket test sends `actor_character_id`, `approved_by_character_id`, `owner_character_id`, `organisation_id`, `account_id`. |
| Refusals leave no trace | No event, no balance, no idempotency record is written before the checks finish. | Snapshot tests. |
| Suspended writes stay suspended | Gate refuses everything outside the two sets before parsing. | Existing "every government write is refused" tests, which still pass. |

## 6. Tests and results

New file `services/world-api/test/government-treasury.test.mjs` (21 tests). Part A is service-level. Part B runs over
the socket on both backends.

Updated tests, each explained in its comment:

- `government-authority.test.mjs`: `addStateGovernment` now sets a federal parent (the kind rule). The misplaced-governor
  test creates a legacy record directly and checks the new refusal for new appointments.
- `government-authorization.test.mjs`: the three setups that used a federal minister now use `gov:min:finance`. The
  suspended-write list is unchanged, and the comment explains that the treasury routes are excluded.
- `government.test.mjs`: the seed test now expects the federal budget approved, ministry budgets in draft at 0, zero
  treasury balances, the seed-only office list, and every office placed.

Results are in section 6.1.

### 6.1 Results

| Run | Total | Pass | Fail | Skip | Notes |
|---|---|---|---|---|---|
| Stage 30 baseline (`npm test`, file backend) | 1102 | 1064 | 0 | 38 | From `STAGE_30_GOVERNMENT_ELECTION_AUTHORITY.md` section 8. |
| Stage 31, after implementation (`npm test`) | 1123 | 1085 | 0 | 38 | +21 treasury tests. The 38 skips are DB-dependent, as before. |
| Stage 31 focused (treasury, authority, government, authorization, record validation) | 225 | 225 | 0 | 0 | After the final build. |
| `npm run lint` (repository root, eslint on `services/world-api/src`) | - | - | - | - | Exit 0 after removing four unused imports. |
| CI on `683879f`: "World API build, lint, and tests" and "World API live PostgreSQL tests" (GitHub Actions run `38170879215`) | - | - | - | - | Both jobs succeeded. The live job ran against a disposable PostgreSQL service. No local live run was done. |

The final full-suite numbers are in the commit message and the report. Where this table disagrees with a later run, the
later run wins.

## 7. Known defects and residual risks

- **Ambiguous legacy seats.** Pre-Stage 31 worlds have `office:minister` and `office:perm-secretary` at `gov:federal`.
  Those are now placed as `office_scope_incompatible`. Under the old resolver a minister there held federal-wide
  authority. The new scope rule removes that authority. Those legacy records are left unchanged on purpose.
- **Engine error paths.** Only the treasury functions were checked for validate-then-write. The older government and
  economy actions still mutate memory before a failure can occur.
- **Persistence failures.** `flushDirty` retries a failed save without rollback. If a save fails after a treasury
  write, memory is ahead of disk until a save succeeds. This is a known condition, not a fix.
- **Older binaries.** No schema version changed, so there is no rollback migration. An older build reading a world with
  treasury accounts ignores the optional fields, and its balance view would be stale.
- **Carried, not changed:** session expiry (D-06), plaintext client credentials (CRED-1), unwired touch controls, mutation
  M4 not run, TLS live suite not run, multi-instance safety untested.

## 8. Remaining blockers

1. **No funding source.** No revenue route, tax, or fine flows into a treasury. Owner decision needed.
2. **Payments do not reach payees.** `spend_budget` debits the government ledger and records the destination. It does not
   credit the payee's economy account. Linking it to the existing economy is required before a payment is real money to
   a citizen, and it must go through the existing economy, not a second system.
3. **Office permission table (R-b).** The president and minister hold the three treasury permissions in the catalogue.
   This is a mission decision that the owner should confirm.
4. **Governors and locals are not seeded.** No state or local organisation exists, so those offices cannot act.
5. **Election and project routes** remain suspended.
6. **Destination coverage.** A character destination must be a player character. NPCs cannot be paid.

## 9. Owner decisions still required

1. Confirm the 25-year approval age (`budget_approval_minimum_age_years`) and that it applies to approval only.
2. Confirm the `office_permissions` table: which offices may approve, allocate, and spend.
3. Confirm the self-dealing rule: a payment to the actor or to a business the actor owns is refused. A broader conflict
   definition (G-7) is still open.
4. Decide the funding source for each treasury.
5. Decide how a payment reaches a payee's economy account.
6. Confirm that a ministry minister, not the federal government, controls ministry budgets (the exact-scope default).

## 10. Next recommended stage

Stage 32 should be a **funding and payee-credit design**: a decided funding source for at least one treasury, and an
atomic credit from a government payment into the existing economy account of a character or business. It must reuse
the economy system, must keep every refusal write-free, and must be tested on both backends. Open the revenue route only
after that. Election certification and publication enforcement (Stage 30 E-2 and E-4) can follow separately.
