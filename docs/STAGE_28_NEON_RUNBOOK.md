# Stage 28: Neon runbook (separate development database)

**Status: BLOCKED.** No Neon endpoint has been reached and no Neon result exists. The sandbox allows outbound traffic
only to GitHub, npm, and PyPI hosts. Nothing in this runbook has been run against Neon. Do not record any Neon
result until the steps below have been run and their output saved.

Neon results will never be presented as production evidence. This runbook covers a **development** database only.

## 1. Preconditions

- A Neon project or branch used **only** for development and tests. It must not hold real player data, and it must
  not be the production database.
- The database name must contain `test` (for example `naija_dev_test`). The live test suites refuse other names.
- Access to the connection string from the Neon console. **Do not paste the password into chat, an issue, a commit,
  or a report.** Put the URL only in your local, git-ignored `.env` file.
- A role with permission to run `CREATE DATABASE` and `DROP DATABASE` if you want the backup restore tests to run.
  If the role lacks that permission, those tests will fail. Record that result. Do not work around it.

## 2. Local configuration (the repository-root `.env`, which is git-ignored)

Use only the following, with your own values. Do not change verification settings to make a connection succeed.

```
NAIJA_ENV=development
DATABASE_URL=postgresql://<user>:<password>@<neon-host>/<dev-database-name>?sslmode=verify-full
PERSISTENCE_BACKEND=postgres
NAIJA_METRICS_ACCESS=open
```

Do **not** set `DB_SSL=false`, `sslmode=disable`, or `DB_SSL_REJECT_UNAUTHORIZED=false` for Neon. Neon uses a publicly
trusted certificate, so the default verification should work with no CA configuration. If it does not, stop and
record the exact error. Do not disable verification. `NODE_EXTRA_CA_CERTS` is needed only for a private CA.

## 3. Steps, in order

Run each step from `/home/user/Naija`. Save the output to a file outside the repository and record the date.

1. **Connection and TLS status.** This uses the app's verified connection and migration status without writing:
   ```
   npm run db:status
   ```
   Expected: the connection succeeds with verified TLS. Record the reported schema version. Do not record the URL.

2. **Confirm TLS was used.** Run a read-only query from a short script, or from `psql`:
   ```
   SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid();
   ```
   Expected: `ssl = true`. Record the version string.

3. **Migrate the development database** (additive migrations; only the dev database):
   ```
   npm run db:migrate
   npm run db:status
   ```
   Expected: `isUpToDate` after migration.

4. **Unmigrated check (optional, on a second dev database only).** Confirm that the server refuses to start on an
   unmigrated database. The live readiness test does this automatically.

5. **Run the test suites against the Neon development database:**
   ```
   cd services/world-api
   NAIJA_ALLOW_DB_TESTS=true npm test
   ```
   This runs persistence, multi-process, backup, and TLS-policy tests against the database. Record the pass, fail, and
   skip counts. Skips must be explained.

6. **Start the server against the dev database** and check that it refuses a bad configuration:
   - With `NAIJA_ENV` unset: it must refuse to start.
   - With `PERSISTENCE_BACKEND=file` and `NAIJA_ENV=production`: it must refuse to start.
   - With a valid configuration: `/health` reports the PostgreSQL backend.

## 4. What to record

For each run: the date, the Neon region and project name (not the password or the full host if you prefer), the
Postgres version, the migration version, the TLS result (`ssl = true`), the test counts, and the skipped tests with their
reasons. Store the record outside the repository, or add a dated report under `docs/` that contains no credentials.

## 5. Things this runbook does not establish

- It does not test Neon's connection pooler separately. If you use a pooled endpoint, record which endpoint type you used.
- It does not test Neon branching, point-in-time restore, or Neon's own backups.
- It does not establish production readiness, load behaviour, or the historical real-player data-loss question.
- Local private-CA TLS tests do not prove the certificate chain Neon presents.

## 6. Stop conditions

Stop and report, without working around them, if:
- verified TLS fails against Neon;
- a step would require disabling verification or using `DB_SSL=false`;
- a test asks for a database whose name does not contain `test`;
- the role has permissions that would touch anything other than the dev database.
