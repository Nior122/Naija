# Stage 13 — Police and Security System

> **Status:** Implemented
> **Branch:** `arena/00cdea0e-naija`
> **Schema Version:** 10 (advanced from 9)

---

## 1. Overview

Stage 13 implements the **Police and Security System**, providing server-authoritative management of police organizations, stations, officer recruitment, incident reporting, dispatch, investigations, evidence chain-of-custody, wanted records, arrests, and misconduct accountability.

This system integrates with the existing justice system (Stage 12) for evidence handoff and case referral, the economy (Stage 4) for officer compensation, the government (Stage 7) for organizational hierarchy, and the geography (Stage 2) for station locations.

### Critical Design Principles

1. **Police reports ≠ convictions.** Incident records, arrest records, and wanted records are allegations and administrative records. They are NOT determinations of guilt.
2. **Arrests ≠ guilt.** An arrest is a procedural action, not a verdict.
3. **Wanted status must not be created from mere accusations.** Wanted records require specific legal basis and authorization by a higher-ranking officer.
4. **Server-authoritative.** All police actions are validated server-side. The client never controls eligibility, authorization, or record creation.
5. **Misconduct accountability.** Officers are subject to complaints and disciplinary action. Suspension and dismissal are possible outcomes.

---

## 2. Data Model

### 2.1 Catalogue (`game/data/police/catalog.json`)

The police catalogue defines all configurable constants for the system:

- **Police levels:** national, state, division, station
- **Ranks:** 10 ranks from Police Constable (level 1) to Commissioner (level 10)
- **Incident categories:** 14 categories (theft, assault, fraud, etc.)
- **Dispatch priorities:** low, normal, high, emergency
- **Misconduct categories:** 9 categories (unauthorized arrest, corruption, etc.)
- **Training modules:** 8 modules (law, ethics, forensics, etc.)
- **Complaint outcomes:** 9 outcomes (no finding through legal referral)
- **Rules:** recruitment age (18), education (secondary), training duration (30 days), field length limits, etc.
- **Seed stations:** 4 stations (national HQ, FCT HQ, Abuja Central, Abuja South)

### 2.2 Persistent Maps (Schema v10)

The following maps are added to `PersistentWorldState`:

| Map | Description |
|-----|-------------|
| `policeUnits` | Police stations and organizational units |
| `policeOfficers` | Officer records (rank, badge, station, status) |
| `recruitmentApplications` | Recruitment applications and training progress |
| `policeIncidents` | Incident reports with reference numbers |
| `dispatches` | Unit dispatch records |
| `investigations` | Investigation records with timelines |
| `policeEvidence` | Evidence with chain-of-custody tracking |
| `wantedRecords` | Wanted person records |
| `arrestRecords` | Arrest records |
| `misconductComplaints` | Complaints against officers |
| `policeAudits` | Audit trail for all police actions |

---

## 3. Police Organization

### 3.1 Hierarchy

```
National Police Headquarters
├── State/Regional HQs
│   ├── Divisional HQs
│   │   └── Local Stations
```

Each unit has a level (national/state/division/station), optional jurisdiction, and optional parent unit.

### 3.2 Ranks

| Level | Rank |
|-------|------|
| 1 | Police Constable |
| 2 | Police Corporal |
| 3 | Sergeant |
| 4 | Inspector |
| 5 | Chief Inspector |
| 6 | Superintendent |
| 7 | Chief Superintendent |
| 8 | Assistant Commissioner |
| 9 | Deputy Commissioner |
| 10 | Commissioner |

### 3.3 Seeding

On world initialization, 4 seed stations are created automatically if not already present.

---

## 4. Recruitment

### 4.1 Eligibility

- **Minimum age:** 18 years (configurable)
- **Minimum education:** Secondary (configurable)
- **No active applications:** Cannot have multiple concurrent applications

### 4.2 Flow

1. **Apply:** Character submits application to a station
2. **Review:** Application is reviewed (status: submitted → under_review)
3. **Decision:** Approved or rejected
4. **Training:** Complete required training modules
5. **Enrollment:** Officer record created with badge number

### 4.3 Promotion

Officers can be promoted to higher ranks. The new rank must have a higher level than the current rank.

---

## 5. Incident Reporting

### 5.1 Submission

Citizens or officers can submit incident reports with:
- Category (from the 14 defined categories)
- Description and summary
- Reporter and reported character IDs
- Location
- Priority level
- Confidentiality level

### 5.2 Reference Numbers

Incidents receive reference numbers in the format: `NPF-{CAT}-{YEAR}-{SEQ}` (e.g., `NPF-THE-2025-000001`).

### 5.3 Duplicate Prevention

Reports within a configurable window (24 hours) with the same category, reporter, and description are rejected as duplicates.

### 5.4 Triage

Incidents can be accepted (assigned to a station) or rejected with a reason.

---

## 6. Dispatch

### 6.1 Dispatch Flow

1. Unit is dispatched to an incident location
2. Officer acknowledges the dispatch
3. Status progresses: awaiting_dispatch → acknowledged → en_route → at_location → handling → resolved

---

## 7. Investigations

### 7.1 Opening Investigations

Active officers can open investigations linked to incidents. Each officer has a maximum number of concurrent active investigations (default: 20).

### 7.2 Investigation Lifecycle

- **assigned** → **active** → **awaiting_info/awaiting_evidence** → **closed**
- Investigations can be suspended or referred to other authorities
- Timeline entries track all investigation actions

### 7.3 Evidence

Evidence records track:
- Category and description
- Collecting officer
- **Chain of custody:** Every transfer is recorded
- Integrity status: unverified → verified → challenged → rejected
- Link to incident, investigation, and optionally justice system evidence

---

## 8. Wanted Records

### 8.1 Requirements

Wanted records require:
- A specific reason (not mere accusation)
- Legal basis (specific law reference)
- Issuing officer (must be active)

### 8.2 Authorization

Wanted records must be authorized by a higher-ranking officer before activation. This prevents abuse.

### 8.3 Lifecycle

`requested` → `under_review` → `authorized` → `active` → (cancelled | expired | resolved)

Only active wanted records can be used to justify arrests.

---

## 9. Arrests

### 9.1 Execution

Officers can execute arrests with:
- Target character
- Reason and legal basis
- Optional link to wanted record, incident, or investigation

### 9.2 Authorization

Arrests may require authorization (configurable). Arrests linked to active wanted records have implicit authorization.

### 9.3 Processing

After arrest, the character must be processed. Options:
- Release (with reason)
- Referral to justice system (links to a case)

### 9.4 Important Distinction

**An arrest is NOT a conviction.** It is a procedural record. The justice system (Stage 12) determines guilt.

---

## 10. Misconduct and Accountability

### 10.1 Complaints

Any character can file a misconduct complaint against an officer:
- Category (from 9 defined categories)
- Description
- Evidence references
- Optional link to incident or arrest

### 10.2 Resolution

Complaints are reviewed and resolved with findings and outcomes:
- **no_finding:** No misconduct found
- **advisory:** Advisory notice issued
- **training_required:** Additional training required
- **formal_warning:** Formal warning on record
- **restricted_permissions:** Officer permissions reduced
- **suspension:** Officer status changed to suspended
- **demotion:** Officer rank reduced
- **dismissal:** Officer status changed to dismissed
- **legal_referral:** Matter referred to justice system

---

## 11. Audit Trail

All significant police actions create audit records:
- Recruitment applications
- Incident reports
- Wanted record requests
- Arrest executions
- Misconduct complaints

Audit records track the action category, related entities, acting character, and summary.

---

## 12. WebSocket API

### 12.1 Actions

| Action | Description |
|--------|-------------|
| `list_stations` | List all police stations |
| `view_station` | View station details |
| `list_officers` | List officers (optionally by station) |
| `apply_recruitment` | Submit recruitment application |
| `submit_incident` | Report an incident |
| `list_incidents` | List incidents |
| `view_incident` | View incident details |
| `dispatch_unit` | Dispatch unit to incident |
| `open_investigation` | Open investigation for incident |
| `list_investigations` | List investigations |
| `submit_evidence` | Submit evidence for incident |
| `request_wanted` | Request wanted record |
| `list_wanted` | List active wanted records |
| `execute_arrest` | Execute arrest |
| `list_arrests` | List arrest records |
| `file_complaint` | File misconduct complaint |
| `list_complaints` | List complaints |
| `police_profile` | View police profile |

### 12.2 Response Types

- `police.result` — Successful action result
- `police.error` — Error with readable message

---

## 13. Integration with Other Systems

### 13.1 Justice System (Stage 12)

- Police evidence can be linked to justice evidence via `justice_evidence_id`
- Investigations can reference justice cases via `case_id`
- Arrests can be referred to justice system cases
- Complaints with `legal_referral` outcome link to the justice system

### 13.2 Character Snapshot

The `police_profile` field in `CharacterRecord` provides:
- Officer status (is_officer)
- Rank and badge number
- Assigned incidents
- Active investigations
- Misconduct complaint count

### 13.3 Government (Stage 7)

- Police organizational hierarchy can align with government levels
- Government appointments can reference police roles

---

## 14. Error Messages

The `policeErrorMessage()` function returns human-readable messages for all error codes:

| Code | Message |
|------|---------|
| `police_not_an_officer` | You must be a registered police officer to perform this action. |
| `police_station_not_found` | Police station not found. |
| `police_age_ineligible` | You do not meet the minimum age requirement for recruitment. |
| `police_education_ineligible` | You do not meet the minimum education requirement for recruitment. |
| `police_wanted_active` | Character already has an active wanted record. |
| `police_wanted_not_active` | Wanted record is not active. |
| `police_duplicate_report` | Duplicate incident report detected. |
| ... | *(34 total error codes)* |

---

## 15. Tests

34 new tests covering:
- Catalog structure and lookups
- Empty maps and initialization
- Station seeding and idempotency
- Recruitment eligibility (age, education)
- Officer enrollment and badge generation
- Rank promotion validation
- Incident reporting and reference numbers
- Incident triage (accept/reject)
- Investigation lifecycle
- Evidence chain-of-custody
- Wanted record authorization hierarchy
- Arrest with/without wanted records
- Misconduct complaints and resolution
- Officer status changes on complaint resolution
- Police profile snapshots
- Audit trail creation
- Schema migration (v9 → v10)
- WebSocket integration (list_stations, submit_incident, police_profile, error handling)

**Total test count:** 206 passing tests

---

## 16. Files Modified/Created

### New Files
- `game/data/police/catalog.json` — Police catalogue with seed data
- `services/world-api/src/police/types.ts` — All type definitions
- `services/world-api/src/police/catalog.ts` — Catalog loading service
- `services/world-api/src/police/service.ts` — Main police service
- `services/world-api/src/police/index.ts` — Public API exports
- `services/world-api/test/police.test.mjs` — 34 police tests
- `docs/POLICE_AND_SECURITY_SYSTEM_PLAN.md` — This document

### Modified Files
- `services/world-api/src/multiplayer/types.ts` — Schema v10, police maps, police_profile
- `services/world-api/src/multiplayer/persistence.ts` — Schema v10, police migration
- `services/world-api/src/multiplayer/world-engine.ts` — police.action handler, seeding, snapshots
- `services/world-api/test/businesses.test.mjs` — Schema v10
- `services/world-api/test/careers.test.mjs` — Schema v10
- `services/world-api/test/economy.test.mjs` — Schema v10
- `services/world-api/test/elections.test.mjs` — Schema v10
- `services/world-api/test/government.test.mjs` — Schema v10
- `services/world-api/test/justice.test.mjs` — Schema v10
- `services/world-api/test/life.test.mjs` — Schema v10
- `services/world-api/test/properties.test.mjs` — Schema v10
