# Naija: One World

> **One country. One persistent world. Millions of lives. Players create the history.**

Naija: One World is a long-term Nigerian life-simulation game project. The intended game will let players begin as secondary-school students and shape lives across education, work, family, community, culture, public life, and future generations in **one shared logical Nigeria**.

**This repository is currently at Stage 0 — Foundation.** It contains the project architecture and documentation, a tiny Godot launch shell, and a testable read-only Node.js world API foundation. It is not yet a playable game, persistent simulation, or multiplayer service.

## Start here

Before changing the project, read [`docs/AI_AGENT_GUIDE.md`](docs/AI_AGENT_GUIDE.md) and [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md). The status file is the source of truth for what exists and what should happen next.

## Technology at a glance

- **Game client:** Godot 4.7.2, GDScript. Open source, suitable for a future stylized 3D game, and exports to desktop and mobile; browser delivery is possible with constraints.
- **Backend foundation:** Node.js 22.22.3 baseline, TypeScript 5.9, Node's built-in HTTP server. This is only a small API shell; it does not own or persist gameplay state yet.
- **Future persistence direction:** PostgreSQL is the leading candidate, but no database or production schema has been created.

See [`docs/TECH_STACK.md`](docs/TECH_STACK.md) for the evaluation and limitations.

## Requirements

- Node.js **22.13 or newer in the 22.x line** and npm. The checked-in `.nvmrc` pins the tested environment baseline.
- Godot **4.7.2 stable** to open and run the client shell.

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

## Open the game shell

Open `game/project.godot` with Godot 4.7.2, then run the project. Alternatively, if the `godot` executable is on your `PATH`:

```sh
godot --path game
```

This currently displays a Stage 0 foundation screen only. No gameplay controls or simulation loop exist yet.

## Development checks

Run from the repository root:

```sh
npm run build  # compile the TypeScript API
npm run test   # build and run API integration tests
npm run lint   # lint the TypeScript source
npm run check  # lint and test
```

The Node checks do not validate/import the Godot project. When Godot is installed, a headless project smoke check can be run with:

```sh
godot --headless --path game --quit
```

## Repository layout

```text
game/                       Godot client shell
services/world-api/         Minimal read-only TypeScript API
docs/                       Vision, plans, architecture, status, and agent guidance
.github/workflows/          Automated Node foundation checks
```

Future domains should be introduced as small, testable modules only when their roadmap phase begins. Do not create empty scaffolding for every future system.

## Project documents

- [Game vision](docs/GAME_VISION.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development status](docs/DEVELOPMENT_STATUS.md)
- [Technology stack](docs/TECH_STACK.md)
- [Database plan](docs/DATABASE_PLAN.md)
- [Multiplayer plan](docs/MULTIPLAYER_PLAN.md)
- [World and time plan](docs/WORLD_PLAN.md)
- [Security plan](docs/SECURITY_PLAN.md)
- [Contributing](docs/CONTRIBUTING.md)
- [AI agent guide](docs/AI_AGENT_GUIDE.md)

## Project status

Stage 0 is the only completed roadmap phase. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for all planned phases and [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md) for verified implementation details and limitations.
