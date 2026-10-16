import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCapitalReturns1797700000000 implements MigrationInterface {
  name = 'AddCapitalReturns1797700000000';

  async up(runner: QueryRunner): Promise<void> {
    // BROKER-CAPRET: part of the cost of the units held came back as cash, as a partial bond
    // repayment does. The cost of the units drops by the returned amount, and the cash comes in
    // as a lot. Shaped like asset rewards: one head per record with immutable versions, tied to
    // the account's journal revisions. A record is created, or voided to take it back. Only new
    // tables, plus the broker import tables of the previous migration gain a place for them.
    await runner.query(`CREATE TABLE account_capital_returns (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "currentVersion" integer NOT NULL CHECK ("currentVersion" BETWEEN 1 AND 2),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      UNIQUE ("ownerId", "accountId", id),
      FOREIGN KEY ("ownerId", "accountId") REFERENCES account_trade_journals ("ownerId", "accountId") ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE TABLE account_capital_return_versions (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "capitalReturnId" uuid NOT NULL,
      version integer NOT NULL CHECK (version BETWEEN 1 AND 2),
      "journalRevision" integer NOT NULL CHECK ("journalRevision" BETWEEN 1 AND 10000),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('create','void')),
      CHECK ((version=1)=(kind='create')),
      "instrumentId" uuid NOT NULL,
      "cashInstrumentId" uuid NOT NULL,
      CHECK ("instrumentId" <> "cashInstrumentId"),
      "occurredAt" timestamptz(3) NOT NULL CHECK (isfinite("occurredAt")
        AND "occurredAt">=timestamptz '1970-01-01 00:00:00+00'
        AND "occurredAt"<timestamptz '10000-01-01 00:00:00+00'),
      "orderWithinTimestamp" integer NOT NULL CHECK ("orderWithinTimestamp">=0),
      amount numeric(78,30) NOT NULL CHECK (amount>0
        AND amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      "amountUsd" numeric(78,30) NOT NULL CHECK ("amountUsd">0
        AND "amountUsd" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      "paidCurrency" text CHECK ("paidCurrency" IN ('RUB','EUR')),
      "rateDate" date CHECK ("rateDate" >= date '1992-07-01' AND "rateDate" < date '10000-01-01'),
      "perUsd" numeric(78,30) CHECK ("perUsd" > 0
        AND "perUsd" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      "rateSource" text CHECK ("rateSource" IN ('bank-of-russia','owner')),
      CHECK (("paidCurrency" IS NULL) = ("rateDate" IS NULL)
        AND ("paidCurrency" IS NULL) = ("perUsd" IS NULL)
        AND ("paidCurrency" IS NULL) = ("rateSource" IS NULL)),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId","accountId","capitalReturnId",version),
      UNIQUE ("ownerId","accountId","requestId"),
      UNIQUE ("ownerId","accountId","journalRevision"),
      FOREIGN KEY ("ownerId","accountId","capitalReturnId") REFERENCES account_capital_returns ("ownerId","accountId",id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId","instrumentId") REFERENCES accounting_instruments ("ownerId",id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId","cashInstrumentId") REFERENCES accounting_instruments ("ownerId",id) ON DELETE RESTRICT
    )`);
    await runner.query(`ALTER TABLE account_capital_returns ADD CONSTRAINT account_capital_returns_current_version
      FOREIGN KEY ("ownerId","accountId",id,"currentVersion")
      REFERENCES account_capital_return_versions ("ownerId","accountId","capitalReturnId",version)
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`);

    // A broker import now counts the capital returns it wrote, and an imported operation may
    // become one. The checks being replaced were written without names, so they are found by
    // what they say.
    await runner.query(`ALTER TABLE broker_imports
      ADD COLUMN "capitalReturns" integer NOT NULL DEFAULT 0 CHECK ("capitalReturns" BETWEEN 0 AND 1000)`);
    await runner.query(`ALTER TABLE broker_imported_operations ADD COLUMN "capitalReturnId" uuid`);
    await runner.query(`ALTER TABLE broker_imported_operations
      ADD CONSTRAINT broker_imported_operations_capital_return
      FOREIGN KEY ("ownerId","accountId","capitalReturnId")
      REFERENCES account_capital_returns ("ownerId","accountId",id) ON DELETE RESTRICT`);
    await runner.query(`DO $$
      DECLARE found record;
      BEGIN
        FOR found IN
          SELECT c.conrelid::regclass AS tbl, c.conname FROM pg_constraint c
          WHERE c.contype = 'c' AND (
            (c.conrelid = 'broker_imports'::regclass
              AND pg_get_constraintdef(c.oid) LIKE '%lastJournalRevision%firstJournalRevision%')
            OR (c.conrelid = 'broker_imported_operations'::regclass
              AND pg_get_constraintdef(c.oid) LIKE '%tradeId%rewardId%'))
        LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', found.tbl, found.conname);
        END LOOP;
      END $$`);
    await runner.query(`ALTER TABLE broker_imports ADD CONSTRAINT broker_imports_revisions
      CHECK ("lastJournalRevision" - "firstJournalRevision" + 1 = trades + rewards + "capitalReturns")`);
    await runner.query(`ALTER TABLE broker_imported_operations
      ADD CONSTRAINT broker_imported_operations_one_entry
      CHECK (num_nonnulls("tradeId","rewardId","capitalReturnId") = 1)`);
  }

  async down(): Promise<void> {
    throw new Error('Capital returns downgrade requires an explicit recovery plan');
  }
}
