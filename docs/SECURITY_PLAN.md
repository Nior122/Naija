# Security and Safety Plan

Security and player safety are foundational constraints, but Stage 0 implements only a static read-only API. There is no authentication, authorization, database, player content, public multiplayer, or anti-cheat system yet.

## Requirements before multiplayer or valuable state

- **Authentication:** use a maintained identity provider or well-reviewed authentication implementation; protect sessions, credentials, recovery, and account linking. Never invent or store plaintext passwords.
- **Authorization:** check ownership, role, jurisdiction, and action permissions on the server for every protected request. Hiding a button is not authorization.
- **Server authority:** clients submit intent. Validate identity, payload schema, ranges, state transitions, timing, ownership, and invariants server-side. Ignore client claims about currency, items, age, votes, evidence, or results.
- **Anti-cheat / exploit prevention:** use server-side validation, idempotency, abuse detection, rate limits, replay protection where applicable, integrity checks, and careful economy design. Avoid invasive device surveillance; define threat model and privacy limits.
- **Rate limiting and resource limits:** bound request rates, payload sizes, expensive queries, concurrent sessions, and retries; return safe errors without leaking internals.
- **Economy integrity:** ledger-like durable records, atomic transfers, deduplication keys, balance/ownership constraints, fraud review, reconciliation, and audited administrative actions. No direct client balance writes.
- **Auditability:** record actor, action, target, time, outcome, and correlation ID for consequential changes, with access control and retention limits. Protect logs from secrets and tampering.
- **Moderation and reporting:** create age-appropriate community standards, reporting and appeal workflows, moderator permissions, escalation, evidence-retention rules, and safety/privacy review before user-generated content.
- **Backups and recovery:** encrypted, access-controlled backups; tested restore procedures; recovery objectives, migration recovery, incident response, and documented ownership.
- **Privacy and data minimization:** collect only what is needed; classify data; control access/retention/export/deletion; consider legal duties and minors' safety. Sensitive life, message, justice, and identity data need stronger controls.

## Stage 0 controls

- The API has no write route; non-GET methods return `405`.
- Responses use JSON, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.
- No credentials or secret values are required. Local `.env` files and common credential files are ignored by Git.
- The world descriptor is static metadata; it does not expose personal data or authoritative simulation state.

These controls are not a substitute for production security review. Before public exposure, add HTTPS at the deployment boundary, security headers appropriate to the full client, request logging without sensitive data, rate limiting, dependency review, threat modeling, and operational monitoring.
