# Naija: One World

> **One country. One persistent world. Millions of lives. Players create the history.**

Naija: One World is a long-term Nigerian life-simulation game project. The intended game will let players begin as secondary-school students and shape lives across education, work, family, community, culture, public life, and future generations in **one shared logical Nigeria**.

## Current status

The repository now contains a **Stage 1 first-playable-prototype implementation** in Godot, alongside the preserved Stage 0 Node.js/TypeScript world API foundation. The playable slice is deliberately small and single-player. It is not the full country, an online world, multiplayer, or production persistence.

**Verification caveat:** Godot is not installed in the current development workspace. GDScript formatting/lint checks and the Node API suite have run, but the Godot project has not been imported, launched, or runtime-tested here. In particular, the Godot domain tests and the two-process save/restart test are present but **have not been run**. See [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md) for exact checks and limitations.

Before changing the project, read [`docs/AI_AGENT_GUIDE.md`](docs/AI_AGENT_GUIDE.md) and [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md). The status file is the source of truth for verified behavior and outstanding work.

## Stage 1 prototype slice

The implementation is designed around a new 15–16-year-old secondary-school student:

- Create a named character with age, character-type, skin-tone, hairstyle, and clothing choices; start in a procedurally generated family/guardian household and home.
- Explore a small, fictional Nigerian neighbourhood called **Idera Quarter**, drawn from original procedural shapes. Travel between the home, streets, school yard, classroom, market, clinic, police station, and community hall.
- Move with **WASD** or **arrow keys**, hold **Shift** to run, and press **E** or use the HUD button to interact with nearby people and objects.
- Talk with family, neighbours, students, teachers, and service NPCs; use a small neighbourhood shop, school timetable, bus stop, clinic, bed, and other reusable interaction targets.
- Track Naira, hunger, energy, health, inventory, school attendance, subject averages, household/home, and current location; a basic reputation field is present but has no progression rules.
- Attend short class activities for Mathematics, English, Computer Studies, Biology, and Civic Education. Answers update academic averages and attendance records.
- Advance a morning/afternoon/evening/night clock. Menus pause the clock. Rest, food, bus travel, movement, and clinic visits affect selected needs or money.
- Save and load one local character through a versioned JSON save in Godot's `user://` data folder. The implementation also includes autosave hooks and a separate-process restart test harness; **runtime persistence is not yet verified**.

This is a 2D prototype with simple procedural placeholder drawings, not a final art style. It does not use real map data or third-party assets. See [`docs/ASSETS.md`](docs/ASSETS.md).

## Technology

- **Game client:** Godot 4.7.2 + GDScript. The Stage 1 code is local/offline and does not yet call the backend.
- **Backend foundation:** Node.js 22.22.3 baseline, TypeScript 5.9, Node's built-in HTTP server. It remains read-only and does not own or persist gameplay state.
- **Future persistence direction:** PostgreSQL is the leading candidate, but there is no database or production schema.

See [`docs/TECH_STACK.md`](docs/TECH_STACK.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requirements

- Node.js **22.13 or newer in the 22.x line** and npm for the API checks.
- Godot **4.7.2 stable** to import, run, or test the game. The binary is not bundled in this repository.
- Optional: `gdtoolkit` for GDScript formatting/parser/lint checks (`gdformat` and `gdlint`). These checks do not replace Godot engine validation.

## Run the backend foundation

From the repository root:

```sh
npm ci
npm run dev
```

The service listens on `0.0.0.0:3000` by default. You can optionally copy `.env.example` to `.env` and change `PORT`.

Available read-only endpoints:

- `GET /health` — process health check.
- `GET /api/v1/world` — static descriptor for the single logical Nigeria world. This is metadata, not a simulated or persisted world state.

For a production-style compiled start:

```sh
npm run build
npm run start
```

## Run the game

Open `game/project.godot` with Godot 4.7.2, or run it from the repository root:

```sh
godot --path game
```

The first screen offers character creation and, when a local save exists, a continue option. The prototype uses generated procedural art and local state only. Engine/runtime behaviour has not yet been verified in this workspace.

## Development checks

Run the backend checks from the repository root:

```sh
npm run build  # compile the TypeScript API
npm run test   # build and run API integration tests
npm run lint   # lint the TypeScript source
npm run check  # lint and test
```

When Godot is installed, run the project import smoke check and Stage 1 tests from the repository root:

```sh
godot --headless --editor --path game --quit
godot --headless --path game --quit
godot --headless --path game --script res://tests/domain_smoke.gd
godot --headless --path game --script res://tests/player_movement.gd
```

The save/restart check must use **two separate Godot processes**; allow the first to exit before starting the second:

```sh
godot --headless --path game --script res://tests/save_restart.gd -- write
godot --headless --path game --script res://tests/save_restart.gd -- read
```

The Godot tests cover character/household creation, age limits, needs, money, inventory, school attendance/performance, interaction targeting, clock progression, domain save/load, movement, bounds, disabled-movement behaviour, and persistence across process restart. They are test scripts, not automated CI jobs, and are not claimed as passing until run with the engine.

If `gdtoolkit` is installed, GDScript static checks are:

```sh
gdformat --check $(find game -name '*.gd' -print)
gdlint $(find game -name '*.gd' -print)
```

## Repository layout

```text
game/                       Godot client, prototype scripts, and GDScript test harnesses
services/world-api/         Minimal read-only TypeScript API foundation
docs/                       Vision, plans, architecture, status, and agent guidance
.github/workflows/          Automated Node foundation checks
```

## Project documents

- [Game vision](docs/GAME_VISION.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development status](docs/DEVELOPMENT_STATUS.md)
- [Technology stack](docs/TECH_STACK.md)
- [Database plan](docs/DATABASE_PLAN.md)
- [Multiplayer plan](docs/MULTIPLAYER_PLAN.md)
- [World and time plan](docs/WORLD_PLAN.md)
- [Asset and licensing notes](docs/ASSETS.md)
- [Security plan](docs/SECURITY_PLAN.md)
- [Contributing](docs/CONTRIBUTING.md)
- [AI agent guide](docs/AI_AGENT_GUIDE.md)

## Scope boundary

Stage 1 introduces only the first small life-simulation slice. The single logical Nigeria architecture remains unchanged, but no full-country geography, account/authentication flow, multiplayer, backend gameplay integration, production persistence, or large-scale NPC simulation has been added. The next step is to run and verify the Godot project and all of its tests before extending the prototype toward Stage 2.
