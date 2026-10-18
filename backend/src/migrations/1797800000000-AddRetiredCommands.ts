import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRetiredCommands1797800000000 implements MigrationInterface {
  name = 'AddRetiredCommands1797800000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE retired_commands (
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      scope text NOT NULL CHECK (scope IN ('deposit', 'deposit-movement', 'deposit-check', 'goal')),
      "requestId" uuid NOT NULL,
      PRIMARY KEY ("ownerId", scope, "requestId")
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Retired commands downgrade requires an explicit recovery plan');
  }
}
