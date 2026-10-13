# Stage 42: NPC simulation and social relationships

Status: implemented on the server and covered by Node tests on the file backend and on PostgreSQL. The Godot panel is
implemented and statically checked (`gdparse`, `gdlint`, and a Node contract test), but **Godot was not run**: no Godot
binary is installed in the sandbox and its release asset host is blocked. Do not treat the panel as runtime-verified.
Read `docs/PHASE_1_FEATURE_INVENTORY.md` (rows 23 and 24) for the status of each part. This stage does not make the game
complete or production-ready.

## 1. What this stage does

Before this stage, the game had no NPC that a player could meet, learn, or affect. The `npc/` module held a dormant
catalogue and a service that no engine path used, and `relationship.progress` could reach only an online, nearby
player. This stage adds a small, bounded NPC layer that uses the existing people, household, and clock records:

- six fixed neighbours who are always present in the shared world, with stable IDs and birth dates;
- an activity state for each one (asleep, at school, socialising, relaxing), derived from the in-game clock;
- a persisted relationship between each character and each neighbour, with affinity, acquaintance, a bounded history,
  and cooldowns;
- five server-validated social actions and a read-only view, each idempotent per request ID;
- a "People" panel in the Godot client that shows only what the server sends.

## 2. Server model

### 2.1 Where the state lives

No new table, no new file, and no schema bump (`schemaVersion` stays 18). The state sits on the existing records:

- `state.people[npcId]` is a `FamilyPersonRecord` with two optional fields:
  - `npc_activity`: the derived state (activity, location, and the clock minute it was written);
  - `npc_social.bonds[characterId]`: one `NPCSocialBondRecord` per character who has met the NPC.
- The residents come from `game/data/npc/social_catalog.json`. The catalogue is loaded once and validated.
- `seedNeighbourResidents` runs in `initialState` and in `validateState`. It creates a resident only when the ID is
  missing, so a reconnect, a map reload, or a server restart never regenerates an identity.

Fixed residents (IDs are `npc-nb-*`, households are `household-nb-*`, neighbourhood `idera-quarter`):

| Household | Residents |
|---|---|
| `bello` | Folake Bello (58), Tope Bello (27) |
| `danjuma` | Yusuf Danjuma (34) |
| `eze` | Uche Eze (41), Chioma Eze (13) |
| `adeyemi` | Segun Adeyemi (72) |

These are fictional people. Their family role is `neighbour`. The Stage 42 change to the family schema is the `neighbour`
role and the optional fields; no other person is affected.

### 2.2 Activity states (bounded, clock-driven)

The activity comes from `state.worldClock` (`day`, `minute_of_day`). It follows the same school-day rule as the education
system. The catalogue holds the hours:

| Activity | Label | Location | Who and when |
|---|---|---|---|
| `sleeping` | Asleep | home | everyone, 22:00 to 06:00 |
| `studying` | At school | schoolyard | ages 6 to 17, on school days, 08:00 to 14:00 |
| `socializing` | Socialising | community hall | adults, 18:00 to 21:00 |
| `relaxing` | Relaxing | home | everyone else, at all other times |

- `syncNPCActivities` runs inside `advanceWorldMinute`, the existing per-minute tick. It is not a new timer. It writes a
  record only when the activity or location changed, so the work per minute is one comparison per resident.
- It also runs before every profile or action, so a request never sees a stale activity.
- Deceased people have no activity and are not visible.

### 2.3 Presence

Presence is decided by location and household. It is not decided by distance. The rules are in `presenceOf`:

- A household member (same `household_id` as the character) is always visible. They are "here" only when their
  location matches the character's location. At home, that means the character is at home.
- Any other resident is visible only when the character is at the resident's current location. A non-household
  resident at home is therefore never visible.
- Sleeping residents are visible but cannot be acted on (`npc_asleep`).

The server does not restrict anything by distance. Stage 42 does not claim a distance rule.

### 2.4 Relationship model

Each `NPCSocialBondRecord` stores: affinity (clamped to −100 to 100), acquaintance, greeting and talk counts,
interaction count, the last use of each action (cooldowns, in absolute game minutes), the last interaction day and minute,
and a bounded history.

Starting values: a household member starts acquainted at affinity 15. A neighbour starts at affinity 0, not acquainted.

Tiers (from the catalogue):

- **hostile**: affinity at or below −40;
- **friend**: affinity at or above 40, acquainted, and at least 3 talks;
- **acquaintance**: acquainted;
- **stranger**: otherwise.

Notable history (capped at 20 entries, newest first in the view): `first_met`, `acquainted`, `argued`, `apologised`,
`became_hostile`, `no_longer_hostile`, `became_friend`. Ordinary greetings and talks are not written to history, so the
history stays small.

### 2.5 Actions

Each action is checked in this order: visibility (`npc_not_found`), presence (`npc_not_here`), sleep (`npc_asleep`),
cooldown (`npc_cooldown_active`), and then the action's own rule.

| Action | Effect on affinity | Cooldown | Its own rule (refusal code) |
|---|---|---|---|
| `greet` | +2 | 30 game minutes | refused when hostile (`npc_turned_away`) |
| `talk` | +4 | 60 game minutes | refused when hostile (`npc_turned_away`) |
| `acquaint` | 0 | none | needs contact, affinity of at least 5, not hostile, and not already acquainted (`npc_no_contact_yet`, `npc_not_warm_enough`, `npc_turned_away`, `npc_already_acquainted`) |
| `argue` | −15 | 60 game minutes | refused when already hostile (`npc_already_hostile`) |
| `apologise` | +10 | 60 game minutes | only when hostile (`npc_not_hostile`) |

Consequences that exist in the server state:

- **Acquaintance is gated.** A stranger cannot be made acquainted until they have had contact and reached affinity 5.
- **Dialogue varies.** The reply's line is chosen by the tier, the household relation, and whether the character has
  interacted before. The lines are static catalogue text. There is no AI service.
- **Recognition.** `recognised` is true after the character's first successful interaction. The greeting context
  `returning` is used for a repeat meeting. The panel shows "They remember you".
- **Hostility** changes what the NPC will do. While hostile, greet and talk are refused, so only `apologise` can raise the
  affinity.

No other consequence exists. Stage 42 does not change money, jobs, housing, or any quest, because none of those are
implemented for NPCs. It does not invent economy effects.

### 2.6 Idempotence and refusals

- A changing request (`npc.action`) must carry a `requestId`. Each request ID is applied at most once. A repeat of a
  successful request is answered with `command.duplicate`, and the state is not changed again.
- A reused request ID for a different action is refused, and nothing changes.
- A refusal changes no social state and is not marked as processed. A retry with the same ID is validated again.
  Activity is derived state and may still be brought up to date during a refusal.
- A success goes through `markRequestProcessed` and `replyAfterSave` (family `npc`). If the save fails, the reply is
  `npc_not_saved` or `npc_outcome_unknown`, and a retry with the same ID is answered from the pending record. It is not
  applied twice.
- Clients never submit a score, an affinity, a count, or a cooldown. The server ignores any such field.

### 2.7 Messages sent

| Message | Direction | Content |
|---|---|---|
| `npc.action` | client to server | `action`, `npcId`, `requestId` |
| `npc.result` | server to client | `action`, `npcId`, `message`, `dialogue`, `affinityChange`, `event` (kind and summary), `npc` (the updated profile) |
| `npc.error` | server to client | `action`, `npcId`, `code`, `message` (the server's sentence), `dialogue` (for a turned-away reply) |
| `npc.view` | client to server, then server reply | `npcId`. The reply has `npc` and `history` |
| `character.snapshot` | server to client, every minute | `npc_profiles`: the NPCs this character can see now, at most 24, each with its bond summary and per-action availability |

A profile action row carries `available`, `reason_code`, `reason_message` (the server's sentence, or null), and
`cooldown_minutes_left`. The client shows the server's sentence, not a code.

Profiles contain only the requesting character's bond. A character cannot see another character's bond. Another
character's ID is never sent.

### 2.8 Careers

Neighbours are excluded from `refreshNpcCareers`. They have no job, no `npcCareers` record, and they take no employer
vacancy. The reason: assigning them would take vacancies from players and would create economy effects that are not
designed. This is a decision of this stage. Change it only with a new decision.

## 3. Client

| File | Role |
|---|---|
| `game/scripts/domain/npc_social_contract.gd` | `NPCSocialContract`: the five actions, the confirmation list (`argue`), the payload keys, the message types, and small helpers. It holds no NPCs, labels, or scores. |
| `game/scripts/ui/npc_panel.gd` | `NpcPanel`: lists the visible NPCs, shows one in detail, sends actions through `ServerRequestTracker`, asks for confirmation before `argue`, and shows the server's history. |
| `game/scripts/prototype_game.gd` | Stores `npc_profiles` from the snapshot, routes `npc.result`, `npc.error`, and `npc.view`, and sends requests. The Stage 41 send path is now shared (`_send_tracked_command`) with the new NPC path. |
| `game/scripts/ui/prototype_ui.gd` | "People" menu button, panel ownership, and an NPC tracker that receives duplicates, connection loss, timeouts, and send failures in the same way as the housing and business trackers. |

Behaviour:

- The panel is opened from the menu. Offline, it says that people are shown in the connected world only, and it shows no
  placeholder residents.
- **Pending**: while a request waits, every action button is disabled and the panel says so. A second request is refused
  locally.
- **Success**: shown only from the server's `npc.result` for the pending request ID. The panel shows the server's message,
  its dialogue line, and any notable event, then refreshes the history.
- **Failure**: the server's `npc.error` sentence is shown. A refusal such as `npc_asleep` resolves the request.
- **Timeout or connection loss**: the request becomes unconfirmed. The player can retry with the same ID, which the
  server applies at most once, or discard it.
- The list refreshes every minute with the snapshot. A selected NPC who is no longer visible is deselected.

## 4. Tests

| Test file | What it covers | Result (file backend) | Result (PostgreSQL) |
|---|---|---|---|
| `test/npc-social-rules-stage42.test.mjs` | Pure rules: activity boundaries and locations, seeding and reload, sync writes, deceased NPCs, cooldown boundary, clamping, history cap, refusals, visibility, bond privacy, validation problems, dialogue placeholders, action rows | 15 pass | n/a (no storage) |
| `test/npc-social-stage42.test.mjs` | Sockets: fixed residents across a restart; visibility in the snapshot; activity by the clock; idempotent greet; cooldown; client-supplied values ignored; a reused request ID; refusals change nothing; household presence; acquaint, talk, argue, apologise; view and history; per-character privacy; bond survives a restart and a returning player is recognised; failed save and retry applied once; a changing request needs an ID and a read does not | 17 pass | 34 pass (both backends, including restart on PostgreSQL) |
| `test/client-npc-stage42.test.mjs` | Client contract: the actions and payload keys match the server; message types and reply routing; no hardcoded resident in any client script; the panel does not write a score; the tracker is used for changing requests and not for the read | 22 pass | n/a (text check) |

Full suites (`npm test` in `services/world-api`, which runs `tsc` and then `node --test test/*.test.mjs`):

- File backend: see section 4.1.
- PostgreSQL: see section 4.1.

Other checks in this stage are listed in section 4.2.

### 4.1 Full-suite results

- File backend (`NAIJA_ENV=test`, no database variables): **1458 tests, 1404 pass, 0 fail, 54 skipped**, exit 0. The
  54 skips are the PostgreSQL-dependent tests, which need `DATABASE_URL` and `NAIJA_ALLOW_DB_TESTS=true`.

- PostgreSQL (`DATABASE_URL=postgres://postgres@127.0.0.1:54329/naija_test?sslmode=disable`, `DB_SSL=false`,
  `NAIJA_ALLOW_DB_TESTS=true`, `NAIJA_ENV=test`): **1743 tests, 1739 pass, 0 fail, 4 skipped**, exit 0. The 4 skips are
  the TLS tests, which need `TLS_TEST_DATABASE_URL` (a separate server with `ssl=on`). They did not run.

These runs used the final code of this stage. CI was not run; see section 4.3.

The PostgreSQL run used PostgreSQL 18.4 on a local disposable database. The database is not part of the repository.

Fixes made to existing tests while the stage was built. None of them weakened an assertion:

- `careers.test.mjs` (schema migration): it took the first person in the map as the family member. The residents now
  come first in insertion order, so the test selects the first non-neighbour person.
- `life.test.mjs` and `support/creation-fixture.mjs`: people and household counts exclude the seeded neighbours, and the
  orphan check exempts the seeded `household-nb-*` households.
- `client-housing-business-stage41.test.mjs`: it checked the exact text of the Stage 41 send function. The send now goes
  through the shared `_send_tracked_command`. The test now checks the same envelope and request ID on that path.

### 4.2 Other checks

- `npm run lint` (ESLint over `services/world-api/src`): exit 0.
- `npx tsc --project tsconfig.json`: exit 0.
- `gdparse` on the four changed GDScript files: parses.
- `gdlint` (gdtoolkit 4.5.0, from `game/scripts`): the new files have 0 findings. `prototype_game.gd` and `prototype_ui.gd`
  have the same findings as before this stage (the baseline was 19 across the two files, and it is still 19).
  `prototype_ui.gd` still reports the public-method and file-length findings that existed before this stage. This stage
  added public functions to it (`show_people`, `update_npc_profiles`, `show_npc_response`).

### 4.3 CI

The CI workflow (`.github/workflows/ci.yml`) runs `npm run check` (lint and the file-backend suite) and, in a second job,
the full suite against a disposable PostgreSQL service. No CI run has been made for this stage. The commit SHA and CI run
ID will be recorded in the handoff once the push has been verified. Until then, CI status for this stage is unknown.

## 5. Not verified

- **Godot.** The panel has not been loaded, clicked, or connected to a live server. `gdparse` checks syntax only.
- **Reconnect while a social request is pending.** The client-side timeout and unconfirmed states are covered by the
  Stage 41 tracker tests and the server's `not_saved` and `outcome_unknown` tests. No Stage 42 test runs a live socket
  drop during an NPC request.
- **Live load.** The per-minute cost and the 24-profile snapshot bound were reasoned about, not measured.

### 5.1 Exact verification still needed

1. Install Godot 4.7.2 and load the project headless (`godot --headless --path game --quit`). Check for script errors in
   `npc_social_contract.gd`, `npc_panel.gd`, `prototype_game.gd`, and `prototype_ui.gd`.
2. Start `services/world-api` against a test world and log in with the client.
3. Wait until 18:00 on the in-game clock, when the adults are at the community hall. Open People. Confirm that the adults
   appear with their activity and location.
4. Greet a resident. Confirm the pending state, then the server's message, and that a second greet is refused as a cooldown
   with the server's sentence.
5. Disconnect during a request. Confirm it is marked unconfirmed, and that a retry with the same ID is applied once.
6. Argue with a resident after the confirmation step. Confirm the affinity change appears only from the server's reply.

## 6. Remaining gaps

- **No link from the world to the panel.** The neighbour avatars drawn in the world (`world_map.gd`) are client-only and
  are not linked to server NPC IDs. Walking up to a neighbour does not open the panel. The menu is the only entry.
- **Six fixed residents only.** No generation of further NPCs, and no family relationships beyond these households.
- **NPCs do not move.** The activity changes the recorded location, but no NPC walks anywhere.
- **No economy, job, housing, or quest effect.** None is implemented for NPCs, so none is claimed.
- **Relationship effects are limited.** The consequences are gating, dialogue, recognition, and hostility (section 2.5).
- **Player-to-player `relationship.progress` is unchanged.** It still requires an online, nearby partner. It is not used for
  NPCs.
- **Argue confirmation is client-side only.** The server accepts `argue` without a confirmation step, which is the
  intended behaviour for a server rule.
- **No distance rule.** Presence is by location and household.
- **Godot not run** (section 5).
- **Open decisions 9, 10, and 11** are unchanged.
- **Stage 41 open items** remain open: Godot runtime verification, socket tests for `my_rentals`, `add_branch`, and
  `fire_employee`, and the business lifecycle client.

## 7. Next Phase 1 priority

Godot runtime verification of the Stage 41 and Stage 42 screens is the first step, and it needs a Godot binary that the
sandbox can download. Without it, neither screen can count as verified. The next feature group after that is the
business lifecycle client and server checks (inventory row 11), which is a smaller and well-defined item. World events
(row 25) can now use the NPC activity state, but they are not designed yet.
