# Stage 28: Configuration, environments, and safety rules

Status: **IN PROGRESS.** This document describes configuration behaviour that is implemented and covered by tests in
`services/world-api/test`. It is not evidence that a production or Neon deployment works. Neon is **BLOCKED** until it
is tested (see `docs/STAGE_28_NEON_RUNBOOK.md`).

## 1. Runtime environment (`NAIJA_ENV`)

`NAIJA_ENV` is **required**. The entry point (`dist/index.js`) refuses to start if it is unset or not one of:

| Value         | Use                                                                                             |
|---------------|-------------------------------------------------------------------------------------------------|
| `production`  | Deployed servers. PostgreSQL only, verified TLS only, metrics protected.                        |
| `development` | Local work. File persistence only when requested explicitly. Plaintext PostgreSQL only to loopback. |
| `test`        | Automated tests. Tests must use a temporary world file and never `data/world-state.json`.     |

`npm test` sets `NAIJA_ENV=test`. The local `npm run dev` script needs `NAIJA_ENV=development` in your own repository-root `.env` (the
only `.env` the server reads; see `.env.example`). Library code called without a value treats the environment as `production`, so local-only
options stay off unless the environment is named.

## 2. Variables

| Variable | production | development | test |
|---|---|---|---|
| `NAIJA_ENV` | required: `production` | required: `development` | required: `test` (set by `npm test`) |
| `DATABASE_URL` | **required** (`postgres://` or `postgresql://`) | optional | optional; live tests need it |
| `PERSISTENCE_BACKEND` | `postgres` or unset. **`file` is refused** | `postgres` or `file`. Unset with `DATABASE_URL` → `postgres`. Unset without it → **refused** | as development |
| `DATA_FILE` | not used for persistence | file mode only; default `data/world-state.json` | file mode only; **must be a temporary file** (the live file is refused) |
| `WORLD_STATE_WARN_PERCENT` | optional: strictly ascending integers from 1 to 99, for example `75,90` (default `75,90`). Invalid values stop startup and are not echoed | as production | as production |
| `NAIJA_IDENTITY_BUDGET` | optional: `enabled` or `disabled` (default `disabled`). **Not enabled in production until reviewed** (R4). Other values stop startup and are not echoed | `disabled` unless set | `disabled` unless set |
| `NAIJA_IDENTITY_LIMIT_PER_IP` | optional: integer 1–1000 (default `10`). Applies only when the budget is enabled. Validated always | as above | as above |
| `NAIJA_IDENTITY_LIMIT_GLOBAL` | optional: integer 1–100000 (default `100`). Applies only when the budget is enabled. Validated always | as above | as above |
| `NAIJA_IDENTITY_WINDOW_MINUTES` | optional: integer 1–1440 (default `60`). Rolling window. Applies only when enabled. Validated always | as above | as above |
| `DB_SSL` | `true` or unset. **`false` is refused** | `false` allowed to a **loopback** host only | as development |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` or unset. **`false` is refused** | `false` allowed (private test CA) | `false` allowed |
| `NAIJA_METRICS_ACCESS` | **required**: `token`, `ingress`, or `disabled`. `open` is refused | `token`, `ingress`, `disabled`, or `open` (default open) | as development |
| `NAIJA_METRICS_TOKEN` | required with `token`; at least 32 characters, no whitespace; never logged | optional with `token` only | as development |
| `NAIJA_ALLOW_DB_TESTS` | not used | `true` enables live database tests against a disposable database | `true` enables live tests |
| `TLS_TEST_DATABASE_URL`, `TLS_TEST_CA_FILE` | not used | test-only; local `ssl=on` server with a test CA | test-only |

Any other variable named in `.env.example` keeps its existing meaning. Unknown `NAIJA_ENV`, `PERSISTENCE_BACKEND`, or
`NAIJA_METRICS_ACCESS` values are refused, not defaulted.

Capacity: each successful save is measured against the 16 MiB world-state limit. Crossing a warning percentage logs one line per level. A save over the limit is refused with `world_capacity_reached`, and the previous file is kept. See `docs/STAGE_28_CAPACITY.md`. The metrics JSON reports `world.state_bytes_last_saved`, `world.state_limit_bytes`, `world.state_usage_ratio`, and `world.persisted_players`. The Prometheus output has the matching `naija_world_api_world_state_bytes`, `naija_world_api_world_state_limit_bytes`, `naija_world_api_world_state_usage_ratio`, and `naija_world_api_persisted_players` gauges.

## 3. Persistence rules (fail closed)

- **Production** requires `DATABASE_URL`. Without it the process exits before it listens. Production with
  `PERSISTENCE_BACKEND=file` is refused. DB_HOST alone does not satisfy the production rule.
- **Development and test** use file mode only when `PERSISTENCE_BACKEND=file` is set. With no backend and no
  `DATABASE_URL`, startup is refused with a message pointing to explicit file mode.
- **No automatic fallback.** A PostgreSQL connection failure, a missing schema, or an unmigrated database stops startup.
  It never switches to the JSON file. An unmigrated database is not ready: the schema version must match the code
  (`npm run db:migrate`).
- **Test isolation.** Under `NAIJA_ENV=test`, file mode requires an explicit state file that is not the live file.
  Symlinks to the live file are resolved and refused.

## 4. PostgreSQL connection rules

- **Verified TLS is the default.** Certificates are verified (`rejectUnauthorized: true`). `sslmode=verify-full`,
  `verify-ca`, and `require` are accepted and mapped to verification. They cannot weaken the policy.
- **`DB_SSL=false` (plaintext)** is allowed only when `NAIJA_ENV` is `development` or `test`, and only to the host
  `127.0.0.1` or any `127.0.0.0/8` address, `::1` (including `[::1]` and `::ffff:127.x.x.x`), or the name `localhost`.
  For `localhost`, the name is resolved **once**, before the pool is created. Every address returned must be loopback.
  The validated list is then pinned to every pooled socket, so the driver never asks the system resolver again for
  that connection. A later DNS change cannot redirect plaintext to another machine. Any other name, any remote
  address, a unix socket path, a comma-separated host list, or an empty host is refused.
- **Remote TLS is not pinned.** The name is passed to the driver, which uses it for certificate verification and
  SNI. A DNS change to another host cannot complete a verified handshake unless that host presents a certificate
  for the name. Tests: `test/plaintext-pinning.test.mjs`, `test/tls-hostname-binding.test.mjs`.
- **Redirect parameters are refused**: `PGHOSTADDR` in the environment, and `host` or `hostaddr` URL parameters.
  These could send a connection somewhere other than the host named.
- **`DB_SSL_REJECT_UNAUTHORIZED=false`** is allowed only in development and test. It never turns TLS off; the
  connection stays encrypted.
- **`sslmode=disable`** in `DATABASE_URL` requires `DB_SSL=false` and is subject to the loopback rule above.
- Errors name the rule. They never contain the connection string, user name, or password.

## 5. Metrics access (`/metrics`, `/metrics/prometheus`)

`/health` is not covered by this policy. It is needed by load balancers and contains no metric counters.

| Mode | Behaviour | Where it is allowed |
|---|---|---|
| `token` | Requires `Authorization: Bearer <NAIJA_METRICS_TOKEN>`. Missing or wrong token → **401** with no metric data. The token is compared as SHA-256 digests in constant time. | all |
| `ingress` | The application does **not** check access. The ingress or network **must** block these paths from the public internet. | production, development, test |
| `disabled` | Both paths return **404**. | all |
| `open` | No check. | development and test only |

**Production configuration.** Choose one of:

1. **Preferred: ingress or network restriction.** Set `NAIJA_METRICS_ACCESS=ingress` and configure the load balancer or
   reverse proxy to return 403/404 for `/metrics` and `/metrics/prometheus` from outside your monitoring network.
   The application cannot verify this; it is an operator declaration. Confirm it from outside the network before relying on it.
2. **Token authentication** where ingress restriction is not possible: `NAIJA_METRICS_ACCESS=token` and
   `NAIJA_METRICS_TOKEN` set from your secret store to a random value of at least 32 characters (for example,
   `openssl rand -hex 32`). Rotate by changing the value and restarting the server.
3. **Disabled**: `NAIJA_METRICS_ACCESS=disabled` if no monitoring needs the endpoints.

If none of these is configured in production, the server refuses to start. There is **no silent exposure** and no
default token.

**Monitoring-client requirements (token mode).**
- Send `Authorization: Bearer <token>` on every scrape. Prometheus example (check the syntax for your version):

  ```yaml
  scrape_configs:
    - job_name: naija-world-api
      metrics_path: /metrics/prometheus
      authorization:
        type: Bearer
        credentials_file: /etc/prometheus/naija-metrics-token   # file readable only by Prometheus
  ```
- Store the token in a file or secret store. Do not put it in a scrape URL, a dashboard query, or a log line.
- Expect 401 on a wrong or missing token. Treat 401 as a configuration error, not a reason to disable auth.
- The application never logs the token. Startup logs only the mode name, and a warning for `ingress`.

**Not claimed.** Ingress or network protection is not enforced by this code. It is verified only when the deployed
ingress configuration has been tested from outside. Token mode is tested locally (`test/metrics-access.test.mjs`).

## 6. Test commands

- `npm test` (in `services/world-api`): builds and runs with `NAIJA_ENV=test`. Skips database and TLS tests unless
  their variables are set.
- Live PostgreSQL tests: `DATABASE_URL=<disposable test database> NAIJA_ALLOW_DB_TESTS=true npm test`. The database name
  must contain `test`, and the tests write rows and apply migrations. Use a local or Neon **development** database only.
- Local TLS tests: add `TLS_TEST_DATABASE_URL=<local ssl=on test database>` and `TLS_TEST_CA_FILE=<test CA PEM>`.

## 7. Limitations (keep with every report)

- Local PostgreSQL results are not proof that Neon or production works.
- Local private-CA TLS does not prove Neon's certificate chain.
- Fencing tests cover separate processes and SIGKILL. A killed process may not know whether its last save committed;
  this is not exactly-once.
- Backups hold the full world state, are unencrypted, and have no operator CLI. Backup tests use disposable databases.
- Historical real-player data loss remains **UNKNOWN**.
- Account and character tables are not wired to the engine. The engine persists one JSON/JSONB world document.
- Load testing and deployment-platform testing are incomplete. Production readiness is **not** claimed.
