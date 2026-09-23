import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalUsdFlows1790070000000 implements MigrationInterface {
  name = 'AddExternalUsdFlows1790070000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE portfolio_flow_journals (
      "ownerId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      "coverageFrom" timestamptz(3) NOT NULL CHECK (isfinite("coverageFrom")
        AND "coverageFrom" >= timestamptz '1970-01-01 00:00:00+00'
        AND "coverageFrom" < timestamptz '10000-01-01 00:00:00+00'),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      "currentRevision" integer NOT NULL DEFAULT 0 CHECK ("currentRevision" BETWEEN 0 AND 10000)
    )`);
    await runner.query(`CREATE TABLE portfolio_flow_versions (
      "ownerId" uuid NOT NULL REFERENCES portfolio_flow_journals("ownerId") ON DELETE RESTRICT,
      "flowId" uuid NOT NULL,
      version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
      "journalRevision" integer NOT NULL CHECK ("journalRevision" BETWEEN 1 AND 10000),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('create', 'correct', 'void')),
      direction text NOT NULL CHECK (direction IN ('contribution', 'withdrawal')),
      "occurredAt" timestamptz(3) NOT NULL CHECK (isfinite("occurredAt")
        AND "occurredAt" >= timestamptz '1970-01-01 00:00:00+00'
        AND "occurredAt" < timestamptz '10000-01-01 00:00:00+00'),
      "amountUsd" numeric(78,30) NOT NULL CHECK ("amountUsd" > 0
        AND "amountUsd" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      "previousVersion" integer,
      PRIMARY KEY ("ownerId", "flowId", version),
      UNIQUE ("ownerId", "journalRevision"),
      UNIQUE ("ownerId", "requestId"),
      CHECK ((version = 1 AND kind = 'create' AND "previousVersion" IS NULL)
        OR (version > 1 AND kind IN ('correct', 'void') AND "previousVersion" IS NOT NULL
          AND "previousVersion" = version - 1)),
      FOREIGN KEY ("ownerId", "flowId", "previousVersion")
        REFERENCES portfolio_flow_versions ("ownerId", "flowId", version) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('External flow downgrade requires an explicit recovery plan');
  }
}
