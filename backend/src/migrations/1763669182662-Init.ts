import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1763669182662 implements MigrationInterface {
    name = 'Init1763669182662'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_type_enum" AS ENUM('free', 'pro', 'enterprise')`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('active', 'cancelled', 'expired')`);
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" "public"."subscriptions_type_enum" NOT NULL DEFAULT 'free', "status" "public"."subscriptions_status_enum" NOT NULL DEFAULT 'active', "startDate" TIMESTAMP, "endDate" TIMESTAMP, "cancelledAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "capitals" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" character varying NOT NULL, "description" text, "isActive" boolean NOT NULL DEFAULT true, "isDefault" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_68ef93064b15baf1b3de78ee343" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."users_subscriptiontype_enum" AS ENUM('free', 'pro', 'enterprise')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password" character varying NOT NULL, "firstName" character varying, "lastName" character varying, "subscriptionType" "public"."users_subscriptiontype_enum" NOT NULL DEFAULT 'free', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."defi_positions_platform_enum" AS ENUM('uniswap', 'aave', 'compound', 'curve', 'balancer', 'sushiswap', 'pancakeswap', 'custom')`);
        await queryRunner.query(`CREATE TYPE "public"."defi_positions_positiontype_enum" AS ENUM('liquidity_pool', 'lending', 'staking', 'yield_farming', 'other')`);
        await queryRunner.query(`CREATE TABLE "defi_positions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "platform" "public"."defi_positions_platform_enum" NOT NULL, "positionType" "public"."defi_positions_positiontype_enum" NOT NULL, "name" character varying NOT NULL, "positionData" jsonb, "value" numeric(30,18) NOT NULL DEFAULT '0', "apy" numeric(10,4), "description" text, "lastUpdated" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a4955edb057ab1d7af8ac8aba10" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."reports_type_enum" AS ENUM('financial_summary', 'asset_allocation', 'performance', 'tax', 'custom')`);
        await queryRunner.query(`CREATE TYPE "public"."reports_format_enum" AS ENUM('pdf', 'excel', 'csv', 'json')`);
        await queryRunner.query(`CREATE TABLE "reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "capitalId" uuid, "type" "public"."reports_type_enum" NOT NULL, "name" character varying NOT NULL, "description" text, "format" "public"."reports_format_enum" NOT NULL DEFAULT 'pdf', "parameters" jsonb, "data" jsonb, "fileUrl" character varying, "generatedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."crypto_wallets_type_enum" AS ENUM('bitcoin', 'ethereum', 'polygon', 'binance_smart_chain', 'avalanche', 'solana', 'arbitrum', 'optimism', 'base', 'custom')`);
        await queryRunner.query(`CREATE TABLE "crypto_wallets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" "public"."crypto_wallets_type_enum" NOT NULL, "address" character varying NOT NULL, "balance" numeric(30,18) NOT NULL DEFAULT '0', "tokens" jsonb, "lastUpdated" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ab617b06d429e7eac0d49114712" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."broker_integrations_brokertype_enum" AS ENUM('interactive_brokers', 'td_ameritrade', 'charles_schwab', 'e_trade', 'robinhood', 'custom')`);
        await queryRunner.query(`CREATE TYPE "public"."broker_integrations_status_enum" AS ENUM('active', 'inactive', 'error')`);
        await queryRunner.query(`CREATE TABLE "broker_integrations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "brokerType" "public"."broker_integrations_brokertype_enum" NOT NULL, "name" character varying NOT NULL, "status" "public"."broker_integrations_status_enum" NOT NULL DEFAULT 'inactive', "credentials" jsonb, "config" jsonb, "errorMessage" text, "lastSyncAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_94ce6ff27f93c2bd7ac77597dae" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."bank_integrations_banktype_enum" AS ENUM('chase', 'bank_of_america', 'wells_fargo', 'citibank', 'capital_one', 'open_banking', 'custom')`);
        await queryRunner.query(`CREATE TYPE "public"."bank_integrations_status_enum" AS ENUM('active', 'inactive', 'error')`);
        await queryRunner.query(`CREATE TABLE "bank_integrations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "bankType" "public"."bank_integrations_banktype_enum" NOT NULL, "name" character varying NOT NULL, "status" "public"."bank_integrations_status_enum" NOT NULL DEFAULT 'inactive', "credentials" jsonb, "config" jsonb, "errorMessage" text, "lastSyncAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_48d89e0dd7343c372749f4329d6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."ai_recommendations_type_enum" AS ENUM('investment', 'diversification', 'risk_management', 'asset_allocation', 'debt_management', 'tax_optimization', 'other')`);
        await queryRunner.query(`CREATE TYPE "public"."ai_recommendations_status_enum" AS ENUM('pending', 'accepted', 'rejected', 'implemented')`);
        await queryRunner.query(`CREATE TABLE "ai_recommendations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" "public"."ai_recommendations_type_enum" NOT NULL, "title" text NOT NULL, "description" text NOT NULL, "data" jsonb, "status" "public"."ai_recommendations_status_enum" NOT NULL DEFAULT 'pending', "priority" numeric(10,2), "reviewedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_57aa33b4356a91e94e98bcd3f2d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."assets_assettype_enum" AS ENUM('stock', 'flow')`);
        await queryRunner.query(`CREATE TYPE "public"."assets_category_enum" AS ENUM('real_estate', 'investments', 'savings', 'crypto', 'vehicle', 'equipment', 'salary', 'dividends', 'freelance', 'rent_income', 'pension', 'other')`);
        await queryRunner.query(`CREATE TYPE "public"."assets_incometype_enum" AS ENUM('active', 'passive')`);
        await queryRunner.query(`CREATE TABLE "assets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" character varying NOT NULL, "assetType" "public"."assets_assettype_enum" NOT NULL DEFAULT 'stock', "category" "public"."assets_category_enum" NOT NULL, "incomeType" "public"."assets_incometype_enum", "amount" numeric(15,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'USD', "date" date NOT NULL, "description" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_da96729a8b113377cfb6a62439c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."liabilities_category_enum" AS ENUM('subscriptions', 'regular_expenses', 'loans', 'mortgage', 'credit_card', 'other')`);
        await queryRunner.query(`CREATE TYPE "public"."liabilities_frequency_enum" AS ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly')`);
        await queryRunner.query(`CREATE TABLE "liabilities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" character varying NOT NULL, "category" "public"."liabilities_category_enum" NOT NULL, "amount" numeric(15,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'USD', "date" date NOT NULL, "description" text, "frequency" "public"."liabilities_frequency_enum", "deadline" date, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4ef7aa825c6104e95f787636bb8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."currencies_type_enum" AS ENUM('fiat', 'crypto', 'stablecoin')`);
        await queryRunner.query(`CREATE TABLE "currencies" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(10) NOT NULL, "name" character varying NOT NULL, "symbol" character varying NOT NULL, "type" "public"."currencies_type_enum" NOT NULL DEFAULT 'fiat', "isActive" boolean NOT NULL DEFAULT true, "isDefault" boolean NOT NULL DEFAULT false, "contractAddress" character varying(42), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9f8d0972aeeb5a2277e40332d29" UNIQUE ("code"), CONSTRAINT "PK_d528c54860c4182db13548e08c4" PRIMARY KEY ("id"))`);
        
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
        
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_fbdba4e2ac694cf8c9cecf4dc84" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "capitals" ADD CONSTRAINT "FK_190ac678130a672ef4ecaa96a0f" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "defi_positions" ADD CONSTRAINT "FK_02028a4e70e3f66e59a8c74105a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reports" ADD CONSTRAINT "FK_bed415cd29716cd707e9cb3c09c" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reports" ADD CONSTRAINT "FK_b4e8a7d2d3a4605b75615056f91" FOREIGN KEY ("capitalId") REFERENCES "capitals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_wallets" ADD CONSTRAINT "FK_3a7eb321b4b1f0be7f8b0e68127" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "broker_integrations" ADD CONSTRAINT "FK_4f36096ac4b1f71d313168e82a8" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bank_integrations" ADD CONSTRAINT "FK_ff9fc9ca5d6b4025a4dc5007207" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ai_recommendations" ADD CONSTRAINT "FK_a3957c679eb0304766c381d25e8" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "assets" ADD CONSTRAINT "FK_d8cf9bdec7d2fad0852aec349c1" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liabilities" ADD CONSTRAINT "FK_a07746c7a2059be1a8ca32cc2c1" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "liabilities" DROP CONSTRAINT "FK_a07746c7a2059be1a8ca32cc2c1"`);
        await queryRunner.query(`ALTER TABLE "assets" DROP CONSTRAINT "FK_d8cf9bdec7d2fad0852aec349c1"`);
        await queryRunner.query(`ALTER TABLE "ai_recommendations" DROP CONSTRAINT "FK_a3957c679eb0304766c381d25e8"`);
        await queryRunner.query(`ALTER TABLE "bank_integrations" DROP CONSTRAINT "FK_ff9fc9ca5d6b4025a4dc5007207"`);
        await queryRunner.query(`ALTER TABLE "broker_integrations" DROP CONSTRAINT "FK_4f36096ac4b1f71d313168e82a8"`);
        await queryRunner.query(`ALTER TABLE "crypto_wallets" DROP CONSTRAINT "FK_3a7eb321b4b1f0be7f8b0e68127"`);
        await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT "FK_b4e8a7d2d3a4605b75615056f91"`);
        await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT "FK_bed415cd29716cd707e9cb3c09c"`);
        await queryRunner.query(`ALTER TABLE "defi_positions" DROP CONSTRAINT "FK_02028a4e70e3f66e59a8c74105a"`);
        await queryRunner.query(`ALTER TABLE "capitals" DROP CONSTRAINT "FK_190ac678130a672ef4ecaa96a0f"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_fbdba4e2ac694cf8c9cecf4dc84"`);
        await queryRunner.query(`DROP TABLE "currencies"`);
        await queryRunner.query(`DROP TYPE "public"."currencies_type_enum"`);
        await queryRunner.query(`DROP TABLE "liabilities"`);
        await queryRunner.query(`DROP TYPE "public"."liabilities_frequency_enum"`);
        await queryRunner.query(`DROP TYPE "public"."liabilities_category_enum"`);
        await queryRunner.query(`DROP TABLE "assets"`);
        await queryRunner.query(`DROP TYPE "public"."assets_incometype_enum"`);
        await queryRunner.query(`DROP TYPE "public"."assets_category_enum"`);
        await queryRunner.query(`DROP TYPE "public"."assets_assettype_enum"`);
        await queryRunner.query(`DROP TABLE "ai_recommendations"`);
        await queryRunner.query(`DROP TYPE "public"."ai_recommendations_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."ai_recommendations_type_enum"`);
        await queryRunner.query(`DROP TABLE "bank_integrations"`);
        await queryRunner.query(`DROP TYPE "public"."bank_integrations_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."bank_integrations_banktype_enum"`);
        await queryRunner.query(`DROP TABLE "broker_integrations"`);
        await queryRunner.query(`DROP TYPE "public"."broker_integrations_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."broker_integrations_brokertype_enum"`);
        await queryRunner.query(`DROP TABLE "crypto_wallets"`);
        await queryRunner.query(`DROP TYPE "public"."crypto_wallets_type_enum"`);
        await queryRunner.query(`DROP TABLE "reports"`);
        await queryRunner.query(`DROP TYPE "public"."reports_format_enum"`);
        await queryRunner.query(`DROP TYPE "public"."reports_type_enum"`);
        await queryRunner.query(`DROP TABLE "defi_positions"`);
        await queryRunner.query(`DROP TYPE "public"."defi_positions_positiontype_enum"`);
        await queryRunner.query(`DROP TYPE "public"."defi_positions_platform_enum"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_subscriptiontype_enum"`);
        await queryRunner.query(`DROP TABLE "capitals"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_type_enum"`);
    }

}
