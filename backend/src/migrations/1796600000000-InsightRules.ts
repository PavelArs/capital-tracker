import { MigrationInterface, QueryRunner } from 'typeorm';

// INS-RULES, additive: the owner's Dashboard insight rules as one JSON document; existing
// owners start with none (off). The application validates the document, so the column adds no
// CHECK a restore could reword.
export class InsightRules1796600000000 implements MigrationInterface {
  name = 'InsightRules1796600000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE owner_settings ADD COLUMN "insightRules" jsonb');
  }

  async down(): Promise<void> {
    throw new Error('Insight rules downgrade requires an explicit recovery plan');
  }
}
