import type { LookupAddress } from "node:dns";
import { Socket, type TcpSocketConnectOpts } from "node:net";
import { Pool, type PoolConfig } from "pg";
import { effectiveEnvironment, isLocalEnvironment, readRuntimeEnvironment, type RuntimeEnvironment } from "../runtime-environment.js";
import { classifyPlaintextHost, resolvePlaintextAddresses, type LookupFunction } from "./host-policy.js";

/**
 * Database connection management for Naija: One World
 * Provides connection pooling and health checking for PostgreSQL
 *
 * Security notes:
 * - TLS certificates are verified by default. Disabling verification requires an
 *   explicit DB_SSL_REJECT_UNAUTHORIZED=false (for private test CAs only).
 * - Error messages never include the connection string or password.
 */

export interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  /** Defaults to true. Set false only for private CAs in local/test environments. */
  rejectUnauthorized?: boolean;
  /**
   * Runtime environment (NAIJA_ENV). Local-only options are refused unless this is "development" or "test".
   * Undefined is treated as "production" by every policy check.
   */
  environment?: RuntimeEnvironment | undefined;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\//i;

/**
 * sslmode values accepted in DATABASE_URL. Anything that can fall back to plaintext
 * or skip certificate checks is rejected, because the URL parameter would otherwise
 * override the TLS policy configured here.
 */
const VERIFIED_SSLMODES = new Set(["verify-full", "verify-ca", "require"]);

/**
 * Builds the pg pool configuration from DatabaseConfig without opening a connection.
 * Exported so the TLS and validation rules can be tested without a live database.
 *
 * TLS policy (single source of truth):
 * - Default: TLS on, server certificate verified.
 * - sslmode=disable in DATABASE_URL is accepted only with an explicit DB_SSL=false (local development).
 * - sslmode=prefer/allow/no-verify and unknown values are rejected.
 * - The sslmode parameter is removed from the connection string so it cannot override the policy.
 * Error messages never include the connection string.
 */
/**
 * Redirect parameters that could send a connection somewhere other than the host the configuration names.
 * pg reads PGHOSTADDR from the environment even when a host is configured. pg also lets host and hostaddr URL
 * parameters override the host in the authority, which would make the host check ambiguous.
 */
function assertNoConnectionRedirects(config: DatabaseConfig): void {
  if (process.env.PGHOSTADDR) {
    throw new Error("PGHOSTADDR is not supported. Set the database host explicitly in DATABASE_URL or DB_HOST.");
  }
  if (config.connectionString) {
    let url: URL | undefined;
    try {
      url = new URL(config.connectionString);
    } catch {
      url = undefined; // reported by buildPoolConfig
    }
    if (url !== undefined && (url.searchParams.has("host") || url.searchParams.has("hostaddr"))) {
      throw new Error("host and hostaddr URL parameters are not supported. Put the host in the URL.");
    }
  }
}

/** Plaintext is allowed only in a local environment, and only to a host the policy classifies as loopback. */
function assertPlaintextAllowed(config: DatabaseConfig): void {
  if (!isLocalEnvironment(effectiveEnvironment(config.environment))) {
    throw new Error("DB_SSL=false is allowed only when NAIJA_ENV is development or test.");
  }
  classifyPlaintextHost(targetHostOf(config));
}

type PinnedLookupCallback = (error: Error | null, address: string | LookupAddress[], family?: number) => void;

/**
 * Socket factory for plaintext connections to "localhost". Each socket is given the fixed list of addresses that
 * resolvePlaintextAddresses validated, through Node's `lookup` option. Node then never asks the system resolver,
 * so no later DNS answer can redirect a pooled connection. Node still tries each validated address in turn.
 *
 * pg calls `socket.connect(port, host)`. This factory ignores the host argument because the pinned list is the
 * only permitted target.
 */
export function pinnedPlaintextStream(addresses: readonly LookupAddress[]): () => Socket {
  const pinned = addresses.map((entry) => ({ address: entry.address, family: entry.family }));
  if (pinned.length === 0) {
    throw new Error("A plaintext connection needs at least one validated loopback address.");
  }
  const lookup = (_hostname: string, options: { all?: boolean } | number, callback: PinnedLookupCallback): void => {
    if (typeof options === "object" && options.all === true) {
      callback(null, pinned.map((entry) => ({ ...entry })));
      return;
    }
    const [first] = pinned;
    if (first === undefined) {
      callback(new Error("no validated address"), "");
      return;
    }
    callback(null, first.address, first.family);
  };
  return () => {
    const socket = new Socket();
    const originalConnect = Socket.prototype.connect as unknown as (this: Socket, options: TcpSocketConnectOpts) => Socket;
    const connectPinned = (port: number): Socket =>
      originalConnect.call(socket, { port, host: "localhost", lookup } as TcpSocketConnectOpts);
    (socket as unknown as { connect: (port: number) => Socket }).connect = connectPinned;
    return socket;
  };
}

/**
 * Builds the pool configuration. `plaintextAddresses` is required when plaintext is used with the host name
 * "localhost": it is the list from resolvePlaintextAddresses. Use resolveDatabasePoolConfig rather than calling this
 * directly, so the lookup cannot be skipped.
 */
export function buildPoolConfig(config: DatabaseConfig = {}, plaintextAddresses?: readonly LookupAddress[]): PoolConfig {
  const poolConfig: PoolConfig = {};
  const environment = effectiveEnvironment(config.environment);
  const local = isLocalEnvironment(environment);
  const sslDisabled = config.ssl === false;

  assertNoConnectionRedirects(config);

  if (config.connectionString) {
    if (!POSTGRES_URL_PATTERN.test(config.connectionString)) {
      throw new Error("DATABASE_URL must be a postgres:// or postgresql:// connection URL.");
    }
    let url: URL;
    try {
      url = new URL(config.connectionString);
    } catch {
      throw new Error("DATABASE_URL could not be parsed as a connection URL.");
    }
    const sslmode = url.searchParams.get("sslmode");
    if (sslmode !== null) {
      const mode = sslmode.toLowerCase();
      if (mode === "disable") {
        if (!sslDisabled) {
          throw new Error("DATABASE_URL sslmode=disable requires DB_SSL=false (local development only).");
        }
      } else if (sslDisabled) {
        throw new Error("DB_SSL=false conflicts with the sslmode set in DATABASE_URL.");
      } else if (!VERIFIED_SSLMODES.has(mode)) {
        throw new Error("DATABASE_URL sslmode is not supported; use sslmode=verify-full.");
      }
      url.searchParams.delete("sslmode");
    }
    poolConfig.connectionString = url.toString();
  } else {
    poolConfig.host = config.host ?? "localhost";
    poolConfig.port = config.port ?? 5432;
    poolConfig.database = config.database ?? "naija_world";
    poolConfig.user = config.user ?? "postgres";
    poolConfig.password = config.password;
  }

  if (sslDisabled) {
    assertPlaintextAllowed(config);
    if (classifyPlaintextHost(targetHostOf(config)) === "localhost-name") {
      if (plaintextAddresses === undefined) {
        throw new Error(
          "DB_SSL=false to localhost requires validated loopback addresses. Connect through DatabaseConnection.connect().",
        );
      }
      poolConfig.stream = pinnedPlaintextStream(plaintextAddresses) as unknown as NonNullable<PoolConfig["stream"]>;
    }
  }
  if (config.rejectUnauthorized === false && !local) {
    throw new Error("DB_SSL_REJECT_UNAUTHORIZED=false is allowed only when NAIJA_ENV is development or test.");
  }

  poolConfig.ssl = sslDisabled ? false : { rejectUnauthorized: config.rejectUnauthorized ?? true };
  poolConfig.max = config.maxConnections ?? 20;
  poolConfig.idleTimeoutMillis = config.idleTimeoutMs ?? 30000;
  poolConfig.connectionTimeoutMillis = config.connectionTimeoutMs ?? 10000;
  poolConfig.statement_timeout = config.statementTimeoutMs ?? 30000;

  return poolConfig;
}

/**
 * The only supported way to get a pool configuration. Redirect and policy checks run first, so a refused
 * configuration never triggers a lookup. For plaintext to "localhost", the lookup happens here, once; the
 * validated addresses are pinned to the pool (see pinnedPlaintextStream). Remote TLS is returned unchanged: the
 * driver resolves the name, and the certificate is verified against that name.
 */
export async function resolveDatabasePoolConfig(config: DatabaseConfig, hostLookup?: LookupFunction): Promise<PoolConfig> {
  assertNoConnectionRedirects(config);
  if (config.ssl === false) {
    assertPlaintextAllowed(config);
    const addresses = await resolvePlaintextAddresses(targetHostOf(config), hostLookup);
    return buildPoolConfig(config, addresses);
  }
  return buildPoolConfig(config);
}

/** The host that a connection built from this configuration will reach, or undefined if it cannot be parsed. */
export function targetHostOf(config: DatabaseConfig): string | undefined {
  if (config.connectionString) {
    try {
      return new URL(config.connectionString).hostname;
    } catch {
      return undefined;
    }
  }
  return config.host ?? "localhost";
}

export class DatabaseConnection {
  private pool: Pool | null = null;
  private config: DatabaseConfig | undefined;
  private hostLookup: LookupFunction | undefined;
  private isConnected: boolean = false;

  /**
   * With no argument, configuration is read from the environment when connect() runs.
   * (Reading it at construction would make the shared singleton ignore DATABASE_URL.)
   */
  constructor(config?: DatabaseConfig, options: { hostLookup?: LookupFunction } = {}) {
    this.config = config;
    this.hostLookup = options.hostLookup;
  }

  /**
   * Initialize the database connection pool
   */
  async connect(): Promise<void> {
    if (this.pool) {
      return;
    }

    const resolved = this.config ?? loadDatabaseConfigFromEnv();
    // Policy, then (for plaintext to localhost) one validated lookup whose addresses are pinned to this pool.
    const poolConfig = await resolveDatabasePoolConfig(resolved, this.hostLookup);
    const pool = new Pool(poolConfig);
    this.pool = pool;

    // Test connection
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
      } finally {
        client.release();
      }
      this.isConnected = true;
      console.log("[Database] Connected to PostgreSQL");
    } catch (error) {
      this.isConnected = false;
      // Discard the failed pool so a later connect() can retry instead of silently reusing it.
      this.pool = null;
      await pool.end().catch(() => undefined);
      throw new Error(`Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute a query with parameters
   */
  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    if (!this.pool) {
      throw new Error("Database not connected. Call connect() first.");
    }

    try {
      const result = await this.pool.query(text, params);
      return result.rows;
    } catch (error) {
      console.error("[Database] Query failed:", error);
      throw error;
    }
  }

  /**
   * Execute a query and return a single row
   */
  async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    const row = rows.length > 0 ? rows[0] : null;
    return row ?? null;
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error("Database not connected. Call connect() first.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check database health
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    if (!this.pool) {
      return { healthy: false, latencyMs: 0, error: "Not connected" };
    }

    const start = Date.now();
    try {
      await this.pool.query("SELECT 1");
      const latencyMs = Date.now() - start;
      return { healthy: true, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - start;
      return {
        healthy: false,
        latencyMs,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Close the connection pool
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      console.log("[Database] Disconnected from PostgreSQL");
    }
  }

  /**
   * Check if connected
   */
  isConnectedToDatabase(): boolean {
    return this.isConnected && this.pool !== null;
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): { total: number; idle: number; waiting: number } | null {
    if (!this.pool) {
      return null;
    }

    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }
}

// Global database instance
export const database = new DatabaseConnection();

function parseBooleanEnv(name: string, value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

/**
 * Load database configuration from environment
 */
export function loadDatabaseConfigFromEnv(): DatabaseConfig {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    const config: DatabaseConfig = { connectionString, environment: readRuntimeEnvironment(process.env, { required: false }) };
    if (process.env.DB_SSL) {
      config.ssl = parseBooleanEnv("DB_SSL", process.env.DB_SSL);
    }
    if (process.env.DB_SSL_REJECT_UNAUTHORIZED) {
      config.rejectUnauthorized = parseBooleanEnv(
        "DB_SSL_REJECT_UNAUTHORIZED",
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
      );
    }
    return config;
  }

  // Fallback to individual environment variables
  const config: DatabaseConfig = { environment: readRuntimeEnvironment(process.env, { required: false }) };

  if (process.env.DB_HOST) {
    config.host = process.env.DB_HOST;
  }
  if (process.env.DB_PORT) {
    config.port = parseInt(process.env.DB_PORT, 10);
  }
  if (process.env.DB_NAME) {
    config.database = process.env.DB_NAME;
  }
  if (process.env.DB_USER) {
    config.user = process.env.DB_USER;
  }
  if (process.env.DB_PASSWORD) {
    config.password = process.env.DB_PASSWORD;
  }
  if (process.env.DB_SSL) {
    config.ssl = parseBooleanEnv("DB_SSL", process.env.DB_SSL);
  }
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED) {
    config.rejectUnauthorized = parseBooleanEnv(
      "DB_SSL_REJECT_UNAUTHORIZED",
      process.env.DB_SSL_REJECT_UNAUTHORIZED,
    );
  }
  if (process.env.DB_MAX_CONNECTIONS) {
    config.maxConnections = parseInt(process.env.DB_MAX_CONNECTIONS, 10);
  }

  return config;
}
