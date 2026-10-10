# Stage 28 — Identity-creation budget (R4)

**Status: implemented and tested locally. NOT enabled in production.** Enabling it in production requires review of this document, the operator steps in section 3, and the open items in section 6. Stage 28 remains IN PROGRESS.

**Approved values (user decision, R4):** 10 new identities per client IP and 100 new identities in total, per rolling 60 minutes. These are the defaults when the budget is enabled. They can be changed by the operator (section 3).

## 1. What is limited

- A **new identity** is a successful `identity.create` that creates a character. Recoveries are not limited: a request whose creation key already belongs to an identity recovers that identity and never uses the budget.
- A request is **not** counted when it is refused for any other reason (invalid key, invalid profile, capacity, persistence failure). Only a committed identity uses a slot.
- A merge conflict is not counted when the compensating save removes the identity from the saved file. If that compensating save also fails, the identity is still in the saved file, so it **is** counted (the saved identity is real).
- A refused request changes nothing: no record, no token, no key reservation is kept.
- Existing players are not limited. Session resume and play do not use the budget.

## 2. How it works

### 2.1 Atomicity

Creation runs inside the serialized persistence queue (`commitIdentity`). Inside that queue, the budget is checked, then the identity is written and saved, and only a successful save records the slot. No other creation can run between the check and the save, so concurrent requests cannot exceed a limit. The engine tests cover this with 25 simultaneous requests from one IP and 20 simultaneous requests across four IPs.

This is atomicity **within one process**. The engine does not claim multi-process fencing (see section 6).

### 2.2 Global limit

The global count is the number of saved players whose `createdAt` falls within the window. No new collection is written, so:

- It survives a restart (the saved identities are the record).
- A failed save leaves no record, so it cannot use a slot.
- It counts every new identity, including those created before the budget was enabled and within the window.

### 2.3 Per-IP limit

The per-IP count is held **in memory** by the process, keyed by `request.socket.remoteAddress`. It is not saved.

- It resets when the process restarts (a documented limitation; tested).
- The table is bounded (`maxTrackedAddresses`, default 10,000). Expired entries are dropped first. While the table is full of active addresses, an address with no entry is refused (fail closed) until an entry expires. This is a deliberate trade-off: it limits memory under a flood of addresses, but it can refuse legitimate new addresses during such a flood.
- No IP address is written to the saved world, the logs, or any error message.

### 2.4 Rolling window

A slot is in use while its creation is less than one window old. A creation exactly one window old has left the window (tested at the exact boundary).

### 2.5 What the player sees

The server sends the error code `identity_creation_limited` with a message such as "Too many new identities were created recently. Try again in about 12 minutes." The message does not say which limit applied and does not include any address or player data.

**When a time is given.** The reply includes `retry_after_seconds` only when the wait is computed from a window: the per-IP window or the global window. The time is the earliest moment a slot in that window frees. Another creation can take that slot first, so the time is a guide ("about"), not a promise. **When the address table is full**, no time is given (any slot may be taken first, so no time would be reliable). The message then reads "Too many new identities are being created right now. Try again later." and there is no `retry_after_seconds` field.

The game client forwards any server error (code and message) through its generic `error_received` path. No client-specific handling was added. The server keeps the socket open after this error, and the client does not retry on `error_received`. So a refused player stays connected without an identity until they reconnect or restart the client after the window. The player-facing message and the reconnect flow have **not** been designed or tested (section 6).

## 3. Operator guide

Set these in the environment of the API process (or in the repository-root `.env` for local development). They are read at startup, so **restart the process after changing them**.

| Variable | Meaning | Default |
|---|---|---|
| `NAIJA_IDENTITY_BUDGET` | `enabled` turns the budget on. `disabled` (or unset) turns it off | `disabled` |
| `NAIJA_IDENTITY_LIMIT_PER_IP` | New identities per client IP in the window (1–1000) | `10` |
| `NAIJA_IDENTITY_LIMIT_GLOBAL` | New identities in total in the window (1–100000) | `100` |
| `NAIJA_IDENTITY_WINDOW_MINUTES` | Rolling window length in minutes (1–1440) | `60` |
| `NAIJA_TRUSTED_PROXIES` | Comma-separated IP addresses or CIDR ranges whose `X-Forwarded-For` is trusted. Empty means none. Invalid values stop startup without echoing them | empty |

- The limits are validated even when the budget is disabled, so a bad value stops startup in any case.
- Invalid values stop startup with a fixed message that does not repeat the value.
- When enabled, the startup log says so, with the limits (no addresses).
- Changing a limit takes effect at the next start. Lowering a limit below the current count refuses new identities until the window moves on. No identities are removed.

**Before you enable it in production, confirm the client address the server sees.** The limits use one **client address**, decided in `src/client-address.ts`:

- By default the address is the socket's own address, `request.socket.remoteAddress`. `X-Forwarded-For` is **ignored**.
- `X-Forwarded-For` is read **only** when the socket address is listed in `NAIJA_TRUSTED_PROXIES` (IP addresses or CIDR ranges, comma-separated). The header is walked from the right; each trusted proxy is skipped, and the first other address is the client. Entries to the left of that point were written by the client and are never used. A malformed, empty, oversized (over 512 characters or 8 entries) or spoofed header is ignored, and the socket address is used.
- The same address is used for the per-IP budget and for the connection-rate limit.
- **Requirement on the proxy:** it must append the address it received to `X-Forwarded-For`, and must replace (not pass through) any `X-Forwarded-For` sent by the client. If it does not, the right-most entry is still the proxy's view of the client, but the list will be wrong for multi-hop chains.

Do not add a proxy address to `NAIJA_TRUSTED_PROXIES` unless only that proxy can reach the API. Any client that can connect directly to the API can then spoof the header from a trusted address.

### 3.1 Before enabling the budget in production (required answers)

Production enablement is **not approved** by this document. These questions must be answered from the real deployment, not from this repository, which contains no deployment or ingress configuration (see `docs/STAGE_28_OPERATIONS_REVIEW.md`).

| Question | Answer from the repository | Needed from the deployment |
|---|---|---|
| Which proxy or load balancer, if any, sits in front of the API? | Not documented. No ingress, load-balancer or reverse-proxy configuration exists in the repository. | Name it. Confirm whether WebSocket upgrades pass through it. |
| How is the socket remote address obtained? | `request.socket.remoteAddress` of the Node process. Correct only when no proxy sits in front of the API, or the proxy's address is the one the server sees. | Confirm the address the API sees for a real player (log the socket address once in a staging environment, not the player's IP). |
| Do legitimate players share one proxy IP? | Yes, if a proxy forwards connections from its own address and `NAIJA_TRUSTED_PROXIES` is not set. Then all players share one per-IP budget of 10. | Confirm. If so, set `NAIJA_TRUSTED_PROXIES` to that proxy only, and confirm the proxy appends `X-Forwarded-For`. |
| Does the global limit hold across the process topology? | **No, not in general.** The global count is read from the saved world, but writes are not fenced between processes (multi-process fencing is tested only within one process). Stage 26 and 27 documents state that multi-instance operation and load balancing are NOT IMPLEMENTED. | Run one API writer, or give the budget a shared store and review it. Do not claim the global limit across several processes. |
| What does a restart do to the per-IP counter? | It resets every address to zero. The global count is kept, because it comes from the saved identities. | Accept or document the reset window (at most one window's worth of extra creations per address per restart). |
| Is `NAIJA_TRUSTED_PROXIES` needed? | Only if a proxy sits in front of the API and the proxy's address is the socket address seen by the server. | Decide from the answers above. |

Until every row is answered from the deployment, keep `NAIJA_IDENTITY_BUDGET` disabled in production.

## 4. Tests

| File | Tests | What it covers |
|---|---|---|
| `test/identity-budget.test.mjs` | 13 | Per-IP limit and isolation between IPs; global limit across IPs; rolling windows (per-IP and global, exact boundary); 25 concurrent creations from one IP; 20 concurrent creations across four IPs; invalid, failed-save and refused requests do not use budget; a retry with an existing key is recovery; existing household members can resume while the budget is used up; the global count survives a restart; the per-IP counter resets on restart (documented limitation); the bounded table fails closed and recovers; disabled by default |
| `test/identity-budget-config.test.mjs` | 5 | Defaults, enable/disable, operator overrides, validation bounds for every variable (also while disabled), fixed error messages that do not echo the value |
| `test/client-address.test.mjs` | 12 | Default trusts nothing; headers from untrusted sockets ignored; a trusted proxy's client used; spoofed leftmost entries ignored; multi-hop chains; IPv4-mapped and IPv6 CIDR; malformed, empty, oversized and repeated headers; `unknown` for a missing address; configuration parsing and fixed errors |
| `test/trusted-proxy-budget.test.mjs` | 7 | Real sockets from loopback addresses with explicit `X-Forwarded-For`: a spoofed header without trust does not create a fresh budget; behind a trusted proxy the forwarded client is limited and spoofed prefixes are ignored; an untrusted socket claiming a trusted address is counted as itself; per-IP refusal gives a time and no address, identifier or internals; a full table gives no time; a global refusal gives a time; metrics count outcomes and expose no address or identifier |
| `test/trusted-proxy-config.test.mjs` | 3 | `NAIJA_TRUSTED_PROXIES` reaches the config; the default trusts nothing; invalid values stop startup without echoing them |

Each test runs against a temporary world file and never touches `data/world-state.json`. Shared-IP and proxy tests use loopback addresses 127.0.0.1–127.0.0.4 as distinct socket addresses (Linux routes all of 127.0.0.0/8 locally, and the client binds its local address).

**Mutation checks (run on the committed source, then restored).** Each mutation rebuilt the server and ran `client-address`, `trusted-proxy-budget` and `identity-budget`:

| Mutation | Result |
|---|---|
| Remove per-IP recording | 8 of 13 engine tests fail |
| Record the budget before the save | 9 tests fail, including the failed-save test |
| Use the leftmost forwarded address instead of the first untrusted one from the right | 3 tests fail (spoofed leftmost entry, repeated header lines, trusted-proxy budget) |
| Remove the socket-trust check before walking the header | 0 tests fail. This mutant is equivalent: the walk starts at the socket address, which is untrusted in that case, so the result is the socket. The check is a fast path, not a separate protection. |
| Stop recording the identity after a conflict whose compensating save fails | 1 test fails (added in this change) |

The equivalence was confirmed by reading the walk, not assumed. The header is inert for an untrusted socket by construction.

Earlier results (before the proxy wiring): 8 of 13 engine tests failed when per-IP recording was removed. The trusted-proxy tests were run against the pre-change code: the proxy-trust test failed (the header was not used), and the refusal and metrics tests failed (no time field, no counters).

## 5. Privacy and data

- No IP address is written to the saved world. The per-IP table lives only in memory.
- The global count uses `createdAt`, which the game already stores for each player. No new personal data is added to the saved world.
- Budget refusals are not logged per request, so the logs do not record which addresses were refused.
- Refusal replies contain no address, player identifier, key or limit internals (tested).

## 5a. Metrics (counts only)

`/metrics` (JSON) and `/metrics/prometheus` report new-identity outcomes since process start. These are counts only; no address, player identifier or key is included (tested).

| JSON field | Prometheus name | Meaning |
|---|---|---|
| `identity_creation.accepted` | `naija_world_api_identity_creations_accepted_total` | Identity saved |
| `identity_creation.limited` | `naija_world_api_identity_creations_limited_total` | Refused by the R4 budget |
| `identity_creation.capacity_refused` | `naija_world_api_identity_creations_capacity_refused_total` | Refused by a record or size limit |
| `identity_creation.failed` | `naija_world_api_identity_creations_failed_total` | Server-side failure: save, build or merge conflict |

Recoveries of existing identities are not counted. An invalid profile is not counted as a failure (it is a client error). The counters reset on restart.

## 6. Limitations and open items (keep with every claim)

- **Not enabled in production.** Enablement needs review and a decision on the shared-IP question in section 3.
- **Process-local per-IP counter.** After a restart, an address starts again at zero. Each API process keeps its own per-IP count, so if several processes run behind a load balancer, the effective per-IP limit is multiplied by the number of processes. The global count is read from the saved world at each commit, but the engine does not fence writes between processes. Running more than one writer against the same saved world is not supported by this change. **No multi-process fencing is claimed.**
- **Client behaviour not tested.** The client has not been run against `identity_creation_limited`. From the code, a refused first join leaves the player connected with no identity and no automatic retry. The message is generic, and there is no countdown or retry button. This needs a client test and a UX decision before enabling the budget.
- **No notification or appeal.** A player who is refused has no way to request an exception. Exceptions are an operator decision and are not implemented.
- **Client address depends on the deployment.** See section 3 and section 3.1. Without a trusted-proxy configuration that matches the real deployment, the per-IP limit may apply to a shared proxy address.
- **Not tested on PostgreSQL in the budget tests.** The budget logic is in the engine and uses the same saved-world `players` collection for both backends. The PostgreSQL backend has not been run with the budget. Neon is BLOCKED and untested.
- **Limits are operator-chosen.** The defaults are the approved values. Whether they suit a live population is not known; they should be reviewed after observing real use.
- **Metrics are process-local counters** (section 5a). They are not a network-protection claim; the budget is not a defence against a determined attacker with many addresses.
