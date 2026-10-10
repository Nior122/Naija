# Stage 28 Tasks 6 and 7: Production Boundary, Identity Budget, and Neon Status

Status: **Stage 28 remains OPEN.** Production topology and Neon are **BLOCKED**. This document records what was
checked and what evidence is missing. It does not infer production topology from local tests, and it does not claim
that Neon was tested. R4 stays disabled in production.

## 1. Task 6: deployment configuration in the repository

### 1.1 What the repository contains

| Search | Result |
|---|---|
| Deployment, container, hosting, ingress, load-balancer, and orchestration files (`Dockerfile`, compose files, `fly.toml`, `render.yaml`, `Procfile`, `k8s`, `helm`, `terraform`, `nginx`, `caddy`, `ingress`, `cloudbuild`, `vercel`, `netlify`, `app.yaml`, `serverless`, and `deploy` names) | **None tracked.** The only match is `.github/workflows/ci.yml`. |
| `.github/workflows/ci.yml` | Runs `npm ci` and `npm run check` (lint and tests) on `ubuntu-24.04`. **No deploy job. No database or TLS suite in CI.** |
| `.env.example` | Describes production expectations (PostgreSQL only; verified TLS; metrics protected). It is an example, not a deployment. |
| `.env` (local) | Absent in this sandbox. Not read. |

**Result: production topology, ingress, load balancer, number of instances, and proxy chain are BLOCKED.** The
repository does not define them.

### 1.2 Evidence needed to unblock

- The platform configuration that deploys the API (for example, a service definition or manifest), committed or
  described in a reviewed document.
- Ingress or load-balancer rules, showing which paths (`/metrics`, `/metrics/prometheus`) are blocked from the public
  internet, and which headers are set (`X-Forwarded-For`), by which hop.
- The number of API processes, and whether they share state. Stage 26 and 27 documents state that multi-instance
  operation is NOT IMPLEMENTED. Multi-process fencing is tested only in one process (`docs/STAGE_28_OPERATIONS_REVIEW.md`).
- The list of trusted proxy addresses for `NAIJA_TRUSTED_PROXIES` (currently empty by default), and the proof that
  only those addresses can reach the API.
- Where the production database runs, and whether it is reachable only over verified TLS.

### 1.3 Checks executed now (configuration reader only, no network, no database connection)

The config reader was run with `NAIJA_ENV=production` and placeholder values. The database host is a placeholder
(`db.example.invalid`) and no password is used. These results describe the validation code, not any deployed environment.

| Input | Result |
|---|---|
| Production, `NAIJA_METRICS_ACCESS` not set | **Rejected**: "NAIJA_METRICS_ACCESS is required in production: token, ingress, or disabled." |
| Production, `token` mode, token of 5 characters | **Rejected**: token must be at least 32 characters with no whitespace. |
| Production, `ingress` mode | **Accepted**. Metrics access `ingress`. Identity budget disabled. Trusted proxies 0. |
| Production, `PERSISTENCE_BACKEND=file` | `readApiConfig` **accepts** it (see note). |
| Same, through the real startup (`node dist/index.js`) | **Exit 1**: "PERSISTENCE_BACKEND=file is not allowed when NAIJA_ENV=production. Production requires PostgreSQL." No `data/` directory was created. |

**Note (low risk, recorded for review).** The file-backend refusal in production is enforced at startup, not in the
config reader. Startup refuses before listening, so the server does not run in that configuration. But the config
reader accepts it. A reviewer may want the same rule in both places.

### 1.4 Item status

| Check | Status | Evidence |
|---|---|---|
| Production requires PostgreSQL (fail-closed) | PASS (local, startup) | Startup exit 1 with file backend. |
| Production requires a metrics setting | PASS (local, config reader) | Rejected without a setting. |
| Metrics token rules | PASS (local, config reader) | Short token rejected. Tokens are not printed by these checks. |
| Ingress blocks `/metrics` from the public internet | **BLOCKED** | No ingress configuration in the repository. |
| R4 identity budget disabled in production | PASS by default (local, config reader) | `identityBudget` undefined unless `NAIJA_IDENTITY_BUDGET=enabled`. **Not verified in a deployed environment**, because no production environment file exists here. |
| Trusted proxy configuration matches the real topology | **BLOCKED** | No proxy topology in the repository. Default is empty, so `X-Forwarded-For` is ignored. |
| Whether legitimate players share a proxy IP | **BLOCKED** | Depends on the topology above. |
| Global identity limit across processes | **BLOCKED / NOT MET** | Holds only under a single active writer. Multi-instance is not implemented. |
| Effect of restarts on the per-IP counter | Documented: per-IP counts are in memory and reset on restart. | `docs/STAGE_28_IDENTITY_BUDGET.md`. Not tested against a deployed restart. |
| Operator documentation for limit changes | Documented | `docs/STAGE_28_CONFIGURATION.md` (`NAIJA_IDENTITY_*` rows). |

### 1.5 Metrics and identity-budget status

- Metrics: the application does not check access in `ingress` mode. The startup log warns the operator to confirm that
  the ingress blocks the paths. That warning is the only control the application provides in this mode.
- Identity budget: **disabled**. Enabling it in production requires the topology evidence in section 1.2, a review,
  and a documented operator decision. Nothing in this task enables it.

## 2. Task 7: Neon

| Item | Status | Evidence |
|---|---|---|
| Neon connectivity test | **BLOCKED** | The sandbox allows outbound traffic only to `github.com`, `codeload.github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`, and `files.pythonhosted.org`. **Neon endpoints are not on the list, so a connection cannot be made from this sandbox.** |
| Neon credentials | **BLOCKED** | None are configured here. No `.env` file exists. Credentials were not requested in chat, and none were stored or printed. |
| TLS verification against Neon | **BLOCKED** | Requires connectivity. Local TLS verification was tested only against a private CA on `localhost` (the DB+TLS suite, 968 of 968). That is not Neon evidence. |
| Disposable read and write test on a development Neon database | **BLOCKED** | Requires connectivity and a separate development database. |
| Cleanup | **BLOCKED** | Requires the test above. |

**What is needed to unblock (the runbook's own preconditions):**
1. Network access from the test host to the Neon endpoint, through an approved route. The sandbox cannot provide this.
2. A separate development Neon database (not production). Its connection string is supplied by the operator through the
   local, git-ignored `.env` on the test host, never in chat and never in the repository.
3. Run the runbook steps in order (`docs/STAGE_28_NEON_RUNBOOK.md`, section 3), with the stop conditions in section 6.
   Keep the output. Do not record a Neon result without it.

Neon results will not be presented as production evidence. The runbook covers a development database only.

## 3. What is not claimed

- Production topology is not known from this repository, and no production behaviour is claimed.
- No Neon connection, TLS check, or read and write test has been run.
- No deployment has been inspected, because none is in the repository.
- R4 is not enabled anywhere. It is disabled by default.
