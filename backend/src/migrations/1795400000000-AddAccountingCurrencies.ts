import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountingCurrencies1795400000000 implements MigrationInterface {
  name = 'AddAccountingCurrencies1795400000000';

  async up(runner: QueryRunner): Promise<void> {
    // CUR-MORE: the main currency may be any accounting currency the application knows (USD,
    // EUR, RUB and the Bank of Russia currencies added since), so the table only checks the
    // shape of a code. The application validates the list; a list in a CHECK would need a new
    // migration for every currency and a reviewed restore pair in the release normalizer.
    await runner.query(`ALTER TABLE owner_settings
      DROP CONSTRAINT "owner_settings_mainCurrency_check"`);
    await runner.query(`ALTER TABLE owner_settings
      ADD CONSTRAINT "owner_settings_mainCurrency_check" CHECK ("mainCurrency" ~ '^[A-Z]{3}$')`);
  }

  async down(): Promise<void> {
    throw new Error('Accounting currencies downgrade requires an explicit recovery plan');
  }
}
