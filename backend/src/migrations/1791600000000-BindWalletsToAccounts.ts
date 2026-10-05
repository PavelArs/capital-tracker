import { MigrationInterface, QueryRunner } from 'typeorm';

export class BindWalletsToAccounts1791600000000 implements MigrationInterface {
  name = 'BindWalletsToAccounts1791600000000';

  async up(runner: QueryRunner): Promise<void> {
    // WAL-ADD, WAL-ACCOUNT: a wallet address belongs to at most one account and may carry a
    // name. Existing addresses keep no account until the owner picks one, so both columns are
    // nullable and nothing is rewritten. The application validates the name, so the columns
    // add no CHECK constraint that a restore could reword.
    await runner.query(`ALTER TABLE wallet_addresses
      ADD COLUMN "accountId" uuid,
      ADD COLUMN label varchar(40),
      ADD CONSTRAINT wallet_addresses_account_fkey FOREIGN KEY ("ownerId", "accountId")
        REFERENCES manual_accounts ("ownerId", id) ON DELETE RESTRICT`);
    await runner.query(
      'CREATE INDEX wallet_addresses_account ON wallet_addresses ("ownerId", "accountId")',
    );
  }

  async down(): Promise<void> {
    throw new Error('Wallet account binding downgrade requires an explicit recovery plan');
  }
}
