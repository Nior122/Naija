# Stage 28 — R7: Credential lifecycle design and test plan (design only)

**Status:** DESIGN AND TEST PLANNING ONLY. Nothing here is implemented. No client-breaking rotation is proposed for immediate release. The current behaviour is unchanged.

**Related:** `docs/STAGE_28_R8_RECOVERY_DESIGN.md` (recovery options and decisions), `docs/STAGE_28_CREATION_KEY_REVIEW.md` (R1–R10 and experiment E1–E7).

---

## 1. Two distinct credentials

The two credentials have different purposes, storage, and lifetimes. They must not be merged or described as one.

| | Creation key (recovery credential) | Session token (connection credential) |
|---|---|---|
| Purpose | Identifies the character when a new identity is requested, and recovers an existing one | Authorizes one player's socket session (`session.resume`) |
| Issued by | Client generates it (64 hex characters) | Server, on `identity.created` (creation or recovery) |
| Stored by | Client storage (`multiplayer_client.gd`); server stores an unsalted SHA-256 `creationKeyHash` | Client; server stores `tokenHash` (SHA-256) |
| Lifetime today | Never expires; reusable; no revocation | Until the next recovery rotates it; no inactivity expiry |
| Rotated when | Never | Each successful key presentation (E1) |
| Revoked when | Never | Only by rotation (recovery) |
| Presented on | `identity.create` | `session.resume` |
| Concurrency | Same-key requests serialized in-process (R1 fix) | A second live connection is refused while the player is online (`player_already_connected`); takeover is blocked only while online |

**Why the distinction matters.** Rotating the session token is a normal effect of recovery and must not be confused with rotating the creation key. Changing one does not change the other. Any future rotation of the creation key requires client support, and the session token can change on every recovery without any client change, because the client already receives the new token.

## 2. Creation-key lifecycle (current, then proposed)

| Stage | Current behaviour | Proposed (not approved) |
|---|---|---|
| Generation | Client generates a random 64-hex value | Keep. Validate format on load (R9); regenerate if invalid |
| First use | Server creates the identity and stores the hash | Keep |
| Recovery | Key presented; token rotates; identity returned | Keep, with the R8 policy (device-bound check or recovery code) |
| Expiry | None | Only after a deprecation window and client support |
| Rotation | None | Key version (R8 4.4) or one-time code (R8 option C). Client must store the new value before the old one stops working |
| Revocation | None | Operator or player action, with authority checks (R8 4.4) |
| Storage migration | Unsalted hashes | Lazy upgrade to salted or HMAC form (R6) on successful presentation |

## 3. Session-token lifecycle (current, then proposed)

| Stage | Current behaviour | Proposed (not approved) |
|---|---|---|
| Issue | New token on creation and on every recovery | Keep |
| Use | `session.resume` checks the token hash | Keep; add expiry only with a deprecation window |
| Rotation | On every key presentation (E1) | Keep as today |
| Expiry | None | Inactivity expiry (for example, 30 days). Value to be approved. Needs a client message for expired sessions |
| Revocation | None other than rotation | Revoke on identity revocation (R8 4.4) |
| Concurrency | One live connection; takeover refused while online | Keep |
| Storage | Hash only on the server | Keep |

## 4. Required scenarios (to be tested before rollout)

Each scenario lists the expected behaviour that must hold **before** any rotation or expiry change ships. Items marked **(today)** describe current behaviour that the test suite already covers or must keep covering.

1. **Server commit, client response lost.** The server saves a new identity or a recovered session, and the response is lost. The client retries with the same key. Expected: the retry recovers the same identity and receives a **new** token; the token from the lost response is invalid. The client must use the latest token only. (The R2 "lost-response" tests cover the commit side. The client-side rule must be written for the client team.)
2. **Concurrent sessions, same key, both new.** Two sockets present a new key at once. Expected: one identity; the other gets `identity_creation_in_progress`. **(today, R1 tests)**
3. **Concurrent sessions, same key, existing identity.** Two sockets recover at once. Expected: one session issued; the other refused; the winner's token works. **(today, R1 recovery test)**
4. **Second device after recovery.** Device A holds token T1. Device B recovers and receives T2. Device A's `session.resume` with T1 returns `session_invalid`. **(today, E1)**
5. **Live connection and recovery.** A recovery from a second socket while the identity is online is refused with `player_already_connected`. **(today, E2)**
6. **Lost token, key still held.** The client has the key but no token. Recovery with the key succeeds and issues a new token. **(today)**
7. **Lost key, token still held.** The client has a valid token but no key. Expected: play continues while the session is valid; the key cannot be re-displayed by the server (the server never stores it). This is a gap for the client team to address. Proposed: the client must keep the key in durable storage.
8. **Lost key and lost token.** Expected: no automatic recovery. Only the operator procedure (R8 option D). This must be documented to players.
9. **Save failure during rotation.** The save fails. Expected: the old token stays valid, the new token is not returned, and the failure is reported as `persistence_failed`. **(today, rollback in `recoverIdentity`; test required for the token-rotation point)**
10. **Process restart after a committed rotation.** The token rotation was saved; the process restarts. Expected: the new token works, the old one does not. Requires a test that restarts from the saved file. **(partly covered by the interruption tests; token-specific test required)**
11. **Migration: old unsalted hash.** A saved identity with the old `creationKeyHash` is recovered after the lazy-upgrade code ships. Expected: recovery succeeds; the upgraded hash is stored; the old form is no longer used once upgraded. Requires a copy of a saved world for the test.
12. **Migration: old token.** An identity whose token predates any expiry rule keeps working during the deprecation window.
13. **Revocation takes effect at once.** After revocation, presenting the old key or token fails, on every connection, including after restart. Not implemented; test required before rollout.
14. **Revocation authority.** A copied key alone cannot revoke an identity whose device holds a valid session. Not implemented; test required.
15. **Expired session.** The client receives a defined expiry message and can recover with the key (if the R8 policy allows). Not implemented.
16. **Invalid key format.** A value that is not 64 hex characters is refused with `invalid_creation_key` and does not count toward the invalid-message disconnect unless R3 is approved. **(today for the refusal; R3 is separate)**
17. **Logs and errors.** No key, token, or hash appears in any log line, error, or metric. **(partly covered; a dedicated redaction test is required)**

## 5. Client-side requirements (for the client team)

- Store the creation key in durable storage and validate the format (R9).
- Handle `invalid_creation_key`, `identity_creation_in_progress`, `identity_creation_conflict`, `session_invalid`, `player_already_connected`, and `persistence_failed`.
- On `identity.created`, replace the stored token. Never keep two tokens.
- Do not treat a lost response as proof that the server did not commit. Retry with the same key, then use the newest token.
- No client change is proposed in this phase. This list is a requirement for the client team to confirm.

## 6. Non-breaking rollout order

1. Tests in section 7 (no behaviour change).
2. Server accepts both old and new forms (R8 phase 1).
3. Client release that handles the new responses and stores the new value (R8 phase 2).
4. Deprecation window with measured counts of old-form identities.
5. Removal of the old form only after an approved review (R8 phase 3).

Each step has a rollback. A step is not started until the previous step's tests pass against a copy of saved data.

## 7. Tests required before rollout

Existing tests (this phase) are marked **(exists)**. Others are required.

| Test area | Required test | Status |
|---|---|---|
| Atomic reservation | Same new key, separate sockets, concurrent | **(exists)** `test/identity-concurrency.test.mjs` |
| Concurrent recovery | Same existing key, separate sockets, concurrent | **(exists)** |
| Failed save releases reservation | Save fails; retry succeeds | **(exists)** |
| Socket closes mid-save | Reservation released; identity recovered once | **(exists)** |
| Rollback of creation | Failure at each injected point leaves no partial state | **(exists)** `test/identity-rollback.test.mjs` (file and PostgreSQL) |
| Merge conflict | Concurrent live change refuses creation; compensating save; retry works | **(exists)** `test/identity-merge.test.mjs` |
| Change inventory | Creation only adds records | **(exists)** |
| Process kill | Killed before commit; killed after commit | **(exists, file backend)** `test/identity-interruption.test.mjs` |
| Token rotation rollback | Save fails during rotation; old token still valid | Required |
| Restart after rotation | Only the newest token works after restart | Required |
| Lost response, same key | Retry returns a new token; lost token invalid | Required (server side) |
| Migration of unsalted hash | Old form recovers; upgraded form stored | Required, on a saved-world copy |
| Revocation | Immediate effect, after restart, every connection | Required (after design approval) |
| Revocation authority | Copied key alone cannot revoke | Required (after design approval) |
| Session expiry | Expired token refused with a defined message | Required (after design approval) |
| Redaction | No key, token, or hash in logs, errors, or metrics | Required |
| Multi-process | Two processes on one PostgreSQL database; one wins | Not claimed. Requires the multi-process test environment |

## 8. Limits of this plan

- The plan assumes a single server process for the in-process reservation. Multi-process behaviour depends on the database version check and is not claimed here.
- The plan does not cover transport security. Tokens and keys are sent over the socket; TLS termination is R10, which is separate.
- No test in the "Required" rows has been written or run.

## 9. Decisions needed

1. Approve or reject inactivity expiry for session tokens, and its length.
2. Approve the deprecation window length for old-form keys and tokens.
3. Confirm the client team can store and replace the creation key (R9) before any server rotation.
4. Choose whether lost-key recovery is key-only (today), code-based, or account-based (R8).

**Status:** design and test planning only. Awaiting review.
