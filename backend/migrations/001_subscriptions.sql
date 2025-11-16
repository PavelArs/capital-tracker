-- Migration: Add subscriptions system
-- This migration creates all tables and enums for the subscription system
-- It's idempotent - safe to run multiple times

BEGIN;

-- Ensure uuid-ossp extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
DO $$
BEGIN
  -- Subscription type enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_type_enum') THEN
    CREATE TYPE subscription_type_enum AS ENUM ('free', 'pro', 'enterprise');
  END IF;

  -- Subscription status enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status_enum') THEN
    CREATE TYPE subscription_status_enum AS ENUM ('active', 'cancelled', 'expired');
  END IF;

  -- Integration status enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integration_status_enum') THEN
    CREATE TYPE integration_status_enum AS ENUM ('active', 'inactive', 'error');
  END IF;

  -- Broker type enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'broker_type_enum') THEN
    CREATE TYPE broker_type_enum AS ENUM (
      'interactive_brokers',
      'td_ameritrade',
      'charles_schwab',
      'e_trade',
      'robinhood',
      'custom'
    );
  END IF;

  -- Bank type enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bank_type_enum') THEN
    CREATE TYPE bank_type_enum AS ENUM (
      'chase',
      'bank_of_america',
      'wells_fargo',
      'citibank',
      'capital_one',
      'open_banking',
      'custom'
    );
  END IF;

  -- DeFi platform enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'defi_platform_enum') THEN
    CREATE TYPE defi_platform_enum AS ENUM (
      'uniswap',
      'aave',
      'compound',
      'curve',
      'balancer',
      'sushiswap',
      'pancakeswap',
      'custom'
    );
  END IF;

  -- DeFi position type enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'defi_position_type_enum') THEN
    CREATE TYPE defi_position_type_enum AS ENUM (
      'liquidity_pool',
      'lending',
      'staking',
      'yield_farming',
      'other'
    );
  END IF;

  -- AI recommendation type enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_recommendation_type_enum') THEN
    CREATE TYPE ai_recommendation_type_enum AS ENUM (
      'investment',
      'diversification',
      'risk_management',
      'asset_allocation',
      'debt_management',
      'tax_optimization',
      'other'
    );
  END IF;

  -- AI recommendation status enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_recommendation_status_enum') THEN
    CREATE TYPE ai_recommendation_status_enum AS ENUM (
      'pending',
      'accepted',
      'rejected',
      'implemented'
    );
  END IF;

  -- Report type enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_type_enum') THEN
    CREATE TYPE report_type_enum AS ENUM (
      'financial_summary',
      'asset_allocation',
      'performance',
      'tax',
      'custom'
    );
  END IF;

  -- Report format enum
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_format_enum') THEN
    CREATE TYPE report_format_enum AS ENUM ('pdf', 'excel', 'csv', 'json');
  END IF;
END $$;

-- Add subscriptionType column to users table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'subscriptionType'
  ) THEN
    -- Use existing enum type if TypeORM created it, otherwise create new one
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'users_subscriptiontype_enum') THEN
      ALTER TABLE users ADD COLUMN "subscriptionType" users_subscriptiontype_enum DEFAULT 'free'::users_subscriptiontype_enum;
    ELSE
      ALTER TABLE users ADD COLUMN "subscriptionType" subscription_type_enum DEFAULT 'free'::subscription_type_enum;
    END IF;
  END IF;
END $$;

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  type subscription_type_enum NOT NULL DEFAULT 'free'::subscription_type_enum,
  status subscription_status_enum NOT NULL DEFAULT 'active'::subscription_status_enum,
  "startDate" TIMESTAMP,
  "endDate" TIMESTAMP,
  "cancelledAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_subscriptions_user FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

-- Create broker_integrations table
CREATE TABLE IF NOT EXISTS broker_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  "brokerType" broker_type_enum NOT NULL,
  name VARCHAR NOT NULL,
  status integration_status_enum NOT NULL DEFAULT 'inactive'::integration_status_enum,
  credentials JSONB,
  config JSONB,
  "errorMessage" TEXT,
  "lastSyncAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_broker_integrations_user FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

-- Create bank_integrations table
CREATE TABLE IF NOT EXISTS bank_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  "bankType" bank_type_enum NOT NULL,
  name VARCHAR NOT NULL,
  status integration_status_enum NOT NULL DEFAULT 'inactive'::integration_status_enum,
  credentials JSONB,
  config JSONB,
  "errorMessage" TEXT,
  "lastSyncAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_bank_integrations_user FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

-- Create defi_positions table
CREATE TABLE IF NOT EXISTS defi_positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  platform defi_platform_enum NOT NULL,
  "positionType" defi_position_type_enum NOT NULL,
  name VARCHAR NOT NULL,
  "positionData" JSONB,
  value DECIMAL(30, 18) NOT NULL DEFAULT 0,
  apy DECIMAL(10, 4),
  description TEXT,
  "lastUpdated" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_defi_positions_user FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

-- Create ai_recommendations table
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  type ai_recommendation_type_enum NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  data JSONB,
  status ai_recommendation_status_enum NOT NULL DEFAULT 'pending'::ai_recommendation_status_enum,
  priority DECIMAL(10, 2),
  "reviewedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ai_recommendations_user FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

-- Create capitals table
CREATE TABLE IF NOT EXISTS capitals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  name VARCHAR NOT NULL,
  description TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_capitals_user FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  "capitalId" UUID,
  type report_type_enum NOT NULL,
  name VARCHAR NOT NULL,
  description TEXT,
  format report_format_enum NOT NULL DEFAULT 'pdf'::report_format_enum,
  parameters JSONB,
  data JSONB,
  "fileUrl" VARCHAR,
  "generatedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_reports_user FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_capital FOREIGN KEY ("capitalId") REFERENCES capitals(id) ON DELETE SET NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions("userId");
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_broker_integrations_user_id ON broker_integrations("userId");
CREATE INDEX IF NOT EXISTS idx_bank_integrations_user_id ON bank_integrations("userId");
CREATE INDEX IF NOT EXISTS idx_defi_positions_user_id ON defi_positions("userId");
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_user_id ON ai_recommendations("userId");
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_status ON ai_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_capitals_user_id ON capitals("userId");
CREATE INDEX IF NOT EXISTS idx_capitals_is_default ON capitals("isDefault");
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports("userId");
CREATE INDEX IF NOT EXISTS idx_reports_capital_id ON reports("capitalId");

-- Create function to update updatedAt timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updatedAt
DO $$
BEGIN
  -- Subscriptions
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_subscriptions_updated_at') THEN
    CREATE TRIGGER update_subscriptions_updated_at
      BEFORE UPDATE ON subscriptions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- Broker integrations
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_broker_integrations_updated_at') THEN
    CREATE TRIGGER update_broker_integrations_updated_at
      BEFORE UPDATE ON broker_integrations
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- Bank integrations
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_bank_integrations_updated_at') THEN
    CREATE TRIGGER update_bank_integrations_updated_at
      BEFORE UPDATE ON bank_integrations
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- DeFi positions
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_defi_positions_updated_at') THEN
    CREATE TRIGGER update_defi_positions_updated_at
      BEFORE UPDATE ON defi_positions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- AI recommendations
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_recommendations_updated_at') THEN
    CREATE TRIGGER update_ai_recommendations_updated_at
      BEFORE UPDATE ON ai_recommendations
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- Capitals
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_capitals_updated_at') THEN
    CREATE TRIGGER update_capitals_updated_at
      BEFORE UPDATE ON capitals
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- Reports
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_reports_updated_at') THEN
    CREATE TRIGGER update_reports_updated_at
      BEFORE UPDATE ON reports
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Set default subscription for existing users
DO $$
BEGIN
  -- Check which enum type exists and use it
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'users_subscriptiontype_enum') THEN
    UPDATE users
    SET "subscriptionType" = 'free'::users_subscriptiontype_enum
    WHERE "subscriptionType" IS NULL;
  ELSIF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_type_enum') THEN
    UPDATE users
    SET "subscriptionType" = 'free'::subscription_type_enum
    WHERE "subscriptionType" IS NULL;
  END IF;
END $$;

COMMIT;

