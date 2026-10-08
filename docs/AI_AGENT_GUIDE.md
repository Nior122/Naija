# AI Agent Guide

This project is intended to continue across many coding sessions. A future agent must establish the current state from the repository before acting; conversation history is not the project's durable specification.

## Required reading order

1. Read [`README.md`](../README.md).
2. Read [`GAME_VISION.md`](GAME_VISION.md).
3. Read [`ROADMAP.md`](ROADMAP.md).
4. Read [`ARCHITECTURE.md`](ARCHITECTURE.md).
5. Read [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).
6. Read any focused plan relevant to the requested work (technology, database, multiplayer, world, security, contributing).

Then inspect the existing source code, tests, Git status, current branch, and recent changes before editing.

## Non-negotiable working rules

- **The repository is the persistent source of truth for the project.** Update it when implementation status or decisions change.
- Never delete working systems or user changes without a clear, justified need. Prefer small extensions over rewrites.
- Never rebuild the project from scratch merely because a clean implementation seems easier.
- Complete only the requested stage and scope. Vision items and roadmap entries are not permission to implement future systems early.
- Preserve the invariant that the game represents one logical Nigeria. Infrastructure partitions are not separate worlds.
- Treat the client as untrusted; do not place authoritative economy, identity, election, legal, or shared-world state in the client.
- Never add credentials, tokens, private keys, passwords, or personal secrets to code, docs, test fixtures, commits, or logs.
- Do not claim a command, engine, platform, service, or test works unless it was actually run and its outcome is known.

## Required completion steps

1. Implement the smallest maintainable change that satisfies the requested scope.
2. Add or update focused tests; run the relevant build, lint, and test commands.
3. Run platform/engine checks when the required tooling is available. If it is unavailable, state exactly what was not verified and why.
4. Update user-facing documentation and `DEVELOPMENT_STATUS.md` with actual completed work, current limitations, and a concrete next stage.
5. Review `git diff`, `git diff --check`, and `git status`; verify no generated artifacts or secrets are included.
6. Commit the intended changes with a meaningful message, then push to the authorized session branch/remote in accordance with the repository and session rules. Verify the branch and remote commit; never push to an unauthorized branch or claim success until verified. If authentication or repository configuration blocks the push, report the exact blocker without requesting or exposing credentials.
7. Leave the repository in a working, understandable state.

## Handoff discipline

Do not use the status file to describe aspirations as completed capabilities. Link to detailed plans for future behavior, record commands and versions actually tested, and call out unresolved decisions. Keep the next-step scope small enough for another agent to start immediately.
