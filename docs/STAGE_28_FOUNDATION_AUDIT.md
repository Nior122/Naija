# Stage 28 foundation audit (read-only)

**Status: Stage 28 remains OPEN. Production remains NOT READY.**
**Mode:** read-only audit. No code changes, no commit, no push, no amend, no rebase, no reset, no history rewrite, no overwrite of uncommitted work.
**Date:** 2026-10-11 (Africa/Lagos). **Branch:** `arena/00cdea0e-naija`. **HEAD:** `a487630`.
**Containment:** government and election writes remain suspended (see `docs/STAGE_28_GOVERNMENT_AUTHORIZATION.md`, section 8).

This report stops for review. No implementation has started.

---

## 0. Summary

- **Live exploits confirmed by real-request probes (file backend, temporary state):**
  - **Justice appeal decision by a non-judge (Probe B).** Any player who knows an appeal ID can reverse a judgment and close the case.
  - **Criminal conviction against another character (Probe C).** Any player can create a conviction record for any character, against an incident ID that does not exist.
  - **Fine payment without payment (Probe E).** Any player can mark any outstanding fine as paid, with any transaction ID. No money moves, and the payer's own payments also move no money.
- **Confirmed by code reading, latent (not reachable by players today):** military promotion, command appointment, training enrolment and completion, assignment, and discharge all lack actor or ownership checks. Players cannot create a service record (Probe F), so these are latent.
- **Demonstrated, design decision required:** key-only identity recovery (Probe A). Anyone holding a creation key can take over an offline identity and lock out the owner. The Stage 28 creation-key review documented this; the probe confirms it on the request path.
- **Demonstrated safe:** economy transfer from another character's account is rejected with `economy_account_not_found` and changes no balance (Probe D, negative control).
- **Government and election containment:** holds for the paths tested (historical results; not rerun in this audit).
- **Persistence and production readiness:** no trusted saved-world corpus exists (the 284-file corpus is absent). The Neon, `pg_dump`, TLS-live, Godot, and deployment-configuration items remain BLOCKED.
- **Recommendation:** do not lift containment, and do not treat any player-reachable justice or economy path as safe, until the P0 items in section 7 are resolved.

---

## 1. Scope, method, and limits

- **Method.** Read the actual repository (source, tests, docs, client GDScript, CI configuration). Ran temporary probes against a file backend in a temporary directory, with `NAIJA_ENV=test`, over the real WebSocket request path (`test/support/harness.mjs`, `test/support/creation-backends.mjs`). Probe scripts and a run log are saved in `docs/evidence/stage28-foundation-audit/`.
- **No live data.** The live saved world is absent (no `services/world-api/data/`). No database was touched.
- **Historical results.** Test-suite results cited in section 4 come from the containment task. They were not rerun in this audit.
- **Not audited in depth.** Education, career, culture, entertainment, geography, life, social, transportation, world-events, NPC, and the business and property families. See section 12.
- **Probe setup.** Some probe setup is written directly into server state, because no player route exists for it (for example, assigning a judge, or creating a fine from a judgment). The decision that is probed is always reached through a real request. Each such setup is noted below.

### Classification key
- **Demonstrated safe:** a probe on the real request path shows the protection holds.
- **Confirmed defect or exploit:** shown by a probe, or by code reading where the path is reachable.
- **Known limitation:** recorded and accepted, with a documented boundary.
- **Incomplete implementation:** the feature is present in part, and the missing part blocks the safe use.
- **Untested assumption:** relied on, but no test or evidence in this audit.
- **Design decision required:** the correct behaviour is a product or security decision, not an engineering fix.

---

## 2. Environment and tool availability

| Item | Result |
|---|---|
| `node` | present (`/usr/local/bin/node`) |
| `pg_dump`, `pg_restore`, `psql` | **MISSING.** Backup and restore success cannot be tested with the PostgreSQL client tools. |
| `godot` (4.7.2 required) | **MISSING.** Client GDScript tests: **NOT RUN.** |
| `docker` | MISSING. No container definition exists in the repository either. |
| Deployment configuration | **None found.** No Dockerfile, `render.yaml`, `fly.toml`, Terraform, Compose file, `Procfile`, `app.yaml`, `vercel.json`, `netlify.toml`, `deploy/`, or `infra/`. `scripts/` holds two regional-data generators. `.github/workflows/ci.yml` is the only workflow. |
| Saved-world corpus | **ABSENT.** `/home/user/data-backups` does not exist. `services/world-api/data/` does not exist. No `world-state.json` outside test temporary directories. |
| Live PostgreSQL / Neon | Not reached. The Neon runbook status is BLOCKED. |

---

## 3. Consolidated findings

Each row has the classification, the evidence, the impact, and the verification method for the fix. "Probe" means a demonstrated result in section 4.

| ID | Area | Finding | Classification | Evidence (files and functions) | Impact | Verification method |
|---|---|---|---|---|---|---|
| **F-01** | Justice | `decide_appeal` does not check that the decider is an assigned judge. The engine passes `characterId` as `decidedBy`. | **Confirmed exploit** (Probe B) | `src/justice/service.ts` `decideAppeal`; `src/multiplayer/world-engine.ts` `decide_appeal` case | Any player who knows an appeal ID reverses a judgment, closes the case, and affects the record. | Probe B; test that a non-assigned judge is refused and state is unchanged. |
| **F-02** | Economy / justice | `payFine` has no check that the payer is the responsible character, no economy debit, and no check that `transaction_id` names a real transaction. | **Confirmed exploit** (Probe E) | `src/justice/service.ts` `payFine` (about line 1078); engine `pay_fine` case | Any player can clear any outstanding fine at no cost. Fines never move money, including the responsible character's own payments. | Probe E; test that a payment debits the payer's account and refuses third-party payment (once the decision in D-02 is made). |
| **F-03** | Crime | `create_criminal_record` accepts any `character_id` (default: the actor), accepts `conviction: true`, and checks neither the actor, the incident, nor the target. | **Confirmed exploit** (Probe C). Impact limited to record integrity while no consumer reads records (grep found no consumers outside the crime service). | `src/crime/service.ts` `createCriminalRecord`; engine `create_criminal_record` (about line 3926) | Any player can create a conviction against another character, citing a non-existent incident. | Probe C; test that a conviction requires an authorised actor and a real incident. |
| **F-04** | Identity | Key-only recovery. A creation key that matches an **offline** identity rotates the session token and returns the same `playerId`. The owner's token is refused (`session_invalid`). | **Design decision required** (demonstrated by Probe A). The Stage 28 creation-key review already recorded it as a takeover path. | `src/multiplayer/world-engine.ts` `recoverIdentity` (about 1290), `createIdentity` (about 1080); `docs/STAGE_28_CREATION_KEY_REVIEW.md` | Anyone holding a leaked key (client config, backup, screenshot) takes over any offline identity. | Probe A; R8 design decision (section 9, D-05). |
| **F-05** | Identity | Session tokens never expire and have no revocation path. A token stays valid until the identity is recovered by key. | **Design decision required** (code reading; grep of `src/` for expiry or revocation found none). | `src/multiplayer/world-engine.ts` session maps (`playerByTokenHash`) | A stolen token has unlimited lifetime. | Test: an expired token is refused. Requires D-06. |
| **F-06** | Client identity | The Godot client stores the session token and the creation key in plaintext, in `user://naija-multiplayer.cfg`. On `session_invalid`, the client clears the token and re-sends `identity.create` with the saved creation key. | **Known limitation / design decision required** (code reading) | `game/scripts/services/multiplayer_client.gd` (`_load_local_session`, `_save_local_session`, `_handle_packet` `"error"` branch, `_send_create_identity`) | Local file read exposes the recovery key. The client performs key-based recovery automatically. | Godot test: NOT RUN. Requires D-07. |
| **F-07** | Military | `promoteServiceMember` takes `authority` but never checks it. `createCommandAppointment` records `appointing_authority` without checking it. `enrollInTraining` and `completeTraining` have no actor or ownership check (confirmed by reading the bodies). Rank order and time-in-rank are enforced for promotion. `assignServiceMember`, discharge, and retire were **not read in full**; they pass the actor's `characterId` and must be checked before R-08. | **Latent defect. Confirmed by code reading.** Not exploitable today (Probe F). | `src/military/service.ts` `promoteServiceMember` (about 557), `createCommandAppointment` (about 602), `enrollInTraining`, `completeTraining` (about 535), `assignServiceMember` (about 651); engine `promote`, `create_appointment`, `complete_training`, `assign` cases | Becomes an exploit as soon as a service record can be created by a player. | Probe F plus a test per action: a non-owner or non-authorised actor is refused; state unchanged. Blocked on D-04. |
| **F-08** | Military | Service records cannot be created by a player. `apply_for_service` creates `submitted`. `enlist` requires `approved`. `decideApplication` has no engine caller. | **Known limitation / incomplete implementation** (Probe F) | `src/military/service.ts` `enrollServiceMember` (approved check), `decideApplication`; engine `enlist` | Military writes in F-07 are unreachable, which is the only reason they are not exploitable. | Probe F: `enlist` refused with `military_application_not_approved`. Any future review route must come with F-07 fixes first. |
| **F-09** | Military | `list_disciplinary_cases` with no filter lists cases for all services. | **Untested assumption / latent** (code reading) | `src/military/service.ts` `listDisciplinaryCases` (the engine passes `undefined` when no `service_id` is given; the function body was **not read in full**); engine `list_disciplinary_cases` | Cross-character read once cases exist. No cases can be created today (F-08). | Test once cases are reachable: a player sees only own or authorised cases. |
| **F-10** | Police | `enrollOfficer` has no caller outside tests. `execute_arrest` requires an officer record, so it returns `police_not_an_officer`. `apply_recruitment` creates `submitted` applications with no review route. | **Incomplete implementation / latent** (code reading; officer records written only at `src/police/service.ts` 343, from `enrollOfficer`) | `src/police/service.ts` `enrollOfficer` (315); engine `execute_arrest` (3437) | Officer creation, arrests, and recruitment review are all unreachable. Any future enrolment route must add authority checks first. | Test: `execute_arrest` refused for a non-officer (exists in principle); an enrolment route must be tested for authority before exposure. Blocked on D-04. |
| **F-11** | Justice | `issueJudgment` requires `assigned_judge_ids`. Only `assignJudgeToCourt` writes them, and it has no player route. Judgments are unreachable for players. | **Incomplete implementation** (code reading; `assignJudgeToCourt` about 575–590) | `src/justice/service.ts` `issueJudgment`, `assignJudgeToCourt` | The justice chain cannot be completed through players, except through setup. This also means F-01 is reached only by a setup-seeded judge, which is a limit on the probe's realism, not on the defect. | Test a player-reachable judge-assignment route once designed (D-01). |
| **F-12** | Justice | `file_case` is not idempotent on re-send. A re-sent filing creates a second case. The test asserts `2` so the gap stays visible. | **Known limitation** (characterised; `docs/STAGE_28_MUTATION_ORDERING_AUDIT.md` line 186) | `src/justice/service.ts` `fileCase`; `IDEMPOTENT_COMMANDS` (world-engine) does not include `justice.action` | Duplicate records on retry. | Test: a re-sent `requestId` returns the original result and creates no second case. |
| **F-13** | Justice | Filing eligibility uses `unverified_no_location` when a filer has no recorded location. This is documented as "not proof of eligibility". | **Known limitation** (Task 2 design; compatibility by design) | `src/justice/service.ts` `fileCase` (about 692–702) | Filings may proceed without location proof. | Covered by the eligibility design doc (`docs/JUSTICE_COURT_ELIGIBILITY_DESIGN.md`). Decision D-08. |
| **F-14** | Government / election | Containment: government and election writes are rejected before state access, `markRequestProcessed`, `flushDirty`, and snapshots. Read-only paths stay available. | **Demonstrated safe** (historical containment tests: 15 tests per backend; mutation check 12 of 19 fail with gates disabled) | `services/world-api/src/multiplayer/world-engine.ts` (gate about 985–1030); `test/government-authorization.test.mjs` | Closes the pre-containment gap (citizen self-appointed to president). | Rerun the focused tests (section 8). |
| **F-15** | Government / election | The gate does not cover unlisted names that reach the engine by other paths. Refused requests still pass `allowCommand`, the per-connection rate limiter, and set `player.lastSeen`, which is persisted at the next save. | **Known limitation** (code reading) | `handleMessage` prelude; `allowCommand` (about 1000) | A refused request changes `lastSeen` (not an authority or money change). Consistent with the stated rule, but it is a side effect. | Test: a refused request changes no field except `lastSeen`; decide whether to exclude `lastSeen` too (D-09). |
| **F-16** | Government / election | Government and election writes still return success before the save. The reply is sent first, then `flushDirty`. The success text is a durable-success claim made before the save. | **Known limitation / design decision required** (warning-only policy) | `governmentAction` tail (`this.send(... "government.result" ...)` then `await this.flushDirty()`); `docs/STAGE_28_MUTATION_ORDERING_AUDIT.md` | Conflicts with the stated rule "no durable-success claim before the save succeeds". The same pattern applies to fines and most handlers. | Decision D-08 and the per-action review. |
| **F-17** | Client / government | The client has no government or election UI and sends no `government.action` or `election.action`. `government.error` and `election.error` have no handler in `prototype_game.gd` (they fall through to `_on_online_message`, which ignores them). | **Known limitation** (code reading) | `game/scripts/prototype_game.gd` `_on_online_message`; `multiplayer_client.gd` `_handle_packet` | No player can reach the suspended paths. Future clients must handle the codes. | Godot test: NOT RUN. |
| **F-18** | Client notices | `persistence.restored` is handled through `persistence_notice`. `world_capacity_reached` and `persistence_failed` arrive as `error` and reach `_on_online_error` → `ui.notify`. | **Demonstrated by code reading** (no Godot run) | `multiplayer_client.gd` `persistence_notice`; `prototype_game.gd` `_on_online_error` (342) | Notices reach the player. | Godot test: NOT RUN. |
| **F-19** | Persistence (file) | Missing world file (ENOENT) creates a fresh `initialState` silently in file mode. | **Untested assumption** (code reading; no dedicated test found). Dev-only: production rejects file mode (`src/persistence/open.ts`). | `src/multiplayer/persistence.ts` load path (about 1044–1150) | A misconfigured dev path can start an empty world. | Dedicated test: file mode with a missing file, expected behaviour per D-10. |
| **F-20** | Persistence (file) | Atomic save: temp file (`wx`), write, fsync, rename, then directory fsync. A directory-sync failure after rename is reported as a failed save, but the new file may exist on disk. Power loss is NOT tested. | **Known limitation** (`docs/STAGE_28_DIRECTORY_SYNC.md` section 6) | `src/multiplayer/persistence.ts` `writeFileDurably`, `syncDirectory`, `writeSnapshot` | Reported failure may still be persisted. No automatic rollback (by policy). | Fault-injection tests exist (`persistence-failure-audit`); power loss not testable here. |
| **F-21** | Persistence (queue) | `commitIdentity` runs inside `serialize`. `recoverIdentity` restores token fields on failed save. | **Demonstrated safe by code reading** (existing persistence tests exist; not rerun) | `src/multiplayer/world-engine.ts` `commitIdentity` (about 1100) | Failed identity saves do not leave a rotated token. | Rerun `persistence-failure-audit` tests (section 8). |
| **F-22** | Persistence (flush) | `flushDirty` re-flushes in `finally` when `dirty` is set during an in-flight save. A later mutation is not dropped. | **Demonstrated safe by code reading** | `src/multiplayer/world-engine.ts` `flushDirty` (finally block) | No lost-dirty-flag. | Test: two overlapping mutations both persist (add if missing). |
| **F-23** | Capacity | The single-file store refuses writes above 16 MiB (`WorldStateCapacityError`), keeps the previous file, and sends `world_capacity_reached` once. Measured: about 700 identities (pretty) and about 1,050 (compact) before refusal. The 2,500, 5,000, and 10,000 targets were **not reached** in real-save runs. | **Known limitation.** 10,000 is a planning target only. | `docs/STAGE_28_CAPACITY.md` section 3.2–3.3; `docs/evidence/stage28-capacity/` (summary JSON only) | No support claim for 2,500 or more. | Isolated real-save runs (section 8). |
| **F-24** | Capacity / 629 identities | The 629-identity failure is **UNEXPLAINED** (`docs/STAGE_28_CAPACITY_INCIDENT.md`). Cause not established. | **Untested assumption / open investigation** | `docs/STAGE_28_CAPACITY_INCIDENT.md` | Possible unknown fault mode. | Diagnosis required before any hard cap (D-11). |
| **F-25** | Compact JSON | Compact format is an opt-in setting. Round-trip and copy tests exist, but no rollout to existing saved worlds has been approved, and none has been converted. | **Known limitation / BLOCKED for rollout** (`docs/STAGE_28_COMPACT_JSON_ROLLOUT.md`) | `src/multiplayer/persistence.ts`; `NAIJA_WORLD_STATE_FORMAT` | No rollout until a copy test runs on real files. | Copy test on the corpus (section 8) once the corpus is found. |
| **F-26** | PostgreSQL | The whole world is one JSONB row (`world_state`), written with `UPDATE ... WHERE key = $1 AND version = $3`. It applies the same 16 MiB check (`src/database/world-store.ts` about line 153). | **Demonstrated on local loopback only** (historical PostgreSQL suite, `DB_SSL=false`, disposable cluster). Not Neon, not production. | `src/database/world-store.ts` | Optimistic version check protects concurrent writers. Multi-process fencing is NOT implemented. | Neon dev-database run (BLOCKED, section 11). |
| **F-27** | Data model | `src/database/schema.ts` defines 13 relational tables. Runtime code uses only `world_state`. `src/database/repositories.ts` is imported only by database tests. | **Design decision required** (two data models) | `src/database/schema.ts`; grep of table names across `src` | Dead or unverified tables may mislead operators. No deletion without review. | Decision D-09 (section 9). |
| **F-28** | Backup | `exportWorldBackup` is one `SELECT` of `world_state`, validated and digested (sha256), custom JSON format (not `pg_dump`). `restoreWorldBackup` exists. | **Untested assumption** (restore not run in this audit). `pg_dump` MISSING. | `src/database/backup.ts` `exportWorldBackup` (67–92) | Backup and restore success cannot be claimed. | Run export then restore on a disposable database only (section 8). |
| **F-29** | HTTP | `/health` is unauthenticated, returns status and short messages (including a persistence message). `/metrics` and `/metrics/prometheus` are gated by `src/metrics-access.ts`; production requires `NAIJA_METRICS_ACCESS`, and token mode needs a 32+ character `NAIJA_METRICS_TOKEN`. Trusted proxies default to none. | **Demonstrated by code reading.** Live behaviour **untested** in this audit. | `src/app.ts`; `src/metrics-access.ts`; `src/config.ts` | Health detail is limited by design; ingress unknown. | Existing tests (not rerun); deployment evidence (section 11). |
| **F-30** | Transport | Application code does not enforce HTTPS or WSS. The identity creation key and session token travel over the WebSocket. | **Untested assumption.** Depends on ingress, which is unknown. | `src/app.ts` (no WSS enforcement found) | Plain WS would expose keys and tokens. | Deployment evidence (section 11). |
| **F-31** | Budget (R4) | The identity-creation budget is disabled by default (`NAIJA_IDENTITY_BUDGET` default `disabled`). Values: 10 per IP, 100 global, per 60 minutes, when enabled. | **Demonstrated by code reading** (`src/config.ts`). Not enabled in production (no deployment evidence). | `src/config.ts` lines 50–60; `docs/STAGE_28_IDENTITY_BUDGET.md` | No protection until enabled. Trusted IP source unknown (F-30). | Test enabled and disabled modes (existing). |
| **F-32** | CI | One job (`ubuntu-24.04`): `npm ci`, `npm run check`. Does not run PostgreSQL tests, TLS tests, or Godot. | **Known limitation** (`.github/workflows/ci.yml`) | `.github/workflows/ci.yml` | Regressions in PostgreSQL or client code are not caught by CI. | Add jobs (section 7, P1). |
| **F-33** | Client tests | Godot 4.7.2 is required. Four headless tests exist (`domain_smoke`, `persistence_notice`, `player_movement`, `save_restart`). Godot is not installed. | **NOT RUN.** Never counted as passing. | `game/tests/`; `command -v godot` (missing) | Client behaviour unverified. | Install Godot 4.7.2 on a suitable runner, then run each test. |
| **F-34** | Dispatch | Mutating and reading families are dispatched by `handleMessage`. Family list: 21 families. Only 13 command types are in `IDEMPOTENT_COMMANDS`. | **Known limitation.** Per-family duplicate behaviour varies. | `src/multiplayer/world-engine.ts` `handleMessage` (about 1000–1062), `IDEMPOTENT_COMMANDS` | Duplicate-send behaviour is not uniform. | Test per family (section 8). |
| **F-35** | Economy | `transferBetweenAccounts` requires both accounts to belong to the actor and be active (`economy_account_not_found` otherwise). | **Demonstrated safe** (Probe D, negative control). | `src/economy/service.ts` `transferBetweenAccounts`; engine `transfer` | Cross-character transfer refused. | Probe D; keep as regression test. |
| **F-36** | Business / property | Ownership checks exist (`business_not_owner`, `property_not_owner`, `business_unauthorized`). | **Untested by probe.** Code reading only. | `src/businesses/*`, `src/properties/*` | Likely safe; not demonstrated. | Probe per action (section 8). |

---

## 4. Probe results (temporary, file backend, real request path)

Scripts: `docs/evidence/stage28-foundation-audit/audit-probe-ABCDE.mjs` and `audit-probe-F.mjs`. Output: `docs/evidence/stage28-foundation-audit/probe-run-output.txt` (the excerpts below are abbreviated; the file has the full lines). Both were run from `services/world-api` with `NAIJA_ENV=test`. The outputs contain no tokens or URLs. The temporary state was removed after each run.

```
A_recovery_with_key_only {"recoveryReplyType":"identity.created","returnsSamePlayerId":true,"returnsNewToken":true,"oldTokenReply":"error:session_invalid"}
B_decide_appeal_by_non_judge {"replyType":"justice.result","replyCode":null,"appealStatus":"decided","decidedBy":"attacker","judgmentStatus":"reversed","caseStatus":"closed","attackerIsAssignedJudge":false}
C_criminal_conviction_against_other {"replyType":"crime.result","replyCode":null,"recordsCreatedDelta":1,"victimConvictions":1}
D_economy_transfer_from_other_account {"replyType":"economy.error","replyCode":"economy_account_not_found","victimBalanceChanged":false,"offenderHasSecondAccount":false}
E_pay_fine_of_other_character_free {"replyType":"justice.result","fineBefore":{"status":"outstanding","paid":0},"fineAfter":{"status":"paid","paid":500000},"payerCashBalanceChanged":false,"fineOwnerIsPayer":false}
F_apply_reply military.result (application submitted)
F_military_self_enlist {"applyStatus":"submitted","enlistReply":"military.error:military_application_not_approved","decideAction":"military.error:military_action_unknown","serviceRecordsCreated":0}
```

### Probe notes (what each result does and does not show)

- **A.** Shows that a second connection presenting only the creation key recovers the same `playerId` with a new token, and the old token is refused. It does not show any player-visible cost. Classified as a design decision (F-04).
- **B.** Shows that a non-judge can decide an appeal and close the case. **Setup:** the judge was assigned by writing `assigned_judge_ids` directly, because no player route exists (F-11). Ages were set in memory. **Setup issue, recorded honestly:** the first run failed with `justice_age_ineligible`. Adding a 400 ms wait after setting ages made it pass. The root cause was **not isolated**. The likely explanation is an in-flight session resume recomputing age from `date_of_birth` after the probe set it. The decision itself is reached through a real `justice.action` request.
- **C.** Shows that an offender created a conviction against a victim, citing a made-up incident ID (`inc-probe-not-real`). The request was accepted.
- **D.** Negative control. A transfer from another character's account is refused, and no balance changes.
- **E.** Shows that a payer can mark another character's fine as paid for 500,000 with a made-up transaction ID, and that no cash account changes. **Setup:** the fine was created by a direct call to `createFine` with synthetic IDs, not from a judgment. The pay path itself is the real request path. Code reading (`payFine`) shows there is no debit at all, so the payer's own payments also move no money.
- **F.** Shows that a player can apply for service (`submitted`) but cannot enlist (`military_application_not_approved`), and that no decision route exists (`military_action_unknown`). No service record is created, so the military write defects (F-07) are latent.

---

## 5. Area notes

### 5.1 Identity and sessions
- Session tokens are stored as SHA-256 hashes (`playerByTokenHash`). The creation key is 256 bits, stored as `creationKeyHash`. Source: `src/multiplayer/world-engine.ts`.
- A key match on an **offline** identity goes to `recoverIdentity`, which rotates the token. The only check is that the identity is not online (F-04).
- A key match on an **online** identity is refused, and a takeover of an active session is not performed (per the same-key policy). That protection is what the Stage 28 same-key work covers.
- Tokens never expire (F-05).
- `session.resume` runs world-date processors. `processElectionWorldDate`, `processJusticeWorldDate`, and `processGovernmentWorldDate` are stubs returning 0. `advanceWorldLife` (`src/life/service.ts` about line 545) is date-driven and was not checked for idempotency.

### 5.2 Persistence and acknowledgement
- The file backend is atomic (temp file with `wx`, fsync, rename, directory fsync). A directory-sync failure is reported as a failed save (F-20).
- Refused saves keep the previous valid file. Nothing is removed to make room (policy).
- Success replies are sent before the save for most handlers (F-16). This is the accepted warning-only policy. The conflict with the "no durable-success claim" rule needs a decision (D-08).
- Production selects PostgreSQL only and rejects `PERSISTENCE_BACKEND=file` at config time. A `DATABASE_URL` is required. No file fallback exists (`src/persistence/open.ts`).

### 5.3 Client
- The client stores the session token and the creation key in `user://naija-multiplayer.cfg` (plaintext). It re-creates the identity with the saved key on `session_invalid` (F-06).
- `persistence.restored` is handled (`persistence_notice`), and errors reach `ui.notify` (F-17, F-18).
- No client path sends a government or election command (F-17).

---

## 6. Dependency map

```
Client (Godot)
  multiplayer_client.gd ──► WebSocket ──► world-engine.ts handleMessage
     │ stores token + creation key (plaintext cfg)           │
     │ on session_invalid → identity.create (saved key)      ├─ allowCommand / rate limit (every request)
     ▼                                                      ├─ containment gate (government, election)  [F-14]
  prototype_game.gd                                         ├─ identity.create / recoverIdentity        [F-04, F-05]
     _on_online_error → ui.notify (error codes)             ├─ session.resume → world-date processors (stubs) [§5.1]
     persistence_notice (persistence.restored)              └─ family switches (21 families)
                                                                 │
   Justice:  assignJudgeToCourt (NO player route) ─► issueJudgment ─► decideAppeal  [F-01, F-11]
             fileCase ─► judgment ─► fine ─► payFine (NO economy debit)            [F-02]
   Crime:    create_criminal_record (no actor / incident check)                    [F-03]
   Economy:  transfer (ownership checked)                                          [F-35 safe]
   Military: apply ─► decideApplication (NO player route) ─► enlist ─► service record
             ─► promote / appoint / enroll training / complete training / assign  [F-07, F-08 latent]
   Police:   enrollOfficer (NO caller) ─► officer ─► execute_arrest              [F-10 latent]
   Government/Election: containment gate ─► (reads allowed, writes refused)       [F-14]

Persistence (every mutation):
  reply sent ──► flushDirty ──► serialize ──► store.flush
     store: file (dev only, explicit) OR PostgreSQL world_state JSONB (production)
     capacity: 16 MiB check ──► world_capacity_reached (once) ──► saves refused, previous file kept
     failure: persistence_failed (per episode) ──► persistence.restored (once, after success)  [F-16, F-19, F-20]
```

Key dependency consequence: **the military and police write defects are latent only because of a missing review route (F-08, F-10). Adding any review or enrolment route without the authority checks would make them live.** Likewise, the justice decision defect (F-01) is reachable today because the decision path does not depend on any judge route; the judge assignment is what is missing.

---

## 7. Prioritised roadmap (no implementation started)

Each item has acceptance criteria. Items at P0 should be settled before any lift of containment or any new player-facing feature in these areas.

### P0: live exploits and blockers

1. **R-01 Justice decision authority (F-01).** Acceptance: a non-assigned character's `decide_appeal` is refused with a stable code; state is unchanged; the same request by an assigned judge succeeds. Depends on D-01 (who may decide).
2. **R-02 Fine payment (F-02).** Acceptance: a payment is accepted only from the responsible character (or an authorised party under D-02); the payer's account is debited in the same snapshot; the transaction ID is server-issued; a repeated transaction ID returns the original result; third-party payment is refused with no state change. Depends on D-02.
3. **R-03 Criminal record authority (F-03).** Acceptance: a conviction requires an authorised actor (D-03) and a real incident; a non-existent incident is refused; a player cannot write a conviction against another character. Until then, `conviction: true` must be refused.
4. **R-04 Key-only recovery (F-04, F-06).** Acceptance: no recovery of an offline identity without the design in D-05; a tested migration plan; owner notification over a verified channel; cancellable 24-hour wait (R8). Until then: document and keep the limitation; do not claim protection.
5. **R-05 Token lifetime (F-05).** Acceptance: defined expiry and revocation (D-06); a test that an expired token is refused; the client handles the refusal without auto-recreating under a stolen token.
6. **R-06 Deployment evidence (F-29, F-30, Task 6).** Acceptance: the hosting manifest, ingress configuration (TLS, trusted proxies, WSS), and metrics access settings are provided and reviewed. Nothing is claimed until then.
7. **R-07 Neon dev database (F-26).** Acceptance: a separate development Neon database, documented steps, and an actual run of the PostgreSQL suite with TLS verified. No production data. Stays BLOCKED until run.

### P1: before exposing the related feature or before any rollout

8. **R-08 Military authority (F-07, F-09).** Acceptance per action (promote, appoint, enrol in training, complete training, assign, discharge, retire): the actor's authority is checked from server state (D-04); a non-authorised actor is refused with no state change; `list_disciplinary_cases` is scoped. Must land before any review route (F-08) is exposed.
9. **R-09 Police authority (F-10).** Acceptance: `enrollOfficer` has an authorised caller only (D-04); `execute_arrest` remains refused for non-officers; recruitment review has a route only after authority tests.
10. **R-10 Justice completeness (F-11, F-12).** Acceptance: a judge-assignment route with authority (D-01); `file_case` re-send returns the original result, no second case.
11. **R-11 Response ordering (F-16).** Acceptance: a decision (D-08) and, for money and legal writes, either reply-after-save or wording that does not claim durability before the save; per-action review; tests showing the reply and the save result agree.
12. **R-12 Missing-file behaviour (F-19).** Acceptance: a missing file in file mode is refused unless an explicit create flag is set (D-10); test added.
13. **R-13 Capacity (F-23, F-24, F-25).** Acceptance: diagnosis of the 629-identity failure; isolated real-save measurements at 2,500 and 5,000 with the production limit unchanged; compact copy test on a real file. No claim above the measured range.
14. **R-14 Backup and restore (F-28).** Acceptance: an approved method (`pg_dump` installed under approval, or the JSON export only); export and restore run on a disposable database; digests match; no claim until run.
15. **R-15 Data model (F-27).** Acceptance: decision D-09; unused tables either documented as unused or removed through a reviewed migration. No deletion without review.
16. **R-16 CI coverage (F-32, F-33).** Acceptance: CI jobs for PostgreSQL and TLS (with a dev database) and for Godot 4.7.2 headless tests; results reported as they are, with skips shown.
17. **R-17 Client code path (F-06, F-17).** Acceptance: decision D-07 on creation-key storage; handling of `government.error` and `election.error` before any government UI ships.

### P2: hardening and completeness

18. **R-18 Idempotency coverage (F-34).** Acceptance: a per-family table, and a test for each mutating family that a re-sent `requestId` returns the original result.
19. **R-19 Business and property probes (F-36).** Acceptance: one probe per ownership check on the real request path.
20. **R-20 Session-resume processors (§5.1).** Acceptance: each stub is either implemented under review or documented as a deliberate no-op; `advanceWorldLife` idempotency tested.
21. **R-21 Lost-dirty and overlap test (F-22).** Acceptance: a test with two overlapping mutations on the real path.

---

## 8. Test and verification plan

For each finding, the test uses the real request path and inspects world state. Each test runs on the file backend and on PostgreSQL (loopback for the disposable cluster; Neon only when it is approved and run).

| Area | Test | Backend | Negative control |
|---|---|---|---|
| F-01 | Non-assigned judge `decide_appeal` refused; state unchanged | file, PG | assigned judge succeeds |
| F-02 | Third-party `pay_fine` refused; payer debited; repeated tx ID idempotent | file, PG | responsible payer succeeds |
| F-03 | Conviction against another character refused; non-existent incident refused | file, PG | authorised flow succeeds (once defined) |
| F-04 | Key-only recovery refused under the chosen design; old token keeps working until rotation is authorised | file, PG | legitimate owner with live token |
| F-05 | Expired token refused (once defined) | file, PG | valid token accepted |
| F-07 / F-08 | Non-authorised promote, appoint, enrol, complete training refused; `enlist` refused without approval | file, PG | authorised actor (once defined) |
| F-10 | Non-officer `execute_arrest` refused; no officer route exposed | file | officer created in test state only |
| F-12 | Re-sent `file_case` `requestId` returns original; one case | file, PG | distinct request creates a case |
| F-14 | Existing containment tests (15 per backend) | file, PG | read-only paths still succeed |
| F-15 | Refused request changes nothing except `lastSeen` (assertion) | file, PG | — |
| F-19 | Missing file in file mode behaviour per D-10 | file | present file loads |
| F-20 | Directory-sync and rename fault tests (existing `persistence-failure-audit`) | file | — |
| F-21 / F-22 | Existing persistence tests; overlapping-mutation test | file, PG | — |
| F-23 | Isolated real saves: 1,000, then 2,500 and 5,000 with the production 16 MiB limit unchanged; record first refusal | file | the raised-limit run is evidence of nothing about the production limit |
| F-25 | Compact copy test on real saved worlds (round-trip and existing-file load) | file | pretty files still load |
| F-26 | Full PostgreSQL suite, `DB_SSL=false` loopback only; Neon run when approved | PG | — |
| F-28 | Export then restore on disposable DB; digest match | PG | corrupted export refused |
| F-29 / F-30 | Metrics and health access under configured settings; WSS enforcement at ingress (deployment evidence) | live (BLOCKED) | — |
| F-31 | Budget enabled and disabled modes | file, PG | — |
| F-33 | Godot 4.7.2 headless: `domain_smoke`, `persistence_notice`, `player_movement`, `save_restart` | Godot (NOT RUN) | — |
| F-35 | Probe D retained as regression | file, PG | — |

**Standard checks after any code change:** `npm run check` (lint, typecheck, build, default test suite), the focused tests for the area, the PostgreSQL suite on loopback, `git diff --check`, and a review of the diff. Skipped tests are not passing. Mutation checks: remove the new check and confirm the test fails.

---

## 9. Unresolved product and security decisions

These require a decision from the owner before implementation. None has been assumed in this audit.

| ID | Decision | Why it matters | Related |
|---|---|---|---|
| **D-01** | Who may decide an appeal and who may be assigned as judge, and by what route? | F-01, F-11. The correct rule is not in the code. | R-01, R-10 |
| **D-02** | Fine payments: who may pay (responsible character only, or third parties); which account is debited; where the money goes (treasury, court); partial payments; the legal basis (Ondo state courts and categories are assumptions flagged for legal-model review, F1). | F-02. Fines currently move no money. | R-02 |
| **D-03** | Criminal records: who may create them, and what must link to a real incident. | F-03. | R-03 |
| **D-04** | Military and police authority: who may promote, appoint, enrol, assign, discharge, and enrol officers. This needs the permanent rules R-a to R-f, which are listed but not implemented. No hierarchy or rule should be invented. | F-07, F-09, F-10 | R-08, R-09 |
| **D-05** | Identity recovery: key-only (current), device-bound session with a recovery grant (direction B, approved as design only, 2026-10-10), or another design. Notification channel, the 24-hour wait, and migration. | F-04. Direction B is approved as design, **implementation is not**. | R-04 |
| **D-06** | Session token lifetime, expiry, and revocation policy. | F-05 | R-05 |
| **D-07** | Creation-key and session-token storage on the client (plaintext cfg today). Options depend on platform support. | F-06 | R-17 |
| **D-08** | Response ordering: keep warning-only (replies before save), or reply after a successful save for money, legal, and government writes. Wording must not claim durability before the save. | F-16. The rule "no durable-success claim before save" conflicts with the current policy. | R-11 |
| **D-09** | Relational schema: keep, remove, or convert the 13 unused tables; and whether `repositories.ts` is supported. | F-27 | R-15 |
| **D-10** | Missing world file in file mode: fail closed, or create (current). | F-19 | R-12 |
| **D-11** | Capacity: the 16 MiB limit (not to be raised without review), the 10,000 planning target, and whether to set a hard cap before the 629-identity diagnosis. | F-23, F-24 | R-13 |
| **D-12** | Push scope. Git shows **5** Stage 28 commits ahead of `origin/arena/00cdea0e-naija` (`e68e805`): `8721104`, `92dfd5f`, `607bf7d`, `258b7f3`, `a487630`. The stated scope is "seven reviewed Stage 28 commits". These counts do not match. Confirm which commits are intended before any push. | Push must not proceed on a mismatched list. | §10 |
| **D-13** | Whether the 284-file corpus can be recovered. If not, the audit's live-data step stays PENDING and the compact-JSON rollout stays BLOCKED. | F-25, §11 | R-13 |

---

## 10. Preserved-work list

Nothing listed here has been modified or removed by this audit.

**Repository (`/home/user/Naija`)**
- Branch `arena/00cdea0e-naija`, HEAD `a487630`. Remote tracking ref `origin/arena/00cdea0e-naija` at `e68e805`. Five local commits ahead of origin: `8721104`, `92dfd5f`, `607bf7d`, `258b7f3`, `a487630` (see D-12).
- Preserved commits `6ae2001`, `1c7d5e9`, `b7d8645`: verified as ancestors of HEAD on this branch.
- Uncommitted tracked modifications (8), preserved as they were:
  - `docs/STAGE_28_MUTATION_ORDERING_AUDIT.md`
  - `docs/STAGE_28_PERSISTENCE_SAFETY.md`
  - `docs/STAGE_28_SAME_KEY_CONFLICT.md`
  - `services/world-api/src/elections/service.ts`
  - `services/world-api/src/government/service.ts`
  - `services/world-api/src/multiplayer/world-engine.ts`
  - `services/world-api/test/persistence-failure-audit.test.mjs`
  - `services/world-api/test/world-capacity-notify.test.mjs`
- Uncommitted untracked files (3), preserved: `docs/STAGE_28_GOVERNMENT_AUTHORIZATION.md`, `services/world-api/test/government-authorization.test.mjs`, `services/world-api/test/mutation-resend-guards.test.mjs`.
- New untracked files created by this audit: `docs/STAGE_28_FOUNDATION_AUDIT.md` (this report) and `docs/evidence/stage28-foundation-audit/` (two probe scripts and the run output). Not committed.
- Evidence: `docs/evidence/stage28-capacity/` (summary JSON only; no world snapshots), preserved.

**Outside the repository**
- `/home/user/stage28-optionD-rejected.patch`: 426 lines, 32,244 bytes. Preserved, not read for changes.
- `/tmp/s28/` scratch scripts and logs. Temporary; may be removed by the sandbox.
- `/tmp/pgdata`: disposable PostgreSQL data directory. Status not checked in this audit.

**Corpus**
- The 284-file saved-world corpus is **absent**. Nothing to preserve. No substitute has been generated, and no revalidation is claimed.

---

## 11. Updated production blockers

| Blocker | Status | Evidence needed |
|---|---|---|
| Live saved-world corpus (284 files) | **BLOCKED.** Absent. | Location of the files, or a confirmed loss statement. |
| Neon / production PostgreSQL | **BLOCKED.** Not reached. | Separate development Neon database and approved credentials handling (no credentials in chat). |
| Deployment configuration (Task 6) | **BLOCKED.** None in repository. | Hosting manifest, ingress (TLS, trusted proxies, WSS), metrics settings, or confirmation none is intended. |
| `pg_dump`, `pg_restore`, `psql` | **MISSING.** | Approved installation on the backup host, or an approved alternative. |
| Godot 4.7.2 (client tests) | **NOT RUN.** Missing. | Installed Godot 4.7.2 runner; test results. |
| Key-only identity recovery (F-04) | **OPEN. Design decision required.** | D-05 decision; tested replacement and migration plan. |
| Justice decision and fine-payment exploits (F-01, F-02) | **OPEN. Confirmed.** | R-01, R-02 with tests. |
| Criminal record exploit (F-03) | **OPEN. Confirmed.** | R-03 with tests. |
| Military and police authority (F-07 to F-10) | **OPEN. Latent.** | D-04; R-08, R-09 before any review route. |
| Token lifetime (F-05) | **OPEN. Design decision.** | D-06. |
| Response ordering (F-16) | **OPEN. Decision.** | D-08. |
| Capacity above the measured range; 629-identity failure (F-23, F-24) | **OPEN.** Cause unexplained. | Diagnosis; isolated real-save runs. |
| Compact JSON rollout (F-25) | **BLOCKED** for existing saved worlds. | Copy test on real files; written owner approval. |
| Backup and restore success (F-28) | **UNTESTED.** | Run export and restore on a disposable database with an approved method. |
| Multi-process fencing and global identity limit | **NOT MET.** Holds only with one writer (`docs/STAGE_28_PRODUCTION_AND_NEON_STATUS.md`). | Design and tests. |
| Power-loss durability (F-20) | **NOT TESTED.** | Power-loss test or accepted limitation. |
| CI coverage (F-32) | **Limited.** PostgreSQL, TLS, Godot not run in CI. | CI jobs (R-16). |
| Stage 28 pre-push gate (A–J) | **PENDING.** | Final report; commit list reconciliation (D-12). |
| Production readiness | **NOT READY.** | All of the above. |

---

## 12. What this audit did not cover

- Education, career, culture, entertainment, geography, life (beyond `advanceWorldLife`), social, transportation, world-events, and NPC families were not audited in depth.
- Business and property ownership checks were read, not probed (F-36).
- `chat.send` and other non-government reads were not checked for abuse.
- No load or concurrency test over real sockets was run in this audit (the R1 concurrency work is historical).
- The historical suite results (default and PostgreSQL) were not rerun.
- The Godot client was not run. Client analysis is code reading only.
- No live PostgreSQL, Neon, TLS, or deployment environment was reached.
- Power loss, disk-full behaviour on a real host, and multi-process races were not tested.
