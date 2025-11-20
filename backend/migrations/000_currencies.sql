-- Migration: Seed default currencies
-- This migration creates the currencies table and inserts default values
-- It's idempotent - safe to run multiple times

BEGIN;

-- Ensure uuid-ossp extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
DO $$
BEGIN
  -- Try to create currencies_type_enum if neither version exists
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currencies_type_enum') THEN
    CREATE TYPE currencies_type_enum AS ENUM ('fiat', 'crypto', 'stablecoin');
  END IF;
END $$;

-- Create currencies table if it doesn't exist
CREATE TABLE IF NOT EXISTS currencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR NOT NULL,
  symbol VARCHAR NOT NULL,
  type currencies_type_enum NOT NULL DEFAULT 'fiat'::currencies_type_enum,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "contractAddress" VARCHAR(42),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add contractAddress column if it doesn't exist (in case table existed but column didn't)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'currencies' AND column_name = 'contractAddress'
  ) THEN
    ALTER TABLE currencies ADD COLUMN "contractAddress" VARCHAR(42);
  END IF;
END $$;

-- Insert default currencies
DO $$
DECLARE
  v_enum_exists BOOLEAN;
  v_enum_name TEXT;
BEGIN
  -- Determine which enum to use (if any columns use it, though we defined type as VARCHAR above to be safe)
  -- But for inserting data we just insert strings, postgres handles cast if column is enum
  
  -- USD - US Dollar (default)
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'USD') THEN
    INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'USD', 'US Dollar', '$', 'fiat'::currencies_type_enum, true, true, NOW(), NOW());
  END IF;

  -- EUR - Euro
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'EUR') THEN
    INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'EUR', 'Euro', '€', 'fiat'::currencies_type_enum, true, false, NOW(), NOW());
  END IF;

  -- RUB - Russian Ruble
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'RUB') THEN
    INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'RUB', 'Russian Ruble', '₽', 'fiat'::currencies_type_enum, true, false, NOW(), NOW());
  END IF;

  -- BTC - Bitcoin
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'BTC') THEN
    INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'BTC', 'Bitcoin', '₿', 'crypto'::currencies_type_enum, true, false, NOW(), NOW());
  END IF;

  -- ETH - Ethereum
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'ETH') THEN
    INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'ETH', 'Ethereum', 'Ξ', 'crypto'::currencies_type_enum, true, false, NOW(), NOW());
  END IF;

  -- USDT - Tether
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'USDT') THEN
    INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "contractAddress", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'USDT', 'Tether', '₮', 'stablecoin'::currencies_type_enum, true, false, '0xdAC17F958D2ee523a2206206994597C13D831ec7', NOW(), NOW());
  ELSE
    -- Update existing USDT with contract address if it doesn't have one
    UPDATE currencies 
    SET "contractAddress" = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    WHERE code = 'USDT' AND ("contractAddress" IS NULL OR "contractAddress" = '');
  END IF;
END $$;

COMMIT;
