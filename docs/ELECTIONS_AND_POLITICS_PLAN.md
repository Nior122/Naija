# Stage 11 — Elections and Politics System

> **Future agents: read this file before changing the elections and politics system.** It documents the implemented political architecture, its integration with Stage 6 (careers), Stage 7 (economy), Stage 10 (government), and the boundaries that later stages (laws, courts, justice) must respect.

## Scope

Stage 11 adds a configurable elections and politics system to the shared Nigerian world. It supports political parties, candidate registration and screening, campaigns with manifestos, voter eligibility verification, secure ballot casting with duplicate prevention, deterministic vote counting, result certification and publication, election disputes, and the transfer of elected winners into government offices managed by Stage 10. The entire system operates on the one shared `nigeria-main` world.

### Implemented

- **Political parties:** Create, register, join, leave. Unique name and abbreviation enforcement. Configurable statuses (proposed, pending_registration, active, suspended, dissolved). Party leadership roles.
- **Party membership:** One active membership per character. Join/leave with history. Leadership assignments separate from government offices.
- **Political profiles:** Public identity, party affiliation, public service history, public statement. Reputation foundation.
- **Election types:** Presidential, gubernatorial, senatorial, House of Representatives, state assembly, and local chairman. Each maps to a government office definition with configurable eligibility rules.
- **Election lifecycle:** Scheduling → candidate registration → screening → campaign → voting → counting → certification → completion (with dispute and cancellation paths).
- **Candidate registration:** Eligibility checks (age, party affiliation, life status). Configurable minimum ages per office type. Duplicate candidacy prevention.
- **Campaign system:** Campaign records with themes and events. Manifesto support with policy statements.
- **Campaign finance:** Donation, party allocation, and expense recording with idempotency. Spending validated against available funds.
- **Debates:** Debate records with participants, topics, and candidate statements.
- **Voter eligibility:** Age (18+), life status, geographic jurisdiction. Server-authoritative checks.
- **Voting:** Secure ballot casting with duplicate prevention. Secret ballots — individual choices not exposed publicly.
- **Vote counting:** Deterministic counting from persisted ballots. Configurable winning rules (plurality).
- **Results:** Preliminary → certified → published. Tie detection. Certification prevents duplicate finalization.
- **Election disputes:** Dispute submission with categories, descriptions, and evidence references. Authorized review workflow.
- **Government office transfer:** Certified election results automatically assign the winner to the correct Stage 10 government office, ending any previous appointment and preserving history.
- **Audit trail:** All significant election events (creation, registration, ballots, counting, certification, disputes) are recorded in audit logs.
- **Schema v8 persistence:** `PersistentWorldState` upgraded from schema 7 to schema 8, adding 13 election maps. Schema 1–7 states auto-migrate to v8.

### Not implemented

- No legislative system or lawmaking (Stage 12).
- No judicial system, courts, or trials (Stage 12).
- No police, military, or security forces.
- No full NPC political behavior simulation.
- No political polling or public opinion simulation.
- No complete electoral commission simulation.
- No precise constituency boundaries beyond state/LGA jurisdiction.
- No live 3D campaign events in the game world.
- No sophisticated campaign advertising or media system.
- No runoff elections or ranked-choice voting (configurable winning rules support future extension).
- Godot client/runtime verification remains blocked (same as Stages 1–10).

## Data boundaries

The elections catalogue is stored in `game/data/elections/catalog.json`. Runtime state lives in `world-state.json` alongside all other stage data. No separate election database, currency, or parallel political system is created.

## Persistence

Stage 11 adds 13 new maps to `PersistentWorldState` under schema version 8:

| Map | Purpose |
|---|---|
| `politicalParties` | Political party records (name, abbreviation, status, leadership, policy positions). |
| `partyMemberships` | Party membership records (character, party, role, join/end dates). |
| `politicalProfiles` | Character political profiles (party affiliation, public statement, service history). |
| `elections` | Election records (type, jurisdiction, schedule, phase, results). |
| `candidates` | Candidate registrations (election, character, party, manifesto, status). |
| `campaigns` | Campaign records (title, themes, status, dates). |
| `campaignEvents` | Campaign event records (type, location, schedule). |
| `campaignFinances` | Campaign finance records (donations, allocations, expenses with idempotency). |
| `debates` | Debate records (participants, topic, statements). |
| `ballots` | Ballot records (voter, candidate, timestamp, validity). |
| `voterParticipation` | Voter participation tracking (has-voted flag, prevents duplicates). |
| `electionDisputes` | Dispute records (complainant, category, status, resolution). |
| `electionAudits` | Audit trail (event category, actor, summary, details). |

Schema versions 1–7 auto-migrate to version 8 with empty election maps.

## WebSocket API

The server accepts `election.action` commands over the existing authenticated WebSocket session.

| Action | Description |
|---|---|
| `list_parties` | Browse political parties with optional status filter. |
| `create_party` | Create a new political party (age 21+ required). |
| `register_party` | Register a pending party as active (authorization required). |
| `join_party` | Join an active political party (one party per character). |
| `leave_party` | Leave current party membership. |
| `political_profile` | View character's political profile. |
| `update_profile` | Update public political statement. |
| `list_elections` | Browse elections with optional phase filter. |
| `view_election` | View election details, candidates, and results. |
| `create_election` | Create a new election with full schedule (authorization required). |
| `advance_phase` | Advance election to next phase (authorization required). |
| `register_candidate` | Submit candidacy for an election (with optional manifesto). |
| `approve_candidate` | Approve a pending candidate (authorization required). |
| `reject_candidate` | Reject a pending candidate with reason (authorization required). |
| `withdraw_candidate` | Withdraw a candidacy. |
| `list_candidates` | View all candidates for an election. |
| `create_campaign` | Create a campaign for an approved candidate. |
| `view_campaign` | View campaign details and finances. |
| `check_eligibility` | Check if character is eligible to vote in an election. |
| `cast_ballot` | Cast a vote for an approved candidate (one per voter per election). |
| `count_votes` | Count valid ballots and produce preliminary results (authorization required). |
| `certify_result` | Certify election results (authorization required). |
| `publish_result` | Publish certified results publicly (authorization required). |
| `transfer_office` | Transfer certified winner to government office (authorization required). |
| `submit_dispute` | Submit an election dispute. |
| `audit_log` | View election audit trail. |
| `my_history` | View character's election candidacy history and party membership. |

## Government integration

When a certified election result is processed via `transfer_office`:

1. The system finds the matching Stage 10 government office by election type and jurisdiction.
2. Any existing active appointment for that office is ended with reason "Election result certified."
3. A new appointment is created for the winner with `appointed_by: "election:<election_id>"`.
4. The winner's political profile is updated with the new public service history entry.
5. An audit record links the appointment to the election.

This ensures:
- Only one active occupant per unique office at any time.
- Complete appointment history is preserved.
- The source election and result are recorded with the appointment.
- Reprocessing the same certified result does not create duplicates (the system prevents re-certification).

## Checks

```sh
npm run check                         # lint + 149 Node tests
node --test services/world-api/test/elections.test.mjs   # focused Stage 11 suite (25 tests)
```
