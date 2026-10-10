# Religion, Culture and Community System — Implementation Plan

## Status

- **Stage:** 16 (Complete)
- **Scope:** Communities, religious/traditional institutions, cultural profiles, memberships, festivals, events, projects, announcements, disputes, reputation, and geography integration.
- **Data catalogue:** `game/data/culture/catalog.json`

## Overview

The religion, culture and community system models social life in the Naija game world. It represents communities, religious institutions, traditional institutions, cultural profiles, festivals, community projects, disputes, and reputation. It integrates with the geography, life, government, careers, and economy systems without duplicating their functionality.

All participation is voluntary. No character is automatically assigned to a religious or cultural group. Privacy is respected — sensitive information is not exposed without authorization.

## What This System Does

- **Communities** — configurable types (village, town, urban neighborhood, cultural association, etc.)
- **Community membership** — voluntary join/leave with role support
- **Religious institutions** — churches, mosques, traditional shrines with configurable roles
- **Traditional institutions** — palaces, council halls with configurable leadership
- **Cultural profiles** — voluntary languages spoken, religious affiliation, cultural interests
- **Festivals** — configurable cultural, religious, harvest, durbar, carnival events
- **Events** — community gatherings, institutional events, festival activities
- **Community projects** — proposals, funding, volunteering, milestones, completion
- **Announcements** — scoped to community/institution/regional visibility
- **Disputes** — non-criminal community disputes with mediation and justice referral
- **Reputation** — community trust, participation score, leadership reputation with decay
- **Geography integration** — communities/institutions linked to states, LGAs, wards, settlements
- **Anti-exploit** — age checks, member limits, rate limits, cooldowns

## What This System Does NOT Do

- **Does NOT assign religion or culture** — all affiliation is voluntary
- **Does NOT infer beliefs** from name, location, appearance, or family
- **Does NOT override justice system** — criminal matters go to Stage 12
- **Does NOT override government** — traditional leaders don't bypass formal government
- **Does NOT create duplicate reputation** — extends existing patterns
- **Does NOT require AI inference** — all simulation is deterministic and server-authoritative

## Integration Points

### Geography (Stage 3)
- Communities linked to states, LGAs, wards, settlements
- Institutions linked to geographic locations
- Events linked to locations

### Life (Stage 5)
- Cultural profiles are per-character
- Community participation feeds into character life

### Government (Stage 10)
- Community leaders can interface with local government projects
- Traditional institutions coexist with formal government

### Careers (Stage 6)
- Community leadership roles as career paths
- Integration boundaries for future career paths

### Economy (Stage 7)
- Project budgets and contributions use Naira
- Financial contributions tracked in project records

### Justice (Stage 12)
- Community disputes can be referred to formal justice system

### Police (Stage 13)
- No direct integration — criminal matters stay separate

## Community Types

| ID | Label |
|----|-------|
| village | Village |
| town | Town |
| urban_neighborhood | Urban Neighborhood |
| rural_settlement | Rural Settlement |
| city_district | City District |
| cultural_association | Cultural Association |
| student_community | Student Community |
| professional_community | Professional Community |
| religious_community | Religious Community |
| trade_association | Trade Association |
| age_grade | Age Grade |
| women_group | Women's Group |
| youth_group | Youth Group |
| development_union | Development Union |
| town_union | Town Union |

## Institution Categories

| ID | General Category | Label |
|----|-----------------|-------|
| church | religious | Church |
| mosque | religious | Mosque |
| traditional_shrine | religious | Traditional Shrine |
| prayer_house | religious | Prayer House |
| palace | traditional | Palace |
| council_hall | traditional | Council Hall |
| community_center | community | Community Center |
| cultural_center | community | Cultural Center |
| market_square | community | Market Square |
| town_hall | community | Town Hall |

## Festival Definitions

| ID | Category | Region |
|----|----------|--------|
| new_yam_festival | harvest | south-east |
| eyo_festival | cultural | south-west |
| argungu_fishing | cultural | north-west |
| durbar_festival | durbar | north |
| osun_osogbo | religious | south-west |
| calabar_carnival | carnival | south-south |
| ofala_festival | cultural | south-east |
| sallah_celebration | religious | national |
| christmas_celebration | religious | national |
| iwu_iji | cultural | south-east |

## Project Lifecycle

```
proposed → under_review → approved → funding_in_progress → active → completed
                  ↘                    ↘              ↘
                cancelled           cancelled      cancelled
```

## WebSocket Actions

| Action | Description |
|--------|-------------|
| `list_community_types` | List community types |
| `list_institution_categories` | List institution categories |
| `list_languages` | List available languages |
| `list_festivals` | List festival definitions |
| `list_religious_categories` | List religious categories |
| `create_community` | Create a community |
| `list_communities` | List communities by location/type |
| `view_community` | View community details |
| `join_community` | Join a community |
| `leave_community` | Leave a community |
| `my_memberships` | View character's memberships |
| `create_institution` | Create an institution |
| `list_institutions` | List institutions |
| `join_institution` | Join an institution |
| `leave_institution` | Leave an institution |
| `update_cultural_profile` | Update cultural profile |
| `view_cultural_profile` | View cultural profile |
| `create_event` | Create a community event |
| `attend_event` | Register for event attendance |
| `list_events` | List events |
| `create_project` | Propose a community project |
| `contribute_to_project` | Contribute to a project |
| `list_projects` | List community projects |
| `publish_announcement` | Publish an announcement |
| `list_announcements` | List announcements |

## Anti-Exploit Protections

| Rule | Value |
|------|-------|
| Minimum age for membership | 10 years |
| Minimum age for leadership | 18 years |
| Minimum age for traditional office | 21 years |
| Max communities per character | 10 |
| Max projects per community | 20 |
| Max events per community per month | 10 |
| Max announcements per day | 5 |
| Max volunteers per project | 50 |
| Max members per community | 500 |
| Community creation cooldown | 24 hours |
| Max disputes per community per month | 5 |

## Languages Supported

English (official), Nigerian Pidgin, Hausa, Yoruba, Igbo, Fulfulde, Kanuri, Tiv, Edo, Efik, Ijaw, Nupe, Igala, Urhobo, Other.

## Schema Version

- **Version:** 13
- **Changes from v12:** Added `communities`, `communityMemberships`, `institutions`, `institutionMemberships`, `culturalProfiles`, `communityEvents`, `communityProjects`, `communityAnnouncements`, `communityReputation`, `communityDisputes`, `communityContributions`, `communityAudits` maps
