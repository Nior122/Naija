# Stage 14 — Military System

> **Status:** Implemented
> **Branch:** `arena/00cdea0e-naija`
> **Schema Version:** 11 (advanced from 10)

---

## 1. Overview

Stage 14 implements the **Military System**, providing server-authoritative management of military organizations, service branches, bases, units, recruitment, training, ranks, promotions, command appointments, assignments, leave, equipment/asset management, national-security events, and disciplinary processes.

This system integrates with the existing career system (Stage 6), economy (Stage 7), government (Stage 10), justice (Stage 12), and police (Stage 13) systems.

### Critical Design Principles

1. **Military service is a career path**, not a dominant system. It coexists with education, business, government, and other life paths.
2. **Server-authoritative.** All military actions are validated server-side. The client never controls rank, membership, qualifications, or command authority.
3. **Government accountability.** Military command follows configured authority rules. Political officials cannot bypass authorization controls.
4. **Historical integrity.** All promotions, demotions, appointments, and disciplinary decisions are preserved.
5. **Safe simulation.** Military activities use abstract game mechanics. No real-world tactical instructions, weapon construction, or targeting procedures.
6. **Disciplinary findings are NOT convictions.** Internal military discipline is separate from criminal prosecution (justice system).

---

## 2. Data Model

### 2.1 Catalogue (`game/data/military/catalog.json`)

The military catalogue defines:

- **3 service branches:** Army, Navy, Air Force
- **Rank structures:** 16 ranks per branch (enlisted → warrant → officer → general/flag/air officer)
- **8 base categories:** Administrative, training, naval, air, logistics, medical, support, operational
- **14 unit categories:** Infantry, armoured, artillery, engineers, signals, logistics, medical, naval vessel, naval squadron, air squadron, air wing, special forces, headquarters, training
- **18 training courses:** Basic military training, physical fitness, leadership, officer cadet, branch-specific courses, medical support, etc.
- **10 assignment types:** Administrative, training, logistics, base support, medical, engineering, operations, community assistance, emergency response, headquarters
- **10 equipment categories:** Uniforms, communications, administrative, medical, engineering, logistics, vehicles, training, naval, aviation
- **8 national security event categories:** Emergency preparedness, disaster assistance, infrastructure protection, humanitarian, border security, national emergency, public safety, civilian assistance
- **9 disciplinary outcomes:** No finding through legal referral
- **7 seed organizations:** Defence HQ, three service HQs, three training commands
- **4 seed bases:** Armed Forces Central Command (Abuja), Army Recruit Training School, Naval Base Lagos, Air Force Base Abuja

### 2.2 Persistent Maps (Schema v11)

14 new maps added to `PersistentWorldState`:

| Map | Description |
|-----|-------------|
| `militaryOrganizations` | Military organizational hierarchy |
| `militaryBases` | Base/installation records |
| `militaryUnits` | Unit/formation records |
| `militaryRecruitments` | Recruitment applications |
| `militaryServiceRecords` | Active service records |
| `militaryTrainingRecords` | Training enrollment/completion |
| `militaryRankHistory` | Promotion/demotion history |
| `militaryCommandAppointments` | Command role assignments |
| `militaryAssignments` | Personnel duty assignments |
| `militaryLeaveRecords` | Leave requests and approvals |
| `militaryAssets` | Equipment and asset records |
| `nationalSecurityEvents` | National security event records |
| `militaryDisciplinaryRecords` | Disciplinary cases |
| `militaryAudits` | Audit trail |

---

## 3. Service Branches and Organization

### 3.1 Three Branches

| Branch | Highest Rank |
|--------|-------------|
| Nigerian Army | General (level 16) |
| Nigerian Navy | Admiral of the Fleet (level 16) |
| Nigerian Air Force | Chief of the Air Staff (level 16) |

### 3.2 Organizational Hierarchy

```
Defence Headquarters
├── Nigerian Army HQ
│   ├── Army Training and Doctrine Command
│   └── [Divisions, Brigades, Battalions...]
├── Nigerian Navy HQ
│   ├── Navy Training Command
│   └── [Fleets, Squadrons...]
└── Nigerian Air Force HQ
    ├── Air Force Training Command
    └── [Wings, Squadrons...]
```

Cycle detection prevents invalid parent-child relationships.

---

## 4. Recruitment and Eligibility

### 4.1 Eligibility

- **Minimum age:** 18 years (configurable)
- **Minimum education:** Secondary (configurable)
- **No active applications:** Cannot have multiple concurrent active applications
- **No active service:** Cannot enlist while already serving

### 4.2 Flow

1. **Apply:** Character submits application for a service branch
2. **Review:** Application enters review
3. **Decision:** Approved or rejected by reviewing authority
4. **Training:** Complete basic military training
5. **Enlistment:** Service record created with service number and initial rank

### 4.3 Service Numbers

Format: `{BRANCH_CODE}{SEQUENCE}` (e.g., `NA000001` for Army, `NN000042` for Navy, `NAF000007` for Air Force)

---

## 5. Training and Qualifications

### 5.1 Course Categories

- Initial service orientation (90 days basic training)
- Physical fitness
- Leadership (foundation and advanced)
- Officer cadet training (180 days, requires tertiary education)
- Branch-specific: Military engineering, naval operations, maritime navigation, aviation fundamentals, aircraft maintenance
- Support: Communications, logistics, medical, emergency response
- Professional: Equipment accountability, military ethics, staff course, command course

### 5.2 Prerequisites

Courses may require:
- Minimum rank level
- Specific service branch
- Specific education level

### 5.3 Completion

- Pass/fail assessment
- Completed courses added to service record
- Failed courses do not grant credit

---

## 6. Ranks and Promotions

### 6.1 Rank Categories per Branch

| Level | Army | Navy | Air Force |
|-------|------|------|-----------|
| 1 | Private | Ordinary Seaman | Aircraftman |
| 2 | Corporal | Able Seaman | Leading Aircraftman |
| 3 | Sergeant | Leading Seaman | Corporal |
| 4 | Staff Sergeant | Petty Officer | Sergeant |
| 5 | Warrant Officer Class 2 | Chief Petty Officer | Flight Sergeant |
| 6 | Warrant Officer Class 1 | Master Chief Petty Officer | Master Warrant Officer |
| 7 | Second Lieutenant | Ensign | Pilot Officer |
| 8 | Lieutenant | Sub Lieutenant | Flying Officer |
| 9 | Captain | Lieutenant Commander | Flight Lieutenant |
| 10 | Major | Commander | Squadron Leader |
| 11 | Lieutenant Colonel | Captain | Wing Commander |
| 12 | Colonel | Commodore | Group Captain |
| 13 | Brigadier General | Rear Admiral | Air Commodore |
| 14 | Major General | Vice Admiral | Air Vice Marshal |
| 15 | Lieutenant General | Admiral | Air Marshal |
| 16 | General | Admiral of the Fleet | Chief of the Air Staff |

### 6.2 Promotion Requirements

- **Minimum time in rank:** Configurable per rank category (180 days for enlisted, 365 for warrant, 730 for officer, 1095 for general/flag/air officer)
- **Higher rank required:** New rank must have a strictly higher level
- **Authorized authority:** Promotions require an authorized decision

### 6.3 Command Appointments

Rank ≠ command. Separate appointment records track who commands which organization.

---

## 7. Assignments and Leave

### 7.1 Assignment Types

Administrative, training, logistics, base support, medical, engineering, operations, community assistance, emergency response, headquarters duty.

### 7.2 Constraints

- Maximum 2 active assignments per person
- Assignment must be to a valid unit or base

### 7.3 Leave

- Leave requests with type, dates, and reason
- Approval by authorized personnel
- Service member status changes to "on_leave" when approved

---

## 8. Equipment and Asset Management

### 8.1 Asset Categories

Uniforms, communications, administrative, medical, engineering, logistics, vehicles, training, naval, aviation.

### 8.2 Asset Lifecycle

`serviceable` → `assigned` → `returned` → `serviceable`
Can also transition to `in_maintenance`, `unserviceable`, `retired`, or `missing`.

### 8.3 Custody Tracking

Every assignment and transfer is recorded in the assignment history.

---

## 9. National Security Events

### 9.1 Event Categories

Emergency preparedness, natural disaster assistance, infrastructure protection, humanitarian support, border security, national emergency, public safety support, civilian assistance.

### 9.2 Event Lifecycle

`proposed` → `approved` → `active` → `standby` → `resolved` (or `cancelled`)

### 9.3 Authorization

Events require an authorizing authority. Participating organizations are tracked.

---

## 10. Discipline and Accountability

### 10.1 Disciplinary Workflow

`submitted` → `under_review` → `investigation_pending` → `awaiting_decision` → `decision_issued` → `appealed` → `closed`

### 10.2 Outcomes

| Outcome | Effect |
|---------|--------|
| No finding | No action |
| Warning | Formal warning recorded |
| Retraining required | Additional training mandated |
| Restricted assignment | Assignment limitations applied |
| Forfeiture of privileges | Privileges removed |
| Suspension | Service status → suspended |
| Demotion | Rank reduced |
| Discharge | Service status → discharged |
| Legal referral | Matter referred to justice system |

### 10.3 Important Distinction

**Disciplinary findings are NOT criminal convictions.** Internal military discipline is separate from the justice system (Stage 12). Legal referrals bridge the two systems.

---

## 11. WebSocket API

### 11.1 Actions

| Action | Description |
|--------|-------------|
| `list_branches` | List service branches |
| `list_organizations` | List organizations (filter by branch) |
| `view_organization` | View organization details |
| `list_bases` | List bases (filter by branch) |
| `view_base` | View base details |
| `list_units` | List units (filter by branch) |
| `apply_for_service` | Submit recruitment application |
| `enlist` | Enlist approved applicant |
| `military_profile` | View military profile |
| `list_training` | List available training courses |
| `enroll_training` | Enroll in training course |
| `complete_training` | Complete training (pass/fail) |
| `promote` | Promote service member |
| `rank_history` | View rank history |
| `create_appointment` | Create command appointment |
| `assign` | Assign service member to duty |
| `request_leave` | Request leave |
| `create_asset` | Create equipment asset |
| `list_assets` | List assets |
| `create_security_event` | Create national security event |
| `list_security_events` | List security events |
| `file_disciplinary_case` | File disciplinary case |
| `list_disciplinary_cases` | List disciplinary cases |
| `service_profile` | View service record snapshot |

---

## 12. Integration with Other Systems

### 12.1 Careers (Stage 6)

Military service is a career path. Service records track employment alongside civilian careers.

### 12.2 Economy (Stage 7)

Military salaries use the economy system for payments. Asset management tracks institutional equipment, not personal wealth.

### 12.3 Government (Stage 10)

Military organizations relate to government structure. Civilian oversight through government appointments.

### 12.4 Justice (Stage 12)

Legal referrals from disciplinary cases bridge to the justice system. Military discipline ≠ criminal prosecution.

### 12.5 Police (Stage 13)

Shared national security events. Inter-agency coordination for emergencies. Distinct permissions and structures.

### 12.6 Geography (Stage 2)

Bases reference geographic locations and state IDs.

### 12.7 Character Snapshot

The `military_profile` field provides:
- Service member status
- Branch, rank, service number
- Current assignment
- Training completed
- Disciplinary case count

---

## 13. Testing

30 new tests covering:
- Catalog structure and lookups
- Empty maps and initialization
- Seeding (organizations, bases, idempotency)
- Organization creation and cycle prevention
- Base creation and snapshots
- Unit creation
- Recruitment eligibility (age, education)
- Service enrollment and service numbers
- Double enlistment prevention
- Training enrollment and completion
- Promotion with time-in-rank validation
- Assignments and completion
- Asset creation, assignment, and return
- National security events
- Disciplinary cases and outcomes
- Military profile snapshots
- Schema migration (v10 → v11)
- WebSocket integration (list_branches, military_profile, error handling)

**Total test count:** 236 passing tests

---

## 14. Files Modified/Created

### New Files
- `game/data/military/catalog.json` — Military catalogue
- `services/world-api/src/military/types.ts` — All type definitions
- `services/world-api/src/military/catalog.ts` — Catalog loader
- `services/world-api/src/military/service.ts` — Main military service
- `services/world-api/src/military/index.ts` — Public API exports
- `services/world-api/test/military.test.mjs` — 30 military tests
- `docs/MILITARY_SYSTEM_PLAN.md` — This document

### Modified Files
- `services/world-api/src/multiplayer/types.ts` — Schema v11, military maps, military_profile
- `services/world-api/src/multiplayer/persistence.ts` — Schema v11, military migration
- `services/world-api/src/multiplayer/world-engine.ts` — military.action handler, seeding, snapshots
- `services/world-api/src/world.ts` — implementationStage: 14, militaryImplemented
- All test files — schemaVersion bumped to 11, military map deletions added
- `docs/ROADMAP.md`, `docs/DEVELOPMENT_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_PLAN.md`, `README.md` — Updated for Stage 14

---

## 15. Known Limitations

- **Godot client verification blocked** — Same limitation as Stages 1-13. Godot 4.7.2 is unavailable.
- **No salary integration yet** — Military salary payments are not yet connected to the economy system's transaction processing. This is a future enhancement.
- **No NPC military careers** — NPC military personnel foundation exists but NPC career progression is not yet automated.
- **No detailed vehicle/aircraft operation** — Asset records track vehicles but piloting/commanding is not simulated.
- **No construction system** — Bases are seeded from catalogue; players cannot construct new military installations.
- **No real-time operations** — National security events are administrative records, not real-time simulations.
