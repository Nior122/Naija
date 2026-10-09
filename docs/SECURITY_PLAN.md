# Security and Safety Plan

Security and player safety are foundational constraints. Stage 2 adds a **bounded local multiplayer prototype**, and Stages 4–6 extend its server authority to education, life and careers; none of this is a public-ready service. Godot runtime behavior—including the new career UI—has not been verified here. Do not expose the prototype to untrusted networks or treat its identity, persistence, or abuse controls as production security.

## Prototype controls currently implemented

- **Server authority:** online characters and outcomes are server-owned. The server accepts movement intent rather than coordinates and validates profile choices, bounds/ranges, travel targets, shop prices, money, inventory, needs, school results, life actions, career eligibility, applications, work sessions, salary, progression and nearby interactions. Career clients cannot supply their own age, credentials, hours, performance, salary, employment status, or outcomes.
- **Identity/session prototype:** the server assigns player IDs and accepts a random recovery key or saved bearer token. It stores SHA-256 hashes of the token and recovery key, rejects a second active connection for the same player, and can recover an identity using the key. This is not an account provider, password system, or full authentication lifecycle.
- **Payload/resource bounds:** JSON WebSocket messages are capped at 8 KiB. Commands and chat have per-connection rate limits; movement is throttled; socket count and connection attempts are bounded; repeated malformed/unknown messages are closed. State files are limited to 16 MiB.
- **Replay handling:** successful state-changing commands require request IDs and recent IDs are retained with a per-player cap. This prototype cache is bounded, not an immutable transaction log.
- **Career action boundary:** `career.action` binds requests to the authenticated character and uses the existing request-ID deduplication. Career profiles, applications, work sessions, performance and salary records are returned only in that character's session; they are excluded from public presence/world rows. Employer termination and professional registration are not exposed over the player protocol.
- **Payroll adapter:** salary payment IDs and session settlement records are de-duplicated before crediting the existing character balance. This is only a prototype adapter and JSON snapshot, not an atomic production ledger or a second economy.
- **Browser upgrade policy:** if a WebSocket request has an `Origin`, it must exactly match `ALLOWED_ORIGINS`. The default allowlist is empty. Native clients without an `Origin` header are accepted. Origin validation is a browser-origin control, **not authentication**.
- **Persistence boundary:** player records, shared clock, Stage 5 lifecycle maps and Stage 6 career/payroll maps are saved in schema-version-3 JSON through a temporary-file rename. Supported schema-version-1/2 records migrate while retaining existing state. The default data directory is Git-ignored. The server does not store raw session/recovery secrets in that file.
- **Logging:** connection/disconnection, identity persistence failures, request failures, and safe error codes are logged; secrets and message contents are not intentionally logged.

## Known security limitations

- The user identity is anonymous and client-held. The client `ConfigFile` stores the bearer token and recovery key in plaintext under `user://`; these are sensitive. There are no user accounts, provider-backed authentication, authorization roles, credential revocation workflow, token expiry, or supported account recovery. The careers prototype has no employer/credentialing identity or authorization roles; termination/licensing helpers are internal and must not be exposed to player clients.
- The server JSON contains personal character/household/lifecycle/career data in plaintext. There is no encryption at rest, access-control policy, retention/deletion/export path, backup/restore service, database transaction log, or multi-process locking. Private career profile shaping reduces protocol exposure; it is not storage encryption or a production privacy boundary.
- The server has no TLS termination. The native default is plain `ws://127.0.0.1:3000/ws`. For non-loopback traffic, use a trusted TLS-terminating proxy and WSS, restrict network access, set browser origins exactly, and protect the data directory. The repository does not contain a deployment profile.
- Browser-origin checks do not protect non-browser clients and do not establish identity. Chat has no content moderation, profanity filter, report/block workflow, or privacy setting. Presence position, location, name, and appearance are visible to connected prototype clients.
- Movement limits direction, sequence, input frequency, speed, and map bounds, but does not validate wall collisions or pathfinding. The career payroll adapter credits the prototype character balance; there is no canonical ledger, economy fraud analysis, tax/transfer controls, or production transaction isolation. Stage 7 must replace this seam before wages become valuable state.
- Rate limits and socket limits are process-local. They are not distributed abuse controls and do not guarantee capacity or availability.
- Logs are not an audit/event ledger. There is no tamper-resistant history, incident response, operational monitoring, or privacy/legal review for a public service.

Treat all online characters, household data, messages, session files, and logs as sensitive prototype data. Use only local/test data until privacy, safety, retention, and access-control requirements have been reviewed. Never commit server state, real credentials, player data, or client session configs.

## Requirements before public multiplayer or valuable state

- **Authentication and recovery:** integrate a maintained identity provider or well-reviewed account system; define account linking, token expiry/rotation/revocation, secure recovery, session theft response, and age-appropriate account flows. Never invent or store plaintext passwords.
- **Authorization and privacy:** check ownership, role, jurisdiction, visibility, and action permissions server-side for every protected request. Define per-field presence visibility, data minimization, consent, retention, export, deletion, and minor safety requirements.
- **Transport and deployment:** enforce HTTPS/WSS at the public boundary, restrict origins and network access, add deployment-specific security headers and secret management, and rehearse credential rotation.
- **Server authority / anti-cheat:** extend validation to collisions, world geometry, state transitions, ownership, replay, timing, and abuse. Define a threat model; avoid invasive device surveillance and document privacy limits.
- **Economy integrity:** use durable ledger-like records, atomic transfers, constraints, reconciliation, fraud review, and audited administrative actions. Do not write balances directly from client requests.
- **Rate limiting and resource safety:** add distributed rate limits, queue/CPU/memory budgets, payload and expensive-query bounds, retry/circuit-breaker rules, connection admission, and monitoring.
- **Auditability:** record actor, action, target, time, outcome, and correlation ID for consequential changes, with access control, retention limits, and tamper resistance. Keep secrets and private message contents out of routine logs.
- **Moderation and reporting:** design age-appropriate community standards, reporting/appeal workflows, block/mute, moderator permissions, escalation, and evidence-retention rules before user-generated content is public.
- **Durability and recovery:** adopt a database, versioned migrations, encrypted access-controlled backups, tested restores, recovery objectives, failure handling, and documented ownership.
- **Safety and legal review:** assess the implications of minors, identity, household, chat, economy, civic systems, and justice-related data with appropriate experts before collecting real or sensitive personal data.

## Stage 1 and API boundaries

- The Stage 1 local save is device-local JSON, unencrypted and user-controlled; it is not an account credential or online authority. Its Godot save/load behavior is not runtime-verified in the current workspace.
- `GET /health` and `GET /api/v1/world` expose non-personal service/world metadata. HTTP write methods remain rejected. The separate WebSocket endpoint is the Stage 2 prototype authority and does not make the HTTP metadata endpoint writable.

These controls are not a substitute for production security review. See [`MULTIPLAYER_PLAN.md`](MULTIPLAYER_PLAN.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).
