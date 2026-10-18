# Stage 28 Task 3: Backup and Restore Status

Status: **Partial. A logical export, verify, and restore library exists and its tests pass locally. There is no
operator tool, no encryption, no retention, no scheduling, and no `pg_dump` run.** Stage 28 remains OPEN. No backup
or restore result is claimed for Neon, production, or the historical world data.

## 1. What exists (inspected, not assumed)

`services/world-api/src/database/backup.ts` (151 lines):

| Function | What it does |
|---|---|
| `exportWorldBackup(db, worldKey)` | Reads the stored world document and wraps it with a SHA-256 digest of its canonical JSON. Refuses a missing world. |
| `verifyWorldBackup(input)` | Checks format name, format version, key, state version, digest shape, and the digest against the snapshot. Then runs the engine's validation. |
| `restoreWorldBackup(db, backup, targetKey)` | Verifies first, then inserts under a **new** key with `ON CONFLICT DO NOTHING`. An existing world is never overwritten. |
| `canonicalJson`, `snapshotDigest` | Key-order-independent canonical JSON and its SHA-256 digest. |

`services/world-api/src/database/cli.ts` does **not** expose backup or restore. No operator command exists, which is
consistent with the directive (do not create a new operator CLI before review).

## 2. Commands actually run

| Command or check | Result |
|---|---|
| `npm test` with `DATABASE_URL` set to the local disposable database `naija_stage28_test` (`127.0.0.1:55433`, `NAIJA_ALLOW_DB_TESTS=true`) | Exit 0. 968 total, 964 pass, 0 fail, 4 skipped (TLS-only). |
| The 10 backup tests in that run | **All 10 passed**: 5 pure tests and 5 live tests. The live tests cover export, verify, and restore under a new key; refusal to overwrite; a tampered file refused with nothing written; a missing world; and restore into a second disposable database that the test creates and drops. |
| `npm test` against the TLS scratch server (`localhost:55434`, private CA trusted through `NODE_EXTRA_CA_CERTS`) | Exit 0. 968 of 968 pass. |
| `command -v pg_dump` | **Not found.** |
| `ls` of `/tmp/pgbin/node_modules/@embedded-postgres/linux-x64/native/bin/` | Contains `initdb`, `pg_ctl`, `postgres`. No `pg_dump`, no `pg_restore`, no `psql`. |
| `find / -name "pg_dump*" -type f` | **No match** on the sandbox filesystem. |

Missing dependency, reported exactly: **`pg_dump` and `pg_restore` are not installed in this sandbox.** This task did
not install them. Installing PostgreSQL client tools would be infrastructure that has not been approved.

So: **a `pg_dump` backup has NOT been created, and a `pg_dump` restore has NOT been tested.** Any statement that
`pg_dump` works is unsupported until it is run.

## 3. Status against the required items

Each item uses one of the five categories from directive item 8: **PASS** (tested locally), **FAIL** (tested and
failed), **BLOCKED** (cannot test here; evidence needed listed), **DESIGN ONLY** (documented, not built), **NOT
APPLICABLE** (out of scope for this task).

| Item | Status | Evidence or gap |
|---|---|---|
| Export, verify, restore under a new key | PASS (local, disposable database) | 5 live backup tests. |
| Restore never overwrites | PASS (local) | Live test. |
| Tampered file refused, nothing written | PASS (local) | Live test. |
| Restore into a second disposable database and open the engine | PASS (local) | Live test. |
| `pg_dump` backup | BLOCKED | `pg_dump` not installed. Evidence needed: an approved PostgreSQL client install on the backup host, then a dump of the **disposable** database only. |
| Encryption at rest for backup files | DESIGN ONLY | Not implemented. Backups are plain JSON. |
| Key storage and rotation | DESIGN ONLY | No key exists or is referenced. Needs a secret store decision (see section 4). |
| Access control on backup files | DESIGN ONLY | Filesystem permissions only; not verified on any host. |
| Retention and deletion | DESIGN ONLY | No retention, pruning, or deletion exists. The directive forbids automatic deletion. |
| Integrity | PARTIAL | SHA-256 detects accidental corruption. It does **not** detect deliberate replacement: a tamperer can recompute the digest. A signature or an external digest record is needed for that. |
| Usability verification (a restored world can be played) | PARTIAL | The live test opens the engine from the restored database. It does not drive a player session through the restored world. |
| Corrupted-primary recovery | BLOCKED / DESIGN ONLY | Not tested. Needs a defined procedure: stop writes, export, restore to a new key, verify, then switch. |
| Separation of backup creation from restore verification | PARTIAL | The library separates `exportWorldBackup` and `verifyWorldBackup`. Nothing schedules them apart. |
| Operator CLI | NOT APPLICABLE | Not created, by directive. |

## 4. Design requirements (not implemented)

These are requirements for a later reviewed design. None is built.

1. **Encryption at rest.** Use authenticated encryption for every backup file. The key must come from a secret store,
   never from the repository, and never from a log line. Document the algorithm and its version in the backup header.
2. **Key rotation.** Store the key identifier in the backup header. Rotation must keep old backups readable for the
   retention period, or re-encrypt them under a reviewed plan. No re-encryption of live data is allowed without a test.
3. **Access.** Backups should be readable only by the backup and restore roles. Log who created or restored a backup,
   without logging the backup content or the key.
4. **Retention.** A retention period must be decided by the operator. Deletion of old backups is a separate, explicit,
   reviewed action. It is not automatic.
5. **Integrity.** Add an external record of each backup's digest (stored apart from the backup) so that replacement
   is detectable. Verify before every restore.
6. **Restore.** Always restore into a new, disposable database or a new key first. Verify the restored world with the
   engine, then with a scripted player session. Only then consider switching.
7. **Corrupted primary.** A written procedure, rehearsed on a disposable copy, before any use on live data.
8. **Evidence for Neon or production.** Each claim must name the environment, the command, and its result. Local runs
   are not evidence for either.

## 5. What is not claimed

- No `pg_dump` backup or restore has been executed.
- No backup has been taken of any live database, Neon database, or production database.
- No backup has been taken of the historical world, and the 284-file corpus was not located, so it has not been backed up or verified.
- Encryption, key management, retention, and access control are not implemented.
- The backup library's tests passing does not establish that a real operational backup would succeed.
