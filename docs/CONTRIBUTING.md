# Contributing

Naija: One World is a long-term project. Keep changes small, testable, documented, and consistent with the current roadmap phase. The repository and its status file are the persistent source of truth; do not assume an idea in a plan is already implemented.

## Before changing code

1. Read `README.md`, `docs/GAME_VISION.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, and `docs/DEVELOPMENT_STATUS.md`.
2. Inspect the existing source, tests, Git status, and current branch. Preserve user changes and working systems.
3. Confirm the requested change belongs to the current phase. Ask before broadening scope when a requirement is ambiguous.
4. Check whether an existing module/API should be extended rather than replaced.

## Development setup

- Use Node.js 22.13+ in the 22.x line (`.nvmrc` records the tested version) and npm.
- Run `npm ci`, then `npm run check` from the repository root.
- Install Godot 4.7.2 stable to open `game/project.godot`. Godot engine validation is separate from the Node `npm run check` command.
- Use `.env.example` only for safe local configuration. Never commit `.env`, tokens, private keys, passwords, or production credentials.

## Change guidelines

- Keep domain rules out of UI and transport glue. Clients request actions; authoritative server modules validate them.
- Add focused tests for changed behavior and update API/schema documentation when contracts change.
- Do not introduce a database, third-party service, framework, large data import, or platform-specific dependency without a documented reason and a Stage 0/roadmap scope fit.
- Avoid speculative abstractions and empty directories for future systems.
- Do not silently alter the one-logical-Nigeria invariant, world identity, or persistence semantics.
- Treat Nigerian cultural/geographic data with provenance, license review, and respectful regional representation.
- Keep generated builds, caches, exports, and datasets out of Git unless a deliberate asset decision says otherwise.

## Git workflow

- `main` is the integration line; changes should be reviewed through a pull request in normal project collaboration.
- Use focused commits with clear intent (for example, `stage-0: establish game foundation and architecture`). Do not commit unrelated generated output or secrets.
- Run `npm run check` before proposing Node/API changes; run the Godot headless smoke check when the engine is available and the client changes.
- Update `docs/DEVELOPMENT_STATUS.md` whenever actual project capability, tests, known limitations, or the next stage changes.
- Do not force-push shared branches or rewrite history without explicit coordination.

## Definition of done

A change is done when its behavior matches the requested scope, relevant tests/checks pass (or limitations are stated precisely), documentation/status are current, secrets are absent, and the working tree is left coherent.
