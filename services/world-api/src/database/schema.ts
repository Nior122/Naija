/**
 * Database schema definitions for Naija: One World
 * Defines the PostgreSQL schema for persistent game state
 */

export const SCHEMA_VERSION = 1;

export const CREATE_SCHEMA_SQL = `
-- Naija: One World Database Schema
-- Version: ${SCHEMA_VERSION}

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Accounts table (player identities)
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Characters table (player characters)
CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  character_type VARCHAR(50) NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 0 AND age <= 9998),
  money NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (money >= 0),
  health NUMERIC(5, 2) NOT NULL DEFAULT 100 CHECK (health >= 0 AND health <= 100),
  energy NUMERIC(5, 2) NOT NULL DEFAULT 100 CHECK (energy >= 0 AND energy <= 100),
  hunger NUMERIC(5, 2) NOT NULL DEFAULT 100 CHECK (hunger >= 0 AND hunger <= 100),
  appearance JSONB NOT NULL DEFAULT '{}'::jsonb,
  position JSONB NOT NULL DEFAULT '{"x": 0, "y": 0}'::jsonb,
  direction JSONB NOT NULL DEFAULT '{"x": 0, "y": 0}'::jsonb,
  current_location VARCHAR(255),
  home_id VARCHAR(255),
  school_id VARCHAR(255),
  education_level VARCHAR(255),
  geographic_location VARCHAR(255),
  life_status VARCHAR(50) DEFAULT 'alive',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inventory table
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id VARCHAR(255) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  category VARCHAR(255) NOT NULL,
  hunger_restore NUMERIC(5, 2),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(character_id, item_id)
);

-- Financial transactions table (ledger)
CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  transaction_type VARCHAR(50) NOT NULL,
  amount NUMERIC(20, 2) NOT NULL,
  balance_after NUMERIC(20, 2) NOT NULL,
  description TEXT,
  idempotency_key VARCHAR(255) UNIQUE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Businesses table
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  owner_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
  business_type VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  capital NUMERIC(20, 2) DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Properties table
CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id VARCHAR(255) UNIQUE NOT NULL,
  owner_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
  property_type VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  value NUMERIC(20, 2) DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Education records table
CREATE TABLE IF NOT EXISTS education_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  school_id VARCHAR(255) NOT NULL,
  enrollment_date TIMESTAMP WITH TIME ZONE,
  graduation_date TIMESTAMP WITH TIME ZONE,
  status VARCHAR(50),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Employment records table
CREATE TABLE IF NOT EXISTS employment_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  employer_id VARCHAR(255),
  job_title VARCHAR(255),
  salary NUMERIC(20, 2),
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  status VARCHAR(50),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions table (for multiplayer session management)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(255) UNIQUE NOT NULL,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  server_instance_id VARCHAR(255) NOT NULL,
  region_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_heartbeat_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Region ownership table (for multi-instance coordination)
CREATE TABLE IF NOT EXISTS region_ownership (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  region_id VARCHAR(255) UNIQUE NOT NULL,
  server_instance_id VARCHAR(255) NOT NULL,
  fencing_token BIGINT NOT NULL DEFAULT 0,
  leased_until TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Idempotency store (for preventing duplicate operations)
CREATE TABLE IF NOT EXISTS idempotency_store (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  operation_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- World state table (for global authoritative state)
CREATE TABLE IF NOT EXISTS world_state (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type VARCHAR(255) NOT NULL,
  entity_type VARCHAR(255),
  entity_id VARCHAR(255),
  actor_id VARCHAR(255),
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_characters_account_id ON characters(account_id);
CREATE INDEX IF NOT EXISTS idx_characters_character_id ON characters(character_id);
CREATE INDEX IF NOT EXISTS idx_inventory_character_id ON inventory(character_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_character_id ON financial_transactions(character_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_idempotency_key ON financial_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_businesses_owner_character_id ON businesses(owner_character_id);
CREATE INDEX IF NOT EXISTS idx_properties_owner_character_id ON properties(owner_character_id);
CREATE INDEX IF NOT EXISTS idx_education_records_character_id ON education_records(character_id);
CREATE INDEX IF NOT EXISTS idx_employment_records_character_id ON employment_records(character_id);
CREATE INDEX IF NOT EXISTS idx_sessions_character_id ON sessions(character_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_region_ownership_region_id ON region_ownership(region_id);
CREATE INDEX IF NOT EXISTS idx_region_ownership_server_instance_id ON region_ownership(server_instance_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_store_idempotency_key ON idempotency_store(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_idempotency_store_expires_at ON idempotency_store(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON audit_log(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
`;

export const DROP_SCHEMA_SQL = `
-- Drop all tables in reverse dependency order
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS world_state CASCADE;
DROP TABLE IF EXISTS idempotency_store CASCADE;
DROP TABLE IF EXISTS region_ownership CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS employment_records CASCADE;
DROP TABLE IF EXISTS education_records CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS businesses CASCADE;
DROP TABLE IF EXISTS financial_transactions CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS characters CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
`;
