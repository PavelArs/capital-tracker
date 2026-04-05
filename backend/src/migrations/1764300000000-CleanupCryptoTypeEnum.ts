import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanupCryptoTypeEnum1764300000000 implements MigrationInterface {
  name = 'CleanupCryptoTypeEnum1764300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Delete wallets with unsupported types
    await queryRunner.query(
      `DELETE FROM "crypto_wallets" WHERE "type" NOT IN ('bitcoin', 'ethereum')`,
    );

    // Recreate enum with only supported values
    await queryRunner.query(`ALTER TABLE "crypto_wallets" ALTER COLUMN "type" TYPE VARCHAR`);
    await queryRunner.query(`DROP TYPE IF EXISTS "crypto_wallets_type_enum"`);
    await queryRunner.query(
      `CREATE TYPE "crypto_wallets_type_enum" AS ENUM('bitcoin', 'ethereum')`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_wallets" ALTER COLUMN "type" TYPE "crypto_wallets_type_enum" USING "type"::"crypto_wallets_type_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore original enum with all values
    await queryRunner.query(`ALTER TABLE "crypto_wallets" ALTER COLUMN "type" TYPE VARCHAR`);
    await queryRunner.query(`DROP TYPE IF EXISTS "crypto_wallets_type_enum"`);
    await queryRunner.query(
      `CREATE TYPE "crypto_wallets_type_enum" AS ENUM('bitcoin', 'ethereum', 'polygon', 'binance_smart_chain', 'avalanche', 'solana', 'arbitrum', 'optimism', 'base', 'custom')`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_wallets" ALTER COLUMN "type" TYPE "crypto_wallets_type_enum" USING "type"::"crypto_wallets_type_enum"`,
    );
  }
}
