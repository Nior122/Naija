# Stage 10 — Government System

> **Future agents: read this file before changing the government system.** It documents the implemented government structure, its integration with Stage 6 (careers), Stage 7 (economy), Stage 8 (businesses), and Stage 9 (property), and the boundaries that later stages (elections, legislation, justice, etc.) must respect.

## Scope

Stage 10 adds a configurable government system representing Nigeria's federal, state, and local administration within the shared Nigerian world. Government finances connect to Stage 7 (economy), appointments reference Stage 5 (character) identities, and projects reference Stage 3 (geography) locations. It is implemented inside the same `nigeria-main` world and does not introduce a parallel governance system.

### Implemented

- **Government structure:** Hierarchical federal → state → local administration. Federal government with configurable ministries, state governments with departments, and local government records.
- **Federal government:** Federal Government of Nigeria seeded on initialization with 15 federal ministries, federal offices (President, Vice President, ministers, permanent secretaries, agency directors), and an initial approved budget.
- **Government offices:** Configurable office definitions with unique/non-unique constraints. Only one active occupant per unique office at a time.
- **Appointments:** Server-authoritative appointment creation and removal. Age eligibility (18+), unique-office enforcement, per-character appointment limits. Historical appointments preserved after removal.
- **Budgets:** Configurable budget creation with category, fiscal year, and approved amount. Spending validated against budget availability.
- **Government revenue:** Revenue recording with category, amount, source reference. Idempotent against duplicate requests.
- **Government expenditure:** Expenditure recording with budget validation, project reference, and category. Overspending rejected.
- **Projects:** Government project creation with lifecycle (proposed → under_review → approved → funded → in_progress → completed). Status transitions validated. Project funding updates status. Location-linked via Stage 3 geography.
- **Announcements:** Government announcements with title, body, scope level, and jurisdiction. Published announcements visible through the API.
- **Marketplace browsing:** Search projects by organisation, location, category, status. Browse announcements by level and jurisdiction.
- **Character snapshot integration:** Government appointments included in authenticated character snapshots.
- **Schema v7 persistence:** `PersistentWorldState` upgraded from schema 6 to schema 7, adding nine new government maps. Schema 1–6 states auto-migrate to v7.

### Not implemented

- No elections, voting, or political party system.
- No legislative process or lawmaking.
- No courts, trials, or legal system.
- No police, military, or security forces.
- No corruption investigations or oversight.
- No public opinion or reputation simulation.
- No automatic term expiry or succession rules.
- No NPC autonomous government participation.
- No inter-governmental fiscal transfers simulation (records supported, automatic transfers not simulated).
- No full infrastructure construction world transformation.
- Godot client/runtime verification remains blocked (same as Stages 1–9).

## Data boundaries

The government catalogue and rules are stored in `game/data/government/catalog.json`. Runtime state lives in `world-state.json` alongside all other stage data. No separate government database or duplicate financial system is created.

- **Government levels:** federal, state, local.
- **Federal ministries:** 15 configurable ministries (Finance, Education, Health, Agriculture, Works, Housing, Environment, Industry, Technology, Labour, Youth, Power, Water, Justice, Transport).
- **Offices:** 10 configurable office types with unique/non-unique constraints.
- **Project categories:** 14 project types (roads, bridges, schools, hospitals, housing, water, drainage, waste, electricity, markets, transport, digital, community, agriculture).
- **Budget categories:** 12 spending categories.
- **Revenue categories:** 7 revenue types.
- **Expenditure categories:** 8 expenditure types.
- **Rules:** Age limit (18+), max appointments per character (5), unique office holders (1), budget bounds (₦0–₦1T), project cost bounds (₦10K–₦500B), revenue/expenditure bounds, announcement length limits, project name/description limits.

## Persistence

Stage 10 adds nine new maps to `PersistentWorldState` under schema version 7:

| Map | Purpose |
|---|---|
| `governmentOrganisations` | Federal, state, and local government organisation records. |
| `governmentOffices` | Office definitions linked to organisations. |
| `governmentAppointments` | Appointment records (office, character, status, dates). |
| `governmentBudgets` | Budget records with approved/allocated/spent amounts. |
| `governmentRevenue` | Revenue records with category and idempotency key. |
| `governmentExpenditure` | Expenditure records linked to budgets and projects. |
| `governmentProjects` | Project records with lifecycle status and funding. |
| `governmentAnnouncements` | Published announcements with scope and jurisdiction. |
| `governmentEvents` | Audit log of government lifecycle events. |

Schema versions 1–6 auto-migrate to version 7 with empty government maps.

## WebSocket API

The server accepts `government.action` commands over the existing authenticated WebSocket session.

| Action | Description |
|---|---|
| `view_federal` | View federal government snapshot (ministries, president, VP, announcements, projects). |
| `view_state` | View a state government snapshot (governor, departments, announcements, projects). |
| `view_local` | View a local government snapshot (chairman, announcements, projects). |
| `appoint` | Appoint a character to a government office (authorization required). |
| `remove_official` | Remove an official from their appointment. |
| `create_budget` | Create a budget for an organisation with fiscal year, category, and amount. |
| `record_revenue` | Record government revenue with category and amount. |
| `record_expenditure` | Record government expenditure against a budget and optionally a project. |
| `create_project` | Create a government project with category, location, and estimated cost. |
| `update_project` | Update project status and progress (enforces valid transitions). |
| `fund_project` | Fund a project, updating its status to "funded" if approved. |
| `publish_announcement` | Publish an announcement with title, body, scope, and jurisdiction. |
| `search_projects` | Search projects by organisation, location, category, or status. |
| `announcements` | Browse published announcements by level and jurisdiction. |
| `my_appointments` | View the character's government appointment history. |

## Checks

```sh
npm run check                         # lint + 124 Node tests (48 retained + 16 economy + 22 business + 19 property + 19 government)
node --test services/world-api/test/government.test.mjs   # focused Stage 10 suite
```
