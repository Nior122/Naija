# Naija: One World

> **One country. One persistent world. Millions of lives. Players create the history.**

Naija: One World is a long-term Nigerian life-simulation game project. The intended game will let players begin as secondary-school students and shape lives across education, work, family, community, culture, public life, and future generations in **one shared logical Nigeria**.

## Current status

The repository preserves the Stage 0 Node/TypeScript API foundation and the Stage 1 Godot offline prototype, and now includes an optional **Stage 2 multiplayer foundation**. The Stage 1 local life remains available; online mode connects to a small, server-authoritative prototype world with the canonical ID `nigeria-main`.

The backend TypeScript build, lint, and nine Node integration tests pass. Static GDScript formatting/lint checks pass. **Godot is not installed in the current workspace**, so the game has not been imported, launched, or tested in-engine. The Godot two-client UI, reconnect flow, and browser export therefore remain unverified. Backend WebSocket tests do exercise two real simultaneous clients and server restart/reconnect behavior. See [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md) for exact results and limitations.

This is not the complete Nigeria simulation, production online service, account system, or Stage 3 geography build. Stage 1/2 data and features are prototype scope.

## Stage 1 — first playable slice (retained)

The local, offline Godot prototype lets a player:

- Create a named 15–16-year-old secondary-school student, choose a character type and appearance, and receive a generated family/guardian household and home.
- Explore the fictional **Idera Quarter** and travel between a home, streets, school yard/classroom, market, clinic, police station, and community hall.
- Walk/run with **WASD** or **arrow keys**, hold **Shift** to run, and press **E** or the HUD button to interact.
- Talk to family, neighbours, students, teachers, and service NPCs; visit the small shop, school, bus stop, clinic, and bed.
- Track Naira, hunger, energy, health, inventory, attendance, academic averages, household/home, and location. Reputation is a placeholder field without progression rules.
- Attend short activities for Mathematics, English, Computer Studies, Biology, and Civic Education; use a local day/time clock.
- Save/load a local versioned JSON character through Godot's `user://` storage. The save/restart harness exists but is **not engine-verified here**.

The 2D prototype uses original procedural placeholder drawings. It has no real map data or third-party game art; see [`docs/ASSETS.md`](docs/ASSETS.md).

## Stage 2 — multiplayer foundation

Online play is optional and uses the same Godot project. It connects to one shared prototype world over JSON WebSocket (`/ws`); the server assigns identity and owns the saved online character, position, actions, and world clock. The client sends movement intent rather than coordinates, renders other connected characters from server presence, and exposes nearby chat and a wave interaction.

The current server also validates and applies the prototype's location travel, bus fare, purchases, item consumption, clinic care, rest, and classroom answers. State-changing requests use bounded request-ID deduplication. The server checks message size, schemas/ranges, interaction distance, connection/command/chat rates, and browser `Origin` configuration.

Player records and the shared clock are separate logical fields in one local JSON file (`world-state.json`), written through a temporary file and rename. The Stage 1 local save remains separate from online character state. The session token and identity-recovery key are kept on the client in a Godot `user://` config file; this is **not** account authentication or encrypted credential storage. The JSON file is a single-process prototype persistence mechanism, not a database or a multi-server coordination layer.

## Technology

- **Game client:** Godot 4.7.2 + GDScript. Offline play remains available; optional multiplayer uses Godot's `WebSocketPeer`.
- **World API/server:** Node.js 22.x + strict TypeScript, HTTP endpoints, and the `ws` WebSocket library.
- **Prototype persistence:** atomically replaced local JSON file, configurable with `DATA_FILE`; no database is configured. PostgreSQL remains a future candidate only.
- **Canonical logical world:** `nigeria-main`; this is not a player-selectable shard.

See [`docs/TECH_STACK.md`](docs/TECH_STACK.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`docs/MULTIPLAYER_PLAN.md`](docs/MULTIPLAYER_PLAN.md).

## Requirements

- Node.js **22.13 or newer in the 22.x line** and npm for the API.
- Godot **4.7.2 stable** to import, run, or test the game; it is not bundled.
- Optional `gdtoolkit` for `gdformat`/`gdlint` checks. These static tools do not replace Godot engine validation.

## Run the server

From the repository root:

```sh
npm ci
cp .env.example .env   # optional; edit only the settings you need
npm run dev
```

The server listens on `0.0.0.0:3000` by default. Its default state file is `services/world-api/data/world-state.json` (ignored by Git). If you set `DATA_FILE` in the root `.env`, a relative path is resolved from `services/world-api/`; for example, `DATA_FILE=data/world-state.json`.

HTTP endpoints:

- `GET /health` — process health.
- `GET /api/v1/world` — canonical world descriptor and bounded-prototype status.
- `GET /ws` — returns `426`; upgrade this path to a WebSocket connection for multiplayer.

Desktop Godot clients normally omit the browser `Origin` header. Browser WebSocket connections require an exact HTTP(S) origin in the comma-separated `ALLOWED_ORIGINS` setting; leaving it empty rejects browser-origin connections. For a production browser deployment, serve the game over HTTPS, use WSS, and proxy the same-origin `/ws` route to this server.

For a compiled start:

```sh
npm run build
npm run start
```

Protect the state file and client session config as personal data/credentials. The prototype does not provide TLS termination, a user account provider, backups, moderation, or production operations.

## Run the game

Open `game/project.godot` with Godot 4.7.2, or start the local/offline prototype from the repository root:

```sh
godot --path game
```

For desktop online play, run the server first. The default native URL is `ws://127.0.0.1:3000/ws`; override it when needed:

```sh
NAIJA_WS_URL=ws://127.0.0.1:3000/ws godot --path game
```

In the character-creation screen, select **Create online life**. The server creates an online character separate from the local Stage 1 save. Reuse that client identity by launching with the same session config and selecting **Continue online life**. Native clients on another host should use that server's reachable address. Do not expose the prototype over an untrusted network without a TLS-terminating proxy and additional security controls.

## Local two-client and reconnect test

1. Start the server with `npm run dev` in one terminal.
2. Start two Godot clients in separate terminals with different session-config paths (this avoids both windows sharing one identity). On macOS/Linux:

   ```sh
   NAIJA_MULTIPLAYER_SESSION_PATH=user://naija-client-a.cfg godot --path game
   NAIJA_MULTIPLAYER_SESSION_PATH=user://naija-client-b.cfg godot --path game
   ```

   In PowerShell, set the variable separately in each terminal before launching: `$env:NAIJA_MULTIPLAYER_SESSION_PATH = 'user://naija-client-a.cfg'` (use `naija-client-b.cfg` for the other client).
3. Create a different online character in each window. Move them around; use **Nearby chat** and move close enough to use **E** to wave.
4. Close one client and launch it again with the same session-config path. Choose **Continue online life**. The server should restore the same character from the same `DATA_FILE`.

These are manual client instructions, **not a claim that Godot's two-window flow was run in this workspace**. The automated Node integration suite independently opens two real WebSocket clients, checks coexistence, server movement, chat/wave, and persisted reconnect after API restart.

## Development checks

From the repository root:

```sh
npm run build  # compile TypeScript
npm run lint   # ESLint
npm test       # build and run Node HTTP/WebSocket integration tests
npm run check  # lint plus tests
```

When Godot is installed, run its import smoke check and retained Stage 1 tests:

```sh
godot --headless --editor --path game --quit
godot --headless --path game --quit
godot --headless --path game --script res://tests/domain_smoke.gd
godot --headless --path game --script res://tests/player_movement.gd
```

The local-save persistence check requires two separate Godot processes, with the writer exiting before the reader starts:

```sh
godot --headless --path game --script res://tests/save_restart.gd -- write
godot --headless --path game --script res://tests/save_restart.gd -- read
```

If `gdtoolkit` is installed, run static GDScript checks:

```sh
gdformat --check $(find game -name '*.gd' -print)
gdlint $(find game -name '*.gd' -print)
```

The automated backend tests cover retained HTTP behavior, two-client presence/movement/chat/interaction, server-side payload validation and rate limits, request-ID idempotency, identity recovery, character and session persistence through API restart, shared clock rollover, and WebSocket `Origin` rejection. They do not exercise Godot rendering/input, browser exports, or actual client reconnect UI.

## Repository layout

```text
game/                       Godot Stage 1 prototype and optional Stage 2 client
services/world-api/         HTTP API, WebSocket authority, JSON persistence, tests
docs/                       Vision, plans, architecture, status, and agent guidance
.github/workflows/          Node/TypeScript foundation checks
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

Stage 2 is a bounded multiplayer foundation, not Stage 3 geography. Preserve one logical Nigeria; do not split the prototype into separately authoritative regional worlds. Full national geography/simulation, accounts, production database and operations, comprehensive anti-cheat/moderation, advanced NPC simulation, and cross-platform client exports remain future work.
