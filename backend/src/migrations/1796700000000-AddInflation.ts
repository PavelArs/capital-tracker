import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInflation1796700000000 implements MigrationInterface {
  name = 'AddInflation1796700000000';

  async up(runner: QueryRunner): Promise<void> {
    // INFL-OFFICIAL: the published change of a currency's consumer price level from the previous
    // month, in percent. Public data read from the statistics offices; a later revision of a
    // month replaces its row.
    await runner.query(`CREATE TABLE inflation_months (
      currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'RUB')),
      month date NOT NULL CHECK (month = date_trunc('month', month)::date),
      provider text NOT NULL CHECK (provider IN ('fred', 'eurostat', 'cbr')),
      "changePercent" numeric(14, 8) NOT NULL CHECK ("changePercent" > -100 AND "changePercent" < 1000),
      "fetchedAt" timestamptz(3) NOT NULL DEFAULT now(),
      PRIMARY KEY (currency, month)
    )`);
    // INFL-MANUAL: a month's change the owner typed in, for a currency without an automatic source
    // or a month not published yet. It replaces the official change of that month.
    await runner.query(`CREATE TABLE inflation_manual_months (
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'RUB')),
      month date NOT NULL CHECK (month = date_trunc('month', month)::date),
      "changePercent" numeric(14, 8) NOT NULL CHECK ("changePercent" > -100 AND "changePercent" < 1000),
      "updatedAt" timestamptz(3) NOT NULL DEFAULT now(),
      PRIMARY KEY ("ownerId", currency, month)
    )`);
    // INFL-PERSONAL: the owner's own annual inflation in percent, one per currency.
    await runner.query(`CREATE TABLE inflation_personal_rates (
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'RUB')),
      "annualPercent" numeric(9, 4) NOT NULL CHECK ("annualPercent" > -50 AND "annualPercent" < 1000),
      "updatedAt" timestamptz(3) NOT NULL DEFAULT now(),
      PRIMARY KEY ("ownerId", currency)
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Inflation downgrade requires an explicit recovery plan');
  }
}
