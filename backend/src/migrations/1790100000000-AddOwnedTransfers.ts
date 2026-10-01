import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOwnedTransfers1790100000000 implements MigrationInterface {
  name = 'AddOwnedTransfers1790100000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE owner_transfer_journals (
      "ownerId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      "currentRevision" integer NOT NULL DEFAULT 0 CHECK ("currentRevision" BETWEEN 0 AND 10000)
    )`);
    await runner.query(`CREATE TABLE owned_transfers (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL REFERENCES owner_transfer_journals("ownerId") ON DELETE RESTRICT,
      "fromAccountId" uuid NOT NULL,
      "toAccountId" uuid NOT NULL,
      "currentVersion" integer NOT NULL CHECK ("currentVersion" BETWEEN 1 AND 10000),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      CHECK ("fromAccountId" <> "toAccountId"),
      UNIQUE ("ownerId", id),
      FOREIGN KEY ("ownerId", "fromAccountId")
        REFERENCES account_trade_journals ("ownerId", "accountId") ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "toAccountId")
        REFERENCES account_trade_journals ("ownerId", "accountId") ON DELETE RESTRICT
    )`);
    await runner.query(
      'CREATE INDEX owned_transfers_from ON owned_transfers ("ownerId", "fromAccountId")',
    );
    await runner.query(
      'CREATE INDEX owned_transfers_to ON owned_transfers ("ownerId", "toAccountId")',
    );
    await runner.query(`CREATE TABLE owned_transfer_versions (
      "ownerId" uuid NOT NULL,
      "transferId" uuid NOT NULL,
      version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
      "journalRevision" integer NOT NULL CHECK ("journalRevision" BETWEEN 1 AND 10000),
      "fromJournalRevision" integer NOT NULL CHECK ("fromJournalRevision" BETWEEN 1 AND 10000),
      "toJournalRevision" integer NOT NULL CHECK ("toJournalRevision" BETWEEN 1 AND 10000),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('create', 'correct', 'void')),
      CHECK ((version = 1) = (kind = 'create')),
      "instrumentId" uuid NOT NULL,
      "occurredAt" timestamptz(3) NOT NULL CHECK (isfinite("occurredAt")
        AND "occurredAt" >= timestamptz '1970-01-01 00:00:00+00'
        AND "occurredAt" < timestamptz '10000-01-01 00:00:00+00'),
      "orderWithinTimestamp" integer NOT NULL CHECK ("orderWithinTimestamp" >= 0),
      quantity numeric(78,30) NOT NULL CHECK (quantity > 0
        AND quantity NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "feeInstrumentId" uuid,
      "feeQuantity" numeric(78,30) NOT NULL CHECK ("feeQuantity" >= 0
        AND "feeQuantity" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      CHECK (("feeQuantity" = 0) = ("feeInstrumentId" IS NULL)),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId", "transferId", version),
      UNIQUE ("ownerId", "requestId"),
      UNIQUE ("ownerId", "journalRevision"),
      FOREIGN KEY ("ownerId", "transferId") REFERENCES owned_transfers ("ownerId", id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "instrumentId") REFERENCES accounting_instruments ("ownerId", id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "feeInstrumentId") REFERENCES accounting_instruments ("ownerId", id) ON DELETE RESTRICT
    )`);
    // Only the identity/first-version insert cycle is deferred. A committed head
    // must always reference its own complete immutable version.
    await runner.query(`ALTER TABLE owned_transfers ADD CONSTRAINT owned_transfers_current_version
      FOREIGN KEY ("ownerId", id, "currentVersion")
      REFERENCES owned_transfer_versions ("ownerId", "transferId", version)
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`);
  }

  async down(): Promise<void> {
    throw new Error('Owned transfer downgrade requires an explicit recovery plan');
  }
}
