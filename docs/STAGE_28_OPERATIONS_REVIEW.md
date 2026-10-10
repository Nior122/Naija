# Stage 28 — Operations review: multi-process, TLS, credentials, metrics, backup

Status: **PARTIAL.** Each area below is marked with the evidence actually obtained. Every result here comes from
a local, disposable PostgreSQL 18.4 cluster (embedded binaries, `trust` authentication, loopback only) or from
pure code tests. **None of it is evidence about Neon or production.** The real-player data-loss conclusion remains
**UNKNOWN**.

## 1. Multi-process persistence (`test/multiprocess-persistence.test.mjs`)

Separate Node processes, each with its own `PostgresWorldStore`, against the disposable cluster. SIGKILL is sent to
the real OS process.

| Test | Result | What it shows |
|---|---|---|
| Concurrent first open | PASS | Two processes opening a new world both load version 1; one row is created. |
| Fencing across processes | PASS | A stale process cannot save, reports unhealthy, and a restarted process loads the current state. |
| SIGKILL after a saved state | PASS | The saved state is recovered. |
| SIGKILL with an unsaved change | PASS | The unsaved change is not recovered. |
| SIGKILL while its save waits on a row lock | PASS, **observed outcome recorded** | See below. |
| Two processes saving at once | PASS | Exactly one save succeeds; the other is fenced. |

**Observed (not assumed):** a writer killed while its `UPDATE` waited on a row lock did **not** lose that update.
When the lock was released, PostgreSQL committed the orphaned statement; the recovered state was version 2 with the
blocked change applied. The killed process never received a reply. The test accepts either outcome only as a
recorded observation; this run committed. Consequence: a crash can produce a durable write the writer never
acknowledged. The state is still whole (snapshot-level), and a restart loads it. Nothing in this stage claims
exactly-once semantics.

**Mutation check:** removing the `version` condition from the compiled save statement fails the fencing test and the
two-process race test. The restored build passes all six.

**Limits:** one host, one local PostgreSQL, no network partition, no injected lost response, no load test. The
whole-snapshot write design (each save rewrites the world) is unchanged.

## 2. TLS and connection policy

Evidence level: **local verification PASS; Neon BLOCKED.**

- **Neon: BLOCKED.** The sandbox allows outbound traffic only to GitHub, npm, and PyPI hosts. No Neon endpoint was
  reachable and no Neon credentials were used. Nothing about Neon connectivity has been tested.
- **Local verified TLS: PASS** (`test/tls-verification.test.mjs`, 12 tests: 8 always run, 4 need
  `TLS_TEST_DATABASE_URL`). The disposable cluster was started with `ssl=on`, a certificate issued by a private test
  CA (not a public CA), and `localhost`/`127.0.0.1` as SANs. Results:
  - Default policy with the CA trusted via `NODE_EXTRA_CA_CERTS`: connects, `pg_stat_ssl.ssl = true`.
  - Default policy without the CA: refused with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. No plaintext fallback.
  - `DB_SSL_REJECT_UNAUTHORIZED=false`: connects encrypted (test-only escape hatch).
  - `DB_SSL=false`: connects in plaintext (local development only).
  - Mutation: setting verification to off in the built pool config fails 4 tests. Restored build: 12 of 12.
- **Pure policy tests (always run):** verified sslmodes accepted and stripped from the URL (so they cannot override the
  policy); `prefer`, `allow`, `no-verify`, unknown rejected; `sslmode=disable` requires `DB_SSL=false`; `DB_SSL=false`
  conflicts with a verified sslmode.
- **Credential redaction (tested):** configuration errors do not contain the password in the message or stack.

Limits of this evidence: `pg_hba` is `trust`, so authentication was not exercised. Only the local TLS path was
tested, not TLS versions or cipher choice, and not a publicly trusted certificate.

### Concerns (reported, not changed)

1. **`DB_SSL=false` is not limited to loopback.** The code accepts it for any host, which would send credentials and
   data in plaintext to a remote database. The policy says it is for the local test environment only, but the code
   does not enforce that. Proposed: refuse `DB_SSL=false` unless the host is loopback. This changes configuration
   behaviour, so it needs approval.
2. **No `DB_SSL_CA` option.** A private CA can be trusted only through `NODE_EXTRA_CA_CERTS`, which Node reads at
   startup. This is fine for a publicly trusted host such as Neon, but a private-CA deployment would need that
   variable set on the process.
3. **`sslmode=require` is accepted and upgraded** to certificate verification. This is stricter than libpq's meaning
   of `require`, and it is tested.

## 3. Password hashing and session credentials

Evidence level: **no password handling exists to verify.**

- No password hashing function exists in `src/`. There is no login flow.
- `accounts.password_hash` is `NOT NULL`, and `AccountRepository.create` accepts a caller-supplied hash, but nothing
  computes one. The Stage 27 note "password hashing is unverified" is replaced by this finding: **there is no password
  storage to verify.**
- Requirement for any future login: a memory-hard password KDF (scrypt or argon2id) with per-password salt and a
  reviewed work factor. A plain SHA-256 of a password must not be used. **Not implemented.**
- Session tokens: `randomBytes(32)`, base64url, stored as SHA-256 digests (`world-engine.ts`). This is acceptable
  for high-entropy bearer tokens, which are not passwords. Not a password hash.
- **Creation key (concern):** the creation key is supplied by the client and must match `^[a-f0-9]{64}$`. The server
  does not check its entropy. Presenting a matching key returns a new session token for the existing player, so the
  creation key works as a long-lived bearer credential. The server stores only its unsalted SHA-256 digest. The
  client that generates the key is not in this repository, so whether keys are random is **unverified**.

## 4. Metrics endpoints

Evidence level: **code review and tests of the renderer; no authentication exists.**

- `/metrics` (JSON) and `/metrics/prometheus` (text) are served on the same port as the game API, with **no
  authentication**.
- Contents are numeric operational values only: request and connection counts, memory, event-loop delay, CPU percent,
  players online, tick rate and duration, flush counts and durations, uptime. The renderer emits no player IDs,
  tokens, hostnames, or database details.
- Exposure: operational data is visible to anyone who can reach the port. Recommended: restrict these paths at the
  ingress, or require a bearer token from configuration. Neither is implemented. Changing this changes the endpoint
  contract, so it needs approval.

## 5. Backup and restore (`src/database/backup.ts`, `test/backup-restore.test.mjs`)

Evidence level: **disposable-data PASS; no operator path and no production backup evidence.**

- **Scope:** the `world_state` row only (the single JSON document the engine uses). The account, character,
  session, and region tables are not part of engine state (see `docs/STAGE_28_ACCOUNT_CHARACTER_DESIGN.md`) and are
  not in these backups.
- **Format:** `naija-world-backup` version 1, with `worldKey`, `stateVersion`, `exportedAt`, a SHA-256 digest of the
  canonical JSON of the snapshot, and the snapshot.
- **Export** reads one row and validates a copy with the engine's own `validateState`. It stores the row as
  stored, without normalising it.
- **Verify** checks format, key, state version, checksum shape, the checksum itself, then `validateState`. Any failure
  throws before anything is written.
- **Restore** inserts the verified snapshot under a new key with `ON CONFLICT DO NOTHING`. It never overwrites. If the
  key exists it fails with `backup_target_exists`.
- **Results:** 10 tests, 5 pure (canonical ordering, a valid backup, checksum mismatch, malformed fields, a snapshot
  the engine would refuse even with a correct checksum) and 5 live (export, verify, and restore reproduces the saved
  state; restore refuses to overwrite and leaves the target unchanged; a tampered file is refused with nothing written;
  a missing world gives a clear code; restore into a **second disposable database** that the test creates and drops,
  followed by opening the engine from it). All 10 pass against the disposable cluster. No leftover databases.
- **Mutation checks:** making restore overwrite fails the no-overwrite test; disabling the checksum fails the
  checksum and tamper tests. Restored build: 10 of 10.

Not covered: no command-line tool (deliberately, so no live-data operation exists without a reviewed step); no
scheduling; no encryption of backup files (a backup contains the full world state and must be handled as sensitive);
no off-site copy; no point-in-time recovery; **no Neon or provider backup/restore was tested**. `pg_dump` is not in the
sandbox's embedded PostgreSQL binaries, so no dump-format test was done.

## 6. What was NOT done (kept honest)

- Neon connectivity and any Neon-hosted TLS: BLOCKED.
- Production readiness: not claimed.
- Real-player data-loss conclusion: UNKNOWN.
- Engine wiring to account and character tables: NOT IMPLEMENTED (see the design document).
- Metrics authentication, the `DB_SSL=false` loopback restriction, and the creation-key policy: proposed, not
  implemented.
