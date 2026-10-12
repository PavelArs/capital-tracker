import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassOfAccount1796900000000 implements MigrationInterface {
  name = 'ClassOfAccount1796900000000';

  async up(runner: QueryRunner): Promise<void> {
    // Asset classes (v8): an account that holds a broker account or a property gets its own
    // section instead of Wallets. Null is a wallet, so every existing account stays one; no
    // other column or row changes.
    await runner.query(`ALTER TABLE manual_accounts ADD COLUMN "assetClass" text
      CHECK ("assetClass" = 'broker' OR "assetClass" = 'property')`);
  }

  async down(): Promise<void> {
    throw new Error('Account class downgrade requires an explicit recovery plan');
  }
}
