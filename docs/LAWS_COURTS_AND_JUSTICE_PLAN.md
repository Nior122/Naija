# Stage 12 — Laws, Courts and Justice System

> **Future agents: read this file before changing the legal system.** It documents the implemented legal framework, its integration with Stage 10 (government), Stage 11 (elections), and Stage 7 (economy), and the boundaries that later stages (police, military) must respect.

## Scope

Stage 12 adds a configurable laws, courts, and justice system to the shared Nigerian world. It provides a legal framework with versioned laws and provisions, a configurable court hierarchy, legislative proposals, case management (civil and criminal), evidence and hearing management, judicial decisions, fines integrated with the Stage 7 economy, appeals, and a legal professional appointment system. All of this operates on the one shared `nigeria-main` world.

### Implemented

- **Legal framework:** Configurable law database with 14 law categories, versioned laws, law provisions, status lifecycle (draft → proposed → under_review → approved → enacted → in_force → suspended → amended → repealed), and amendment tracking.
- **Seed laws:** 5 seed laws including the Constitution of Nigeria (1999), Criminal Code Act, Land Use Act, Tenancy Law of Lagos State, and Companies and Allied Matters Act 2020, with provisions.
- **Court hierarchy:** 8 court levels (customary, magistrate, state high, federal high, national industrial, court of appeal, supreme, tribunal) with 10 seed courts: the seven original courts and three Ondo state courts (`court:magistrate-ondo`, `court:state-high-ondo`, `court:customary-ondo`) added for the Ondo region. Jurisdiction-based case assignment.
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

---

## Law category meanings and court jurisdiction (Stage 28 review)

This section is the reference for the `law_categories`, `case_categories[].law_category`, and `seed_courts[].permitted_categories` fields in `game/data/justice/catalog.json`. It records what each law category means in the game, which seeded courts list it, and which case categories use it. The source of truth for the data is the catalog. This section explains the intended rules. It is a game design reference, not legal advice; the constitutional notes are secondary and should be checked by a lawyer before they are relied on.

### How a filing is matched

A court accepts a case when its `permitted_categories` lists the case's `law_category` **or** the case's `type` (`civil` or `criminal`). The type match is broad: a court that lists `civil` accepts every civil case type, whatever its law category. This is the current behaviour, kept for compatibility. See `docs/JUSTICE_COURT_ELIGIBILITY_DESIGN.md` for the known limitation and the proposed separate design.

### Law categories

| Law category | Label | Meaning in the game | Seeded courts that list it | Case categories that use it |
|---|---|---|---|---|
| `constitutional` | Constitutional and Foundational | Constitutional questions. | supreme, appeal-federal, federal-high | none |
| `criminal` | Criminal Law | Criminal offences; cases of type `criminal`. | supreme, appeal-federal, federal-high, magistrate-fct, state-high-fct, magistrate-ondo, state-high-ondo | criminal_misdemeanor, criminal_felony |
| `civil` | Civil Law | General civil claims. | supreme, appeal-federal, federal-high, magistrate-fct, state-high-fct, customary-fct, magistrate-ondo, state-high-ondo, customary-ondo | civil_general, debt_recovery, compensation_claim |
| `commercial` | Business and Commercial | Business disputes between traders and companies. | supreme, appeal-federal, federal-high, state-high-fct, state-high-ondo | contract_dispute, commercial_dispute |
| `property` | Property and Tenancy | Land, buildings, and tenancies. | supreme, appeal-federal, magistrate-fct, state-high-fct, customary-fct, magistrate-ondo, state-high-ondo, customary-ondo | property_dispute, tenancy_dispute |
| `employment` | Employment and Labour | Employment and labour claims. | supreme, appeal-federal, nic, state-high-fct, state-high-ondo | employment_claim |
| `traffic` | Traffic and Transportation | Road traffic offences and transport claims. | magistrate-fct, magistrate-ondo | none |
| `environmental` | Environmental | Environmental matters. | none | none |
| `administration` | Public Administration | Administrative and regulatory penalties, and challenges to administrative action. | none | regulatory_penalty |
| `election` | Election-related | Election-related matters. | federal-high | none |
| `financial` | Financial and Taxation | Taxation and banking matters. Not used by any case category today. | federal-high | none |
| `education` | Education | Education matters. | none | none |
| `safety` | Public Safety | Public safety matters. | none | none |
| `other` | Other | Matters not covered above. | none | none |

### Current mapping decisions

- **`debt_recovery` → `civil`.** A general debt claim is a civil claim. The Federal High Court's financial jurisdiction covers banking and revenue matters (see below). The game has no separate banking or tax case category, so a debt claim is not treated as financial. Changing this mapping changed no seeded court's acceptance.
- **`regulatory_penalty` → `administration`.** A regulatory penalty is an administrative sanction. The catalog label "Public Administration" matches it. No seeded court lists `administration`, so the mapping has no effect on which courts accept these cases today. Those cases are accepted only through their civil type (see the matching rule). Whether a court should list `administration` is an open decision (below).
- **`financial`.** No case category maps to it. It is listed only by `federal-high`, as configured. It stays in the catalog, unused, until a banking or tax case category is designed.
- **`contract_dispute`, `commercial_dispute` → `commercial`; `property_dispute`, `tenancy_dispute` → `property`; `employment_claim` → `employment`; criminal cases → `criminal`; `civil_general`, `compensation_claim` → `civil`.** These follow the catalog labels directly.

### Constitutional notes (secondary sources; to be checked by a lawyer)

Secondary commentary on the Constitution of Nigeria 1999 (section 251, Federal High Court) describes exclusive federal jurisdiction over revenue of the Federal Government, taxation of companies and persons subject to federal taxation, banking matters, and challenges to executive or administrative action of the Federal Government or its agencies. State high courts have general civil jurisdiction under section 272. This is why `financial` belongs to the federal high court in the seed configuration, and why an administrative penalty dispute is not a state-court matter when a federal agency is involved. The game does not model these distinctions yet.

### Ondo state courts (PROVISIONAL gameplay assumptions; not legally verified)

Added after the Stage 28 review (decision F1). They are labelled provisional in `game/data/justice/catalog.json` (top-level `notice`) and in `docs/JUSTICE_COURT_ELIGIBILITY_DESIGN.md`.

- **What was added:** `court:magistrate-ondo`, `court:state-high-ondo`, and `court:customary-ondo`. Each has `applicable_jurisdiction_id: ng:state:on` and copies the permitted categories and level of its FCT counterpart (`court:magistrate-fct`, `court:state-high-fct`, `court:customary-fct`).
- **What is provisional:** the choice of categories and the level of each court. The mirror of the FCT courts is a gameplay assumption. It has not been checked against Ondo State law or court rules, and it has not been checked by a lawyer.
- **What did not change:** the federal courts, and the FCT courts (not rewritten). No stored court in any saved world is overwritten. Seeding adds only missing court IDs during character creation.
- **Jurisdiction checks:** unchanged. An FCT-located filer is still rejected at the Ondo courts, and an Ondo-located filer is still rejected at the FCT state courts. An unlocated filer is still accepted at a state court as `unverified_no_location`, and is never treated as proof of eligibility.
- **Open:** legal-model review of the Ondo categories and levels. This review remains open. Until it is complete, nothing in the game may describe these courts as legally verified.

### Open decisions

1. Whether `administration` should be listed by `federal-high` (its constitutional basis above). This would not change acceptance today, because regulatory penalties are also civil.
2. Whether broad `civil` matching should be narrowed. The impact is listed in `docs/JUSTICE_COURT_ELIGIBILITY_DESIGN.md`.
3. Whether a banking or tax case category should be added so that `financial` has a use.

