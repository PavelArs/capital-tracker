import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBrokerImports1797500000000 implements MigrationInterface {
  name = 'AddBrokerImports1797500000000';

  async up(runner: QueryRunner): Promise<void> {
    // BROKER-SYNC: a broker history written into an empty account in one command. Which of the
    // owner's instruments stands for a broker's instrument, so a later import reuses it; each
    // import with its client request and the broker's account it read; and which entry each
    // broker operation became, so an operation of a broker account is never written twice, into
    // any account. Only new tables.
    await runner.query(`CREATE TABLE broker_instrument_links (
      "ownerId" uuid NOT NULL,
      provider text NOT NULL CHECK (provider = 'tbank'),
      "providerInstrumentId" text NOT NULL CHECK ("providerInstrumentId" ~ '^[0-9A-Za-z_-]{1,64}$'),
      "instrumentId" uuid NOT NULL,
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId", provider, "providerInstrumentId"),
      UNIQUE ("ownerId", "instrumentId"),
      FOREIGN KEY ("ownerId", "instrumentId") REFERENCES accounting_instruments ("ownerId", id)
        ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE TABLE broker_imports (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      provider text NOT NULL CHECK (provider = 'tbank'),
      "brokerAccountId" text NOT NULL CHECK ("brokerAccountId" ~ '^[0-9A-Za-z_-]{1,64}$'),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      trades integer NOT NULL CHECK (trades BETWEEN 0 AND 1000),
      rewards integer NOT NULL CHECK (rewards BETWEEN 0 AND 1000),
      "firstJournalRevision" integer NOT NULL CHECK ("firstJournalRevision" BETWEEN 1 AND 10000),
      "lastJournalRevision" integer NOT NULL CHECK ("lastJournalRevision" BETWEEN 1 AND 10000),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      CHECK ("lastJournalRevision" - "firstJournalRevision" + 1 = trades + rewards),
      UNIQUE ("ownerId", id),
      UNIQUE ("ownerId", "accountId", "requestId"),
      FOREIGN KEY ("ownerId", "accountId") REFERENCES manual_accounts ("ownerId", id)
        ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE TABLE broker_imported_operations (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      provider text NOT NULL CHECK (provider = 'tbank'),
      "brokerAccountId" text NOT NULL CHECK ("brokerAccountId" ~ '^[0-9A-Za-z_-]{1,64}$'),
      "operationId" text NOT NULL CHECK ("operationId" ~ '^[0-9A-Za-z._:-]{1,128}(#[0-9]{1,6})?$'),
      "importId" uuid NOT NULL,
      "tradeId" uuid,
      "rewardId" uuid,
      CHECK (("tradeId" IS NULL) <> ("rewardId" IS NULL)),
      PRIMARY KEY ("ownerId", provider, "brokerAccountId", "operationId"),
      FOREIGN KEY ("ownerId", "importId") REFERENCES broker_imports ("ownerId", id)
        ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "accountId", "tradeId")
        REFERENCES account_trades ("ownerId", "accountId", id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "accountId", "rewardId")
        REFERENCES account_rewards ("ownerId", "accountId", id) ON DELETE RESTRICT
    )`);
    await runner.query(
      'CREATE INDEX broker_imported_operations_import ON broker_imported_operations ("ownerId", "importId")',
    );
  }

  async down(): Promise<void> {
    throw new Error('Broker imports downgrade requires an explicit recovery plan');
  }
}
