import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropRemovedModuleTables1764200000000 implements MigrationInterface {
  name = 'DropRemovedModuleTables1764200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop tables that reference other tables first (foreign key order)
    await queryRunner.query(`DROP TABLE IF EXISTS "report" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invitation_code" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "capital" CASCADE`);

    // Remove subscriptionType column from users table
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "subscriptionType"`);

    // Drop the enum type
    await queryRunner.query(`DROP TYPE IF EXISTS "users_subscriptiontype_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the subscription type enum
    await queryRunner.query(
      `CREATE TYPE "users_subscriptiontype_enum" AS ENUM('free', 'pro', 'enterprise')`,
    );

    // Recreate subscriptionType column on users
    await queryRunner.query(
      `ALTER TABLE "users" ADD "subscriptionType" "users_subscriptiontype_enum" NOT NULL DEFAULT 'free'`,
    );

    // Recreate capital table
    await queryRunner.query(`
      CREATE TABLE "capital" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "description" character varying,
        "isDefault" boolean NOT NULL DEFAULT false,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_capital" PRIMARY KEY ("id"),
        CONSTRAINT "FK_capital_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Recreate invitation_code table
    await queryRunner.query(`
      CREATE TABLE "invitation_code" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying NOT NULL,
        "isUsed" boolean NOT NULL DEFAULT false,
        "createdByUserId" uuid,
        "usedByUserId" uuid,
        "usedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invitation_code" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_invitation_code_code" UNIQUE ("code")
      )
    `);

    // Recreate subscription table
    await queryRunner.query(`
      CREATE TABLE "subscription" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" character varying NOT NULL,
        "status" character varying NOT NULL,
        "startDate" TIMESTAMP NOT NULL,
        "endDate" TIMESTAMP,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscription_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Recreate report table
    await queryRunner.query(`
      CREATE TABLE "report" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "type" character varying NOT NULL,
        "format" character varying NOT NULL DEFAULT 'json',
        "config" jsonb NOT NULL DEFAULT '{}',
        "generatedData" jsonb,
        "userId" uuid NOT NULL,
        "capitalId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_report" PRIMARY KEY ("id"),
        CONSTRAINT "FK_report_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_report_capital" FOREIGN KEY ("capitalId") REFERENCES "capital"("id") ON DELETE SET NULL
      )
    `);
  }
}
