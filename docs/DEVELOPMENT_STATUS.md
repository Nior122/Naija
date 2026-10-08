# Development Status

> **Future AI agents: read this file before modifying the project.** It records implementation and verification separately; source code alone is not proof of runtime behaviour.

## Current stage

**Stage 1 — First Playable Prototype: implementation is present, runtime verification is pending.** Stage 0 foundations remain in the repository. The Godot engine is not installed in the current workspace, so the game and its Godot test scripts have not been run. Do not describe the prototype or save/restart flow as verified until those checks pass in Godot.

## Stage 0 foundation retained

- `services/world-api/` is the original minimal Node.js/TypeScript API foundation.
- It still exposes only `GET /health` and `GET /api/v1/world`, with a static descriptor for the single logical world `nigeria-main`.
- It has no write routes, authentication, gameplay authority, database, or persisted world state; the Godot prototype does not call it.
- Stage 0 vision, architecture, roadmap, security, database, multiplayer, world/time, and contributor documents remain in place.

## Stage 1 implementation present (not runtime-verified)

- `game/project.godot` now starts `res://scenes/prototype.tscn` at a 1280 × 800 viewport. The pre-existing Stage 0 scene is preserved.
- Character creation offers a name, ages 15–16, a simple character type, skin-tone, hairstyle, and clothing choices. A local character model carries identity, household/home, location, money, needs, inventory, education, academic records, and a placeholder reputation value.
- New lives receive a procedurally generated family/guardian household, small starter inventory, and a 5,000 Naira starting balance.
- The 2D world is the fictional **Idera Quarter** and contains a home/interior, streets, school yard/classroom, shop, clinic, police station, and community hall. Locations and interactable drawings are authored procedurally in GDScript; no national map data or third-party game art is used.
- The player controller supports keyboard walking/running, map bounds, avatar appearance, camera following, and nearby-interaction targeting.
- NPC dialogue is reusable and separate from player movement. The prototype includes family, neighbours, school students/teacher, shopkeeper, nurse, officer, and community characters.
- School has a small timetable, short choice-based lesson activities, subject averages, and attendance records.
- Hunger, energy, health, Naira spending, a reusable item list, a simple shop, rest, a local clock, daypart tinting, HUD, profile/school/inventory/save menus, and modal clock pause are represented in the slice.
- `game/scripts/services/save_service.gd` implements a version-1 local JSON save at `user://naija-stage1-save.json`, with load validation. The game code requests autosaves and offers manual save/load. These paths are **not runtime-verified**.
- Test harnesses are present: domain checks, movement checks, and a two-process save/restart checkpoint. They have not been run in Godot.
- Asset notes are in [`ASSETS.md`](ASSETS.md).

## Current architecture

```text
Godot 4.7.2 / GDScript client
  ├── prototype domain/services/world/UI (single-player local slice)
  └── local versioned JSON under user:// (implementation present; unverified)

Node.js 22.x / TypeScript API
  └── GET /health and GET /api/v1/world only; separate and not connected

Future server-authoritative gameplay + durable persistence: not implemented
```

The Stage 1 local prototype does not create additional world copies or change the canonical architecture: the future game still represents **one logical Nigeria** (`nigeria-main`). Idera Quarter is one small fictional, offline prototype setting, not a partition, server shard, or geography claim. The client save is local character data, not a shared authoritative-world database.

## Technology baseline

| Component | Baseline | Verification state |
|---|---|---|
| Node.js | 22.22.3 workspace runtime; declared `>=22.13 <23` | `npm run check` passed during this Stage 1 work. |
| npm | 10.9.8 workspace baseline | Existing lockfile/workspaces used. |
| TypeScript | 5.9.3 | Compiled by `npm run check`. |
| ESLint | 10.12.0; typescript-eslint 8.71.1 | Passed on the Node service. |
| Godot | 4.7.2 stable project target | No engine binary available; project import, launch, and GDScript runtime tests not run. |
| GDScript tools | gdtoolkit 4.5.0 in a temporary `/tmp` virtual environment | `gdformat --check` and `gdlint` passed for 14 scripts; these are static checks only. |
| PostgreSQL | Future candidate only | Not installed, configured, or connected. |

## How to run

From the repository root, with Node.js 22.13+ and npm:

```sh
npm ci
npm run dev
```

The API listens on `0.0.0.0:3000` by default. Copy `.env.example` to `.env` to override `PORT`. It remains read-only.

To open the prototype with Godot 4.7.2:

```sh
godot --path game
```

## How to test

Node API checks, run from the repository root:

```sh
npm run check
```

Godot import/domain/movement checks, when Godot is installed:

```sh
godot --headless --editor --path game --quit
godot --headless --path game --quit
godot --headless --path game --script res://tests/domain_smoke.gd
godot --headless --path game --script res://tests/player_movement.gd
```

The save persistence test must be run as **two separate processes**, with the writer fully exited before the reader starts:

```sh
godot --headless --path game --script res://tests/save_restart.gd -- write
godot --headless --path game --script res://tests/save_restart.gd -- read
```

If gdtoolkit is installed, run static parsing/formatting/lint checks from the repository root:

```sh
gdformat --check $(find game -name '*.gd' -print)
gdlint $(find game -name '*.gd' -print)
```

## Verification performed for this Stage 1 work

- `npm run check` — **passed**: ESLint, TypeScript build, and all 4 Node API integration tests.
- `gdformat --check $(find game -name '*.gd' -print)` — **passed**: 14 GDScript files parsed and formatted.
- `gdlint $(find game -name '*.gd' -print)` — **passed**: no GDScript lint findings.
- `git diff --cached --check` — **passed** on the full staged diff after the final source/docs review.
- `godot --headless --path game --quit` — **blocked** with `godot: command not found`; no Godot executable is installed. Project import and launch were not run.
- `domain_smoke.gd` — **not run**; it is a test harness, not a passed result.
- `player_movement.gd` — **not run**; it is a test harness, not a passed result.
- `save_restart.gd` write/read in separate Godot processes — **not run**. Save/load and restart persistence therefore remain unverified.
- Manual play/visual review and desktop/mobile/web exports — **not run**.

## Known limitations and risks

- GDScript parser/linter checks do not perform Godot type analysis, import the scene, simulate input/physics, or prove that drawing/UI/resource APIs run correctly. A live engine check is a release gate.
- The app itself has not been launched here. UI sizing, focus, keyboard controls, world travel, school interactions, and the day-to-day loop need manual review in Godot.
- Although a versioned local JSON save/load service, autosave hooks, and restart test are implemented, they are untested in the engine and can still have runtime or data-validation issues. This is not production/cloud persistence and is not encrypted or authoritative.
- The local starting balance and economy are a prototype; there is no ledger, account, server authority, or transaction audit.
- Reputation is currently a basic model field without a simulation or progression rule. Education, home, school, and NPC data are simplified prototype data, not official records or a real Nigerian dataset.
- The world is a few drawn interiors and outdoor areas. Collision/navigation, activities, NPC autonomy, accessibility, localization, art/audio, and edge cases are minimal or absent.
- There is no authentication, multiplayer, backend gameplay connection, durable shared-world database, full Nigeria geography, production operations, or service-to-client synchronization.
- No PC, Android, iOS, or browser build has been exported or tested. The CI workflow still checks only the Node/TypeScript foundation.
- The earlier Godot release-binary download attempt was blocked while connecting to `objects.githubusercontent.com`; the engine could not be installed in this environment.

## Next steps / Stage 1 exit gate

Do not start Stage 2 until the prototype has been imported, launched, and reviewed with Godot 4.7.2. Run all three Godot scripts above, including both `save_restart.gd` phases in separate processes, fix engine/runtime failures, and manually verify character creation, movement, interactions, school attendance/performance, needs, save/load after process restart, and the opening layout. Update this file with exact results only after those checks.

Once Phase 1 is demonstrated and reviewed, the next planned roadmap slice is Stage 2 as defined in [`ROADMAP.md`](ROADMAP.md). Continue to defer full Nigeria geography, multiplayer, authentication, production persistence, and later-life systems until their planned phases.
