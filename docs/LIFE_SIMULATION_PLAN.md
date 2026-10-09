# Stage 5 — Age & Life Simulation

## Status and boundary

**Implementation present.** The shared TypeScript world API has calendar, life-event, family and relationship rules; the local Godot prototype has corresponding lifecycle and profile/save integrations. The Node and formatting/parser checks listed below have run. Godot 4.7.2 is unavailable in this workspace, so Godot project import, type/runtime validation, rendered UI and client save/restart tests are still unverified. Implementation is not a substitute for those checks.

Stage 5 extends the existing single logical `nigeria-main` world and Stages 0–4. The online server owns one clock and one persistent population record set; geography does not create another timeline. Offline Godot saves remain their existing client-local mode and are not an alternate online world. Do not begin Stage 6 work as part of this stage.

Included: configurable calendar/time scaling; DOB-derived ages and stages; idempotent birthday and life-history processing; persistent generational family/household/relationship records; starter family NPCs; age-safe friendship and adult relationship progression; marriage and child NPC records; retirement and centralized death/status history; asset-reference inheritance hooks; profile display and deceased-action guards.

Not included: employment/careers, property ownership/transfer, legal inheritance, automatic old-age death, detailed mortality, sexual content, a full NPC society, or operational systems for crime, policing, medicine, government or religion. Accident, violence/crime-related, illness and poisoning/exposure causes are abstract narrative categories only. This plan intentionally specifies no methods, substances or quantities.

## Calendar and age contract

The versioned static catalog is [`../game/data/life/life_catalog.json`](../game/data/life/life_catalog.json). It is shared input, not per-player mutable state. Its schema and `world_id` are checked by both client/server calendar loaders.

- The calendar is Gregorian, based at 2025-01-01 / world day 1, with configurable starting minute and names for months/weekdays. A world-clock snapshot contains day, minute, millisecond remainder, calendar date and update timestamp; seconds are derived from its millisecond remainder.
- The server's `GAME_MINUTE_MS` setting optionally overrides the catalog default of 650 real milliseconds per in-game minute. Valid values are 1–60,000 ms. All online characters and NPCs derive date and age from the same server clock.
- Online character age is derived from `date_of_birth` and `worldClock.world_date`; the current numeric `age` is a denormalized snapshot kept synchronized for existing gameplay compatibility. New characters start at 15 or 16. Existing records without DOB are migrated to a date consistent with their legacy age at the current world date.
- Life stages, inclusive year ranges, age of adult relationship eligibility, friendship age-gap limit, relationship-stage order, retirement threshold and old-age review threshold are catalog-configurable. There is no automatic death on reaching an age threshold.
- February 29 birthdays are observed on February 28 in non-leap years; the rule is explicit in the catalog. Date arithmetic uses Gregorian leap-year rules. Stage and birthday transitions are recorded with stable event IDs so retries and reloads do not duplicate events.
- The authoritative server timeline progresses while the server process runs, including periods with no connected players. A reconnect catches a character and its household NPCs up to the current shared date. **The prototype pauses world time while the API process is stopped; server-downtime catch-up is not implemented.** In local offline mode, the existing client-local clock advances during play and life processing catches up to that saved game date; it does not accrue elapsed real time while the app is closed and never synchronizes to the online server.

## Persistent people, family and history

The online version-2 JSON state contains ID-keyed maps for `people`, `households`, `families`, `relationships`, `lifeEvents`, `marriages` and `inheritanceEvents`, alongside existing `players` and the shared clock. Character and NPC records keep stable person/character IDs, DOB, current age/stage/status, household/family IDs, relationship/event references and the last processed date. The local client stores equivalent life fields in its existing character and household save; it remains separate from online state.

- Starter parents/guardians and siblings are unique persistent NPC/person records, not duplicated display-only names. Their DOBs/ages, household, family membership, life status/history, location and parent/guardian/sibling links persist alongside the player. Catalog-driven household profiles vary the caregiver roles/count and sibling group size; the player is not assigned a universal parent pair. Legacy guardian identities are preserved during online migration.
- Families are generic groups that may link to parent families; households hold members and homes; relationship edges use typed records and stable participant IDs. Marriage can create a linked household and family generation without making the player the center of every family.
- The profile projection bounds the amount returned for display using catalog limits, while canonical online person/event maps retain the underlying linked records. Deceased people and their edges/events are preserved rather than deleted.
- Life history is event data with IDs, world date, participant IDs, summary and structured facts. Profile history is composed from recorded lifecycle and education history, not fabricated presentation strings. Birthday and life-stage events, family creation, relationship progression, marriage, childbirth, retirement, death and inheritance-hook creation are represented.
- Migration from online state schema 1 to schema 2 retains the existing player identity, clock, location/geography, education, money, inventory and other Stage 2–4 character state. Older local character saves are loaded with safe DOB/life defaults and retain existing education/persistence fields. The JSON state remains a bounded single-process prototype, not a database or multi-writer store.

## Relationships, marriage and childbirth

Friendship is a non-romantic relationship and can be recorded for age-appropriate peers; when a minor is involved, the configurable maximum age gap is enforced. Romance and marriage require both people to meet the configured adult age and eligible life-stage rule. Romantic progress is ordered (`meet`, `get_to_know`, `dating`, `commitment`, `marriage`) and each change requires confirmation from both participants. Close parent/guardian/sibling links cannot enter the romantic path. No sexual content is modeled.

A marriage event records both spouse IDs, date, family ID, household ID and history links. It updates the spouse and family-tree edges and links both people to the shared household. A birth action is request-idempotent: it adds a persistent NPC with a DOB, parents, household/family, home/location, alive state, history and sibling/parent links. A child is never a separately controlled player character. No fertility or medical model is included.

## Status, death and inheritance hooks

Life status is centralized as `alive`, `retired` or `deceased`. Death requires an abstract configured cause category and a valid date; repeat requests are safe. It records age at death, cause category, death date, an event/history entry for the person and family, and a pending inheritance event with related people and asset-reference IDs. Relationships/person records remain available for history; the server marks affected spouse links as bereaved and does not transfer any assets. Inheritance records have `transfer_performed: false` (local) or an empty asset-reference list (online) and a pending-review state; these are integration hooks only.

Retirement is an optional, age-gated life-status path, configured at 60 by default. Old-age review is available from 80 by default, but old age does not trigger death automatically. Cause categories include `old_age`, `illness`, `accident`, `violence`, `poisoning_or_exposure` and `other`; they are stored as abstract narrative labels, not simulated procedures or real-world guidance.

The local `CharacterState` and prototype action router guard normal movement, travel, sleep/time advancement, spending, inventory consumption and other existing active actions when a character is deceased. The online server rejects normal active commands for deceased characters while preserving profile and history access. Retired characters are not treated as deceased.

## Profile and client integration

The profile exposes age, DOB, configured life-stage label, status, family members/tree, relationships, education and recorded life/education history. Starter family NPC records are spawned at the home for the offline prototype. The same life fields round-trip through local save/load and are included in online character snapshots/profile projections. Online actions and lifecycle records remain server-owned; the client does not choose the shared date or age.

Client-side behavior is source-implemented but engine-unverified. In particular, scene/UI rendering, clicking through profile actions, saved offline family/NPC reload, and Godot multiplayer display must be checked with Godot 4.7.2 before calling the client path verified.

## Verification status

| Requirement | Evidence | Status |
|---|---|---|
| Calendar seconds/minutes/days, week/month/year, leap rules, configured scale and starting ages | `services/world-api/test/life.test.mjs` calendar test | **Passed (Node)** |
| DOB-derived age, birthday and life-stage transitions, idempotency and offline catch-up | Server lifecycle tests; client domain smoke assertions | **Passed (Node/static client test source)** |
| Unique persistent starter parents/guardians/siblings and generic tree links | Node life and multiplayer/persistence tests; local smoke/save-restart assertions | **Passed (Node/static client test source)** |
| Friendship, mutual confirmation and minor/adult age restrictions | Node relationship and WebSocket tests | **Passed (Node)** |
| Adult romantic progression, marriage records, household/family links, childbirth NPCs and generations | Node life test | **Passed (Node)** |
| Death/status/history preservation, family history, idempotency and inheritance hooks without transfer | Node life test | **Passed (Node)** |
| Online shared clock, persistence, reconnect/offline catch-up, multiplayer and earlier-stage regressions | `npm run check` | **Passed: 37 Node tests (10 Stage 5 life tests)** |
| Local Godot import/runtime/UI/save-restart and Godot multiplayer regressions | Godot 4.7.2 executable unavailable | **Blocked / not run** |

`gdformat` provides GDScript parsing/format checks only; it is not Godot's parser/type checker or a gameplay test. Current `gdlint` structural findings and exact engine limitation are tracked in [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).

## Stage 6 boundary

The next planned stage is **Stage 6 — Careers & Employment**. It must remain outside this implementation; retirement and inheritance fields are only future integration points and must not be treated as completed job, property, economy or legal systems.
