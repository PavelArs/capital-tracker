import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManualOpeningPositions1790030000000 implements MigrationInterface {
  name = 'AddManualOpeningPositions1790030000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE manual_accounts (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      name varchar(120) NOT NULL CHECK (name = btrim(name) AND length(name) > 0 AND name !~ '[[:cntrl:]]'),
      "currentRevision" integer CHECK ("currentRevision" > 0),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      UNIQUE ("ownerId", id),
      UNIQUE ("ownerId", "requestId")
    )`);
    await runner.query(`CREATE TABLE accounting_instruments (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      name varchar(120) NOT NULL CHECK (name = btrim(name) AND length(name) > 0 AND name !~ '[[:cntrl:]]'),
      symbol varchar(32) CHECK (symbol = btrim(symbol) AND length(symbol) > 0 AND symbol !~ '[[:cntrl:]]'),
      namespace text NOT NULL DEFAULT 'manual' CHECK (namespace = 'manual'),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      UNIQUE ("ownerId", id),
      UNIQUE ("ownerId", "requestId")
    )`);
    await runner.query(`CREATE TABLE account_opening_snapshots (
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "accountId" uuid NOT NULL,
      revision integer NOT NULL CHECK (revision > 0),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      "asOf" timestamptz(3) NOT NULL CHECK (isfinite("asOf")
        AND "asOf" >= timestamptz '1970-01-01 00:00:00+00'
        AND "asOf" < timestamptz '10000-01-01 00:00:00+00'),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId", "accountId", revision),
      UNIQUE ("ownerId", "accountId", "requestId"),
      FOREIGN KEY ("ownerId", "accountId") REFERENCES manual_accounts ("ownerId", id) ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE TABLE account_opening_positions (
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "accountId" uuid NOT NULL,
      revision integer NOT NULL CHECK (revision > 0),
      "instrumentId" uuid NOT NULL,
      quantity numeric(78,30) NOT NULL CHECK (quantity > 0
        AND quantity NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "costStatus" text NOT NULL,
      "totalCostUsd" numeric(78,30),
      PRIMARY KEY ("ownerId", "accountId", revision, "instrumentId"),
      FOREIGN KEY ("ownerId", "accountId", revision)
        REFERENCES account_opening_snapshots ("ownerId", "accountId", revision) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "instrumentId") REFERENCES accounting_instruments ("ownerId", id) ON DELETE RESTRICT,
      CHECK (("costStatus" = 'unknown' AND "totalCostUsd" IS NULL)
        OR ("costStatus" = 'known' AND "totalCostUsd" IS NOT NULL AND "totalCostUsd" >= 0
          AND "totalCostUsd" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)))
    )`);
    // A new account has no snapshot. The writer inserts the full snapshot before
    // changing this pointer, keeping the dependency cycle valid without deferral.
    await runner.query(`ALTER TABLE manual_accounts
      ADD CONSTRAINT manual_accounts_current_opening
      FOREIGN KEY ("ownerId", id, "currentRevision")
      REFERENCES account_opening_snapshots ("ownerId", "accountId", revision) ON DELETE RESTRICT`);
  }

  async down(): Promise<void> {
    throw new Error('Manual accounting downgrade requires an explicit recovery plan');
  }
}
