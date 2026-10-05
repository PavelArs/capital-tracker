import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaidCurrencyTrades1791100000000 implements MigrationInterface {
  name = 'PaidCurrencyTrades1791100000000';

  async up(runner: QueryRunner): Promise<void> {
    // CUR-PAID-RUB: a trade version paid in RUB or EUR keeps the amounts as paid and the
    // rate its stored USD amounts were derived at (paid units per 1 USD): the Bank of Russia
    // rate of the trade's date, or the one the owner entered. No row means USD.
    await runner.query(`CREATE TABLE account_trade_version_payments (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "tradeId" uuid NOT NULL,
      version integer NOT NULL,
      currency varchar(3) NOT NULL CHECK (currency IN ('RUB','EUR')),
      gross numeric(78,30) NOT NULL CHECK (gross > 0
        AND gross NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      fee numeric(78,30) NOT NULL CHECK (fee >= 0
        AND fee NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "rateDate" date NOT NULL CHECK ("rateDate" >= date '1992-07-01'
        AND "rateDate" < date '10000-01-01'),
      "perUsd" numeric(78,30) NOT NULL CHECK ("perUsd" > 0
        AND "perUsd" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "rateSource" varchar(16) NOT NULL CHECK ("rateSource" IN ('bank-of-russia','owner')),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId", "accountId", "tradeId", version),
      FOREIGN KEY ("ownerId", "accountId", "tradeId", version)
        REFERENCES account_trade_versions ("ownerId", "accountId", "tradeId", version)
        ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Paid-currency trades downgrade requires an explicit recovery plan');
  }
}
