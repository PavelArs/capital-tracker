import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOwnerBinding1789990000000 implements MigrationInterface {
  name = 'AddOwnerBinding1789990000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "owner_auth" (
      "id" smallint PRIMARY KEY CONSTRAINT "owner_auth_singleton" CHECK (id = 1),
      "userId" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE RESTRICT,
      "credentialVersion" uuid NOT NULL
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Owner authentication downgrade requires an explicit recovery plan');
  }
}
