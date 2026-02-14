import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropStubModuleTables1764100000000 implements MigrationInterface {
  name = 'DropStubModuleTables1764100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop tables (CASCADE handles foreign key constraints)
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_recommendations" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "defi_positions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_integrations" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "broker_integrations" CASCADE`);

    // Drop associated enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ai_recommendations_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ai_recommendations_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."defi_positions_platform_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."defi_positions_positiontype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."broker_integrations_brokertype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."broker_integrations_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."bank_integrations_banktype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."bank_integrations_status_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // These stub module tables are intentionally dropped and will not be recreated.
    // The original table definitions can be found in 1763669182662-Init.ts if needed.
  }
}
