# Stage 28 — Account and character database integration: design (Task 3)

Status: **design only. Not implemented.** The game engine still reads and writes one JSON world document
(`world_state`, JSONB, whole-snapshot save with a version fence). The `accounts`, `characters`, `sessions`
and `region_ownership` tables exist in the schema, and the repository code can read and write them, but the
engine does not use them for game state. This document does not claim that account and character data is
integrated with the engine.

## 1. What the code does today (verified by reading the code)

| Concern | Engine (`src/multiplayer/`) | Schema (`src/database/schema.ts`) |
|---|---|---|
| Identity | Anonymous. A creation key (SHA-256 `creationKeyHash`) and a session token (SHA-256 `tokenHash`) are stored on the player record. Only hashes are persisted. | `accounts` requires `username` (unique), `password_hash` (NOT NULL), and optional `email`. |
| Password hashing | None in `src/`. There is no password hashing function and no login flow. | `password_hash` is NOT NULL, but nothing writes it. |
| Character | `CharacterRecord` has 41 fields, keyed by `player_id` and `character_id`. | `characters` has 21 columns, including `account_id` and `life_status`. |
| Persistence | One `WorldState` JSON document. Saved as a whole, with `version` fencing (see `services/world-api/test/multiprocess-persistence.test.mjs`). | Tables are separate rows. No code path writes the engine state into them. |

### Field gap (measured from the source)

- Engine fields with **no column** (23): `player_id`, `inventory`, `academic_scores`, `attendance`,
  `education_record`, `reputation`, `household`, `life_profile`, `career_profile`, `economy_profile`,
  `business_profiles`, `property_profiles`, `rental_agreements`, `government_appointments`,
  `political_profile`, `legal_profile`, `police_profile`, `military_profile`, `criminal_profile`,
  `cultural_profile`, `entertainment_profile`, `social_profile`, `transportation_profile`.
- Columns with **no engine field** (3): `id`, `account_id`, `life_status`. `account_id` and `id` are relational
  identifiers. `life_status` has no matching field in the engine record. It may be a stale column, or it may
  be meant to be derived from `life_profile`. This needs a decision before any mapping is written.

Conclusion: a column-by-column copy of the engine record into `characters` would drop 23 fields. Any
integration needs either a JSONB payload column that holds the full record, or a set of child tables per
domain. A partial mapping must not be shipped.

## 2. Why no implementation in Stage 28

Any wiring has to choose one of these, and each has a blocking problem:

1. **Dual write** (snapshot stays authoritative; tables are a projection written after each save). Two sources
   of truth can disagree after a partial failure. There is no transaction that spans the snapshot row and the
   projection rows unless they are written in the same statement. The multi-process tests show that a writer
   killed during a save can still have its statement commit later, so a projection could describe a state that
   the snapshot never recorded.
2. **Cutover** (tables become authoritative; snapshot retired). This needs a migration of real player data. The
   brief does not allow an unreviewed migration of real player data, and the real-player data-loss question is
   UNKNOWN. Cutover is therefore not in scope for Stage 28.
3. **Read-only projection for admin or analytics only.** This adds no game behaviour and needs a reviewed plan
   for keeping it in sync. It is recorded as an option, not implemented.

Stage 28 therefore keeps the snapshot as the only source of truth. The account and character tables stay
unused by the engine, and this is documented here and in the audit.

## 3. Decisions that must be made before any integration

1. **Account model.** Is an account a persistent anonymous identity (a creation key hash), or a username and
   password login? The current engine implements the first. The `accounts` table assumes the second. If
   login is wanted, a password-hashing scheme must be chosen and reviewed (Task 7 covers the current position). Nothing in `src/` hashes passwords today.
   Until then `accounts.password_hash` must not be treated as meaningful.
2. **Character storage shape.** JSONB payload per character (one row per `character_id`, full record in
   `payload`), or per-domain child tables. The JSONB option keeps every field and needs no field mapping. It does not exist in the schema yet. The
   per-domain option needs a mapping for each of the 23 fields.
3. **`life_status`.** Keep, derive, or drop.
4. **Session and region tables.** `sessions` and `region_ownership` are for multi-instance coordination. They are
   not used. Multi-instance writes are not supported by the snapshot design (see Task 2 results).

## 4. Migration and compatibility notes (for a future reviewed plan)

- Any future migration must be **dry-run first** against a copy of the saved state, with the 284-file corpus as
  the fixture set. It must not run against the live world file.
- The snapshot must stay readable after any cutover, so rollback means reverting to the snapshot.
- A migration must record checksums before and after. Existing failure modes (missing location, unknown
  category) must be preserved, not silently normalised.
- Corpus-based evidence is not proof that historical player data is intact. The real-player data-loss
  conclusion remains UNKNOWN.

## 5. Next steps (not part of Stage 28 unless the user approves)

- Decide 3.1 to 3.3 with the user.
- If the JSONB payload option is chosen, write a repository function that round-trips a full `CharacterRecord`
  through a proposed `payload` column (not yet in the schema) with a test that compares every field. That test would be the first evidence of
  integration.
- Do not switch the engine to read from these tables until the snapshot-to-table migration has a reviewed plan
  and a rollback test.
