# Technology Stack

## Decision summary

| Layer | Selected direction | Current use |
|---|---|---|
| Game client | **Godot 4.7.2 stable + GDScript** | Preserved Stage 1 offline prototype plus optional Stage 2 WebSocket client; engine/runtime verification is pending. |
| Backend/API | **Node.js 22.x + TypeScript 5.9** | HTTP health/world metadata and server-authoritative prototype multiplayer service. |
| Multiplayer transport | **JSON over WebSocket** (`ws` server, Godot `WebSocketPeer`) | Cross-platform prototype at `/ws`; browser WSS proxy/export is not tested. |
| Package management | **npm workspaces + lockfile** | Root scripts for build, test, lint, and development. |
| Testing | **Node built-in test runner, `fetch`, and `ws` clients** | Integration tests include two simultaneous real WebSocket clients and state-file restart/reconnect. |
| Linting | **ESLint 10 + typescript-eslint 8** | TypeScript service source. |
| Source control / automation | **Git + GitHub Actions** | CI runs Node build, lint, and tests (`npm run check`). |
| Prototype persistence | **Versioned local JSON file** | One-process server snapshot for the shared clock and player records; no DB or multi-process coordination. |
| Future persistence candidate | **PostgreSQL** | Not configured or connected; evaluate before production persistence. |

Versions above are project baselines, not proof every platform export has been validated. Godot 4.7.2 is the project target, but the engine binary is unavailable in the current workspace; neither Stage 1 nor the Stage 2 Godot client has been runtime-tested here. Node 22.22.3 is the available/tested runtime baseline.

## Requirements assessment

| Requirement | Assessment and decision |
|---|---|
| Free/open source and low cost | Godot is MIT-licensed; Node.js, TypeScript, npm tooling, and the future PostgreSQL option are open source. Self-hosting is possible. Hosting, app-store fees, and operations still have real costs. |
| Cross-platform, mobile, and PC | Godot provides desktop and Android/iOS export paths. The standard WebSocket protocol is intended to work with native clients and a browser WSS proxy, but exports and deployment paths need separate testing. |
| Browser where practical | Godot web export is an optional target, not guaranteed parity. Browser memory, threading, graphics, origin checks, TLS, and proxy/networking need validation. No web export is included or tested. |
| Multiplayer and persistence | Stage 2 now has a bounded server-authoritative prototype over JSON WebSocket, with a single local JSON state file. It is not a production identity system, database, or distributed server architecture. |
| Small prototype that can evolve toward 3D | Godot supports quick GDScript iteration and both 2D/3D in the same project, avoiding an early engine migration if the prototype grows. |
| Maintainability and AI-agent compatibility | GDScript is the native client language; TypeScript gives explicit backend contracts and strict checks. Keep boundaries small to manage the two-language cost. |
| Scalability | No stack choice guarantees millions of concurrent lives. Start with one modular backend and one logical world; measure workloads and correctness before adding workers, partitions, replicas, or more languages. |

## Why Godot for the client

Godot is open source under the MIT license, has integrated 2D/3D tooling, supports GDScript with a short edit/test loop, and has export paths for desktop, Android, iOS, and web. The existing project keeps Stage 1 offline play while providing an optional Stage 2 client that sends intent to the backend and renders server presence/state.

The client is not the online simulation authority. Online position, money, inventory, needs, school outcomes, and world time come from server snapshots. The client transport uses Godot's `WebSocketPeer`; server rules and JSON contracts live in the separate TypeScript service.

### Trade-offs to keep visible

- Godot web exports have different performance, browser, threading, and networking constraints from native builds; browser hosting must proxy `/ws` to the backend and configure allowed origins.
- iOS builds/signing require Apple tooling and a suitable macOS environment; they cannot be fully produced or verified in this Linux workspace.
- The current online identity is an anonymous prototype recovery key plus bearer token stored in a local `ConfigFile`, not a user account or encrypted credential system.
- A very large online simulation is not delivered by choosing an engine. Backend authority, durable data, safety, operations, and measured scaling remain separate work.

## Why Node.js and TypeScript for the backend

Node.js is available in the environment, can be self-hosted cheaply, and has a broad ecosystem. TypeScript's types make contracts and domain boundaries easier to inspect. The built-in HTTP server retains the small Stage 0 API surface; the `ws` dependency handles the Stage 2 WebSocket endpoint. The `ws` transport works with Godot's standard WebSocket client and can be proxied as WSS for browser clients.

This is an initial service boundary, not a guarantee that every future CPU-intensive simulation should run in one Node process. Stage 2 assumes a single process owns one state file. Split workloads only when profiling, load tests, durability, and ownership boundaries justify it; any workers must still preserve one canonical logical Nigeria.

## Future persistence and operations direction

PostgreSQL is the leading candidate for durable shared state and relational constraints, but no production DB is configured. The current `world-state.json` file is versioned, size-bounded, and atomically replaced for a single server process. It stores prototype personal character records and one shared clock; it has no transaction log, multi-writer coordination, migrations, backups, or encryption. It is not a production persistence design.

Geographic support (for example, a spatial extension) should be selected only after source datasets, query patterns, hosting cost, and portability are evaluated. Caches, queues, analytics stores, and separate simulation workers are later decisions.

## Environment variables and secrets

The Node API reads `PORT` (default `3000`), `DATA_FILE`, `WS_PATH` (default `/ws`), and `ALLOWED_ORIGINS` (comma-separated exact HTTP(S) origins for browser clients). The root `.env.example` is a safe template; `.env` is ignored by Git. `DATA_FILE` relative paths resolve from the `services/world-api/` workspace.

The native Godot client reads `NAIJA_WS_URL` (default `ws://127.0.0.1:3000/ws`). `NAIJA_MULTIPLAYER_SESSION_PATH` optionally selects a separate local session config, primarily for two-client testing. Do not put production credentials, tokens, private keys, or personal data in the repository. Future credentials should use a managed secret store or deployment environment.

## Primary references

- [Godot license](https://godotengine.org/license/) and [Godot export documentation](https://docs.godotengine.org/en/stable/tutorials/export/index.html)
- [Godot web export guidance](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- [Node.js 22 documentation](https://nodejs.org/docs/latest-v22.x/api/)
- [TypeScript documentation](https://www.typescriptlang.org/docs/)
- [PostgreSQL documentation](https://www.postgresql.org/docs/) (future candidate only)
