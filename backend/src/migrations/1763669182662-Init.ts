import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1763669182662 implements MigrationInterface {
    name = 'Init1763669182662'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Helper function to create enum type if not exists
        const createEnumIfNotExists = async (enumName: string, enumValues: string[]) => {
            await queryRunner.query(`
                DO $$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') THEN
                        CREATE TYPE "public"."${enumName}" AS ENUM(${enumValues.map(v => `'${v}'`).join(', ')});
                    END IF;
                END $$;
            `);
        };

        // Create all enum types
        await createEnumIfNotExists('subscriptions_type_enum', ['free', 'pro', 'enterprise']);
        await createEnumIfNotExists('subscriptions_status_enum', ['active', 'cancelled', 'expired']);
        await createEnumIfNotExists('users_subscriptiontype_enum', ['free', 'pro', 'enterprise']);
        await createEnumIfNotExists('defi_positions_platform_enum', ['uniswap', 'aave', 'compound', 'curve', 'balancer', 'sushiswap', 'pancakeswap', 'custom']);
        await createEnumIfNotExists('defi_positions_positiontype_enum', ['liquidity_pool', 'lending', 'staking', 'yield_farming', 'other']);
        await createEnumIfNotExists('reports_type_enum', ['financial_summary', 'asset_allocation', 'performance', 'tax', 'custom']);
        await createEnumIfNotExists('reports_format_enum', ['pdf', 'excel', 'csv', 'json']);
        await createEnumIfNotExists('crypto_wallets_type_enum', ['bitcoin', 'ethereum', 'polygon', 'binance_smart_chain', 'avalanche', 'solana', 'arbitrum', 'optimism', 'base', 'custom']);
        await createEnumIfNotExists('broker_integrations_brokertype_enum', ['interactive_brokers', 'td_ameritrade', 'charles_schwab', 'e_trade', 'robinhood', 'custom']);
        await createEnumIfNotExists('broker_integrations_status_enum', ['active', 'inactive', 'error']);
        await createEnumIfNotExists('bank_integrations_banktype_enum', ['chase', 'bank_of_america', 'wells_fargo', 'citibank', 'capital_one', 'open_banking', 'custom']);
        await createEnumIfNotExists('bank_integrations_status_enum', ['active', 'inactive', 'error']);
        await createEnumIfNotExists('ai_recommendations_type_enum', ['investment', 'diversification', 'risk_management', 'asset_allocation', 'debt_management', 'tax_optimization', 'other']);
        await createEnumIfNotExists('ai_recommendations_status_enum', ['pending', 'accepted', 'rejected', 'implemented']);
        await createEnumIfNotExists('assets_assettype_enum', ['stock', 'flow']);
        await createEnumIfNotExists('assets_category_enum', ['real_estate', 'investments', 'savings', 'crypto', 'vehicle', 'equipment', 'salary', 'dividends', 'freelance', 'rent_income', 'pension', 'other']);
        await createEnumIfNotExists('assets_incometype_enum', ['active', 'passive']);
        await createEnumIfNotExists('liabilities_category_enum', ['subscriptions', 'regular_expenses', 'loans', 'mortgage', 'credit_card', 'other']);
        await createEnumIfNotExists('liabilities_frequency_enum', ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);
        await createEnumIfNotExists('currencies_type_enum', ['fiat', 'crypto', 'stablecoin']);

        // Create tables with IF NOT EXISTS
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" "public"."subscriptions_type_enum" NOT NULL DEFAULT 'free', "status" "public"."subscriptions_status_enum" NOT NULL DEFAULT 'active', "startDate" TIMESTAMP, "endDate" TIMESTAMP, "cancelledAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "capitals" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" character varying NOT NULL, "description" text, "isActive" boolean NOT NULL DEFAULT true, "isDefault" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_68ef93064b15baf1b3de78ee343" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password" character varying NOT NULL, "firstName" character varying, "lastName" character varying, "subscriptionType" "public"."users_subscriptiontype_enum" NOT NULL DEFAULT 'free', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "defi_positions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "platform" "public"."defi_positions_platform_enum" NOT NULL, "positionType" "public"."defi_positions_positiontype_enum" NOT NULL, "name" character varying NOT NULL, "positionData" jsonb, "value" numeric(30,18) NOT NULL DEFAULT '0', "apy" numeric(10,4), "description" text, "lastUpdated" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a4955edb057ab1d7af8ac8aba10" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "capitalId" uuid, "type" "public"."reports_type_enum" NOT NULL, "name" character varying NOT NULL, "description" text, "format" "public"."reports_format_enum" NOT NULL DEFAULT 'pdf', "parameters" jsonb, "data" jsonb, "fileUrl" character varying, "generatedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "crypto_wallets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" "public"."crypto_wallets_type_enum" NOT NULL, "address" character varying NOT NULL, "balance" numeric(30,18) NOT NULL DEFAULT '0', "tokens" jsonb, "lastUpdated" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ab617b06d429e7eac0d49114712" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "broker_integrations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "brokerType" "public"."broker_integrations_brokertype_enum" NOT NULL, "name" character varying NOT NULL, "status" "public"."broker_integrations_status_enum" NOT NULL DEFAULT 'inactive', "credentials" jsonb, "config" jsonb, "errorMessage" text, "lastSyncAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_94ce6ff27f93c2bd7ac77597dae" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "bank_integrations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "bankType" "public"."bank_integrations_banktype_enum" NOT NULL, "name" character varying NOT NULL, "status" "public"."bank_integrations_status_enum" NOT NULL DEFAULT 'inactive', "credentials" jsonb, "config" jsonb, "errorMessage" text, "lastSyncAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_48d89e0dd7343c372749f4329d6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "ai_recommendations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" "public"."ai_recommendations_type_enum" NOT NULL, "title" text NOT NULL, "description" text NOT NULL, "data" jsonb, "status" "public"."ai_recommendations_status_enum" NOT NULL DEFAULT 'pending', "priority" numeric(10,2), "reviewedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_57aa33b4356a91e94e98bcd3f2d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "assets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" character varying NOT NULL, "assetType" "public"."assets_assettype_enum" NOT NULL DEFAULT 'stock', "category" "public"."assets_category_enum" NOT NULL, "incomeType" "public"."assets_incometype_enum", "amount" numeric(15,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'USD', "date" date NOT NULL, "description" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_da96729a8b113377cfb6a62439c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "liabilities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" character varying NOT NULL, "category" "public"."liabilities_category_enum" NOT NULL, "amount" numeric(15,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'USD', "date" date NOT NULL, "description" text, "frequency" "public"."liabilities_frequency_enum", "deadline" date, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4ef7aa825c6104e95f787636bb8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "currencies" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(10) NOT NULL, "name" character varying NOT NULL, "symbol" character varying NOT NULL, "type" "public"."currencies_type_enum" NOT NULL DEFAULT 'fiat', "isActive" boolean NOT NULL DEFAULT true, "isDefault" boolean NOT NULL DEFAULT false, "contractAddress" character varying(42), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9f8d0972aeeb5a2277e40332d29" UNIQUE ("code"), CONSTRAINT "PK_d528c54860c4182db13548e08c4" PRIMARY KEY ("id"))`);
        
        // Seed default currencies
        await queryRunner.query(`
            INSERT INTO "currencies" ("code", "name", "symbol", "type", "isActive", "isDefault") 
            VALUES 
                ('USD', 'US Dollar', '$', 'fiat', true, true),
                ('EUR', 'Euro', '€', 'fiat', true, false),
                ('RUB', 'Russian Ruble', '₽', 'fiat', true, false),
                ('BTC', 'Bitcoin', '₿', 'crypto', true, false),
                ('ETH', 'Ethereum', 'Ξ', 'crypto', true, false),
                ('USDT', 'Tether', '₮', 'stablecoin', true, false)
            ON CONFLICT (code) DO NOTHING
        `);
        
        // Add foreign keys only if they don't exist
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_fbdba4e2ac694cf8c9cecf4dc84') THEN
                    ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_fbdba4e2ac694cf8c9cecf4dc84" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_190ac678130a672ef4ecaa96a0f') THEN
                    ALTER TABLE "capitals" ADD CONSTRAINT "FK_190ac678130a672ef4ecaa96a0f" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_d8cf9bdec7d2fad0852aec349c1') THEN
                    ALTER TABLE "assets" ADD CONSTRAINT "FK_d8cf9bdec7d2fad0852aec349c1" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_a07746c7a2059be1a8ca32cc2c1') THEN
                    ALTER TABLE "liabilities" ADD CONSTRAINT "FK_a07746c7a2059be1a8ca32cc2c1" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_3a7eb321b4b1f0be7f8b0e68127') THEN
                    ALTER TABLE "crypto_wallets" ADD CONSTRAINT "FK_3a7eb321b4b1f0be7f8b0e68127" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_94ce6ff27f93c2bd7ac77597dae_userId') THEN
                    ALTER TABLE "broker_integrations" ADD CONSTRAINT "FK_94ce6ff27f93c2bd7ac77597dae_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_48d89e0dd7343c372749f4329d6_userId') THEN
                    ALTER TABLE "bank_integrations" ADD CONSTRAINT "FK_48d89e0dd7343c372749f4329d6_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_a4955edb057ab1d7af8ac8aba10_userId') THEN
                    ALTER TABLE "defi_positions" ADD CONSTRAINT "FK_a4955edb057ab1d7af8ac8aba10_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_57aa33b4356a91e94e98bcd3f2d_userId') THEN
                    ALTER TABLE "ai_recommendations" ADD CONSTRAINT "FK_57aa33b4356a91e94e98bcd3f2d_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_d9013193989303580053c0b5ef6_userId') THEN
                    ALTER TABLE "reports" ADD CONSTRAINT "FK_d9013193989303580053c0b5ef6_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_d9013193989303580053c0b5ef6_capitalId') THEN
                    ALTER TABLE "reports" ADD CONSTRAINT "FK_d9013193989303580053c0b5ef6_capitalId" FOREIGN KEY ("capitalId") REFERENCES "capitals"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop foreign keys
        await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "FK_d9013193989303580053c0b5ef6_capitalId"`);
        await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "FK_d9013193989303580053c0b5ef6_userId"`);
        await queryRunner.query(`ALTER TABLE "ai_recommendations" DROP CONSTRAINT IF EXISTS "FK_57aa33b4356a91e94e98bcd3f2d_userId"`);
        await queryRunner.query(`ALTER TABLE "defi_positions" DROP CONSTRAINT IF EXISTS "FK_a4955edb057ab1d7af8ac8aba10_userId"`);
        await queryRunner.query(`ALTER TABLE "bank_integrations" DROP CONSTRAINT IF EXISTS "FK_48d89e0dd7343c372749f4329d6_userId"`);
        await queryRunner.query(`ALTER TABLE "broker_integrations" DROP CONSTRAINT IF EXISTS "FK_94ce6ff27f93c2bd7ac77597dae_userId"`);
        await queryRunner.query(`ALTER TABLE "crypto_wallets" DROP CONSTRAINT IF EXISTS "FK_3a7eb321b4b1f0be7f8b0e68127"`);
        await queryRunner.query(`ALTER TABLE "liabilities" DROP CONSTRAINT IF EXISTS "FK_a07746c7a2059be1a8ca32cc2c1"`);
        await queryRunner.query(`ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "FK_d8cf9bdec7d2fad0852aec349c1"`);
        await queryRunner.query(`ALTER TABLE "capitals" DROP CONSTRAINT IF EXISTS "FK_190ac678130a672ef4ecaa96a0f"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "FK_fbdba4e2ac694cf8c9cecf4dc84"`);
        
        // Drop tables
        await queryRunner.query(`DROP TABLE IF EXISTS "currencies"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "liabilities"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "assets"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "ai_recommendations"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "bank_integrations"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "broker_integrations"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "crypto_wallets"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "reports"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "defi_positions"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "capitals"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "subscriptions"`);
        
        // Drop enum types
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."currencies_type_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."liabilities_frequency_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."liabilities_category_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."assets_incometype_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."assets_category_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."assets_assettype_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."ai_recommendations_status_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."ai_recommendations_type_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."bank_integrations_status_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."bank_integrations_banktype_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."broker_integrations_status_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."broker_integrations_brokertype_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."crypto_wallets_type_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."reports_format_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."reports_type_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."defi_positions_positiontype_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."defi_positions_platform_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."users_subscriptiontype_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."subscriptions_status_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."subscriptions_type_enum"`);
    }
}
