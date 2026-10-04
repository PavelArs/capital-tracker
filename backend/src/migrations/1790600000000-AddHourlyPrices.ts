import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHourlyPrices1790600000000 implements MigrationInterface {
  name = 'AddHourlyPrices1790600000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE price_observations (
      asset varchar(16) NOT NULL CHECK (asset ~ '^[A-Z0-9]{2,15}$'),
      "quoteCurrency" varchar(3) NOT NULL CHECK ("quoteCurrency" ~ '^[A-Z]{3}$'),
      source text NOT NULL CHECK (source IN ('kraken','coingecko')),
      "observedAt" timestamptz(3) NOT NULL CHECK (isfinite("observedAt")
        AND "observedAt" >= timestamptz '2009-01-03' AND "observedAt" < timestamptz '10000-01-01'),
      price numeric(78,30) NOT NULL CHECK (price > 0
        AND price NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      kind text NOT NULL CHECK (kind IN ('hourly-close','spot','daily-close')),
      "fetchedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("fetchedAt")),
      -- A daily close and the 23:00 hourly close share the same instant.
      PRIMARY KEY (asset, "quoteCurrency", source, kind, "observedAt")
    )`);
    await runner.query(
      `CREATE INDEX price_observations_latest ON price_observations (asset, "quoteCurrency", "observedAt" DESC)`,
    );
    // Stored prices are history the providers may no longer serve: append only.
    await runner.query(`CREATE FUNCTION price_observations_append_only() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'price observations are append-only' USING ERRCODE = 'restrict_violation';
      END $$`);
    await runner.query(`CREATE TRIGGER price_observations_append_only
      BEFORE UPDATE OR DELETE ON price_observations
      FOR EACH ROW EXECUTE FUNCTION price_observations_append_only()`);
    await runner.query(`CREATE TRIGGER price_observations_no_truncate
      BEFORE TRUNCATE ON price_observations
      FOR EACH STATEMENT EXECUTE FUNCTION price_observations_append_only()`);
    await runner.query(`CREATE TABLE sync_sources (
      key text PRIMARY KEY CHECK (key ~ '^(prices|fx|wallet):[a-z0-9-]{1,64}$'),
      state text NOT NULL CHECK (state IN ('synced','syncing','delayed','failed')),
      "lastAttemptAt" timestamptz(3) CHECK ("lastAttemptAt" IS NULL OR isfinite("lastAttemptAt")),
      "lastSuccessAt" timestamptz(3) CHECK ("lastSuccessAt" IS NULL OR isfinite("lastSuccessAt")),
      "nextRunAt" timestamptz(3) CHECK ("nextRunAt" IS NULL OR isfinite("nextRunAt")),
      "errorCode" text CHECK ("errorCode" ~ '^[a-z_]{1,40}$'),
      "errorMessage" varchar(300) CHECK ("errorMessage" !~ '[[:cntrl:]]'),
      CHECK (("errorCode" IS NULL) = ("errorMessage" IS NULL))
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Hourly prices downgrade requires an explicit recovery plan');
  }
}
