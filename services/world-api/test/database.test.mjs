import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseConnection, database, loadDatabaseConfigFromEnv } from "../dist/database/connection.js";
import { MigrationManager, migrationManager } from "../dist/database/migrations.js";
import { AccountRepository, CharacterRepository, accountRepository, characterRepository } from "../dist/database/repositories.js";

/**
 * Database integration tests for Stage 27
 * Tests database connection, schema, migrations, and repositories
 * 
 * NOTE: These tests require a PostgreSQL database to be available.
 * Live tests run only when DATABASE_URL is set AND NAIJA_ALLOW_DB_TESTS=true.
 */

// Live tests write rows and apply additive migrations, so they require BOTH a URL and an explicit opt-in.
// Point DATABASE_URL only at a disposable development or test database, never at data you need.
const hasDatabase = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
if (process.env.DATABASE_URL && !hasDatabase) {
  console.warn("[db-tests] DATABASE_URL is set but NAIJA_ALLOW_DB_TESTS is not set to the literal string true; live database tests are skipped.");
}

test("Database: module imports work without database", async () => {
  assert.ok(DatabaseConnection);
  assert.ok(database);
  assert.ok(loadDatabaseConfigFromEnv);
  assert.ok(MigrationManager);
  assert.ok(migrationManager);
  assert.ok(AccountRepository);
  assert.ok(CharacterRepository);
  assert.ok(accountRepository);
  assert.ok(characterRepository);
});

test("Database: loadDatabaseConfigFromEnv returns config", () => {
  const config = loadDatabaseConfigFromEnv();
  assert.ok(typeof config === "object");
});

test("Database: connection test", { skip: !hasDatabase }, async () => {
  const config = loadDatabaseConfigFromEnv();
  const db = database; // same connection the repositories use
  
  try {
    await db.connect();
    assert.ok(db.isConnectedToDatabase());
    
    const health = await db.healthCheck();
    assert.ok(health.healthy);
    assert.ok(health.latencyMs >= 0);
    
    await db.disconnect();
    assert.ok(!db.isConnectedToDatabase());
  } finally {
    await db.disconnect();
  }
});

test("Database: migration initialization", { skip: !hasDatabase }, async () => {
  const config = loadDatabaseConfigFromEnv();
  const db = database; // same connection the repositories use
  
  try {
    await db.connect();
    await migrationManager.initialize();
    
    const status = await migrationManager.getStatus();
    assert.ok(status.currentVersion >= 0);
    assert.ok(status.latestVersion >= 1);
    
  } finally {
    await db.disconnect();
  }
});

test("Database: account repository create and find", { skip: !hasDatabase }, async () => {
  const config = loadDatabaseConfigFromEnv();
  const db = database; // same connection the repositories use
  
  try {
    await db.connect();
    await migrationManager.migrate();
    
    // Create account
    const account = await accountRepository.create({
      username: `test_user_${Date.now()}`,
      email: `test_${Date.now()}@example.com`,
      password_hash: "test_hash",
      metadata: { test: true },
    });
    
    assert.ok(account.id);
    assert.ok(account.username.startsWith("test_user_"));
    assert.ok(account.is_active);
    
    // Find by ID
    const found = await accountRepository.findById(account.id);
    assert.ok(found);
    assert.equal(found.id, account.id);
    assert.equal(found.username, account.username);
    
    // Find by username
    const foundByUsername = await accountRepository.findByUsername(account.username);
    assert.ok(foundByUsername);
    assert.equal(foundByUsername.id, account.id);
    
    // Clean up
    await accountRepository.delete(account.id);
    
  } finally {
    await db.disconnect();
  }
});

test("Database: character repository create and find", { skip: !hasDatabase }, async () => {
  const config = loadDatabaseConfigFromEnv();
  const db = database; // same connection the repositories use
  
  try {
    await db.connect();
    await migrationManager.migrate();
    
    // Create account first
    const account = await accountRepository.create({
      username: `test_user_${Date.now()}`,
      password_hash: "test_hash",
    });
    
    // Create character
    const character = await characterRepository.create({
      account_id: account.id,
      character_id: `char_${Date.now()}`,
      name: "Test Character",
      character_type: "boy",
      age: 15,
      money: 1000,
      health: 100,
      energy: 100,
      hunger: 100,
      appearance: { skin_tone: "brown" },
      position: { x: 100, y: 200 },
      direction: { x: 1, y: 0 },
    });
    
    assert.ok(character.id);
    assert.equal(character.name, "Test Character");
    assert.equal(character.age, 15);
    assert.equal(character.money, 1000);
    
    // Find by character_id
    const found = await characterRepository.findByCharacterId(character.character_id);
    assert.ok(found);
    assert.equal(found.id, character.id);
    
    // Find by account_id
    const characters = await characterRepository.findByAccountId(account.id);
    assert.ok(characters.length > 0);
    assert.equal(characters[0].id, character.id);
    
    // Clean up
    await characterRepository.delete(character.id);
    await accountRepository.delete(account.id);
    
  } finally {
    await db.disconnect();
  }
});

test("Database: character money update with transaction", { skip: !hasDatabase }, async () => {
  const config = loadDatabaseConfigFromEnv();
  const db = database; // same connection the repositories use
  
  try {
    await db.connect();
    await migrationManager.migrate();
    
    // Create account and character
    const account = await accountRepository.create({
      username: `test_user_${Date.now()}`,
      password_hash: "test_hash",
    });
    
    const character = await characterRepository.create({
      account_id: account.id,
      character_id: `char_${Date.now()}`,
      name: "Test Character",
      character_type: "girl",
      age: 16,
      money: 500,
    });
    
    // Update money (credit)
    const updated = await characterRepository.updateMoney(character.character_id, 200, `idem_${Date.now()}`);
    assert.equal(updated.money, 700);
    
    // Update money (debit)
    const updated2 = await characterRepository.updateMoney(character.character_id, -100, `idem_${Date.now() + 1}`);
    assert.equal(updated2.money, 600);
    
    // Try to debit more than available (should fail)
    try {
      await characterRepository.updateMoney(character.character_id, -1000, `idem_${Date.now() + 2}`);
      assert.fail("Should have thrown error for insufficient funds");
    } catch (error) {
      assert.ok(error.message.includes("Insufficient funds"));
    }
    
    // Replaying the same idempotency key must not apply the amount twice
    const idemKey = `idem_duplicate_${Date.now()}`;
    const first = await characterRepository.updateMoney(character.character_id, 50, idemKey);
    const replay = await characterRepository.updateMoney(character.character_id, 50, idemKey);
    assert.equal(Number(first.money), Number(replay.money));
    assert.equal(Number(replay.money), Number(updated2.money) + 50);
    
    // Clean up
    await characterRepository.delete(character.id);
    await accountRepository.delete(account.id);
    
  } finally {
    await db.disconnect();
  }
});
