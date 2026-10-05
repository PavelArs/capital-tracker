import { MigrationInterface, QueryRunner } from 'typeorm';

export class RecordPortfolioSnapshots1791000000000 implements MigrationInterface {
  name = 'RecordPortfolioSnapshots1791000000000';

  async up(runner: QueryRunner): Promise<void> {
    // A cache of portfolio value at whole hours (product model principle 3): rebuilt from
    // operations, stored prices and stored rates, never an input to anything else.
    await runner.query(`CREATE TABLE portfolio_snapshots (
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "takenAt" timestamptz(3) NOT NULL CHECK (isfinite("takenAt")
        AND "takenAt" >= timestamptz '2025-01-01 00:00:00+00' AND "takenAt" < timestamptz '10000-01-01'
        AND "takenAt" = date_trunc('hour', "takenAt")),
      currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      -- Sum of the priced holdings; null when the currency had no stored rate at that instant.
      value numeric CHECK (value IS NULL OR (value >= 0
        AND value NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric))),
      -- False when a held asset had no price or rate, or an account's history was unknown.
      complete boolean NOT NULL,
      "computedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("computedAt")),
      PRIMARY KEY ("ownerId", "takenAt", currency)
    )`);
    // Which inputs the stored snapshots reflect, so a later change rebuilds from its instant.
    await runner.query(`CREATE TABLE portfolio_snapshot_state (
      "ownerId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      "inputsRevision" text NOT NULL CHECK ("inputsRevision" ~ '^[a-f0-9]{32}$'),
      "pricesFetchedThrough" timestamptz(3) CHECK ("pricesFetchedThrough" IS NULL
        OR isfinite("pricesFetchedThrough")),
      "ratesFetchedThrough" timestamptz(3) CHECK ("ratesFetchedThrough" IS NULL
        OR isfinite("ratesFetchedThrough")),
      "hourlyFrom" timestamptz(3) NOT NULL CHECK (isfinite("hourlyFrom")
        AND "hourlyFrom" = date_trunc('hour', "hourlyFrom")),
      "refreshedAt" timestamptz(3) NOT NULL CHECK (isfinite("refreshedAt"))
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Portfolio snapshot downgrade requires an explicit recovery plan');
  }
}
