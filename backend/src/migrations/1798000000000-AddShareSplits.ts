import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShareSplits1798000000000 implements MigrationInterface {
  name = 'AddShareSplits1798000000000';

  async up(runner: QueryRunner): Promise<void> {
    // SPLIT: a share split of one security, for every account that holds it. From effectiveAt
    // each unit held becomes `ratio` units and what they cost stays the same. A record is
    // created, or withdrawn (removedAt) to take it back. Additive: one new table.
    await runner.query(`CREATE TABLE instrument_splits (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      "instrumentId" uuid NOT NULL,
      "effectiveAt" timestamptz(3) NOT NULL CHECK (isfinite("effectiveAt")
        AND "effectiveAt">=timestamptz '1970-01-01 00:00:00+00'
        AND "effectiveAt"<timestamptz '10000-01-01 00:00:00+00'),
      ratio integer NOT NULL CHECK (ratio BETWEEN 2 AND 1000000),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      "removedAt" timestamptz(3) CHECK ("removedAt" IS NULL OR isfinite("removedAt")),
      UNIQUE ("ownerId","requestId"),
      FOREIGN KEY ("ownerId","instrumentId") REFERENCES accounting_instruments ("ownerId",id) ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE UNIQUE INDEX instrument_splits_active
      ON instrument_splits ("ownerId","instrumentId","effectiveAt") WHERE "removedAt" IS NULL`);
  }

  async down(): Promise<void> {
    throw new Error('Share split downgrade requires an explicit recovery plan');
  }
}
