import { MigrationInterface, QueryRunner } from 'typeorm';

// Frozen copy of the market tickers known when this migration was written.
const marketTickers = ['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'ZEC', 'TRX', 'XLM'];

export class ClassifyAssets1790700000000 implements MigrationInterface {
  name = 'ClassifyAssets1790700000000';

  async up(runner: QueryRunner): Promise<void> {
    // Constant defaults add the columns without rewriting rows; they claim nothing.
    await runner.query(`ALTER TABLE accounting_instruments
      ADD COLUMN "assetType" text NOT NULL DEFAULT 'manual',
      ADD COLUMN "valuationCurrency" text NOT NULL DEFAULT 'USD',
      ADD COLUMN "priceSource" text NOT NULL DEFAULT 'manual'`);
    await runner.query(
      `UPDATE accounting_instruments
      SET "assetType"='crypto', "valuationCurrency"='USD', "priceSource"='market'
      WHERE upper(symbol) = ANY($1::text[])`,
      [marketTickers],
    );
    await runner.query(`ALTER TABLE accounting_instruments
      ADD CONSTRAINT accounting_instruments_asset_values CHECK (
        "assetType" IN ('crypto', 'fiat', 'manual')
        AND "valuationCurrency" IN ('USD', 'EUR', 'RUB')
        AND "priceSource" IN ('market', 'manual', 'fixed')),
      ADD CONSTRAINT accounting_instruments_asset_classification CHECK (
        ("assetType" = 'crypto' AND symbol IS NOT NULL AND "valuationCurrency" = 'USD')
        OR ("assetType" = 'fiat' AND "priceSource" = 'fixed'
          AND upper(symbol) = "valuationCurrency")
        OR ("assetType" = 'manual' AND "priceSource" = 'manual'))`);
  }

  async down(): Promise<void> {
    throw new Error('Asset classification downgrade requires an explicit recovery plan');
  }
}
