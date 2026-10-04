import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletAddressTradeLinks1790600000000 implements MigrationInterface {
  name = 'AddWalletAddressTradeLinks1790600000000';

  async up(runner: QueryRunner): Promise<void> {
    // One transaction per trade. A transaction keeps every trade it was completed with;
    // the service allows a new one only after the previous trade is voided in the journal.
    // The trade's current state is read from the journal, never copied here.
    await runner.query(`CREATE TABLE wallet_address_trade_links (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      txid text NOT NULL,
      "accountId" uuid NOT NULL,
      "tradeId" uuid NOT NULL,
      "createVersion" integer NOT NULL DEFAULT 1 CHECK ("createVersion" = 1),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId", "accountId", "tradeId"),
      FOREIGN KEY ("ownerId", "addressId") REFERENCES wallet_addresses("ownerId", id) ON DELETE RESTRICT,
      FOREIGN KEY ("addressId", txid) REFERENCES wallet_address_transactions("addressId", txid) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "accountId", "tradeId", "createVersion")
        REFERENCES account_trade_versions("ownerId", "accountId", "tradeId", version) ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE INDEX wallet_address_trade_links_transaction
      ON wallet_address_trade_links ("addressId", txid, "createdAt")`);
  }

  async down(): Promise<void> {
    throw new Error('Wallet address trade link downgrade requires an explicit recovery plan');
  }
}
