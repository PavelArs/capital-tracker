import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailyDisplayFx1790090000000 implements MigrationInterface {
  name = 'AddDailyDisplayFx1790090000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE display_fx_observations (
      provider text NOT NULL CHECK (provider = 'exchangerate-api-open'),
      base text NOT NULL CHECK (base = 'USD'),
      "observedAt" timestamptz(3) PRIMARY KEY CHECK (isfinite("observedAt")
        AND "observedAt" >= timestamptz '1970-01-01' AND "observedAt" < timestamptz '10000-01-01'),
      "fetchedAt" timestamptz(3) NOT NULL CHECK (isfinite("fetchedAt")),
      "nextUpdateAt" timestamptz(3) NOT NULL CHECK (isfinite("nextUpdateAt")
        AND "nextUpdateAt" > "observedAt" AND "nextUpdateAt" < timestamptz '10000-01-01'),
      "endOfLifeAt" timestamptz(3) CHECK ("endOfLifeAt" IS NULL OR (isfinite("endOfLifeAt")
        AND "endOfLifeAt" > "observedAt" AND "endOfLifeAt" < timestamptz '10000-01-01')),
      "eurRate" numeric(78,30) NOT NULL CHECK ("eurRate" > 0
        AND "eurRate" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "rubRate" numeric(78,30) NOT NULL CHECK ("rubRate" > 0
        AND "rubRate" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric))
    )`);
    await runner.query(`CREATE TABLE display_fx_collection (
      provider text PRIMARY KEY CHECK (provider = 'exchangerate-api-open'),
      "reservedAttempts" timestamptz(3)[] NOT NULL DEFAULT '{}'
        CHECK (cardinality("reservedAttempts") <= 3 AND array_position("reservedAttempts",NULL) IS NULL),
      "leaseId" uuid,
      "leaseUntil" timestamptz(3) CHECK ("leaseUntil" IS NULL OR isfinite("leaseUntil")),
      "lastAttemptAt" timestamptz(3) CHECK ("lastAttemptAt" IS NULL OR isfinite("lastAttemptAt")),
      "lastSuccessAt" timestamptz(3) CHECK ("lastSuccessAt" IS NULL OR isfinite("lastSuccessAt")),
      "nextAttemptAt" timestamptz(3) CHECK ("nextAttemptAt" IS NULL OR isfinite("nextAttemptAt")),
      "lastOutcome" text NOT NULL DEFAULT 'idle'
        CHECK ("lastOutcome" IN ('idle','running','ok','provider-error','rate-limited','invalid-data')),
      CHECK (("leaseId" IS NULL) = ("leaseUntil" IS NULL))
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Display FX downgrade requires an explicit recovery plan');
  }
}
