# Entertainment and Media System — Implementation Plan

## Status

- **Stage:** 17 (Complete)
- **Scope:** Entertainment professions, creator profiles, music projects, film productions, content creation, events, contracts, journalism, fame, monetization, and moderation.
- **Data catalogue:** `game/data/entertainment/catalog.json`

## Overview

The entertainment and media system provides a configurable foundation for entertainment careers in the Naija game world. It covers music, film, comedy, digital content, broadcasting, and journalism — integrating with existing career, economy, business, and culture systems without duplicating their functionality.

Players can create entertainment profiles, develop projects, publish content, organize events, sign contracts, report news, and build fame through gameplay.

## What This System Does

- **30 entertainment professions** across 6 categories (music, film, comedy, digital content, broadcasting, journalism)
- **20 skills** for entertainment career development
- **Creator profiles** with stage names, biographies, fame scores, and career stages
- **Music projects** with full production lifecycle (idea → development → pre-production → production → post-production → ready → released)
- **Film projects** with cast/crew management and production workflow
- **Content creation** with drafts, publication, and simulated audience metrics
- **Entertainment events** with ticketing, capacity, and performer fame boosts
- **Contracts** for recording, management, sponsorship, collaboration, and performance
- **News reports** with editorial review, publication, corrections, and retractions
- **Fame system** with career stages (beginner → emerging → established → recognized → star → icon)
- **Content moderation** with reporting, review, and action workflows
- **Controversies** with reputation impact and resolution tracking
- **20 genres** and **16 content types** for creative variety
- **Anti-exploit** protections (age checks, daily limits, capacity enforcement)

## What This System Does NOT Do

- **Does NOT generate real audio/video** — represents creative work through game mechanics and metadata
- **Does NOT integrate with real external platforms** — all systems are in-game
- **Does NOT create duplicate career systems** — builds on Stage 6 careers foundation
- **Does NOT create duplicate economy** — uses Stage 7 Naira ledger for all financial operations
- **Does NOT guarantee income** — fame and revenue depend on gameplay quality and activity
- **Does NOT force career choices** — entertainment can coexist with education and other careers

## Integration Points

### Careers (Stage 6)
- Entertainment professions as career options
- Skills extend career skill system

### Economy (Stage 7)
- All revenue flows through Naira ledger
- Ticket sales, content revenue, contract compensation

### Businesses (Stage 8)
- Entertainment businesses (studios, labels, production companies)
- Film projects can be linked to business entities

### Culture (Stage 16)
- Events can occur at cultural venues
- Festival performances as event type

### Geography (Stage 3)
- Events linked to states, LGAs, settlements

## Profession Categories

| Category | Professions |
|----------|-------------|
| Music | Singer, Rapper, Songwriter, Music Producer, Beatmaker, Sound Engineer, DJ, Music Manager |
| Film & Acting | Actor, Director, Screenwriter, Cinematographer, Video Editor, Film Producer |
| Comedy & Live | Comedian, Stand-up Performer, Host, Stage Performer |
| Digital Content | Video Creator, Livestreamer, Influencer, Educational Creator, Podcast Host |
| Broadcasting | Radio Presenter, News Presenter, Media Executive |
| Journalism | Reporter, Journalist, Editor, Photographer |

## Career Stages

| Stage | Min Fame | Label |
|-------|----------|-------|
| Beginner | 0 | Starting out |
| Emerging | 10 | Building audience |
| Established | 30 | Known in field |
| Recognized | 50 | Public figure |
| Star | 70 | National recognition |
| Icon | 90 | Industry leader |

## Project Lifecycle (Music & Film)

```
idea → development → pre_production → production → post_production → ready_for_release → released
  ↘                    ↘                           ↘
cancelled          cancelled                    cancelled
```

## Content Lifecycle

```
draft → processing → published → archived
  ↘                    ↘
removed            unlisted → removed
```

## WebSocket Actions

| Action | Description |
|--------|-------------|
| `list_professions` | List all entertainment professions |
| `list_profession_categories` | List profession categories |
| `list_skills` | List entertainment skills |
| `list_genres` | List available genres |
| `list_content_types` | List content types |
| `list_event_types` | List event types |
| `create_profile` | Create entertainment profile |
| `view_profile` | View entertainment profile |
| `create_music_project` | Create music project |
| `transition_music_project` | Advance music project |
| `create_film_project` | Create film project |
| `transition_film_project` | Advance film project |
| `create_content` | Create content draft |
| `publish_content` | Publish content |
| `create_event` | Create entertainment event |
| `purchase_ticket` | Buy event ticket |
| `list_events` | List entertainment events |
| `create_contract` | Propose entertainment contract |
| `accept_contract` | Accept a contract |
| `create_news_report` | Draft news report |
| `publish_news_report` | Publish news report |
| `list_news_reports` | List news reports |

## Anti-Exploit Protections

| Rule | Value |
|------|-------|
| Minimum age for profile | 15 years |
| Minimum age for contracts | 18 years |
| Max professions per character | 3 |
| Max collaborators per project | 10 |
| Max projects per character | 20 |
| Max content per day | 5 |
| Max events per day | 3 |
| Max contracts per character | 10 |
| Max news reports per day | 3 |
| Event capacity max | 50,000 |
| Ticket price max | ₦100,000 |
| Project budget max | ₦50,000,000 |

## Schema Version

- **Version:** 14
- **Changes from v13:** Added `entertainmentProfiles`, `musicProjects`, `filmProjects`, `contentRecords`, `entertainmentEvents`, `entertainmentContracts`, `newsReports`, `controversies`, `contentModeration`, `entertainmentCollaborations`, `entertainmentAudits` maps
