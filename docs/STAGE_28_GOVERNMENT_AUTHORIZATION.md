# Government and election authorization: findings (2026-10-11)

Status: **vulnerability confirmed; temporarily contained (section 8).** Player-initiated government and election writes
are refused on the server with `government_writes_suspended` and `election_writes_suspended`. This is a containment
stage only, not an authorization system. The permanent rules (R-a to R-f) are still not implemented. Stage 28 push stays
on HOLD. Sections 1 to 6 are the pre-containment findings and are kept as the record of why the gap was closed this way.

## 1. Summary

The WebSocket engine does not check whether the acting character holds any government office, appointment, or election
authority before it performs a government or election mutation. The only checks are session authentication (the socket must
be bound to a live identity) and input validation. Any authenticated character, of any age, can:

- create a government budget for any government organisation (confirmed; the reported finding);
- appoint themselves, in a single request, to the unique presidency of the federal government (confirmed);
- take the presidency through the election flow, with no other official involved (confirmed end to end).

Budget creation is one link in that chain. Fixing `create_budget` alone does not close the exposure, because the
appointment and election paths are open.

## 2. Request path (current code, verified)

1. `handleMessage` (`src/multiplayer/world-engine.ts`) resolves the player from the socket with `playerFor(context)`. An
   unauthenticated socket gets a generic `error` with code `not_authenticated`, before any government code runs.
2. `case "government.action"` calls `governmentAction(context, player, message, requestId)`. The actor is
   `player.character.character_id`, taken from the session, not from the payload.
3. `governmentAction` reads the action parameters from `message.payload` (`requiredString`, `requiredInteger`). It does
   not read any role, office, or appointment field from the payload for authorization, and no such check exists.
4. Each mutation calls a service function in `src/government/service.ts` (`createBudget`, `appointOfficial`,
   `removeOfficial`, `recordGovernmentExpenditure`, and others). **None of these functions takes an actor parameter.**
   Their checks are: the organisation or office exists, the character exists and is alive and of minimum age (for
   appointments only), uniqueness of unique offices, the appointment cap, and amount or category validity.
5. Elections (`electionAction`, `src/elections/service.ts`) follow the same pattern. The actor is passed only as a
   recorded field (`createdBy`, `authorizedBy`, `approvedBy`, `certifiedBy`, `publishedBy`), never checked.
6. There is no HTTP route for these mutations. The WebSocket engine is the only entry point (checked by a search of
   `src/`).
7. Government services do not move money. `createBudget` creates an allocation record, and expenditure is recorded
   against a budget. Neither debits or credits an economy account. The harm is to the government ledger and to office
   holding, not to cash balances.

## 3. Confirmed behaviour before containment (tests in `test/government-authorization.test.mjs`)

Historical. The tests in this file were rewritten for containment (section 8). The table below records the behaviour that
was confirmed before the containment change.

| Test | Current result | Meaning |
| --- | --- | --- |
| KNOWN VULNERABILITY: no office, creates a budget (age 16) | passes (asserts success) | confirmed; age is not checked |
| `todo`: no office, budget refused | TODO (fails on `government.result`) | the desired result is unambiguous |
| `todo`: fabricated `office_id`, `appointment_id`, `role`, `actor_character_id` | TODO (fails on `government.result`) | payload fields are never checked against state |
| Authorised holder (test-side appointment to `office:minister`, `gov:federal`) creates a budget | passes | the only current path that is legitimately authorised; must keep working after any fix |
| Same authorised request sent twice, same `requestId` | passes, two budgets | no duplicate protection (design question, section 5) |
| Two holders, same organisation, same year and category, concurrent | passes, two budgets | no uniqueness rule exists (section 5) |
| Unauthenticated socket | passes; refused with `not_authenticated`, no budget | session authentication works |
| KNOWN VULNERABILITY: citizen appoints self to `office:president` | passes | a single request grants the unique presidency |
| `todo`: self-appointment refused | TODO (fails on `government.result`) | the desired result is unambiguous |
| KNOWN VULNERABILITY: election flow to presidency | passes | create party, register party, create election, register and approve self, vote, count, certify, publish, transfer office |

Results: file backend 10 tests, 7 pass, 0 fail, 3 TODO; PostgreSQL loopback 20 tests (both backends), 14 pass,
0 fail, 6 TODO. The TODO entries fail on the vulnerable behaviour itself, not on a setup error.

Election-chain step detail: `advance_phase` to `certification` returned `elections_phase_transition_invalid` only because
`count_votes` had already moved the phase. The later `certify_result`, `publish_result`, and `transfer_office` steps
succeeded.

## 4. Why no correction was applied

Every correction needs a government-permission rule that the game model does not define:

- **R-a Who may appoint, and to which offices.** `appoint` is documented as "authorization required", but no rule says
  who has that authority. The seeded world has 10 offices, all in `gov:federal`, and **all are vacant**. Requiring an
  office holder to appoint would make the first appointment impossible. Some bootstrap rule would be needed.
- **R-b Which offices may create or approve budgets, record revenue or expenditure, create or fund projects, and publish
  announcements.** The catalogue lists offices but attaches no permission to any of them. The brief said not to assume
  identical permissions. Any membership rule ("holds any office in the organisation") assumes exactly that.
- **R-c Hierarchy.** Whether a federal office may act for a ministry (for example, a federal budget for `gov:min:health`)
  is not defined. The seeded world has 16 organisations (the federal government and 15 ministries) and no state or local
  organisation. Ministries have no offices. The catalogue defines state and local office types (`governor`,
  `deputy-governor`, `lg-chairman`), but all 10 seeded offices are attached to `gov:federal`.
- **R-d Election authority.** No rule says who may create an election, advance its phases, approve or reject candidates,
  count, certify, publish, or transfer office. No electoral authority role is modelled.
- **R-e Self-dealing.** Whether a candidate may approve their own candidacy or certify their own election. This is very
  likely to be disallowed, but it is still a rule.
- **R-f Age for budgets.** The catalogue sets an age minimum for office holders (18). It sets none for budgets.

A `create_budget`-only guard ("holds an active office in the target organisation") would close the single-step path for
non-holders. It would **not** close the exposure, because a citizen can become a holder in one request (self-appointment)
or through the election flow. It would also make budget creation impossible for everyone until a holder exists, which
depends on R-a. Shipping it would look like a fix while leaving the exploit open, so it was not applied.

## 5. Duplicate requests and concurrency

- `government.action` and `election.action` are not in `IDEMPOTENT_COMMANDS`. A repeated `requestId` is processed again.
- `createBudget` has no uniqueness rule (organisation, fiscal year, and category may repeat). Two authorised requests
  both succeed. The engine handles each message synchronously, so the two creations cannot interleave within one
  mutation. Whether duplicates are a defect depends on R-b and on whether an organisation may hold several budgets for one
  category and year. This is an unresolved design question, not a race.
- Idempotency and authorization are separate. Adding a request-ID cache does not fix authority.

## 6. Options for review

1. **Contain now (recommended, needs approval).** Refuse player-initiated government mutations and election creation and
   transfer until R-a to R-e are decided. Read-only actions (`view_*`, `list_*`, `announcements`, `my_*`) stay available.
   Nothing that is legitimately authorised today is lost, because no office holder exists in the seeded world. The
   engine-level election tests would need updating for the new refusal. This is a product change: players lose the
   election and government write actions until the rules exist.
2. **Implement the rules, then guard.** Decide R-a to R-f first, then add one actor check per mutation, using the
   appointment and election records as the authority source. This is larger, and it needs owner decisions.
3. **Leave as is.** Not recommended. The presidency can be taken in one request, and the presidency record is not
   used by other systems today (checked: no other module reads `governmentAppointments` for a decision), but the
   exposure is an authorization failure in a shared world.

## 7. Files

- `services/world-api/test/government-authorization.test.mjs` (new, uncommitted): containment tests (section 8).
- `services/world-api/test/mutation-resend-guards.test.mjs` (new, uncommitted): the `create_budget` re-send test now
  expects `government_writes_suspended`.
- `services/world-api/src/multiplayer/world-engine.ts`: containment gate (section 8).
- `services/world-api/src/government/service.ts`, `services/world-api/src/elections/service.ts`: message text for the
  two suspension codes only.
- `docs/STAGE_28_GOVERNMENT_AUTHORIZATION.md` (new, uncommitted): this document.

## 8. Containment (temporary; approved as option 1)

Approved condition: this is a containment stage only. It is not the permanent authorization system, and it does not decide
which offices may appoint, control budgets, run elections, or self-deal.

### 8.1 What is refused

- Every government action that is not on the read list is refused with `government.error`, code
  `government_writes_suspended`. Read list: `view_federal`, `view_state`, `view_local`, `search_projects`, `announcements`,
  `my_appointments`.
- Every election action that is not on the read list is refused with `election.error`, code `election_writes_suspended`.
  Read list: `list_parties`, `political_profile`, `list_elections`, `view_election`, `list_candidates`, `view_campaign`,
  `check_eligibility`, `audit_log`, `my_history`.
- The gate is deny by default. Unknown, unlisted, misspelled, or malformed action names get the same suspension code. The
  switch's own unknown-action branch is no longer reachable for players.
- The message text is in `governmentErrorMessage` and `electionsErrorMessage`: "temporarily suspended", with the
  read-only note. It states nothing about saving or recovery.

### 8.2 Where it runs

- The gate is the first check in `governmentAction` and `electionAction` in `world-engine.ts`, after the existing shape
  check on `message.action` and before any payload parsing, state access, or side effect.
- A refused request does not call `markRequestProcessed`, `touchPlayer`, `flushDirty`, or `sendCharacterSnapshot`. A
  duplicate `requestId` is therefore not recorded either.
- Only `message.action` is read. Fields in `payload` (including a fake `action`) cannot change the decision. Client-supplied
  role, office, appointment, organisation, and authority fields are never read by the gate.
- Reads are unchanged: they still run, and they still send `markRequestProcessed` and `flushDirty` as before.

### 8.3 Exemptions (internal paths)

- `seedGovernmentWorld` and the election initialisation run from trusted server code: at persistence initialisation and from
  identity creation (`seedNewIdentityWorlds`). They do not pass through the socket gate. They are idempotent: seeding returns
  early when organisations already exist. They create organisations, offices, and one budget. They create no appointments.
  Safety: no player message reaches them, and they cannot be triggered with player-supplied input.
- Service functions (`appointOfficial`, `createBudget`, and the rest) are not changed. They are reachable only from the
  engine, and the engine refuses player writes before calling them.
- No other module writes government or election state (checked by grep across `services/world-api/src`). Two names collide
  with the government and election services but are different functions: `resolveDispute` and `createProject` /
  `publishAnnouncement` in `culture/service.ts` are culture-domain methods (community disputes, community projects and
  announcements). The culture module does not import the government or election services.

### 8.4 Lists checked

- Election mutators in `elections/service.ts` with no player action: `cancelElection`, `updatePartyStatus`,
  `setPartyLeadership`, `createCampaignEvent`, `recordCampaignFinance`, `createDebate`, `addDebateStatement`,
  `resolveDispute`. None has a caller in the engine. Each is refused if a player sends its name.
- Election read helpers (`listParties`, `getPoliticalProfile`, `checkVoterEligibility`, `listElections`, `getElection`,
  `listCandidates`, `getCampaign`, `getElectionAuditLog`, `getCharacterElectionHistory`) were read for writes. None writes.
- Government read helpers (`getFederalGovernment`, `getStateGovernment`, `getLocalGovernment`, `searchProjects`,
  `getCharacterAppointments`) were checked the same way. None writes. `processGovernmentWorldDate` is a no-op.

### 8.5 Tests

`test/government-authorization.test.mjs` (15 tests per backend) and `test/mutation-resend-guards.test.mjs` (the
`create_budget` re-send test). They use the real socket path and compare a full fingerprint of the world state before and
after each refused request. The fingerprint excludes only `player.lastSeen`, which the engine sets for every command
before dispatch. Cases: every government write and every election write for a citizen with no office; the same
government writes for an office holder; the 16-year-old `create_budget`; a repeated `requestId`; self-appointment;
`remove_official`; fabricated fields; the full election chain; alternate shapes (case and whitespace variants,
cross-family names, names only in the payload, non-string actions, unknown message types); read availability; the
unauthenticated socket; and identity creation as the seeding path.

Mutation check: with both gate conditions disabled in a scratch build, 12 of the 19 focused tests failed. The gate was
restored byte-identical and rebuilt.

### 8.6 Not done

- Permanent rules R-a to R-f: not implemented. Nothing in this section decides who may appoint, who may control budgets,
  who may run elections, self-dealing, or the age rule for budgets.
- No existing government or election record was deleted or changed. Existing appointments, budgets, parties, and
  elections stay in the world state.
- Lifting containment is a separate change. It must come with the permanent rules and the tests for them.

