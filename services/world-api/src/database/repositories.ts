import { database } from "./connection.js";

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
    await database.query(
      "UPDATE accounts SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
  }

  /**
   * Delete account
   */
  async delete(id: string): Promise<void> {
    await database.query("DELETE FROM accounts WHERE id = $1", [id]);
  }
}

/**
 * Database repository for player characters
 */

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
    const result = await database.queryOne<Character>(
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

    return result;
  }

  /**
   * Find character by ID
   */
  async findById(id: string): Promise<Character | null> {
    return database.queryOne<Character>(
      "SELECT * FROM characters WHERE id = $1",
      [id]
    );
  }

  /**
   * Find character by character_id
   */
  async findByCharacterId(characterId: string): Promise<Character | null> {
    return database.queryOne<Character>(
      "SELECT * FROM characters WHERE character_id = $1",
      [characterId]
    );
  }

  /**
   * Find all characters for an account
   */
  async findByAccountId(accountId: string): Promise<Character[]> {
    return database.query<Character>(
      "SELECT * FROM characters WHERE account_id = $1 ORDER BY created_at",
      [accountId]
    );
  }

  /**
   * Update character money (transactional)
   */
  async updateMoney(characterId: string, amount: number, idempotencyKey?: string): Promise<Character> {
    return database.transaction(async (client) => {
      // Check idempotency key if provided
      if (idempotencyKey) {
        const existing = await client.query(
          "SELECT id FROM financial_transactions WHERE idempotency_key = $1",
          [idempotencyKey]
        );
        if (existing.rows.length > 0) {
          throw new Error("Duplicate transaction");
        }
      }

      // Get current character
      const characterResult = await client.query(
        "SELECT * FROM characters WHERE character_id = $1 FOR UPDATE",
        [characterId]
      );

      if (characterResult.rows.length === 0) {
        throw new Error("Character not found");
      }

      const character = characterResult.rows[0];
      const newBalance = parseFloat(character.money) + amount;

      if (newBalance < 0) {
        throw new Error("Insufficient funds");
      }

      // Update character
      await client.query(
        "UPDATE characters SET money = $1, updated_at = NOW() WHERE character_id = $2",
        [newBalance, characterId]
      );

      // Record transaction
      await client.query(
        `INSERT INTO financial_transactions (character_id, transaction_type, amount, balance_after, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [character.id, amount >= 0 ? "credit" : "debit", amount, newBalance, idempotencyKey]
      );

      // Return updated character
      const updatedResult = await client.query(
        "SELECT * FROM characters WHERE character_id = $1",
        [characterId]
      );

      return updatedResult.rows[0];
    });
  }

  /**
   * Update character position
   */
  async updatePosition(characterId: string, position: { x: number; y: number }): Promise<void> {
    await database.query(
      "UPDATE characters SET position = $1, updated_at = NOW() WHERE character_id = $2",
      [JSON.stringify(position), characterId]
    );
  }

  /**
   * Delete character
   */
  async delete(id: string): Promise<void> {
    await database.query("DELETE FROM characters WHERE id = $1", [id]);
  }
}

export const accountRepository = new AccountRepository();
export const characterRepository = new CharacterRepository();
