# Stage 28 — Identity-creation budget (R4)

**Status: implemented and tested locally. NOT enabled in production.** Enabling it in production requires review of this document, the operator steps in section 3, and the open items in section 6. Stage 28 remains IN PROGRESS.

**Approved values (user decision, R4):** 10 new identities per client IP and 100 new identities in total, per rolling 60 minutes. These are the defaults when the budget is enabled. They can be changed by the operator (section 3).

## 1. What is limited

- A **new identity** is a successful `identity.create` that creates a character. Recoveries are not limited: a request whose creation key already belongs to an identity recovers that identity and never uses the budget.
- A request is **not** counted when it is refused for any other reason (invalid key, invalid profile, capacity, persistence failure, merge conflict). Only a committed identity uses a slot.
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

The game client forwards any server error (code and message) through its generic `error_received` path. No client-specific handling was added. The server keeps the socket open after this error, and the client does not retry on `error_received`. So a refused player stays connected without an identity until they reconnect or restart the client after the window. The player-facing message and the reconnect flow have **not** been designed or tested (section 6).

## 3. Operator guide

Set these in the environment of the API process (or in the repository-root `.env` for local development). They are read at startup, so **restart the process after changing them**.

| Variable | Meaning | Default |
|---|---|---|
| `NAIJA_IDENTITY_BUDGET` | `enabled` turns the budget on. `disabled` (or unset) turns it off | `disabled` |
| `NAIJA_IDENTITY_LIMIT_PER_IP` | New identities per client IP in the window (1–1000) | `10` |
| `NAIJA_IDENTITY_LIMIT_GLOBAL` | New identities in total in the window (1–100000) | `100` |
| `NAIJA_IDENTITY_WINDOW_MINUTES` | Rolling window length in minutes (1–1440) | `60` |

- The limits are validated even when the budget is disabled, so a bad value stops startup in any case.
- Invalid values stop startup with a fixed message that does not repeat the value.
- When enabled, the startup log says so, with the limits (no addresses).
- Changing a limit takes effect at the next start. Lowering a limit below the current count refuses new identities until the window moves on. No identities are removed.

**Before you enable it in production, confirm the client address the server sees.** The server reads `request.socket.remoteAddress` and does **not** read `X-Forwarded-For` or any other forwarding header (it cannot do so safely without a trusted-proxy list, which is not implemented). If a load balancer or reverse proxy sits in front of the API and forwards connections from its own address, every player shares one IP, and the per-IP limit of 10 would then apply to all players together. In that case, either leave the per-IP limit at a value that is safe for the shared address, or implement and review a trusted-proxy rule first. Do not enable the budget in production until this is confirmed.

## 4. Tests

| File | What it covers |
|---|---|
| `test/identity-budget.test.mjs` (13 tests) | Per-IP limit and isolation between IPs; global limit across IPs; rolling windows (per-IP and global, exact boundary); 25 concurrent creations from one IP; 20 concurrent creations across four IPs; invalid, failed-save and refused requests do not use budget; a retry with an existing key is recovery; existing household members can resume while the budget is used up; the global count survives a restart; the per-IP counter resets on restart (documented limitation); the bounded table fails closed and recovers; disabled by default |
| `test/identity-budget-config.test.mjs` (8 tests) | Defaults, enable/disable, operator overrides, validation bounds, fixed error messages that do not echo the value |

Each test runs against a temporary world file and never touches `data/world-state.json`. Shared-IP tests use loopback addresses 127.0.0.1–127.0.0.4 as distinct client addresses.

**Mutation check.** Removing the per-IP recording made 8 of the 13 engine tests fail, so the tests detect a broken budget.

## 5. Privacy and data

- No IP address is written to the saved world. The per-IP table lives only in memory.
- The global count uses `createdAt`, which the game already stores for each player. No new personal data is added to the saved world.
- Budget refusals are not logged per request, so the logs do not record which addresses were refused.

## 6. Limitations and open items (keep with every claim)

- **Not enabled in production.** Enablement needs review and a decision on the shared-IP question in section 3.
- **Process-local per-IP counter.** After a restart, an address starts again at zero. Each API process keeps its own per-IP count, so if several processes run behind a load balancer, the effective per-IP limit is multiplied by the number of processes. The global count is read from the saved world at each commit, but the engine does not fence writes between processes. Running more than one writer against the same saved world is not supported by this change. **No multi-process fencing is claimed.**
- **Client behaviour not tested.** The client has not been run against `identity_creation_limited`. From the code, a refused first join leaves the player connected with no identity and no automatic retry. The message is generic, and there is no countdown or retry button. This needs a client test and a UX decision before enabling the budget.
- **No notification or appeal.** A player who is refused has no way to request an exception. Exceptions are an operator decision and are not implemented.
- **Not tested on PostgreSQL in the budget tests.** The budget logic is in the engine and uses the same saved-world `players` collection for both backends. The PostgreSQL backend has not been run with the budget. Neon is BLOCKED and untested.
- **Limits are operator-chosen.** The defaults are the approved values. Whether they suit a live population is not known; they should be reviewed after observing real use.
- **No metrics.** Refusals are not counted in `/metrics`. Adding a counter is a possible follow-up.
