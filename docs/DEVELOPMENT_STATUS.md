# Development Status

> **Future AI agents: read this file before modifying the project.** It records verified repository state, not the full vision.

## Current stage

**Stage 0 — Foundation: complete.** Stage 1 / Phase 1 has not started.

## Completed

- Inspected the starter repository; it contained only a minimal `README.md` and no existing game or backend code.
- Chose and documented Godot 4.7.2 + GDScript for the client and Node.js 22.x + TypeScript 5.9 for the initial backend boundary.
- Added a minimal Godot project with one static foundation/title scene. It clearly states that gameplay is not implemented.
- Added a modular TypeScript HTTP API foundation with a health endpoint and a static descriptor for the single logical Nigeria; it has no write routes or persisted game state.
- Added API integration tests, strict TypeScript configuration, ESLint, npm workspace scripts, and GitHub Actions checks for the Node foundation.
- Added the requested vision, architecture, technology, roadmap, database, multiplayer, world/time, security, contributing, and AI-agent documents.
- Added Git/environment hygiene via `.gitignore`, `.env.example`, `.editorconfig`, and `.nvmrc`.
- Verified a clean dependency install, build/lint/test check, and development plus compiled-server HTTP smoke checks; details are below.

## In progress

None. No gameplay, persistence, or multiplayer feature is currently being developed.

## Not started

All future roadmap systems, including but not limited to: character creation/gameplay, education, age/life events, geography data, world clock, NPC society, careers, businesses, banking/economy, property, transport, family/relationships, government/elections, law/courts, police/security, military, crime, culture/religion, media/social networking, weather/events, authentication, multiplayer, production persistence, anti-cheat, moderation, analytics, mobile/PC release, and large-scale operations.

## Current architecture

- `game/`: Godot client shell; presentation only, no gameplay script or network connection.
- `services/world-api/`: read-only TypeScript/Node HTTP server. Routes are `GET /health` and `GET /api/v1/world`; all non-GET methods are rejected. The world descriptor is a source-code constant, not authoritative simulation state.
- `docs/`: system vision and forward plans. PostgreSQL is a future candidate only; no database is configured.
- The architecture records one logical Nigeria (`nigeria-main`). There are no shards, servers, replicas, or world synchronization yet.

## Current technology and verified versions

| Component | Baseline / version | Notes |
|---|---|---|
| Node.js | 22.22.3 in the Stage 0 workspace | Runtime for API; Node `>=22.13 <23` is declared. |
| npm | 10.9.8 in the Stage 0 workspace | Lockfile-backed install; npm workspaces. |
| TypeScript | 5.9.3 | Strict type-checking/build. |
| ESLint | 10.12.0 | Lints TypeScript source; typescript-eslint 8.71.1. |
| Godot | 4.7.2 stable selected | Project target; engine binary was not available in this workspace, so the scene has not been imported/run here. |
| PostgreSQL | Not installed/selected | Future candidate only; there is no DB code or data. |

## How to run

From the repository root, with Node.js 22.13+ and npm:

```sh
npm ci
npm run dev
```

The API listens on `0.0.0.0:3000` by default. Copy `.env.example` to `.env` to override `PORT`. Visit `/health` and `/api/v1/world` to inspect the read-only responses.

For a compiled run:

```sh
npm run build
npm run start
```

To open the client, install Godot 4.7.2 stable and open `game/project.godot`, or run `godot --path game` when the executable is available. The client currently displays a static foundation screen only.

## How to test

```sh
npm run build
npm run test
npm run lint
npm run check
```

`npm run test` compiles the service and runs Node's integration tests. `npm run check` runs lint and tests. These checks do not validate Godot project import/export. With Godot installed, the intended headless smoke command is `godot --headless --path game --quit`.

## Verification performed for Stage 0

- `npm ci` — completed successfully; npm reported zero known vulnerabilities in the installed dependency tree.
- `npm run check` — passed: TypeScript build, ESLint, and all 4 API integration tests.
- `npm run dev` — started on `0.0.0.0:3000`; `GET /health` and `GET /api/v1/world` returned the expected JSON.
- `npm run start` after build — started the compiled server on `0.0.0.0:3000`; both read-only endpoints returned the expected JSON.
- Local configuration — a temporary ignored `.env` with `PORT=3307` was loaded and the development server bound to that port; the temporary file was removed after the check.
- Godot import/run and platform exports — **not run**, because no Godot executable is installed in the workspace.

## Known limitations

- Godot 4.7.2 was selected after checking its stable release, but its engine binary was not installed in this environment. The Godot project/scene could not be imported or executed here; no engine success is claimed.
- The backend has no authentication, database, persistence, write API, game logic, rate limiting, production deployment, or service-to-client integration.
- The static world descriptor is not proof of a running persistent world or a functioning multiplayer architecture.
- No geography, real Nigerian datasets, map, 3D scene, NPC simulation, economy, or actual player history is present.
- Browser, Android, iOS, and PC exports have not been built or tested. iOS signing needs Apple tooling; web/browser behavior requires target-specific validation.
- The CI workflow verifies only the Node/TypeScript service, not Godot imports or platform exports.

## Next stage

**Stage 1 — First Playable Prototype (Phase 1).** Start by agreeing on the smallest vertical slice and its acceptance criteria. Recommended scope: a single-player Godot prototype with one bounded school/neighborhood scene, a minimal student profile, basic navigation, and a few interactions that demonstrate a day-in-the-life loop. Use placeholder visuals and local temporary data. Add focused tests for any new domain logic, keep gameplay state separable from presentation, and avoid multiplayer, production database, full Nigeria geography, economy, and large NPC simulation. End Phase 1 with a runnable prototype and updated status/docs; do not begin Phase 2 until the slice is demonstrated and reviewed.
