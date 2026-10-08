# Technology Stack

## Decision summary

| Layer | Selected direction | Current use |
|---|---|---|
| Game client | **Godot 4.7.2 stable + GDScript** | Minimal Stage 0 title/foundation scene only. |
| Backend foundation | **Node.js 22.x + TypeScript 5.9** | Small read-only HTTP API; Node's built-in `http` module avoids a framework commitment. |
| Package management | **npm workspaces + lockfile** | Root scripts for build, test, lint, and development. |
| Testing | **Node.js built-in test runner + `fetch`** | Integration checks for the API routes. |
| Linting | **ESLint 10 + typescript-eslint 8** | TypeScript service source. |
| Source control / automation | **Git + GitHub Actions** | A CI workflow runs Node build/lint/tests. |
| Future persistence candidate | **PostgreSQL** | Planned only; no database is created or connected in Stage 0. |

Versions above are the project baseline, not a claim that every platform export has been validated. Godot 4.7.2 was the latest stable release checked when this foundation was created; Node 22.22.3 is the available/tested runtime baseline.

## Requirements assessment

| Requirement | Assessment and decision |
|---|---|
| Free/open source and low cost | Godot is MIT-licensed; Node.js, TypeScript, npm tooling, and the planned PostgreSQL option are open-source. Self-hosting is possible. Hosting, app-store fees, and operations will still have real costs. |
| Cross-platform, mobile, and PC | Godot provides a single client project with desktop and Android/iOS export paths. Platform-specific packaging/signing still needs each platform's toolchain and testing. |
| Browser where practical | Godot web export is available, but browser memory, threading, graphics, and networking differ from native. Treat web as an optional validated target, not a guaranteed equal client. |
| Multiplayer and persistence | Neither a client engine nor an engine's multiplayer helper is sufficient for a shared persistent world. A separate server-authoritative API/domain layer and durable storage are required; the current Node service is only a testable starting boundary. |
| Small prototype that can evolve toward 3D | Godot supports quick GDScript iteration and both 2D/3D in the same project, avoiding an early engine migration if the prototype grows into stylized 3D. |
| Maintainability and AI-agent compatibility | GDScript is the native client language; TypeScript gives explicit backend contracts. Both use standard editor/test tooling and are easy to inspect in a small repository. Keep boundaries small to manage the two-language cost. |
| Scalability | No stack choice guarantees millions of concurrent lives. Start with one modular backend and a single logical world; measure workload and correctness before adding workers, partitions, replicas, or more languages. |

## Why Godot for the client

The project needs to begin with a small game and retain a credible path to stylized 3D on desktop and mobile. Godot is open source under the MIT license, has integrated 2D/3D tooling, supports GDScript with a short edit/test loop, and has export paths for desktop, Android, iOS, and web. Its editor and project format are relatively approachable for future contributors and coding agents.

The client is not the authoritative simulation host. Game state and player commands must ultimately be validated by server-side services. This keeps the game client replaceable and prevents a rendering engine's networking model from defining the logical world.

### Trade-offs to keep visible

- Godot web exports have different performance, browser, threading, and networking constraints from native builds. Browser support must be tested as a separate target; it is not promised by the Stage 0 shell.
- iOS builds/signing require Apple tooling and a suitable macOS environment. They cannot be fully produced or verified in this Linux workspace.
- Native Godot multiplayer transports and browser-compatible transports differ. The future game protocol should be transport-independent and use an appropriate WebSocket/WebRTC path for web clients where needed.
- A very large online simulation is not delivered by choosing an engine. Backend authority, data consistency, content pipelines, operations, and measured scaling remain separate engineering work.

## Why Node.js and TypeScript for the initial backend boundary

Node.js is available in the environment, can be self-hosted cheaply, and has a broad ecosystem and strong AI-agent familiarity. TypeScript's types make API contracts and domain boundaries easier to inspect and refactor. Node is effective for an initial network/API layer, while the Stage 0 service deliberately uses the built-in HTTP server to keep dependencies and framework decisions small.

This is an initial service boundary, not a guarantee that every future CPU-intensive simulation will run in one Node process. Start with a modular backend and split workloads only when profiling, load tests, and ownership boundaries justify it. If later simulation workers need another language, introduce them behind explicit, versioned contracts.

## Alternatives considered

- **Unity:** broad platform reach and mature tooling, but proprietary licensing/terms and cost exposure are less aligned with the open, low-cost preference. It remains an alternative only if a later, evidence-based evaluation changes the requirements.
- **Unreal Engine:** strong high-end 3D capabilities, but heavier hardware/build workflows and a less suitable starting cost/complexity profile for a small mobile-first prototype.
- **Browser-first engines/frameworks:** convenient web delivery, but packaging and performance trade-offs for native mobile/PC 3D are less attractive than a game-engine client for this vision.
- **Godot C#:** viable for teams preferring C#, but GDScript gives the smallest engine setup and avoids tying the client to a runtime that is not supported on every Godot export target in the same way. Backend code is separately typed in TypeScript.

## Future persistence and operations direction

PostgreSQL is the leading open-source candidate for durable shared state and relational constraints. Geographic support (for example, a spatial extension) should be selected only after source datasets, query patterns, hosting cost, and portability are evaluated. Caches, queues, analytics stores, and separate simulation workers are future decisions; none are required or installed for Stage 0.

## Environment variables and secrets

The API reads `PORT` (default `3000`). The root `.env.example` is a safe local template; `.env` is ignored by Git and loaded by the Node start/dev scripts. Do not put production credentials, tokens, private keys, or personal secrets in the repository. Future credentials should be provided through a managed secret store or the deployment environment.

## Primary references

- [Godot license](https://godotengine.org/license/) and [Godot export documentation](https://docs.godotengine.org/en/stable/tutorials/export/index.html)
- [Godot web export guidance](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- [Node.js 22 documentation](https://nodejs.org/docs/latest-v22.x/api/)
- [TypeScript documentation](https://www.typescriptlang.org/docs/)
- [PostgreSQL documentation](https://www.postgresql.org/docs/) (future candidate only)
