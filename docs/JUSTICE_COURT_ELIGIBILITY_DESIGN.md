# Justice Court Eligibility: Current Behaviour, Known Limitations, and Proposed Design

**Status:** PROPOSAL. Nothing in this document is implemented except the current behaviour described in section 1. No stored court list, character, or case has been changed to match this design.

**Scope:** which court may hear which filing, and how a filer's jurisdiction is established. This covers Stage 28 Decisions 1 and 2. The law category meanings are in `docs/LAWS_COURTS_AND_JUSTICE_PLAN.md`.

---

## 1. Current behaviour (implemented, Stage 28)

Filing is checked in `services/world-api/src/justice/service.ts` (`fileCase`), in this order:

1. The court exists and is active.
2. The case category exists (`justice_case_category_invalid`).
3. **Court category.** The court accepts the case when `permitted_categories` lists the case's `law_category` **or** its `type` (`civil` or `criminal`). Otherwise `justice_court_category_not_permitted`.
4. The filer's recorded location, if present, is well-formed (`justice_filer_location_invalid`).
5. **Jurisdiction.** A court with `applicable_jurisdiction_id` rejects a filer whose recorded `state_id` differs (`justice_court_jurisdiction_mismatch`). A filer with **no** recorded location is accepted and the case-filed audit entry records `jurisdiction_check: "unverified_no_location"`. A federal court records `not_required`. A matching state records `verified`.
6. Eligibility of the filer (deceased, minimum age), respondent, summary length, queue size.

The audit entry is the only record of the jurisdiction result. The case record does not store it.

## 2. Known limitations

**L1. Broad civil and criminal matching.** A court that lists `civil` accepts every civil case type. For example, `court:customary-fct` (`civil`, `property`) accepts a `commercial_dispute` and a `regulatory_penalty`. A court that lists `criminal` accepts every criminal case. Filing restrictions by subject matter therefore apply only where the court does not list the broad type. This is existing behaviour, kept for compatibility.

**L2. Missing location is not verified.** A character without `geographic_location` is accepted by every state court. This is not proof of jurisdiction. It is recorded as `unverified_no_location`. It is a known gap, not a valid placement.

**L3. Location source.** The engine sets `geographic_location` only when the client supplies a profile location at character creation (`world-engine.ts`, about lines 424–430). Nothing updates it when a character moves between states. The source is not verified server-side.

**L4. Listing gaps.** `administration` is mapped (regulatory penalties) but listed by no court. `financial` is listed by `federal-high` but mapped by no case category. `environmental`, `education`, `safety`, and `other` are unused.

**L5. Stored court lists are free strings.** The validator accepts any string in `permitted_categories`. A stored `tenancy_dispute` entry (in 283 of 284 saved-world copies, in the customary court) is accepted and matches through its `property` law category.

## 3. Current state of saved worlds (measured, read-only)

Measured across the 284-file corpus (`/home/user/data-backups/stage28-20261010T143151Z`):

- **Characters:** 283 characters, **all 283 without a recorded location.** None has a malformed location.
- **Cases:** **0** cases in any file. No existing filing can change under a stricter rule.
- **Courts:** 283 files carry the `court:customary-fct` entry with `["civil", "property", "tenancy_dispute"]`. The live file has no courts record. Every seeded court list is present in each of the 283 copies.

This means the missing-location path currently covers every existing character, so the state-court jurisdiction check is inactive for saved data.

## 4. Impact of a stricter matching rule (measured, not implemented)

The table lists every (court, case category) pair whose result would change under a **law-category-only** rule (no broad type match). It was computed from the current catalog and the stored customary list. No saved case exists, so no filing in saved worlds would change.

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

**Total: 19 pairs** (15 seed, 4 stored). Every change is a civil case that is accepted today only through the broad `civil` type. The stricter rule would also stop the federal high court accepting property and employment disputes, which that court's list does not name.

**Decision needed before any stricter rule ships:** whether these 19 outcomes are intended. For example, a commercial dispute at the customary court is probably not intended, but a federal high court property dispute is a judgement for the legal model.

## 5. Proposed design (for separate review)

**Court configuration.** Split the single list into two explicit fields, while keeping `permitted_categories` for compatibility:

- `subject_categories`: law categories the court hears (for example, `federal-high`: `constitutional`, `commercial`, `financial`, `election`, and any others the legal model confirms).
- `case_types`: broad types the court hears (`civil`, `criminal`). This is set explicitly per court. A court that should not hear all civil matters does not list `civil` here.

**Acceptance rule (new).** Accept if `subject_categories` includes the case's `law_category`. Accept if `case_types` includes the case's `type`, **only** for courts that opt in. Courts with no `case_types` field use the existing rule (`permitted_categories`), so saved worlds are read the same way.

**Filer jurisdiction.**

- Phase 0 (current): accept filers with no location and record `unverified_no_location`.
- Phase 1: report the count of unverified filings at state courts, with no new rejections. This needs a decision on how it is reported.
- Phase 2 (needs product approval): require a verified location for state courts. Options: require a location at character creation; require a server-side residence source; or accept an unverified filer only at federal courts. Any option must be approved before it is enforced.
- Location must come from a server-side source, and must never be invented or back-filled to pass a check.

**Federal courts.** Unchanged. They have no `applicable_jurisdiction_id`, and they accept filers from any state.

## 6. Migration and backward compatibility

- **No backfill.** Saved characters have no location (283 of 283). Do not infer a location from name, profile, or any other field.
- **No rewrite of stored court lists.** The stored customary entry `tenancy_dispute` is kept. It is inert under the new fields and still matches through `property`.
- **Versioned catalog.** The new fields are optional. A world saved without them loads unchanged. A migration that adds `case_types` to stored courts is a separate change, reviewed like any other data migration.
- **Cases.** There are no cases in saved worlds. A future case record would need the `jurisdiction_check` value in its audit entry to remain readable.
- **Rollback.** Removing the optional fields restores the current behaviour.

## 7. Testable specification (for the implementation review)

1. A court with `subject_categories` only: accepts by law category; rejects a broad-type-only match.
2. A court with `case_types` only: accepts by type; rejects a subject-only match.
3. A court with neither (legacy): behaves exactly as `permitted_categories` does today.
4. The 19 pairs in section 4 change only in the stricter rule, and only where that rule is enabled.
5. A federal court accepts a filer from any state, with or without a location.
6. A state court accepts a verified filer in its state, rejects a verified filer in another state, and records an unverified filer as `unverified_no_location` (under phase 0).
7. Saved worlds (the 284-file corpus) load unchanged under the new fields, with no normalization and no lost records.

## 8. Open decisions

1. Whether the 19 outcomes in section 4 are intended.
2. Whether broad `civil` and `criminal` matching should stay for legacy courts only, or be removed.
3. The phase 2 location policy (section 5).
4. Whether `administration` should be listed by `federal-high`.
5. Whether `financial` needs a banking or tax case category.
