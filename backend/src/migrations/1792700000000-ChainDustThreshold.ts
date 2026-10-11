import { MigrationInterface, QueryRunner } from 'typeorm';

// CLS-DUST, additive: the owner's dust threshold in USD; existing owners start with none (off).
// The application validates the amount, so the column adds no CHECK a restore could reword.
export class ChainDustThreshold1792700000000 implements MigrationInterface {
  name = 'ChainDustThreshold1792700000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE owner_settings ADD COLUMN "dustThresholdUsd" numeric(20,8)');
  }

  async down(): Promise<void> {
    throw new Error('Dust threshold downgrade requires an explicit recovery plan');
  }
}
