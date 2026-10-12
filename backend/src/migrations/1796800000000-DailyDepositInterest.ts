import { MigrationInterface, QueryRunner } from 'typeorm';

export class DailyDepositInterest1796800000000 implements MigrationInterface {
  name = 'DailyDepositInterest1796800000000';

  async up(runner: QueryRunner): Promise<void> {
    // DEP-DAILY: interest can be posted every day. Quarterly stays allowed for the deposits
    // already stored; the app no longer offers it for new ones. Every stored row satisfies the
    // widened check unchanged.
    await runner.query(`ALTER TABLE bank_deposits
      DROP CONSTRAINT bank_deposits_payout_check,
      ADD CONSTRAINT bank_deposits_payout_check
        CHECK (payout IN ('daily', 'monthly', 'quarterly', 'at-end'))`);
  }

  async down(): Promise<void> {
    throw new Error('Daily deposit interest downgrade requires an explicit recovery plan');
  }
}
