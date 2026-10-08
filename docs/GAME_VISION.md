# Game Vision — Naija: One World

## North star

> **One country. One persistent world. Millions of lives. Players create the history.**

Naija: One World is envisioned as a long-running life simulation rooted in Nigeria. A player begins as a secondary-school student and can shape a life through education, work, relationships, family, community, culture, public life, and future generations. The world should feel recognizably Nigerian while leaving room for the country's extraordinary regional, linguistic, religious, and personal diversity.

The working title is **Naija: One World**. It may change.

## World promise

There is **one logical Nigeria**, not a separate copy of the country for each server, region, or player group. The shared national history, laws, public institutions, major events, and economy should remain coherent. Infrastructure may be distributed for performance and reliability, but distribution must not create disconnected national worlds.

Players are participants in a living society, not just visitors to a collection of minigames. Their choices, relationships, creative work, civic activity, businesses, and consequences can contribute to a persistent player-created history.

## Intended life domains

The long-term scope may include:

- Schooling at secondary schools, universities, polytechnics, vocational institutions, and apprenticeships.
- Skills, careers, employment, player businesses, banking, a Naira-denominated game economy, taxation, loans, savings, and investment.
- Housing, property, vehicles, roads and public/private transportation; dating, relationships, marriage, households, children, aging, death, inheritance, and generational legacy.
- Religion, culture, languages, community, music, film, comedy, journalism, content creation, entertainment, and social networks.
- Nigerian public life: one national government and President/Vice President; state governors and administrations; ministers, legislature, local government, civil service, and agencies; parties and elections; laws, judges, lawyers, courts, police, military, security, crime, and justice.
- A geographically grounded society of states, LGAs, cities, towns, villages, neighborhoods, roads, buildings, airports, ports, railways, public places, weather, a persistent clock, dynamic events, NPCs, and player-created history.

These are **vision items**, not claims about current implementation. The roadmap introduces them gradually.

## Experience principles

1. **One shared country:** a single logical world identity and coherent national state.
2. **A whole life, not a checklist:** player agency and consequences should connect life domains.
3. **Local grounding without flattening:** model Nigerian places and experiences with research and community input; do not treat one region, language, faith, or lifestyle as representative of everyone.
4. **Meaningful social systems:** make relationships and institutions matter, not merely their UI screens.
5. **Persistent but fair:** the world can progress while a player is offline without requiring every NPC to be simulated every second.
6. **Trustworthy systems:** clients request actions; authoritative services validate and apply them.
7. **Incremental delivery:** prove small vertical slices before adding country-scale content or infrastructure.

## Platforms and presentation

The target direction is stylized-realistic and cross-platform: Android, iOS, PC, and browser where the technical and performance trade-offs are acceptable. A browser build is a delivery option, not a promise of identical capabilities or performance on every device.

## Stage 0 boundary (completed)

Stage 0 established the repository, technology direction, documentation, a minimal Godot title shell, and a testable read-only API foundation. At the end of that phase there was no gameplay, production database, authentication, multiplayer, Nigerian map, simulated clock, complete NPC society, or release-ready art.

## Stage 1 prototype boundary (current)

Stage 1 adds the implementation of a small local single-player life-simulation slice in the fictional Idera Quarter: student creation, home and family, movement/interactions, school activities, basic needs, inventory, and local JSON save/load. Godot runtime and restart persistence remain unverified in the current workspace. This slice is not the full Nigeria, online play, production data, or the long-term life simulation; see [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md) for verified status.
