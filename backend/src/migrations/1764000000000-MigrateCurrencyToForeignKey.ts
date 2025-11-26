import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrateCurrencyToForeignKey1764000000000
  implements MigrationInterface
{
  name = "MigrateCurrencyToForeignKey1764000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Increase precision for amount columns to support cryptocurrencies (up to 8 decimal places)
    await queryRunner.query(
      `ALTER TABLE "assets" ALTER COLUMN "amount" TYPE numeric(20,8)`
    );

    await queryRunner.query(
      `ALTER TABLE "liabilities" ALTER COLUMN "amount" TYPE numeric(20,8)`
    );

    // Add currencyId column to assets table
    await queryRunner.query(`ALTER TABLE "assets" ADD "currencyId" uuid`);

    // Add currencyId column to liabilities table
    await queryRunner.query(`ALTER TABLE "liabilities" ADD "currencyId" uuid`);

    // Migrate data for assets: set currencyId based on currency code
    await queryRunner.query(`
      UPDATE "assets" a
      SET "currencyId" = c.id
      FROM "currencies" c
      WHERE c.code = a.currency
    `);

    // Migrate data for liabilities: set currencyId based on currency code
    await queryRunner.query(`
      UPDATE "liabilities" l
      SET "currencyId" = c.id
      FROM "currencies" c
      WHERE c.code = l.currency
    `);

    // For any records that couldn't be matched, set to USD
    await queryRunner.query(`
      UPDATE "assets" a
      SET "currencyId" = (SELECT id FROM "currencies" WHERE code = 'USD' LIMIT 1)
      WHERE "currencyId" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "liabilities" l
      SET "currencyId" = (SELECT id FROM "currencies" WHERE code = 'USD' LIMIT 1)
      WHERE "currencyId" IS NULL
    `);

    // Make currencyId NOT NULL
    await queryRunner.query(
      `ALTER TABLE "assets" ALTER COLUMN "currencyId" SET NOT NULL`
    );

    await queryRunner.query(
      `ALTER TABLE "liabilities" ALTER COLUMN "currencyId" SET NOT NULL`
    );

    // Drop old currency columns
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "currency"`);

    await queryRunner.query(`ALTER TABLE "liabilities" DROP COLUMN "currency"`);

    // Add foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "assets" ADD CONSTRAINT "FK_assets_currency" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );

    await queryRunner.query(
      `ALTER TABLE "liabilities" ADD CONSTRAINT "FK_liabilities_currency" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );

    // Add CHECK constraints to ensure positive amounts
    await queryRunner.query(
      `ALTER TABLE "assets" ADD CONSTRAINT "assets_amount_positive" CHECK (amount > 0)`
    );

    await queryRunner.query(
      `ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_amount_positive" CHECK (amount > 0)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop CHECK constraints
    await queryRunner.query(
      `ALTER TABLE "liabilities" DROP CONSTRAINT IF EXISTS "liabilities_amount_positive"`
    );

    await queryRunner.query(
      `ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_amount_positive"`
    );

    // Drop foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "liabilities" DROP CONSTRAINT "FK_liabilities_currency"`
    );

    await queryRunner.query(
      `ALTER TABLE "assets" DROP CONSTRAINT "FK_assets_currency"`
    );

    // Revert amount column precision back to original
    await queryRunner.query(
      `ALTER TABLE "assets" ALTER COLUMN "amount" TYPE numeric(15,2)`
    );

    await queryRunner.query(
      `ALTER TABLE "liabilities" ALTER COLUMN "amount" TYPE numeric(15,2)`
    );

    // Add back currency columns
    await queryRunner.query(
      `ALTER TABLE "liabilities" ADD "currency" character varying(3) NOT NULL DEFAULT 'USD'`
    );

    await queryRunner.query(
      `ALTER TABLE "assets" ADD "currency" character varying(3) NOT NULL DEFAULT 'USD'`
    );

    // Migrate data back: set currency code from currencyId
    await queryRunner.query(`
      UPDATE "assets" a
      SET "currency" = c.code
      FROM "currencies" c
      WHERE c.id = a."currencyId"
    `);

    await queryRunner.query(`
      UPDATE "liabilities" l
      SET "currency" = c.code
      FROM "currencies" c
      WHERE c.id = l."currencyId"
    `);

    // Drop currencyId columns
    await queryRunner.query(
      `ALTER TABLE "liabilities" DROP COLUMN "currencyId"`
    );

    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "currencyId"`);
  }
}
