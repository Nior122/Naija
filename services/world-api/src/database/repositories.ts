import { database, type DatabaseConnection } from "./connection.js";

/**
 * Database repository for player accounts
 */

export interface Account {
  id: string;
  username: string;
  email?: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
  last_login_at?: Date;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export class AccountRepository {
  constructor(private readonly db: DatabaseConnection = database) {}

  /**
   * Create a new account
   */
  async create(data: {
    username: string;
    email?: string;
    password_hash: string;
    metadata?: Record<string, unknown>;
  }): Promise<Account> {
    const result = await database.queryOne<Account>(
      `INSERT INTO accounts (username, email, password_hash, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.username, data.email, data.password_hash, JSON.stringify(data.metadata ?? {})]
    );

    if (!result) {
      throw new Error("Failed to create account");
    }

    return result;
  }

  /**
   * Find account by ID
   */
  async findById(id: string): Promise<Account | null> {
    return database.queryOne<Account>(
      "SELECT * FROM accounts WHERE id = $1",
      [id]
    );
  }

  /**
   * Find account by username
   */
  async findByUsername(username: string): Promise<Account | null> {
    return database.queryOne<Account>(
      "SELECT * FROM accounts WHERE username = $1",
      [username]
    );
  }

  /**
   * Find account by email
   */
  async findByEmail(email: string): Promise<Account | null> {
    return database.queryOne<Account>(
      "SELECT * FROM accounts WHERE email = $1",
      [email]
    );
  }

  /**
   * Update last login time
   */
  async updateLastLogin(id: string): Promise<void> {
    await this.db.query(
      "UPDATE accounts SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
  }

  /**
   * Delete account
   */
  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM accounts WHERE id = $1", [id]);
  }
}

/**
 * Database repository for player characters
 */

/** Convert a characters row into the Character type (NUMERIC columns arrive as strings from pg). */
function toCharacter(row: Record<string, unknown>): Character {
  return {
    ...row,
    money: Number(row.money),
    health: Number(row.health),
    energy: Number(row.energy),
    hunger: Number(row.hunger),
  } as Character;
}

export interface Character {
  id: string;
  account_id: string;
  character_id: string;
  name: string;
  character_type: string;
  age: number;
  money: number;
  health: number;
  energy: number;
  hunger: number;
  appearance: Record<string, unknown>;
  position: { x: number; y: number };
  direction: { x: number; y: number };
  current_location?: string;
  home_id?: string;
  school_id?: string;
  education_level?: string;
  geographic_location?: string;
  life_status: string;
  created_at: Date;
  updated_at: Date;
}

export class CharacterRepository {
  constructor(private readonly db: DatabaseConnection = database) {}

  /**
   * Create a new character
   */
  async create(data: {
    account_id: string;
    character_id: string;
    name: string;
    character_type: string;
    age: number;
    money?: number;
    health?: number;
    energy?: number;
    hunger?: number;
    appearance?: Record<string, unknown>;
    position?: { x: number; y: number };
    direction?: { x: number; y: number };
    current_location?: string;
    home_id?: string;
    school_id?: string;
    education_level?: string;
    geographic_location?: string;
  }): Promise<Character> {
    const result = await database.queryOne<Record<string, unknown>>(
      `INSERT INTO characters (
        account_id, character_id, name, character_type, age, money, health, energy, hunger,
        appearance, position, direction, current_location, home_id, school_id, education_level, geographic_location
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *`,
      [
        data.account_id,
        data.character_id,
        data.name,
        data.character_type,
        data.age,
        data.money ?? 0,
        data.health ?? 100,
        data.energy ?? 100,
        data.hunger ?? 100,
        JSON.stringify(data.appearance ?? {}),
        JSON.stringify(data.position ?? { x: 0, y: 0 }),
        JSON.stringify(data.direction ?? { x: 0, y: 0 }),
        data.current_location,
        data.home_id,
        data.school_id,
        data.education_level,
        data.geographic_location,
      ]
    );

    if (!result) {
      throw new Error("Failed to create character");
    }

    return toCharacter(result);
  }

  /**
   * Find character by ID
   */
  async findById(id: string): Promise<Character | null> {
    const row = await database.queryOne<Record<string, unknown>>("SELECT * FROM characters WHERE id = $1", [id]);
    return row ? toCharacter(row) : null;
  }

  /**
   * Find character by character_id
   */
  async findByCharacterId(characterId: string): Promise<Character | null> {
    const row = await database.queryOne<Record<string, unknown>>("SELECT * FROM characters WHERE character_id = $1", [characterId]);
    return row ? toCharacter(row) : null;
  }

  /**
   * Find all characters for an account
   */
  async findByAccountId(accountId: string): Promise<Character[]> {
    const rows = await database.query<Record<string, unknown>>(
      "SELECT * FROM characters WHERE account_id = $1 ORDER BY created_at",
      [accountId]
    );
    return rows.map(toCharacter);
  }

  /**
   * Update character money (transactional)
   */
  /**
   * Apply a signed amount (in naira, two decimal places) to a character's balance.
   *
   * Guarantees:
   * - The character row is locked (SELECT ... FOR UPDATE) before any check, so concurrent
   *   debits serialize and cannot overdraw the balance.
   * - The balance change is computed in SQL, not in JavaScript floating point.
   * - A repeated idempotency key for the same character returns the current character without
   *   applying the amount again. Replays are therefore safe to retry.
   * - Everything runs in one transaction; a failure rolls back the balance and the ledger row together.
   */
  async updateMoney(characterId: string, amount: number, idempotencyKey?: string): Promise<Character> {
    if (!Number.isFinite(amount) || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6 || Math.abs(amount) > 1e12) {
      throw new Error("Invalid amount");
    }
    if (amount === 0) {
      throw new Error("Invalid amount");
    }
    if (idempotencyKey !== undefined && (idempotencyKey.length === 0 || idempotencyKey.length > 255)) {
      throw new Error("Invalid idempotency key");
    }

    return this.db.transaction(async (client) => {
      const locked = await client.query(
        "SELECT id, money FROM characters WHERE character_id = $1 FOR UPDATE",
        [characterId]
      );
      if (locked.rows.length === 0) {
        throw new Error("Character not found");
      }
      const row = locked.rows[0];

      if (idempotencyKey) {
        const existing = await client.query(
          "SELECT id FROM financial_transactions WHERE character_id = $1 AND idempotency_key = $2",
          [row.id, idempotencyKey]
        );
        if (existing.rows.length > 0) {
          // Replay of an already-applied request: report the current state, change nothing.
          return this.loadByCharacterId(client, characterId);
        }
      }

      // Conditional update: the balance can never drop below zero, even under concurrency.
      const updated = await client.query(
        "UPDATE characters SET money = money + $1, updated_at = NOW() WHERE id = $2 AND money + $1 >= 0 RETURNING money",
        [amount, row.id]
      );
      if (updated.rows.length === 0) {
        throw new Error("Insufficient funds");
      }

      await client.query(
        `INSERT INTO financial_transactions (character_id, transaction_type, amount, balance_after, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.id, amount > 0 ? "credit" : "debit", amount, updated.rows[0].money, idempotencyKey ?? null]
      );

      return this.loadByCharacterId(client, characterId);
    });
  }

  private async loadByCharacterId(client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, characterId: string): Promise<Character> {
    const result = await client.query("SELECT * FROM characters WHERE character_id = $1", [characterId]);
    const row = result.rows[0];
    if (!row) throw new Error("Character not found");
    return toCharacter(row);
  }

  /**
   * Update character position
   */
  async updatePosition(characterId: string, position: { x: number; y: number }): Promise<void> {
    await this.db.query(
      "UPDATE characters SET position = $1, updated_at = NOW() WHERE character_id = $2",
      [JSON.stringify(position), characterId]
    );
  }

  /**
   * Delete character
   */
  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM characters WHERE id = $1", [id]);
  }
}

export const accountRepository = new AccountRepository();
export const characterRepository = new CharacterRepository();
