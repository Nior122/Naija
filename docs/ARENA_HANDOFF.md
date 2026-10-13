# Arena handoff: Naija: One World

This document lets a new Arena chat continue the project without the earlier conversation. Facts here were checked
against the repository and CI. Where a number comes from an earlier recorded run and was not re-run for this handoff, the
text says so.

## 1. Project objective

Naija: One World is a persistent multiplayer Nigerian life-simulation game. Players begin as secondary-school students and
shape lives across education, work, housing, business, family, and civic life, in one shared world (`nigeria-main`).

## 2. Development strategy

1. Complete the planned game as one connected, playable simulation.
2. Private deployment, for the developer and invited testers.
3. Testing and production readiness.
4. Worldwide launch, once the release criteria are met.

**Current phase: Phase 1, feature completion.** Do not move to launch or long hardening work while planned features are
incomplete. Do not start a dedicated infrastructure or hardening stage on the basis of this document.

## 3. Repository state

- **Branch:** `arena/00cdea0e-naija`. This session is fixed to this branch. Push only to it, and only with fast-forward
  pushes.
- **Last Stage 40 commit:** `8e564f7` (`Stage 40: business accounts in the economy ledger, buyer-paid sales`).
- **Base:** `main` and `origin/main` are both at `44483b4`. The arena branch was branched from it. The arena branch has
  146 commits in total.
- **Latest CI:** run `38243775351`, event `push`, branch `arena/00cdea0e-naija`, **head SHA `8e564f7`**, conclusion
  **success**. Both jobs passed: "World API build, lint, and tests" and "World API live PostgreSQL tests (disposable
  service)". Earlier runs `38236939594` (`26f06d3`) and `38236669212` (`09d3bea`) also succeeded. Stage 39's `b95dedb`
  failed its foundation job once, with no cause identified. Do not claim CI for any commit unless its run ID and tested SHA
  are identified.
- **This handoff commit** adds only this file and a status note in `docs/DEVELOPMENT_STATUS.md`. Its hash is in the handoff
  report, not in this file.
- **Stash:** the session notes mention a stash `s38-pre-realign-worktree`. It is **not present** in the clone used for this
  handoff. Its contents are unknown and cannot be inspected from here. It predates Stage 39. Do not drop or apply any stash
  without inspecting it first.
- **Clone note:** the clone was recreated from `origin`. The branch ref had been left at `44483b4`, while the working tree
  held the Stage 1–40 files. Those files were byte-identical to `8e564f7`. The branch and index were moved to `8e564f7`
  without touching working-tree files.
- **Dependencies:** `node_modules` is not in Git. Run `npm ci` at the repository root in a new clone.

## 4. Commands

From the repository root:

- `npm ci`, then `npm run check`. `check` runs lint, then the world-api test suite, which builds first.
- `npm run build`, `npm run lint`.
- One test file: `cd services/world-api && NAIJA_ENV=test node --test test/<file>.test.mjs`.
- Live PostgreSQL: the CI job sets `DATABASE_URL` to a `naija_test` database on a `postgres:18` service and runs `npm test`.
  Local runs also need `NAIJA_ALLOW_DB_TESTS=true`. Use a scratch database whose name contains "test". The TLS tests need a
  separate `TLS_TEST_DATABASE_URL` server, and they skip without it. See the Stage 40 document, section 7.3.
- Godot 4.7 is the client engine (`game/project.godot`, `config/features` `4.7`, GL Compatibility). **Godot is not installed
  in the sandbox**, so no Godot runtime test was run in any Stage 34–40 work. The headless scripts in `game/tests/` also
  have not been run in this work. `docs/CONTRIBUTING.md` recommends Godot 4.7.2.

Test results recorded in `docs/STAGE_40_BUSINESS_ACCOUNTS.md` section 7.3. They were **not re-run for this handoff**:

| Run | Total | Pass | Fail | Skip | TODO |
|---|---|---|---|---|---|
| Full, file backend (`npm test`) | 1372 | 1318 | 0 | 54 (PostgreSQL-only) | 0 |
| Full, live PostgreSQL 18 (embedded npm server, `naija_test`) | 1638 | 1634 | 0 | 4 (need TLS server) | 0 |

Re-run for this handoff (on `8e564f7`): `npm ci`, `npm run build`, and `npm run lint` passed. The four targeted files
(`business-accounts-stage40`, `housing-rent-stage39`, `businesses`, `business-money-stage34`) gave 58 tests, 58 pass, 0 fail,
0 skip, 0 TODO, on the file backend.

## 5. Completed work

- **Stages 0–21:** earlier foundations. `docs/DEVELOPMENT_STATUS.md` is the older record, and the top of it now points here.
- **Stages 22–38:** geography, multiplayer integration, identity and authority, treasury and payments, persistence
  concurrency, cross-process request records, property safety, and consequential-mutation safety. Each has a
  `docs/STAGE_NN_*.md` document.
- **Stage 39** (`b95dedb`, then `09d3bea` and `26f06d3` for CI logs and results): housing rent periods (per-period due
  dates, `property_rent_not_due`, per-period idempotency), NPC landlord and seller counterparties (an NPC cash account with
  no bank product), and ledger rows for property money. Tests: `test/housing-rent-stage39.test.mjs`. Document:
  `docs/STAGE_39_HOUSING_RENT_AND_COUNTERPARTIES.md`.
- **Stage 40** (`8e564f7`): business accounts in the economy ledger. Each business has one economy account (`kind: current`,
  holder = business id). Every business money movement is an economy ledger row. The following were fixed:
  1. A client could credit any business through `sell_product` with a supplied buyer. Sales are now buyer-paid
     (`buy_product`, `buy_service`), and the payer is the session character. `sell_product` and `sell_service` are removed.
  2. Restock changed stock before checking funds. It now checks first.
  3. Close did not require a zero balance. It now does.
  4. NPC seed set a balance with no ledger row. It is now issuance (see the limitations).
  5. Daily operating cost was counted twice in `total_expenses_ngn`. It is now counted once.
  6. An unreachable `character.money` fallback in `createBusiness` was removed.

  The shared-account rule (owner decision, `docs/STAGE_40_BUSINESS_ACCOUNTS.md` section 2.2): every owner or co-owner is
  equally authorised; withdrawals go to the caller's own cash; `share_percent` is recorded but **not enforced**.
  Tests: `test/business-accounts-stage40.test.mjs` (13 service tests and 8 socket tests per backend; 21 on the file backend,
  29 with PostgreSQL), `test/businesses.test.mjs` (22 of 22), and `test/business-money-stage34.test.mjs` (8 of 8 on the file
  backend).
- **Stage 41** (housing and business client): Godot housing and business screens, and `ServerRequestTracker` for
  duplicate protection. Record: `docs/STAGE_41_HOUSING_BUSINESS_CLIENT.md`. Not runtime-verified.
- **Stage 42** (NPC simulation and social relationships): six fixed neighbours with clock-derived activity, and
  player-to-NPC relationships. Record: `docs/STAGE_42_NPC_SOCIAL.md`. Pushed in `3df94f7`; Godot not run.
- **Stage 43** (business lifecycle, validation, and economic integration): create, listings, restock, purchases,
  hire, pay, fire, branches, owner-only ownership transfer, closure, and the business panel's lifecycle screens.
  Failed changes roll back through a snapshot. Record: `docs/STAGE_43_BUSINESS_LIFECYCLE.md`. Server tests pass on both
  backends (file 1460/1514, PostgreSQL 1808/1812, 0 failures). Godot not run.

## 6. Feature status

Source of truth: `docs/PHASE_1_FEATURE_INVENTORY.md` (rows 1–28). Summary, with the rows that matter for housing and
business:

- **COMPLETE:** sessions and persistence (row 1); calendar (2); cash ledger (3); bus fare and clinic routes (5);
  property money ledger rows (10); NPC housing counterparties (9); business payments on the server (12).
- **PARTIAL:** salary credit (4); housing purchase, listing, transfer (6); rent start, termination, maintenance, furnishing
  (7); rent payment (8, complete for the rules, no client UI); businesses (11, server complete for the lifecycle, client
  implemented in Stage 43 and not runtime-verified); education (21); authority model
  (28); and some areas not re-audited (16, 22, 27).
- **SUSPENDED:** government writes (13); elections (14); police wanted requests and arrests (15); crime mutations (17);
  military mutations (18); justice judgments, appeals, and fines (19). Each is refused fail-closed with a `*_suspended` code.
- **BLOCKED:** the station and jurisdiction model (rows 15–17 and 28). The inventory states that it waits on open owner
  decision 10 (station assignment).
- **MISSING:** relationships and social (23); NPC simulation (24); world events (25); transportation beyond bus fare (26).
- **MISSING, not to be enabled:** revenue, taxation, borrowing, and unrestricted minting (20).

## 7. Known limitations

**Client (Godot):**
- `game/scripts` has no housing or business commands or screens. Checked with a grep at this handoff.
- The Godot client has not been run against any Stage 34–40 server work.

**Housing:**
- Rent is paid only when a tenant sends `pay_rent`. There is no arrears, late fee, eviction, or automatic rent collection.
- Stage 39 section 5 lists its remaining scope limits. Read it before any housing change.

**Business (Stage 40 section 5 and 7.4):**
- The business panel (Stages 41 and 43) is not runtime-verified in Godot. `produce` and `record_expense` have no client.
  Co-owner add and remove are not implemented on the server.
- Recipient consent for hiring and ownership transfer is not implemented. A co-owner-only business cannot be
  transferred onward. The branch setup cost is undefined, and the service price ceiling is provisional.
- NPC businesses are not created in the running world (`seedNpcBusinesses` has no production caller). NPCs cannot be
  hired. The NPC seed-capital source is unresolved. See `docs/STAGE_43_BUSINESS_LIFECYCLE.md` section 7.
- `share_percent` is recorded but not enforced. Co-owners withdraw without a split.
- Operating costs, supplier stock, and setup fees are sinks. No supplier or landlord accounts exist.
- NPC seed capital is issuance with no source (section 2.6). A world-issuance policy is needed.
- Revenue recorded through the removed `sell_product` path cannot be verified. `legacy_recorded_revenue_ngn` keeps the figure.
- The file backend supports one process. No multi-host guarantee is claimed for business money.
- Taxes, fines, borrowing, minting, and revenue remain suspended. Stage 40 did not enable any of them.

**Persistence and infrastructure:** the file backend is single-process. PostgreSQL is the multi-host path. Infrastructure
work is not the current phase.

**Lint:** the Godot static lint has known structural findings (see the README and `docs/DEVELOPMENT_STATUS.md`).

## 8. Next task: Godot runtime verification, then the open business decisions

The next work is **Godot runtime verification** of the Stage 41 housing and business screens, the Stage 42 People panel,
and the Stage 43 business panel. None of them is verified yet. Godot 4.7 is not installed, and its release asset host is
blocked from the sandbox. If a Godot binary becomes available, run the project and record exactly what ran. Also resolve
the `max-file-lines` finding in `game/scripts/ui/business_panel.gd` (1188 lines) during that pass.

Before any further business change, the owner needs to decide the items in `docs/STAGE_43_BUSINESS_LIFECYCLE.md`
section 8.2: recipient consent, the service price ceiling, the co-owner-only ownership state, the NPC seed-capital source,
and the branch setup cost. Open decisions 9, 10, and 11 remain open.

## 9. Rules for the next chat

- Start by checking `git rev-parse HEAD` and `git rev-parse origin/arena/00cdea0e-naija`. Continue from the actual HEAD.
- Do not recreate the repository. Do not revert completed work. Do not restart Stage 39 or Stage 40.
- Never use `git reset --hard`, force-push, or destructive cleanup. Do not discard changes to make the tree clean. Do not
  blindly apply or drop stashes.
- Use fast-forward pushes only, to `arena/00cdea0e-naija`.
- Do not commit secrets, env files with secrets, build output, or `node_modules`.
- Do not claim CI passed for a commit unless the run ID and tested SHA are identified.
- Do not claim Godot UI ran unless it did.
- Request IDs must match `[A-Za-z0-9._:-]+`. Other IDs are dropped by the server.
- Keep `docs/DEVELOPMENT_STATUS.md` current when capability, tests, limitations, or the next stage change
  (`docs/CONTRIBUTING.md`).
