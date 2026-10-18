// Child-process probe for the TLS tests. Connects with the exact policy the app uses
// (loadDatabaseConfigFromEnv + buildPoolConfig), runs one query, and prints one JSON line.
// NODE_EXTRA_CA_CERTS must be set in the environment BEFORE node starts, so the parent spawns this file.
import pg from "pg";
import { loadDatabaseConfigFromEnv, resolveDatabasePoolConfig } from "../../dist/database/connection.js";

const pool = new pg.Pool(await resolveDatabasePoolConfig(loadDatabaseConfigFromEnv()));
try {
  const result = await pool.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
  const ssl = result.rows.length === 1 ? result.rows[0].ssl : null;
  process.stdout.write(`@@TLS ${JSON.stringify({ ok: true, ssl })}\n`);
} catch (error) {
  process.stdout.write(`@@TLS ${JSON.stringify({ ok: false, code: error.code ?? null, message: String(error.message).slice(0, 200) })}\n`);
  process.exitCode = 0;
} finally {
  await pool.end().catch(() => undefined);
}
