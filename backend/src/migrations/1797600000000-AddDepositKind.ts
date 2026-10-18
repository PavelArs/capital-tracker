import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepositKind1797600000000 implements MigrationInterface {
  name = 'AddDepositKind1797600000000';

  async up(runner: QueryRunner): Promise<void> {
    // DEP-ACCOUNT: a savings or current account is a deposit with a balance and no term. Every row
    // that exists is a term deposit and keeps that meaning. An account has no end date and pays
    // out or adds its interest every day or every month; the checks keep that in the table too.
    await runner.query(`ALTER TABLE bank_deposits
      ADD COLUMN kind text NOT NULL DEFAULT 'term-deposit'
        CHECK (kind IN ('term-deposit', 'account')),
      ADD CONSTRAINT bank_deposits_account_has_no_term CHECK (
        kind <> 'account' OR ("endDate" IS NULL AND payout IN ('daily', 'monthly'))
      )`);
    // DEP-HISTORY keeps what a deposit was after it is deleted, and that includes whether it was
    // an account. Events written before this release were all term deposits.
    await runner.query(`ALTER TABLE bank_deposit_events
      ADD COLUMN "depositKind" text NOT NULL DEFAULT 'term-deposit'
        CHECK ("depositKind" IN ('term-deposit', 'account'))`);
  }

  async down(): Promise<void> {
    throw new Error('Deposit kind downgrade requires an explicit recovery plan');
  }
}
