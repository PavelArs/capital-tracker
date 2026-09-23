import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsdCsvImports1790050000000 implements MigrationInterface {
  name = 'AddUsdCsvImports1790050000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE account_csv_imports (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      sha256 text NOT NULL CHECK (length(sha256)=64 AND sha256 ~ '^[0-9a-f]{64}$'),
      "originalBytes" bytea NOT NULL,
      "byteLength" integer NOT NULL CHECK ("byteLength" BETWEEN 1 AND 262144
        AND octet_length("originalBytes")="byteLength"),
      filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 120
        AND position('/' in filename)=0 AND position(chr(92) in filename)=0
        AND filename !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')),
      state text NOT NULL CHECK (state IN ('draft','committed','rolled-back')),
      "acceptedSettings" jsonb,
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      UNIQUE ("ownerId","accountId",id),
      UNIQUE ("ownerId","accountId",sha256),
      FOREIGN KEY ("ownerId","accountId")
        REFERENCES account_trade_journals ("ownerId","accountId") ON DELETE RESTRICT,
      CHECK ((state='draft' AND "acceptedSettings" IS NULL)
        OR (state IN ('committed','rolled-back') AND "acceptedSettings" IS NOT NULL
          AND jsonb_typeof("acceptedSettings")='object'))
    )`);
    await runner.query(`CREATE TABLE account_csv_import_commands (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "requestId" uuid NOT NULL,
      "batchId" uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('confirm','rollback')),
      "canonicalPayload" text NOT NULL,
      "rowCount" integer NOT NULL CHECK ("rowCount" BETWEEN 1 AND 100),
      "firstJournalRevision" integer NOT NULL CHECK ("firstJournalRevision" BETWEEN 1 AND 10000),
      "lastJournalRevision" integer NOT NULL CHECK ("lastJournalRevision" BETWEEN 1 AND 10000),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId","accountId","requestId"),
      UNIQUE ("ownerId","accountId","batchId",kind),
      FOREIGN KEY ("ownerId","accountId","batchId")
        REFERENCES account_csv_imports ("ownerId","accountId",id) ON DELETE RESTRICT,
      CHECK ("lastJournalRevision"="firstJournalRevision"+"rowCount"-1)
    )`);
    await runner.query(`CREATE TABLE account_csv_import_rows (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "batchId" uuid NOT NULL,
      ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
      "startLine" integer NOT NULL CHECK ("startLine" BETWEEN 2 AND 262145),
      "tradeId" uuid NOT NULL,
      "createVersion" integer NOT NULL CHECK ("createVersion"=1),
      "rollbackVersion" integer CHECK ("rollbackVersion" IS NULL OR "rollbackVersion"=2),
      PRIMARY KEY ("ownerId","accountId","batchId",ordinal),
      UNIQUE ("ownerId","accountId","tradeId"),
      FOREIGN KEY ("ownerId","accountId","batchId")
        REFERENCES account_csv_imports ("ownerId","accountId",id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId","accountId","tradeId","createVersion")
        REFERENCES account_trade_versions ("ownerId","accountId","tradeId",version) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId","accountId","tradeId","rollbackVersion")
        REFERENCES account_trade_versions ("ownerId","accountId","tradeId",version) MATCH SIMPLE ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('CSV import downgrade requires an explicit recovery plan');
  }
}
