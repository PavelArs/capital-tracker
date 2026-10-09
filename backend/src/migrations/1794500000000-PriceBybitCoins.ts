import { MigrationInterface, QueryRunner } from 'typeorm';

export class PriceBybitCoins1794500000000 implements MigrationInterface {
  name = 'PriceBybitCoins1794500000000';

  async up(runner: QueryRunner): Promise<void> {
    // BYBIT-ANY-COIN: a coin Kraken and CoinGecko are not asked for is priced from Bybit's
    // spot market. The column is text, so the restored CHECK reads back the same.
    await runner.query(`ALTER TABLE price_observations
      DROP CONSTRAINT price_observations_source_check,
      ADD CONSTRAINT price_observations_source_check
        CHECK (source IN ('kraken','coingecko','bybit'))`);
    // When the account began counting every coin it holds; null: its records were read for
    // BTC, ETH, SOL, USDT and USDC only, and the next sync reads them again for the rest.
    await runner.query(`ALTER TABLE bybit_accounts ADD COLUMN "everyCoinAt" timestamptz`);
  }

  async down(): Promise<void> {
    throw new Error('Bybit coin pricing downgrade requires an explicit recovery plan');
  }
}
