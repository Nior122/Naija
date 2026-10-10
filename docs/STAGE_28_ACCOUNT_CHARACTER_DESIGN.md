# Stage 28 Task 5: Account and Character Integration (design review)

Status: **Design only. No schema integration, no migration, and no runtime change.** Stage 28 remains OPEN.
Production account or character integration is out of scope for this phase (directive). This document is for review.

## 1. Current state (inspected)

| Item | Where | Runtime use |
|---|---|---|
| Live world document: `schemaVersion 18`, maps for players, people, households, families, relationships, life events, marriages, inheritance, careers, economy, businesses, properties, government, justice, police, military, crime, culture, entertainment, world clock | `src/multiplayer/types.ts` (`PersistentWorldState`), stored as one JSON document in `world_state` | **Yes. This is the only authority the running server reads or writes.** |
| Relational model: `accounts`, `characters`, `inventory`, `financial_transactions`, `businesses`, `properties`, `education_records`, `employment_records`, `sessions`, `region_ownership`, `idempotency_store`, `audit_log` | `src/database/schema.ts` | **No runtime call sites.** `AccountRepository` and `CharacterRepository` are exported from `src/database/index.ts` and used only by `test/database.test.mjs`. |
| Identity model | Engine: `PersistentPlayer` with `playerId`, `tokenHash`, `creationKeyHash`, `recentRequestIds`, `createdAt`, `lastSeen`. Key-only. No account. | Yes. |

**Consequence: two sets of tables describe the same concepts, and only one is live.** The relational tables are a
design artefact. Wiring them in would create the competing sources of truth that the directive forbids.

## 2. Engine fields to database columns

Source: `CharacterRecord` (`src/multiplayer/types.ts` lines 52–80) and `CharacterLifeFields` (`src/life/types.ts`).

| Engine field | Database equivalent | Fit | Notes |
|---|---|---|---|
| `character_id` | `characters.character_id` (`VARCHAR(255) UNIQUE`) | Direct | |
| `name` | `characters.name` | Direct | |
| `character_type` (`girl`, `boy`, `androgynous`) | `characters.character_type` (`VARCHAR(50)`) | Direct | No enum constraint in the database. |
| `age` | `characters.age` (`INTEGER`, 0–9998) | Direct | The engine's age range must be checked against the database check. |
| `money` (number) | `characters.money` (`NUMERIC(20,2)`, ≥ 0) | **Check** | The engine holds a JavaScript number. Fractional values beyond two decimals would be rounded on write. Not tested. |
| `health`, `energy`, `hunger` | `characters.*` (`NUMERIC(5,2)`, 0–100) | **Check** | Database limits are 0–100. Engine ranges must match before any write. |
| `appearance` (`Record<string,string>`) | `characters.appearance` (`JSONB`) | Direct | |
| `position`, `direction` | `characters.position`, `characters.direction` (`JSONB`) | Direct | |
| `current_location` | `characters.current_location` | Direct | |
| `home_id`, `school_id`, `education_level` | `characters.home_id`, `school_id`, `education_level` | Direct | |
| `geographic_location` (object or null) | `characters.geographic_location` (`VARCHAR(255)`) | **Mismatch** | The engine stores an object. The database column is a string. A serialisation rule is needed. |
| `life_status` | `characters.life_status` (`VARCHAR(50)`) | Direct | |
| `inventory` (array of items) | `inventory` table (`UNIQUE(character_id, item_id)`) | **Check** | Duplicate item identifiers in the engine array would violate the unique constraint. Not tested. |
| `created_at`, `updated_at` | `characters.created_at`, `updated_at` | Direct | |
| `player.createdAt` | `characters.created_at` (character) | Partial | Equivalent only if character and player are one-to-one. |
| `player.lastSeen` | none | **No equivalent** | |
| `player.playerId` | none directly. `characters.id` is a UUID; `characters.character_id` is a string. | **Mismatch** | See section 4. |
| `player.tokenHash` | `sessions` (`session_id`, `character_id`, …) | **Partial** | `sessions` stores no token hash. Its `server_instance_id` and heartbeat fields have no engine equivalent. |
| `player.creationKeyHash` | none | **No equivalent** | |
| `player.recentRequestIds` | `idempotency_store` (table exists) | **Check** | Different shape and retention. Not compared. |

## 3. Fields with no database equivalent

These stay in the world document unless a reviewed decision moves them. None has a column today.

- Life fields: `date_of_birth`, `life_stage_id`, `household_id`, `family_ids`, `life_event_ids`, `relationship_ids`, `last_life_processed_date`, `inheritance_event_ids`, `death_cause`, `death_date`, `age_at_death`.
- Education: `academic_scores`, `attendance`, `education_record` (the `education_records` table exists, but its shape has not been compared).
- Other character fields: `reputation`, `household`, `life_profile`, and the private employment projection.
- Whole maps: people, households, families, relationships, life events, marriages, inheritance events, careers, employments, work sessions, career skills, government, justice, police, military, crime, culture, entertainment, and the world clock.
- Engine-only session secrets: `tokenHash` and `creationKeyHash`.

## 4. Competing sources of truth (must be resolved before any integration)

1. **World document vs. `characters` table.** Both describe a character. Only the document is live.
2. **Identity model.** The engine is key-only, with no account. `characters.account_id` is `NOT NULL` and references
   `accounts`, which requires `password_hash`. An integration needs a decision: either an account is created for
   each identity (a new, reviewed model), or the `accounts` requirement is removed. Neither is decided here.
3. **Session model.** The engine's `tokenHash` and the `sessions` table describe the same concept with different fields.
4. **Idempotency.** `recentRequestIds` in the engine and `idempotency_store` in the database. Only one can be the record.
5. **Businesses, properties, and financial transactions.** The engine's ledger maps and the database tables overlap.
   A ledger has to be authoritative in one place. Engine invariants (for example, transfers that touch two characters)
   would have to be enforced by SQL, which is not designed.
6. **Regions.** The `region_ownership` table exists for multi-instance coordination. Multi-instance coordination is not
   implemented (Stage 26 and 27 documents state this).

**Decision needed:** one authority per concept. Until it is made, the world document remains the only authority, and
no code may write to the relational character tables.

## 5. Lifecycle

| Stage | Today (world document) | Required for a relational design | Gap |
|---|---|---|---|
| Create | `commitIdentity` saves the whole document synchronously. The reply is sent only after the save succeeds. | One transaction across the identity, character, inventory, and session rows. | Must preserve "reply only after a successful save". |
| Load | `PostgresWorldStore.open` loads and validates the entire document. | Load the character with its inventory and related rows, then validate the same invariants. | Validation rules would need a relational equivalent. |
| Save | Whole-document, version-fenced `UPDATE`. One writer. | Per-row writes need row-level version fencing and a multi-row transaction for any invariant that spans rows. | The engine's serialised queue would need an SQL equivalent. Multi-process fencing is not implemented. |
| Delete | **No delete path exists.** | A deletion policy is required. `accounts` cascades to `characters`, which would delete player records. | **Automatic deletion is forbidden.** A tombstone or soft-delete policy must be designed and reviewed first. |

## 6. Ownership and access

- Today the token proves ownership of an identity. The server stores only its hash. Possession of the token is the
  only proof, which is the key-only model that R8 reviews.
- An account model would add a second proof (a password or a verified channel). That is a change to authentication,
  which must not happen without a documented migration plan and tests (directive).
- Character ownership is one-to-one with the identity today. Any change to that (for example, several characters per
  account) is a product decision.

## 7. Concurrency

- Today: one writer (single process), serialised commands, and a version-fenced whole-document save.
- A row-based design would allow concurrent writes, but that needs row locks, deterministic ordering for multi-row
  invariants, and tests under real concurrent sockets (the R1 approach).
- Multi-process fencing and kill-and-recover are not tested. They must not be claimed (directive).

## 8. Save compatibility and migration

- Existing saved worlds are `schemaVersion 18` JSON documents. Any move to rows must read them unchanged.
- A migration would need: a verified backup first (`src/database/backup.ts`); an import into a **copy** of the
  database; a field-by-field comparison of the imported rows against the document; and an explicit cutover decision.
- No migration is proposed for the historical world. The 284-file corpus was not located, so its compatibility cannot
  be tested (see `docs/STAGE_28_CAPACITY.md`).

## 9. Rollback

- Keep `world_state` readable and unchanged through any cutover period.
- Rollback = switch the authority flag back to the document, after confirming the document has no later changes
  (dual-run comparison). The flag itself is not designed yet.
- Rollback must never remove relational rows as a side effect. Removal needs its own reviewed procedure.

## 10. Tests required before any integration (not written)

- Round trip: document → rows → document, field by field, for every mapped field, including the mismatches in section 2.
- Invariant parity: the same validation rules apply to the document and to the rows.
- Concurrency: concurrent writes on separate sockets, with money and inventory invariants checked afterwards.
- Migration: the historical-copy import and comparison (the corpus is required for this).
- Rollback: after a cutover drill on a disposable database.

## 11. Status

| Area | Status |
|---|---|
| Engine fields to columns | Mapped on paper (section 2). **Not tested.** |
| Fields with no equivalent | Listed (section 3). |
| Competing sources | Identified (section 4). **Unresolved.** |
| Create, load, save, delete | Reviewed (section 5). **Delete policy absent.** |
| Ownership and concurrency | Reviewed (sections 6–7). **Unresolved.** |
| Migration and rollback | Designed in outline only (sections 8–9). |
| Schema integration | **Not started. Requires review.** |
