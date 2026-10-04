import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTradePaymentRecords1790500000000 implements MigrationInterface {
  name = 'AddTradePaymentRecords1790500000000';

  async up(runner: QueryRunner): Promise<void> {
    // What a non-USD trade version actually paid. No row means paid in USD; the
    // versions table and every existing row stay unchanged.
    await runner.query(`CREATE TABLE account_trade_version_payments (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "tradeId" uuid NOT NULL,
      version integer NOT NULL,
      currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$' AND currency <> 'USD'),
      gross numeric(78,30) NOT NULL CHECK (gross > 0
        AND gross NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      fee numeric(78,30) NOT NULL CHECK (fee >= 0
        AND fee NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "perUsd" numeric(78,30) NOT NULL CHECK ("perUsd" > 0
        AND "perUsd" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      PRIMARY KEY ("ownerId", "accountId", "tradeId", version),
      FOREIGN KEY ("ownerId", "accountId", "tradeId", version)
        REFERENCES account_trade_versions ("ownerId", "accountId", "tradeId", version) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Trade payment downgrade requires an explicit recovery plan');
  }
}
