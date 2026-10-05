import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountInThreeCurrencies1790900000000 implements MigrationInterface {
  name = 'AccountInThreeCurrencies1790900000000';

  async up(runner: QueryRunner): Promise<void> {
    // Official Bank of Russia rates: rubles per one unit, effective on a Moscow date.
    await runner.query(`CREATE TABLE fx_rates (
      currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'RUB'),
      source text NOT NULL CHECK (source IN ('cbr')),
      "rateDate" date NOT NULL CHECK ("rateDate" >= date '1992-07-01'
        AND "rateDate" < date '10000-01-01'),
      "rubPerUnit" numeric(78,30) NOT NULL CHECK ("rubPerUnit" > 0
        AND "rubPerUnit" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "fetchedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("fetchedAt")),
      PRIMARY KEY (currency, source, "rateDate")
    )`);
    // Stored rates are history the owner's results depend on: append only.
    await runner.query(`CREATE FUNCTION fx_rates_append_only() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'fx rates are append-only' USING ERRCODE = 'restrict_violation';
      END $$`);
    await runner.query(`CREATE TRIGGER fx_rates_append_only
      BEFORE UPDATE OR DELETE ON fx_rates
      FOR EACH ROW EXECUTE FUNCTION fx_rates_append_only()`);
    await runner.query(`CREATE TRIGGER fx_rates_no_truncate
      BEFORE TRUNCATE ON fx_rates
      FOR EACH STATEMENT EXECUTE FUNCTION fx_rates_append_only()`);
    // The owner's main currency; no row means USD.
    await runner.query(`CREATE TABLE owner_settings (
      "ownerId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      "mainCurrency" varchar(3) NOT NULL DEFAULT 'USD'
        CHECK ("mainCurrency" IN ('USD','EUR','RUB')),
      "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("updatedAt"))
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Three-currency accounting downgrade requires an explicit recovery plan');
  }
}
