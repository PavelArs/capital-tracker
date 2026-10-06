import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkOwnTransfers1791800000000 implements MigrationInterface {
  name = 'LinkOwnTransfers1791800000000';

  async up(runner: QueryRunner): Promise<void> {
    // XFER-*: a chain transaction classified as a transfer between the owner's own accounts
    // produces one owned transfer. When the other side of the same transaction is one of the
    // owner's addresses too, both legs name that transfer and each other, so the pair reads as
    // one operation. "automatic" marks a pair the app linked without asking (D7). The columns
    // are nullable and the application validates them, so no CHECK constraint is added that a
    // restore could reword.
    await runner.query(`ALTER TABLE chain_transaction_classification_versions
      ADD COLUMN "transferId" uuid,
      ADD COLUMN "linkedAddressId" uuid,
      ADD COLUMN automatic boolean`);
    await runner.query(`ALTER TABLE chain_transaction_classification_versions
      ADD CONSTRAINT chain_transaction_classification_versions_transfer
        FOREIGN KEY ("ownerId", "transferId") REFERENCES owned_transfers ("ownerId", id)
        ON DELETE RESTRICT,
      ADD CONSTRAINT chain_transaction_classification_versions_linked
        FOREIGN KEY ("linkedAddressId", txid)
        REFERENCES wallet_address_transactions ("addressId", txid) ON DELETE RESTRICT`);
    await runner.query(
      `CREATE INDEX chain_transaction_classification_versions_transfer_idx
        ON chain_transaction_classification_versions ("ownerId", "transferId")
        WHERE "transferId" IS NOT NULL`,
    );
  }

  async down(): Promise<void> {
    throw new Error('Own transfer link downgrade requires an explicit recovery plan');
  }
}
