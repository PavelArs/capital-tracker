import { MigrationInterface, QueryRunner } from 'typeorm';

export class TradePurposes1791400000000 implements MigrationInterface {
  name = 'TradePurposes1791400000000';

  async up(runner: QueryRunner): Promise<void> {
    // PR-OPS-2: income, expense, gift or fee recorded in the trade journal, kept per version
    // like its amounts; no row means a purchase or sale. The application validates the value
    // against the trade's side, so the table adds no CHECK constraint that a restore could
    // reword.
    await runner.query(`CREATE TABLE account_trade_version_purposes (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "tradeId" uuid NOT NULL,
      version integer NOT NULL,
      purpose varchar(16) NOT NULL,
      PRIMARY KEY ("ownerId", "accountId", "tradeId", version),
      FOREIGN KEY ("ownerId", "accountId", "tradeId", version)
        REFERENCES account_trade_versions ("ownerId", "accountId", "tradeId", version)
        ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Trade purposes downgrade requires an explicit recovery plan');
  }
}
