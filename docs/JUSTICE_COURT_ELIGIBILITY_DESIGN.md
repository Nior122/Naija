# Justice Court Eligibility: Current Behaviour, Known Limitations, and Proposed Design

**Status:** PARTLY IMPLEMENTED. The Ondo state courts from F1 option (a) are implemented, as a catalog change with tests (section 0, F1). The stricter matching rule in section 4 and the other proposals in sections 5–6 are still PROPOSALS. No stored court list, character, or case has been changed.

**Verified:** 2026-10-10 against the justice code and catalog at `d49db3f`, and again after the Ondo courts were added (see the commit that adds them). Every claim below was re-checked against the code, the seeded catalog, or the saved-world corpus. Corrections from the earlier draft are marked **(corrected)**. New findings are marked **(new)**.

**Scope:** which court may hear which filing, and how a filer's jurisdiction is established. This covers Stage 28 Decisions 1 and 2. The law category meanings and the legal basis notes are in `docs/LAWS_COURTS_AND_JUSTICE_PLAN.md` (section "Law category meanings and court jurisdiction (Stage 28 review)", about lines 100–142, including "Law categories" and "Constitutional notes"). Those notes are secondary sources and need review by a lawyer.

## 0. Summary of this review

- **(new) F1. Located characters are rejected at every FCT state court. Resolved in part: Ondo state courts added (option a).** On 2026-10-10 the user chose to add Ondo state courts. Three courts were added to `game/data/justice/catalog.json`: `court:magistrate-ondo`, `court:state-high-ondo`, and `court:customary-ondo`. Each has `applicable_jurisdiction_id: ng:state:on` and mirrors the permitted categories and level of its FCT counterpart. The mirror is an assumption that the legal model still needs to confirm. The FCT courts are unchanged, so an FCT filer is still rejected at the Ondo courts, and an Ondo filer is still rejected at the FCT courts. An Ondo-located character can now file at the Ondo state courts with `verified`. The unlocated path is unchanged. Original finding: The engine can store a location only in the single loaded region, `ng:region:ondo:akure-south-core`, whose `state_id` is `ng:state:on` (Ondo). Every seeded state court (`magistrate-fct`, `state-high-fct`, `customary-fct`) has `applicable_jurisdiction_id: ng:state:fc` (FCT). A character located by the engine is therefore rejected at all three, with `justice_court_jurisdiction_mismatch`. It is accepted at `federal-high`. An unlocated character is accepted at the state courts as `unverified_no_location`. This was reproduced with the engine's own `geographicLocationForMapPosition` and `fileCase` (a temporary script, since deleted). No file was changed. This is a correctness problem, and fixing it needs a product decision (section 8, item 1). It is not a legal ruling.
- **(new) F2. Catalog edits do not reach saved worlds.** `seedJusticeWorld` adds a seeded court only when its ID is absent (`if (state.courts[seed.id]) continue;`). A saved world keeps its stored `permitted_categories`, and filing reads only the stored list. Changing `game/data/justice/catalog.json` alone changes nothing for an existing world. Any court change needs an explicit, reviewed migration.
- **(corrected) F3. Listing gaps (section 2, L4).** Four law categories are listed by a seeded court but mapped by no case category: `constitutional` (supreme, appeal-federal, federal-high), `election` (federal-high), `financial` (federal-high), and `traffic` (magistrate-fct). `administration` is mapped by `regulatory_penalty` but listed by no court. `environmental`, `education`, `safety`, and `other` are neither listed nor mapped. The earlier draft missed the first group.
- **(corrected) F4. Location source (section 2, L3).** The earlier draft said the location is set only at character creation. The engine also changes it while a character moves on the map in town, and clears it when the character leaves town (`world-engine.ts`, about lines 694–695, 1079, 1102, 1125, 1140–1144). Creation takes a client-supplied profile location, which is validated against the single region. The `state_id` is always `ng:state:on` (F1).
- **(new) F5. A rejection message is missing.** `justice_filer_location_invalid` has no entry in `justiceErrorMessage`, so a player sees the raw code.
- **(new) F6. Appeals are checked by court level only.** `fileAppeal` requires an appellate court (`court_of_appeal` or `supreme`). It does not check the court's category list or the filer's jurisdiction. This is outside this design and needs its own review.
- **(corrected) F7. Corpus facts (section 3).** The live `world-state.json` has an empty `courts` record (`{}`), not a missing one. The 284-file corpus includes 31 `.tmp` files (atomic-write leftovers). All 284 parse. Only the 252 `.json` files and the live file are complete saved worlds; the 31 `.tmp` files are partial copies. The per-file counts below are from all 284 files.
- **Decision 2 outcome.** The stricter rule (section 4) would change 19 acceptance outcomes. No saved case exists, so no existing filing would change. Current matching is unchanged.

## 1. Current behaviour (implemented, Stage 28)

Filing is checked in `services/world-api/src/justice/service.ts` (`fileCase`), in this order. Each step throws a stable error code. Earlier checks return first, so a filing is rejected for the first failing reason only.

| # | Check | Error code (if rejected) | Notes |
|---|---|---|---|
| 1 | The court exists | `justice_court_not_found` | |
| 2 | The court is active | `justice_court_not_active` | |
| 3 | The case category exists | `justice_case_category_invalid` | Before the court-category check, so an unknown category is never reported as a court restriction. |
| 4 | **Court category.** The court's `permitted_categories` lists the case's `law_category` **or** its `type` (`civil` or `criminal`) | `justice_court_category_not_permitted` | Broad-type matching (L1). |
| 5 | The filer exists | `justice_character_not_found` | |
| 6 | The filer's recorded location, if present, has a well-formed `state_id` (`^ng:state:[a-z]{2}$`) | `justice_filer_location_invalid` | No user message (F5). |
| 7 | **Jurisdiction.** A court with `applicable_jurisdiction_id` requires the filer's `state_id` to match | `justice_court_jurisdiction_mismatch` | Missing location: accepted, `unverified_no_location`. Federal court: `not_required`. Matching state: `verified`. |
| 8 | The filer is not deceased | `justice_character_deceased` | |
| 9 | The filer meets `minimum_filing_age` | `justice_age_ineligible` | |
| 10 | The respondent exists, if one is named | `justice_respondent_not_found` | |
| 11 | The summary is within `case_summary_max_length` | `justice_case_summary_too_long` | |
| 12 | The queue is below `max_cases_per_court_queue` | `justice_court_queue_full` | Counts open cases only (not `closed` or `dismissed`). |

The jurisdiction result is written only to the audit entry (`case_filed`, detail `jurisdiction_check`). The case record does not store it. A rejected filing writes neither a case nor an audit entry (covered by tests).

## 2. Known limitations

**L1. Broad civil and criminal matching.** A court that lists `civil` accepts every civil case type. For example, `court:customary-fct` (`civil`, `property`) accepts a `commercial_dispute` and a `regulatory_penalty`. A court that lists `criminal` accepts every criminal case. Filing restrictions by subject matter therefore apply only where the court does not list the broad type. This is existing behaviour, kept for compatibility.

**L2. Missing location is not verified.** A character without `geographic_location` is accepted by every state court. This is not proof of jurisdiction. It is recorded as `unverified_no_location`. It is a known gap, not a valid placement. Under the current engine it is the only way a player can reach an FCT state court (F1).

**L3. Location source (corrected).** The engine sets `geographic_location` from a client-supplied profile location at character creation (`world-engine.ts`, about lines 424–430). While the character moves on the map in town, it is recomputed from the map position (lines 694–695, 1125). It is cleared when the character leaves town (lines 1079, 1102, 1140–1144). The `state_id` is always the region's state, `ng:state:on` (F1). The client-supplied value is not checked against any state other than that region. No server-side residence source exists.

**L4. Listing gaps (corrected).** See F3 above. The LAWS plan documents the meaning of each category (its "Law categories" table). Changing a mapping or listing needs the review described in sections 4 and 5 of this document.

**L5. Stored court lists are free strings.** The validator (`record-validation.ts`, `stringArray`) accepts any string in `permitted_categories`. The catalog validator (`catalog.ts`) checks the seeded lists only. A stored `tenancy_dispute` entry (in all 283 saved courts records, in the customary court) is accepted and matches through its `property` law category.

**L6. Appeals are not checked against category or jurisdiction (new).** See F6.

## 3. Current state of saved worlds (measured, read-only)

Measured across all 284 files in the corpus (`/home/user/data-backups/stage28-20261010T143151Z`: 283 files in `tmp-test-dirs/` plus `live/world-state.json`). Every file parses. The read was done with a read-only script. Nothing was written.

- **Characters:** 283 characters, one in each of 283 files. **All 283 have no recorded location.** None has a malformed location.
- **Cases:** **0** in any file. No existing filing can change under a stricter rule.
- **Courts:** 283 files carry a `courts` record with the seven seeded courts. All 283 carry `court:customary-fct` with `["civil", "property", "tenancy_dispute"]`. The live file's `courts` record is empty (`{}`), so none of the seeded courts is stored there (F7).
- **Consequence.** The missing-location path covers every existing character, so the state-court jurisdiction check is inactive for saved data. The FCT-versus-Ondo problem (F1) is therefore not yet visible in saved data. It will appear for the first character created with a location.

## 4. Impact of a stricter matching rule (measured, not implemented)

The table lists every (court, case category) pair whose result would change under a **law-category-only** rule (no broad type match). It was recomputed from `game/data/justice/catalog.json`, with the stored customary list added. No saved case exists, so no filing in saved worlds would change.

| Court (list) | Case category (type / law category) | Now | Law-only |
|---|---|---|---|
| supreme | regulatory_penalty (civil / administration) | accept | reject |
| appeal-federal | regulatory_penalty (civil / administration) | accept | reject |
| federal-high | property_dispute (civil / property) | accept | reject |
| federal-high | tenancy_dispute (civil / property) | accept | reject |
| federal-high | employment_claim (civil / employment) | accept | reject |
| federal-high | regulatory_penalty (civil / administration) | accept | reject |
| magistrate-fct | contract_dispute (civil / commercial) | accept | reject |
| magistrate-fct | employment_claim (civil / employment) | accept | reject |
| magistrate-fct | regulatory_penalty (civil / administration) | accept | reject |
| magistrate-fct | commercial_dispute (civil / commercial) | accept | reject |
| state-high-fct | regulatory_penalty (civil / administration) | accept | reject |
| customary-fct | contract_dispute (civil / commercial) | accept | reject |
| customary-fct | employment_claim (civil / employment) | accept | reject |
| customary-fct | regulatory_penalty (civil / administration) | accept | reject |
| customary-fct | commercial_dispute (civil / commercial) | accept | reject |
| stored customary (civil, property, tenancy_dispute) | contract_dispute (civil / commercial) | accept | reject |
| stored customary | employment_claim (civil / employment) | accept | reject |
| stored customary | regulatory_penalty (civil / administration) | accept | reject |
| stored customary | commercial_dispute (civil / commercial) | accept | reject |

**Total: 28 pairs** (24 seed, 4 stored). The first 19 were in the original review. The 9 Ondo pairs come from the Ondo courts added for F1, which mirror the FCT courts. Every change is a civil case that is accepted today only through the broad `civil` type. The stricter rule would also stop the federal high court accepting property and employment disputes, which that court's list does not name. Adding the Ondo courts changes no existing filing, because no saved case exists.

Ondo pairs added (civil cases, accepted only through the broad type):

| Court | Case category (type / law category) |
|---|---|
| magistrate-ondo | contract_dispute, employment_claim, regulatory_penalty, commercial_dispute |
| state-high-ondo | regulatory_penalty |
| customary-ondo | contract_dispute, employment_claim, regulatory_penalty, commercial_dispute |

**Decision needed before any stricter rule ships:** whether these 19 outcomes are intended. For example, a commercial dispute at the customary court is probably not intended, but a federal high court property dispute is a judgement for the legal model.

## 5. Proposed design (for separate review)

**Court configuration.** Split the single list into two explicit fields, while keeping `permitted_categories` for compatibility:

- `subject_categories`: law categories the court hears (for example, `federal-high`: `constitutional`, `commercial`, `financial`, `election`, and any others the legal model confirms).
- `case_types`: broad types the court hears (`civil`, `criminal`). This is set explicitly per court. A court that should not hear all civil matters does not list `civil` here.

**Acceptance rule (new).** Accept if `subject_categories` includes the case's `law_category`. Accept if `case_types` includes the case's `type`, **only** for courts that opt in. Courts with no `case_types` field use the existing rule (`permitted_categories`), so saved worlds are read the same way.

**Filer jurisdiction.**

- Phase 0 (current): accept filers with no location and record `unverified_no_location`.
- Phase 1: report the count of unverified filings at state courts, with no new rejections. This needs a decision on how it is reported.
- Phase 2 (needs product approval, and depends on F1): require a verified location for state courts. Options: require a location at character creation; require a server-side residence source; or accept an unverified filer only at federal courts. Any option must be approved before it is enforced.
- Location must come from a server-side source, and must never be invented or back-filled to pass a check.

**Federal courts.** Unchanged. They have no `applicable_jurisdiction_id`, and they accept filers from any state.

**Resolving F1.** Option (a) was chosen and is implemented: the Ondo state courts are new court IDs, so they reach saved worlds through seeding (section 6). Options (b) and (c) were not chosen. (b) would change seeded `applicable_jurisdiction_id` values, which needs the migration in section 6 because stored courts keep their old value. (c) would keep the FCT courts only and document the limit. Each option changes filing outcomes, so each needs a product decision and tests before any change.

## 6. Migration and backward compatibility

- **No backfill.** Saved characters have no location (283 of 283). Do not infer a location from name, profile, or any other field.
- **No rewrite of stored court lists.** The stored customary entry `tenancy_dispute` is kept. It is inert under the new fields and still matches through `property`.
- **(new) How new seeded courts reach saved worlds.** Seeding runs when a character or family is created (`world-engine.ts`, the creation path, about line 941), not when a saved world is loaded. It adds only court IDs that are missing. So the three Ondo courts are added to a saved world the next time a character is created in it. Stored courts are not changed. A world with no new character creation keeps its current courts until one happens. The test "Stored worlds: seeding adds the Ondo courts..." pins this.
- **(new) Catalog edits need an explicit migration.** Because seeding skips existing courts (F2), a change to `seed_courts` (new fields, new `applicable_jurisdiction_id`, new `permitted_categories`) does not reach a saved world. Any such change needs a versioned migration that is reviewed like any other data migration, and that states which stored courts it changes.
- **Versioned catalog.** The new fields are optional. A world saved without them loads unchanged. A migration that adds `case_types` to stored courts is a separate change, reviewed like any other data migration.
- **Cases.** There are no cases in saved worlds. A future case record would need the `jurisdiction_check` value in its audit entry to remain readable.
- **Rollback.** Removing the optional fields restores the current behaviour. A migration that changes a stored court needs its own reversal plan before it is applied.

## 7. Testable specification and regression coverage

**Ondo courts (added after `d49db3f`).** Tests in `test/justice-filing.test.mjs`: an Ondo filer is accepted at the Ondo state high, magistrate, and customary courts, with `verified`; an FCT filer is rejected at the Ondo state court; an Ondo filer is still rejected at the FCT state court; an unlocated filer is accepted at an Ondo court as `unverified_no_location`; each Ondo court mirrors its FCT counterpart; a saved world gains the Ondo courts on seeding without any stored court being rewritten. The pinned acceptance matrix was updated deliberately, and every Ondo row matches its FCT row.

**Existing coverage (test/justice-filing.test.mjs, and test/justice.test.mjs).** These tests pass at `d49db3f`:

- Catalog vocabulary: every case category declares a known law category and a `civil` or `criminal` type; every seeded court lists only law categories.
- Rule: only the law category or the case type counts, never the case-category ID.
- Accepted filings: employment at NIC; commercial at FCT High and Federal High; tenancy through customary `property`; a federal court accepts a filer from any state; a filer in the court's state is accepted.
- Rejected filings: general civil at NIC; felony at NIC; misdemeanor at customary; unknown category reported as invalid; another-state filer at state and local courts; a rejected filing changes neither cases nor courts; malformed state ID at state and federal courts.
- Missing location: recorded as unverified at state and local courts; federal court says `not_required`.
- Pinned acceptance matrix (`PINNED`): the seeded courts that accept each case category.
- Stored worlds: seeding does not rewrite an existing court; a saved court with a legacy entry still validates unchanged; seeded data passes record validation.

**Requirements for any implementation review (not yet covered):**

1. A court with `subject_categories` only accepts by law category and rejects a broad-type-only match.
2. A court with `case_types` only accepts by type and rejects a subject-only match.
3. A court with neither field behaves exactly as `permitted_categories` does today.
4. The 19 pairs in section 4 change only when the stricter rule is enabled, and each change is listed.
5. A state court accepts a verified filer in its state, rejects a verified filer in another state, and records an unverified filer as `unverified_no_location` (phase 0).
6. An engine-located filer (`ng:state:on`) is rejected at the FCT state courts with `justice_court_jurisdiction_mismatch` (F1). This is now covered by "Ondo courts: an Ondo filer is still rejected at the FCT state court". The Ondo courts accept the same filer (covered).
7. `justice_filer_location_invalid` has a user-facing message (F5).
8. Saved worlds (the 284-file corpus) load unchanged under the new fields, with no normalization and no lost records.
9. A catalog change does not change a stored court unless a migration is applied (F2).
10. Appeals: a test records the current level-only check before any change (F6).

## 8. Open decisions

1. **(resolved in part, F1)** Option (a) chosen: Ondo state courts added. Still open: the legal model must confirm that the Ondo courts should hear the same categories as the FCT courts (the mirror assumption). Located characters still cannot file at the FCT state courts. That is correct for FCT residents, but it needs confirming against the legal model.
2. Whether the 19 outcomes in section 4 are intended.
3. Whether broad `civil` and `criminal` matching should stay for legacy courts only, or be removed.
4. The phase 2 location policy (section 5).
5. Whether `administration` should be listed by `federal-high`. This would not change acceptance today, because regulatory penalties are also civil.
6. Whether `financial` needs a banking or tax case category. Decision 3: do not add mappings only for completeness.
7. **(new)** Whether appeals should check the appellate court's category list and the filer's jurisdiction (F6).
8. **(new)** Whether `justice_filer_location_invalid` should get a message (F5). This is a text-only change and does not alter behaviour.
