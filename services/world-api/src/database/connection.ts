import { Pool, type PoolConfig } from "pg";

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
  maxConnections?: number;
  idleTimeoutMs?: number;
}

const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\//i;

/**
 * Builds the pg pool configuration from DatabaseConfig without opening a connection.
 * Exported so the TLS and validation rules can be tested without a live database.
 */
export function buildPoolConfig(config: DatabaseConfig = {}): PoolConfig {
  const poolConfig: PoolConfig = {};

  if (config.connectionString) {
    // Validate the scheme only; never echo the value back in an error.
    if (!POSTGRES_URL_PATTERN.test(config.connectionString)) {
      throw new Error("DATABASE_URL must be a postgres:// or postgresql:// connection URL.");
    }
    poolConfig.connectionString = config.connectionString;
  } else {
    poolConfig.host = config.host ?? "localhost";
    poolConfig.port = config.port ?? 5432;
    poolConfig.database = config.database ?? "naija_world";
    poolConfig.user = config.user ?? "postgres";
    poolConfig.password = config.password;
  }

  if (config.ssl === false) {
    poolConfig.ssl = false;
  } else {
    // Verify server certificates by default. Note: if the connection string itself
    // carries an sslmode parameter, pg applies that parameter over this option.
    poolConfig.ssl = {
      rejectUnauthorized: config.rejectUnauthorized ?? true,
    };
  }

  poolConfig.max = config.maxConnections ?? 20;
  poolConfig.idleTimeoutMillis = config.idleTimeoutMs ?? 30000;

  return poolConfig;
}

export class DatabaseConnection {
  private pool: Pool | null = null;
  private config: DatabaseConfig;
  private isConnected: boolean = false;

  constructor(config: DatabaseConfig = {}) {
    this.config = config;
  }

  /**
   * Initialize the database connection pool
   */
  async connect(): Promise<void> {
    if (this.pool) {
      return;
    }

    const pool = new Pool(buildPoolConfig(this.config));
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
    const config: DatabaseConfig = { connectionString };
    if (process.env.DB_SSL_REJECT_UNAUTHORIZED) {
      config.rejectUnauthorized = parseBooleanEnv(
        "DB_SSL_REJECT_UNAUTHORIZED",
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
      );
    }
    return config;
  }

  // Fallback to individual environment variables
  const config: DatabaseConfig = {};

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
    config.ssl = process.env.DB_SSL === "true";
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
