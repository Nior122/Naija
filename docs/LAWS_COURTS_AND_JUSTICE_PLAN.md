# Stage 12 — Laws, Courts and Justice System

> **Future agents: read this file before changing the legal system.** It documents the implemented legal framework, its integration with Stage 10 (government), Stage 11 (elections), and Stage 7 (economy), and the boundaries that later stages (police, military) must respect.

## Scope

Stage 12 adds a configurable laws, courts, and justice system to the shared Nigerian world. It provides a legal framework with versioned laws and provisions, a configurable court hierarchy, legislative proposals, case management (civil and criminal), evidence and hearing management, judicial decisions, fines integrated with the Stage 7 economy, appeals, and a legal professional appointment system. All of this operates on the one shared `nigeria-main` world.

### Implemented

- **Legal framework:** Configurable law database with 14 law categories, versioned laws, law provisions, status lifecycle (draft → proposed → under_review → approved → enacted → in_force → suspended → amended → repealed), and amendment tracking.
- **Seed laws:** 5 seed laws including the Constitution of Nigeria (1999), Criminal Code Act, Land Use Act, Tenancy Law of Lagos State, and Companies and Allied Matters Act 2020, with provisions.
- **Court hierarchy:** 8 court levels (customary, magistrate, state high, federal high, national industrial, court of appeal, supreme, tribunal) with 7 seed courts. Jurisdiction-based case assignment.
- **Legislative proposals:** Proposal creation by eligible characters (18+), submission workflow, approval/rejection by authorized characters, and automatic law creation on approval.
- **Legal professional appointments:** Judges, magistrates, lawyers, prosecutors, and other roles with age eligibility (35+ for judges, 25+ for lawyers). Court assignment for judges.
- **Case management:** Civil and criminal case types, 11 case categories, 16 case statuses with validated transitions, case filing with court jurisdiction validation.
- **Evidence management:** Evidence submission, admissibility review, version preservation.
- **Hearings:** Hearing scheduling by assigned judges, hearing types (pretrial, trial, sentencing, interlocutory, appeal).
- **Judgments:** Judicial decisions with outcomes (acquittal, conviction, dismissal, civil remedy, fine, settlement), reasoning, and appeal eligibility.
- **Fines and economy integration:** Fine creation, payment tracking with idempotency, partial/full payment, integration with Stage 7 economy transactions.
- **Appeals:** Appeal filing with grounds, appellate court validation (Court of Appeal or Supreme), decision with outcomes (affirmed, reversed, modified, remanded, dismissed).
- **Audit trail:** All legally significant events recorded (law creation, case filing, judgment issued, appeal filed, fine paid, etc.).
- **Schema v9 persistence:** `PersistentWorldState` upgraded from schema 8 to schema 9, adding 17 justice maps. Schema 1–8 states auto-migrate to v9.

### Not implemented

- No police system or criminal investigations (Stage 13).
- No military system (Stage 14).
- No crime simulation system (Stage 15).
- No prison/incarceration enforcement (prison interface prepared, not implemented).
- No NPC autonomous case generation (foundation prepared).
- No live courtroom UI or 3D interactions.
- No full legislative voting process (proposals exist but no voting by multiple legislators).
- No jury system.
- No legal aid or pro bono system.
- Godot client/runtime verification remains blocked (same as Stages 1–11).

## Data boundaries

The justice catalogue is stored in `game/data/justice/catalog.json`. Runtime state lives in `world-state.json` alongside all other stage data. No separate legal database or parallel court system is created.

## Persistence

Stage 12 adds 17 new maps to `PersistentWorldState` under schema version 9:

| Map | Purpose |
|---|---|
| `laws` | Law records (title, category, jurisdiction, status, version, dates). |
| `lawProvisions` | Individual provisions within laws (section, title, description, penalties). |
| `legislativeProposals` | Legislative proposals (title, provisions, status, sponsor, decision). |
| `courts` | Court records (name, level, jurisdiction, permitted categories, judges). |
| `legalProfessionals` | Professional appointments (role, court, qualifications). |
| `legalRepresentations` | Lawyer-client representation records. |
| `cases` | Legal cases (number, category, court, parties, status, judgment). |
| `caseParticipants` | Case party records (role, status). |
| `evidence` | Evidence records (category, submitter, admissibility, version). |
| `witnesses` | Witness records (testimony, credibility). |
| `hearings` | Hearing records (court, judge, schedule, status). |
| `judgments` | Judicial decisions (outcome, reasoning, remedies, appeal status). |
| `sentences` | Sentence records (type, amount, duration, status). |
| `fines` | Fine records (amount, payment tracking, idempotency). |
| `settlements` | Settlement records (terms, parties, payment obligations). |
| `appeals` | Appeal records (grounds, appellate court, outcome). |
| `legalAudits` | Audit trail of all legally significant events. |

Schema versions 1–8 auto-migrate to version 9 with empty justice maps.

## WebSocket API

The server accepts `justice.action` commands over the existing authenticated WebSocket session.

| Action | Description |
|---|---|
| `search_laws` | Search laws by query, category, and jurisdiction. |
| `active_laws` | List all active laws with optional jurisdiction filter. |
| `list_courts` | Browse courts with optional jurisdiction filter. |
| `view_court` | View court details including active cases. |
| `create_proposal` | Create a legislative proposal (age 18+ required). |
| `submit_proposal` | Submit a draft proposal for review (sponsor only). |
| `file_case` | File a legal case in a court (civil or criminal). |
| `my_cases` | View character's cases (as party or participant). |
| `view_case` | View case details and status. |
| `submit_evidence` | Submit evidence for a case. |
| `issue_judgment` | Issue a judicial decision (judge must be assigned to court). |
| `file_appeal` | File an appeal to appellate court (party to the case). |
| `decide_appeal` | Decide an appeal (appellate judge). |
| `pay_fine` | Pay a fine through the economy system (idempotent). |
| `my_fines` | View character's outstanding and paid fines. |
| `legal_profile` | View character's legal profile (cases, fines, role). |

## Checks

```sh
npm run check                         # lint + 172 Node tests
node --test services/world-api/test/justice.test.mjs   # focused Stage 12 suite (23 tests)
```
