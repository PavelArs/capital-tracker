import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManualPriceCurrency1797400000000 implements MigrationInterface {
  name = 'AddManualPriceCurrency1797400000000';

  async up(runner: QueryRunner): Promise<void> {
    // AST-MANUAL-VALUE: a hand value keeps the currency it was set in, so 500,000 RUB stays
    // 500,000 RUB as the dollar rate moves. "priceUsd" holds the price in this currency; every
    // existing row was set in USD and keeps that meaning. No other table changes.
    await runner.query(`ALTER TABLE manual_usd_price_versions
      ADD COLUMN "quoteCurrency" text NOT NULL DEFAULT 'USD'
        CHECK ("quoteCurrency" IN ('USD', 'EUR', 'RUB'))`);
  }

  async down(): Promise<void> {
    throw new Error('Manual price currency downgrade requires an explicit recovery plan');
  }
}
