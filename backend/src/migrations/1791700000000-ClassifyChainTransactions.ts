import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassifyChainTransactions1791700000000 implements MigrationInterface {
  name = 'ClassifyChainTransactions1791700000000';

  async up(runner: QueryRunner): Promise<void> {
    // CLS-*: the owner's reading of one raw chain transaction, kept apart from the raw row so a
    // resync never touches it. Every change appends a version (PR-OPS-7); the head names the
    // current one. A classified version names the journal entry it produced in the wallet's
    // account: a trade or a reward. The application validates status and type, so the tables
    // add no CHECK constraint that a restore could reword.
    await runner.query(`CREATE TABLE chain_transaction_classifications (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      txid text NOT NULL,
      "currentVersion" integer NOT NULL,
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("addressId", txid),
      FOREIGN KEY ("addressId", txid)
        REFERENCES wallet_address_transactions ("addressId", txid) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE TABLE chain_transaction_classification_versions (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      txid text NOT NULL,
      version integer NOT NULL,
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      status varchar(16) NOT NULL,
      type varchar(24),
      details jsonb,
      comment text,
      "accountId" uuid,
      "tradeId" uuid,
      "rewardId" uuid,
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("addressId", txid, version),
      UNIQUE ("ownerId", "requestId"),
      FOREIGN KEY ("addressId", txid)
        REFERENCES chain_transaction_classifications ("addressId", txid) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "accountId", "tradeId")
        REFERENCES account_trades ("ownerId", "accountId", id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "accountId", "rewardId")
        REFERENCES account_rewards ("ownerId", "accountId", id) ON DELETE RESTRICT
    )`);
    await runner.query(
      'CREATE INDEX chain_transaction_classifications_owner ON chain_transaction_classifications ("ownerId")',
    );
  }

  async down(): Promise<void> {
    throw new Error('Chain classification downgrade requires an explicit recovery plan');
  }
}
