import { MigrationInterface, QueryRunner } from 'typeorm';

// Additive: existing owners start with an empty failure streak.
export class CapMfaFailureStreak1792200000000 implements MigrationInterface {
  name = 'CapMfaFailureStreak1792200000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE owner_mfa ADD COLUMN "consecutiveFailures" integer NOT NULL
      DEFAULT 0 CONSTRAINT "owner_mfa_consecutiveFailures_check"
      CHECK ("consecutiveFailures" BETWEEN 0 AND 100)`);
  }

  async down(): Promise<void> {
    throw new Error('MFA failure streak downgrade requires an explicit recovery plan');
  }
}
