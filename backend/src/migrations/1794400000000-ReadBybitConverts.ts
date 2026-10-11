import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReadBybitConverts1794400000000 implements MigrationInterface {
  name = 'ReadBybitConverts1794400000000';

  async up(runner: QueryRunner): Promise<void> {
    // BYBIT-CONVERT: whether the key may read convert history (its Exchange permission), as
    // Bybit last said; null before the first pass that asked. A convert is stored as a trade
    // ("bybit-trade-convert-<id>"), which the record check already accepts.
    await runner.query(`ALTER TABLE bybit_accounts ADD COLUMN "convertAllowed" boolean`);
  }

  async down(): Promise<void> {
    throw new Error('Bybit convert downgrade requires an explicit recovery plan');
  }
}
