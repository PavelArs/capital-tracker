import { MigrationInterface, QueryRunner } from 'typeorm';

// Additive: one nullable column, so existing sessions stay valid and show "Unknown device".
export class AddSessionDevice1792800000000 implements MigrationInterface {
  name = 'AddSessionDevice1792800000000';

  async up(runner: QueryRunner): Promise<void> {
    // SEC-SESSIONS: a fixed browser name such as "Safari on iPhone", never the raw User-Agent.
    await runner.query('ALTER TABLE auth_sessions ADD COLUMN device varchar(40)');
  }

  async down(): Promise<void> {
    throw new Error('Session device downgrade requires an explicit recovery plan');
  }
}
