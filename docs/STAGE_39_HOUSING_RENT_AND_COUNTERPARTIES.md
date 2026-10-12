# Stage 39: housing rent periods, counterparties, and the property ledger

Phase 1 of "Finish building Naija: one world". The first feature group after the audit in
`docs/PHASE_1_FEATURE_INVENTORY.md`: housing rent and the money paths that feed it.

## Starting point

- Branch `arena/00cdea0e-naija`. Starting HEAD `5db989da034eb6b90ef7c9bf67343861cfbeabec`, equal to `origin/arena/00cdea0e-naija` at the start.
- `stash@{0}` (`s38-pre-realign-worktree`) is kept. It is not part of this stage.

## What was wrong

1. **`pay_rent` was suspended** (`property_rent_payment_suspended`) because a repeated request paid again, and the idempotency key was built from the request time.
2. **NPC counterparties were a money sink.** A rent or sale to an NPC landlord or seller debited the payer and credited nothing. The code only credited player holders.
3. **Property money moves wrote no ledger rows.** Balances changed, but `economyTransactions` had no entry.
4. **Calendar had no month arithmetic** (only `addDays` and `addYearsClamped`).

## What changed

### Rent periods (`src/properties/service.ts`, `types.ts`)

- A rental start pays the first period and the deposit. The agreement records `paid_through_world_date` (the first period's end), with the month-end clamp (31 January + 1 month = 28 February).
- Period lengths: monthly 1, quarterly 3, half-yearly 6, yearly 12 months.
- `payRent` is due from `paid_through_world_date`. An earlier payment is refused with `property_rent_not_due` and changes nothing.
- An agreement saved before Stage 39 has no `paid_through_world_date`. Its due day is one period after its last payment (or its start, if it has none). This is the fail-closed reading, and it is an assumption: that the last payment covered one period from its date. Without it, an older agreement would have been due from its start, and a tenant could pay a period twice.
- A successful payment covers one period, advances `paid_through_world_date`, and stores `covered_from_world_date` and `covered_until_world_date` on the payment.
- The idempotency key is `prop-rent-period:{agreement}:{period start}`. A repeat for the same period has the same key, and the due-date check refuses it too.

### Counterparties (`src/properties/service.ts`, `src/economy/service.ts`)

- A **player** holder must already have a cash account.
- An **NPC** holder receives into its own cash account in `economyAccounts`, opened on first credit with `bank_product_id: null`. The interest and fee loops skip accounts without a bank product, so no interest or fee applies. Player routes cannot act on it: deposit, withdrawal, and transfer compare `account.character_id` with the session character and return `economy_account_not_found` on a mismatch (`src/economy/service.ts`, lines 406, 481, 593–594).
- Any other owner kind (business, government, community, joint, or unknown) is refused with `property_counterparty_unsupported` before anything is debited. This keeps Stage 34's rule: no business or organisation payments until a shared account model exists.
- The check runs before the debit on rent start, rent payment, and purchase.

### Ledger (`src/economy/types.ts`, `src/multiplayer/persistence.ts`)

- Six property transaction kinds: `rent_payment`, `rent_receipt`, `property_purchase`, `property_sale_proceeds`, `property_furnishing`, `property_maintenance`. Persistence validates them.
- Every property debit and credit writes one `economyTransactions` row in the same mutation as its balance change, with before and after balances.

### Engine (`src/multiplayer/world-engine.ts`)

- `pay_rent` is removed from `PROPERTY_SUSPENDED_ACTIONS`. The map stays empty as the fail-closed hook. The Stage 34 comment is updated.

### Validation (`src/multiplayer/record-validation.ts`)

- New optional fields are checked with `optionalWorldDate`. An absent value stays absent (not normalised to null, so older valid records are not rewritten). A present value must be a valid world date.

### Calendar (`src/life/calendar.ts`)

- `addMonthsClamped(date, months)`.

## Tests changed, and why

These three tests asserted the old suspension. They were rewritten to the new contract. They were not weakened.

| Test | Old assertion | New assertion |
|---|---|---|
| `property-actions-stage35`: pay_rent refused | `property_rent_payment_suspended` | Before the period is due: `property_rent_not_due`, with no money, payment, or agreement change |
| `property-actions-stage35`: termination and pay_rent together | `property_rent_payment_suspended` | With the period due: the termination applies once, and the number of payment rows matches the money moved (either order is allowed; a refused payment is `property_agreement_not_active`) |
| `money-routes-stage34`: pay_rent containment | `property_rent_payment_suspended` on an unknown agreement | `property_agreement_not_found` on an unknown agreement, with nothing changed (the test still checks that nothing changes live or in storage) |

`test/record-validation.test.mjs` gains two mutation checks for the new optional fields.

## New tests: `test/housing-rent-stage39.test.mjs` (7 tests, both backends)

1. A yearly NPC rental pays the first period and the deposit at the start. The NPC account is opened with no bank product, the ledger rows match, the next period is refused until its due day, and then it is paid once.
2. A monthly rental is clamped to the month end (31 January, then 28 February). The February payment covers 28 February to 28 March, a player landlord is credited, and a repeat is refused.
3. Rent payment to an owner that is neither a player nor an NPC is refused before any debit.
4. Renting from such an owner is refused before any debit, and no agreement starts.
5. Buying from an NPC seller debits the buyer, credits the NPC seller account, and writes one ledger row per side.
6. A repeated `pay_rent` request is a duplicate. After a restart, the paid period is still paid, so the same period is refused.
7. An agreement saved before Stage 39 (no paid-through date, last payment 15 June 2026) is refused on 14 June 2027 and accepted on 15 June 2027. This is the regression test for the legacy rule.

## Verification

| Gate | Result |
|---|---|
| `npm run lint` (root) | exit 0 |
| `npm run build` (root and world-api) | exit 0 |
| `tsc --noEmit` (world-api) | exit 0 |
| Full suite, file backend (`NAIJA_ENV=test`, no PostgreSQL) | 1351 total: 1297 pass, 0 fail, 54 skip, 0 TODO |
| Full suite, PostgreSQL 18.4 (embedded, `DB_SSL=false`) | 1609 total: 1605 pass, 0 fail, 4 skip, 0 TODO |

Both full suites ran after the last code edit. The stage-39 file has 7 tests per backend. Record validation has 2 new mutation checks.

The 54 file-backend skips are the PostgreSQL-backed tests, which state "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS". The 4 PostgreSQL skips are the live TLS tests, which need `TLS_TEST_DATABASE_URL`.


### Failures found and fixed during the stage

- **Record-validation (property domain): 31 failures.** The first version of the optional fields normalised absent values to null and counted them, so valid older records were rewritten. Fixed with `optionalWorldDate` (absent stays absent). Verified by the record-validation suite (157/157).
- **Test setup errors (fixed in the tests, not the code):** the rental-start payment is also a payment row, so the first row lookup in the monthly test returned the start payment; and a business-owner rent test changed the ownership but not the listing, so the existing owner-consistency check (`property_listing_unavailable`) refused first. Both fixes keep the intended check in the path.

## CI investigation (run 38235819303, commit b95dedb)

- **Result:** the `Foundation checks` workflow failed. Job `node-foundation` ("World API build, lint, and tests") failed at the step `Run foundation checks` (`npm run check`). Job `node-live-database` ("World API live PostgreSQL tests") passed.
- **Logs: not retrieved.** `gh run view --log-failed` and `gh api .../jobs/{id}/logs` both failed with "EOF" from the results receiver. This is the same failure as run 38209331236 (Stage 38). `gh run rerun --failed` was refused ("its workflow file may be broken").
- **Local repro: did not reproduce.** The same command on the same commit, in this sandbox (Node 22.22.3, the `.nvmrc` version; 2 vCPU), passed: lint exit 0, then tests 1351 total, 1297 pass, 0 fail, 54 skip, 0 TODO, exit 0. The run took about 3.5 minutes locally; the CI job took about 2 minutes 10 seconds in total, including the install. The job timing does not show whether the suite stopped early.
- **Root cause: not determined.** No failing test name is known, so no cause is asserted. Stage 39 changed rent and record-validation code and added the `housing-rent-stage39` tests. None of these were shown to be the cause. The failure is in the same class as the unexplained run 38209331236, which is also unexplained.
- **Not done:** no timeout was raised, and no test was skipped or changed to hide it. No later passing run is taken as a fix.
- **Diagnostics added:** the foundation job now keeps its full output (`tee` to `world-api-foundation.log`, with `pipefail`). On failure it writes the failing test names and errors to the step summary, and uploads `world-api-foundation-log` (14 days). This is the same pattern as the PostgreSQL job, so the next failure can be read without the results receiver.

## What this proves, and what it does not

**Verified by tests:**
- Rent is charged once per period, and a repeat for a paid period is refused on both backends.
- A monthly due date clamps to the month end.
- NPC and player counterparties receive the money, and the ledger rows match balances on both sides.
- Unmodelled owners are refused before any debit, and the state is unchanged live and in storage.
- The paid period survives a restart.

**Not proven:**
- **Concurrency across processes.** The stage-35 race test sends two requests on one server. It does not show that two processes serialise payments. Multi-host safety is not claimed.
- **Automatic collection.** Rent is paid only when the tenant sends `pay_rent`. There are no arrears, eviction, or late fees.
- **UI.** The Godot client has no property commands. Housing is not playable from the client.
- **Loaded-record validation of all property fields.** Only the Stage 39 fields were added to validation.
- **GDScript.** Godot is not installed, so no client file was run. No client file changed in this stage.

## Phase 1 status

Housing rent contract and counterparties: done. The remaining Phase 1 order is in `docs/PHASE_1_FEATURE_INVENTORY.md`:

1. Shared business-account model, then business payments (blocked; not started).
2. Station and jurisdiction model, then police and crime enablement (blocked).
3. Judge assignment and the authority model, then justice and military mutations.
4. Client UI for housing and businesses.
5. NPC, social, world-event, and transportation simulation (missing).

Revenue, taxation, fines, borrowing, minting, and organisation payments are not enabled. They are outside this order.
