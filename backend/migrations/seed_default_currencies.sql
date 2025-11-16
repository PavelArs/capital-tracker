-- Migration: Seed default currencies
-- This migration inserts default currencies into the currencies table
-- It's idempotent - safe to run multiple times

BEGIN;

-- Create currency_type_enum if it doesn't exist (TypeORM may create currencies_type_enum)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'currencies_type_enum'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_type WHERE typname = 'currency_type_enum'
    ) THEN
      CREATE TYPE currency_type_enum AS ENUM ('fiat', 'crypto', 'stablecoin');
    END IF;
  END IF;
END $$;

-- Insert default currencies (only if they don't exist)
-- Use the correct enum type (TypeORM creates currencies_type_enum)
DO $$
BEGIN
  -- USD - US Dollar (default)
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'USD') THEN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currencies_type_enum') THEN
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'USD', 'US Dollar', '$', 'fiat'::currencies_type_enum, true, true, NOW(), NOW());
    ELSE
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'USD', 'US Dollar', '$', 'fiat'::currency_type_enum, true, true, NOW(), NOW());
    END IF;
  END IF;

  -- EUR - Euro
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'EUR') THEN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currencies_type_enum') THEN
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'EUR', 'Euro', '€', 'fiat'::currencies_type_enum, true, false, NOW(), NOW());
    ELSE
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'EUR', 'Euro', '€', 'fiat'::currency_type_enum, true, false, NOW(), NOW());
    END IF;
  END IF;

  -- RUB - Russian Ruble
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'RUB') THEN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currencies_type_enum') THEN
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'RUB', 'Russian Ruble', '₽', 'fiat'::currencies_type_enum, true, false, NOW(), NOW());
    ELSE
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'RUB', 'Russian Ruble', '₽', 'fiat'::currency_type_enum, true, false, NOW(), NOW());
    END IF;
  END IF;

  -- BTC - Bitcoin
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'BTC') THEN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currencies_type_enum') THEN
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'BTC', 'Bitcoin', '₿', 'crypto'::currencies_type_enum, true, false, NOW(), NOW());
    ELSE
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'BTC', 'Bitcoin', '₿', 'crypto'::currency_type_enum, true, false, NOW(), NOW());
    END IF;
  END IF;

  -- ETH - Ethereum
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'ETH') THEN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currencies_type_enum') THEN
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'ETH', 'Ethereum', 'Ξ', 'crypto'::currencies_type_enum, true, false, NOW(), NOW());
    ELSE
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'ETH', 'Ethereum', 'Ξ', 'crypto'::currency_type_enum, true, false, NOW(), NOW());
    END IF;
  END IF;

  -- USDT - Tether
  IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'USDT') THEN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currencies_type_enum') THEN
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'USDT', 'Tether', '₮', 'stablecoin'::currencies_type_enum, true, false, NOW(), NOW());
    ELSE
      INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'USDT', 'Tether', '₮', 'stablecoin'::currency_type_enum, true, false, NOW(), NOW());
    END IF;
  END IF;
END $$;

COMMIT;

