import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropLegacySchema1797000000000 implements MigrationInterface {
  name = 'DropLegacySchema1797000000000';

  async up(runner: QueryRunner): Promise<void> {
    // DB-CLEAN: the tables of the screens retired in M20 and the columns of users and
    // wallet_stake_scans that no code reads. Plain DROP without CASCADE, so a dependent object
    // nobody knew about fails the whole migration instead of being removed with it. The owner
    // confirmed the list on 2026-10-12. The dump comes from the release script, not from the
    // migration CLI: anyone running migrate.js directly must take their own backup first.
    for (const table of [
      'reports',
      'capitals',
      'assets',
      'liabilities',
      'user_currency_preferences',
      'crypto_wallets',
      'subscriptions',
      'currencies',
      'invitation_codes',
      'display_fx_observations',
      'display_fx_collection',
    ]) {
      await runner.query(`DROP TABLE "${table}"`);
    }
    for (const type of [
      'assets_assettype_enum',
      'assets_category_enum',
      'assets_incometype_enum',
      'crypto_wallets_type_enum',
      'currencies_type_enum',
      'liabilities_category_enum',
      'liabilities_frequency_enum',
      'reports_format_enum',
      'reports_type_enum',
      'subscriptions_status_enum',
      'subscriptions_type_enum',
    ]) {
      await runner.query(`DROP TYPE "public"."${type}"`);
    }
    await runner.query(`ALTER TABLE users
      DROP COLUMN "emailVerified",
      DROP COLUMN "emailVerificationToken",
      DROP COLUMN "resetPasswordToken",
      DROP COLUMN "resetPasswordExpires",
      DROP COLUMN "firstName",
      DROP COLUMN "lastName"`);
    await runner.query('ALTER TABLE wallet_stake_scans DROP COLUMN "scannedAt"');
  }

  async down(): Promise<void> {
    throw new Error('Dropping the legacy schema cannot be undone; restore from the release dump');
  }
}
