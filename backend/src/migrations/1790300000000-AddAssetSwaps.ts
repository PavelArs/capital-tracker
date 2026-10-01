import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssetSwaps1790300000000 implements MigrationInterface {
  name = 'AddAssetSwaps1790300000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE account_swaps (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "currentVersion" integer NOT NULL CHECK ("currentVersion" BETWEEN 1 AND 10000),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      UNIQUE ("ownerId","accountId",id),
      FOREIGN KEY ("ownerId","accountId") REFERENCES account_trade_journals ("ownerId","accountId") ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE TABLE account_swap_versions (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "swapId" uuid NOT NULL,
      version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
      "journalRevision" integer NOT NULL CHECK ("journalRevision" BETWEEN 1 AND 10000),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('create','correct','void')),
      CHECK ((version=1)=(kind='create')),
      "outgoingInstrumentId" uuid NOT NULL,
      "incomingInstrumentId" uuid NOT NULL,
      CHECK ("outgoingInstrumentId"<>"incomingInstrumentId"),
      "occurredAt" timestamptz(3) NOT NULL CHECK (isfinite("occurredAt")
        AND "occurredAt">=timestamptz '1970-01-01 00:00:00+00'
        AND "occurredAt"<timestamptz '10000-01-01 00:00:00+00'),
      "orderWithinTimestamp" integer NOT NULL CHECK ("orderWithinTimestamp">=0),
      "outgoingQuantity" numeric(78,30) NOT NULL CHECK ("outgoingQuantity">0
        AND "outgoingQuantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      "incomingQuantity" numeric(78,30) NOT NULL CHECK ("incomingQuantity">0
        AND "incomingQuantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      "considerationUsd" numeric(78,30) CHECK ("considerationUsd">=0
        AND "considerationUsd" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      "feeSource" text,
      "feeInstrumentId" uuid,
      "feeQuantity" numeric(78,30) NOT NULL CHECK ("feeQuantity">=0
        AND "feeQuantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      CHECK (("feeQuantity"=0 AND "feeSource" IS NULL AND "feeInstrumentId" IS NULL)
        OR ("feeQuantity">0 AND "feeSource" IS NOT NULL AND "feeInstrumentId" IS NOT NULL
          AND ("feeSource"='held' OR ("feeSource"='incoming'
            AND "feeInstrumentId"="incomingInstrumentId" AND "feeQuantity"<="incomingQuantity")))),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId","accountId","swapId",version),
      UNIQUE ("ownerId","accountId","requestId"),
      UNIQUE ("ownerId","accountId","journalRevision"),
      FOREIGN KEY ("ownerId","accountId","swapId") REFERENCES account_swaps ("ownerId","accountId",id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId","outgoingInstrumentId") REFERENCES accounting_instruments ("ownerId",id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId","incomingInstrumentId") REFERENCES accounting_instruments ("ownerId",id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId","feeInstrumentId") REFERENCES accounting_instruments ("ownerId",id) ON DELETE RESTRICT
    )`);
    await runner.query(`ALTER TABLE account_swaps ADD CONSTRAINT account_swaps_current_version
      FOREIGN KEY ("ownerId","accountId",id,"currentVersion")
      REFERENCES account_swap_versions ("ownerId","accountId","swapId",version)
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`);
  }

  async down(): Promise<void> {
    throw new Error('Asset swap downgrade requires an explicit recovery plan');
  }
}
