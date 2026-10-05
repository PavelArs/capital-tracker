import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaidCurrencyTrades1791100000000 implements MigrationInterface {
  name = 'PaidCurrencyTrades1791100000000';

  async up(runner: QueryRunner): Promise<void> {
    // CUR-PAID-RUB: a trade version paid in RUB or EUR keeps the amounts as paid and the
    // Bank of Russia rates its stored USD amounts were derived at. No row means USD.
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
      "rubPerUsd" numeric(78,30) NOT NULL CHECK ("rubPerUsd" > 0
        AND "rubPerUsd" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "rubPerUnit" numeric(78,30) NOT NULL CHECK ("rubPerUnit" > 0
        AND "rubPerUnit" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        AND (currency <> 'RUB' OR "rubPerUnit" = 1)),
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
