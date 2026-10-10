# Crime and Consequences System — Implementation Plan

## Status

- **Stage:** 15 (Complete)
- **Scope:** Crime mechanics with consequences that integrate with police (Stage 13), justice (Stage 12), and economy (Stage 7) systems.
- **Data catalogue:** `game/data/crime/catalog.json`

## Overview

The crime system models crime incidents, detection, resolution, criminal records, notoriety, restitution, and rehabilitation in the Naija game world. It integrates with the police, justice, and economy systems without duplicating their functionality.

Crime actions are server-authoritative and abstract game mechanics. Allegations are not convictions; investigations are not established facts.

## What This System Does

- **Crime definitions** with configurable categories, severities, and values
- **Crime action resolution** — server-side detection rolls, evidence generation
- **Incident lifecycle** — created → reported → under review → investigation → court → resolved → closed
- **Player/NPC participation** — suspects, victims, witnesses, investigators
- **Criminal records** — distinct from allegations, with conviction tracking
- **Notoriety/reputation** — detected crimes increase notoriety, which decays over time
- **Financial consequences** — restitution, fines integrated with economy system
- **Employment consequences** — criminal records affect background checks
- **Political consequences** — criminal records affect office eligibility
- **Rehabilitation** — characters can undergo rehabilitation to recover reputation
- **Anti-exploit protections** — age checks, cooldowns, rate limits, offline/new-player protection

## What This System Does NOT Do

- **Does NOT create police incidents** — links to police system via `linkToPoliceIncident()`
- **Does NOT create justice cases** — links to justice system via `linkToJusticeCase()`
- **Does NOT handle fines directly** — references economy system for payments
- **Does NOT manage employment records** — provides data for career system to check
- **Does NOT manage political eligibility** — provides data for government system to check

## Integration Points

### Police (Stage 13)
- Crime incidents can be linked to police incident reports via `linkToPoliceIncident()`
- Evidence can be linked to police investigations via `linkToPoliceInvestigation()`
- Crime categories map to police incident categories (theft → theft, assault → assault, etc.)

### Justice (Stage 12)
- Crime incidents can be linked to justice court cases via `linkToJusticeCase()`
- Criminal records track conviction outcomes from justice judgments
- Crime categories map to justice case categories (criminal_theft, criminal_fraud, etc.)

### Economy (Stage 7)
- Crime values determine financial loss/recovery
- Restitution records integrate with economy ledger via transaction IDs
- Fines are tracked in criminal records, payments go through economy

### Careers (Stage 6)
- Criminal records provide data for employment background checks
- Categories flagged in `employment_background_check_categories` affect hiring

### Government (Stage 10)
- Criminal records provide data for political eligibility checks
- Categories flagged in `political_disqualification_categories` affect candidacy

## Crime Definitions

| ID | Category | Severity | Label |
|----|----------|----------|-------|
| shoplifting | theft | minor | Shoplifting |
| pickpocketing | theft | minor | Pickpocketing |
| grand_theft | theft | serious | Grand Theft |
| petty_fraud | fraud | minor | Petty Fraud |
| insurance_fraud | fraud | serious | Insurance Fraud |
| armed_robbery | robbery | severe | Armed Robbery |
| property_damage | property_damage | minor | Vandalism |
| extortion | extortion | moderate | Extortion |
| smuggling | smuggling | serious | Smuggling |
| bribery | corruption | moderate | Bribery |
| assault | assault | moderate | Assault |
| kidnapping | kidnapping | severe | Kidnapping |
| cybercrime | cybercrime | serious | Cybercrime |
| tax_evasion | financial_crime | moderate | Tax Evasion |

## Crime Severities

| Severity | Detection Chance | Fine Range (₦) |
|----------|-----------------|----------------|
| Minor | 70% | 5,000 – 50,000 |
| Moderate | 50% | 20,000 – 200,000 |
| Serious | 30% | 100,000 – 1,000,000 |
| Severe | 20% | 500,000 – 5,000,000 |

## Incident Lifecycle

```
created → reported → under_review → investigation_open → referred_to_court → resolved → closed
created → closed (dismissed)
```

## WebSocket Actions

| Action | Description |
|--------|-------------|
| `list_crime_definitions` | List all crime types with metadata |
| `list_categories` | List crime categories |
| `commit_crime` | Attempt a crime action (server resolves) |
| `report_crime` | Report an existing incident |
| `view_incident` | View incident details |
| `list_incidents` | List incidents by perpetrator/victim/status |
| `transition_incident` | Transition incident to new status |
| `add_evidence` | Add evidence to incident |
| `link_to_police` | Link to police incident report |
| `link_to_justice` | Link to justice court case |
| `criminal_profile` | View character's criminal profile |
| `create_criminal_record` | Create criminal record (from court judgment) |
| `list_criminal_records` | List character's criminal records |
| `create_restitution` | Create restitution obligation |
| `start_rehabilitation` | Begin rehabilitation program |
| `notoriety` | View character's notoriety status |

## Anti-Exploit Protections

| Rule | Value |
|------|-------|
| Minimum age for crime | 15 years |
| Victim targeting cooldown | 48 hours |
| Max reports per hour | 5 |
| Max crime actions per day | 10 |
| New player protection | 7 days (age < 15) |
| Offline loss limit | 25% of value |
| Notoriety decay | 0.01 per day |

## Consequence Rules

| Rule | Value |
|------|-------|
| Criminal record retention | 7 years |
| Background check categories | theft, fraud, robbery, corruption, assault, organized_crime |
| Political disqualification categories | corruption, organized_crime, financial_crime, kidnapping |
| Restitution percentage | 100% |
| Rehabilitation recovery rate | 0.002 reputation per day |

## Schema Version

- **Version:** 12
- **Changes from v11:** Added `crimeIncidents`, `crimeParticipations`, `crimeEvidence`, `crimeReports`, `criminalRecords`, `crimeNotoriety`, `crimeRestitution`, `crimeRehabilitation`, `crimeAudits` maps
