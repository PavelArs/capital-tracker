import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkChainSwaps1793100000000 implements MigrationInterface {
  name = 'LinkChainSwaps1793100000000';

  async up(runner: QueryRunner): Promise<void> {
    // CLS-SWAP: a chain transaction classified as a swap pairs with the owner's raw transaction
    // on the other side, usually another hash or another address, and both name the one swap
    // recorded in the account the bought coins arrived in. Paid from another account, the
    // existing "transferId" names the owned transfer that brought the coins over. The columns
    // are nullable and the application validates them, so no CHECK constraint is added that a
    // restore could reword.
    await runner.query(`ALTER TABLE chain_transaction_classification_versions
      ADD COLUMN "swapAccountId" uuid,
      ADD COLUMN "swapId" uuid,
      ADD COLUMN "pairedAddressId" uuid,
      ADD COLUMN "pairedTxid" text`);
    await runner.query(`ALTER TABLE chain_transaction_classification_versions
      ADD CONSTRAINT chain_transaction_classification_versions_swap
        FOREIGN KEY ("ownerId", "swapAccountId", "swapId")
        REFERENCES account_swaps ("ownerId", "accountId", id) ON DELETE RESTRICT,
      ADD CONSTRAINT chain_transaction_classification_versions_paired
        FOREIGN KEY ("pairedAddressId", "pairedTxid")
        REFERENCES wallet_address_transactions ("addressId", txid) ON DELETE RESTRICT`);
    await runner.query(
      `CREATE INDEX chain_transaction_classification_versions_swap_idx
        ON chain_transaction_classification_versions ("ownerId", "swapId")
        WHERE "swapId" IS NOT NULL`,
    );
  }

  async down(): Promise<void> {
    throw new Error('Chain swap link downgrade requires an explicit recovery plan');
  }
}
