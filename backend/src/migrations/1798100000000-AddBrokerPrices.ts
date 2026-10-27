import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBrokerPrices1798100000000 implements MigrationInterface {
  name = 'AddBrokerPrices1798100000000';

  async up(runner: QueryRunner): Promise<void> {
    // BPR-1: the current price a connected broker reports for a security the owner holds, in the
    // currency it names, at the instant it was read. Additive: one new append-only table.
    await runner.query(`CREATE TABLE broker_price_observations (
      "ownerId" uuid NOT NULL,
      "instrumentId" uuid NOT NULL,
      provider text NOT NULL CHECK (provider = 'tbank'),
      "observedAt" timestamptz(3) NOT NULL CHECK (isfinite("observedAt")
        AND "observedAt" >= timestamptz '1970-01-01 00:00:00+00'
        AND "observedAt" < timestamptz '10000-01-01 00:00:00+00'),
      price numeric(78,30) NOT NULL CHECK (price > 0
        AND price NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "quoteCurrency" text NOT NULL CHECK ("quoteCurrency" IN ('RUB','USD','EUR')),
      "fetchedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("fetchedAt")),
      PRIMARY KEY ("ownerId","instrumentId",provider,"observedAt"),
      FOREIGN KEY ("ownerId","instrumentId") REFERENCES accounting_instruments ("ownerId",id) ON DELETE RESTRICT
    )`);
    // Prices the broker reported are history it does not serve again: append only.
    await runner.query(`CREATE FUNCTION broker_price_observations_append_only() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'broker price observations are append-only' USING ERRCODE = 'restrict_violation';
      END $$`);
    await runner.query(`CREATE TRIGGER broker_price_observations_append_only
      BEFORE UPDATE OR DELETE ON broker_price_observations
      FOR EACH ROW EXECUTE FUNCTION broker_price_observations_append_only()`);
    await runner.query(`CREATE TRIGGER broker_price_observations_no_truncate
      BEFORE TRUNCATE ON broker_price_observations
      FOR EACH STATEMENT EXECUTE FUNCTION broker_price_observations_append_only()`);
  }

  async down(): Promise<void> {
    throw new Error('Broker prices downgrade requires an explicit recovery plan');
  }
}
