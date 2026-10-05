import { MigrationInterface, QueryRunner } from 'typeorm';

export class TradeComments1791200000000 implements MigrationInterface {
  name = 'TradeComments1791200000000';

  async up(runner: QueryRunner): Promise<void> {
    // OPS-COMMENT: the owner's note on a trade version, kept with it like its amounts. A
    // correction states its own note; no row means none. The length bound is the column type,
    // so the table adds no CHECK constraint that a restore could reword.
    await runner.query(`CREATE TABLE account_trade_version_comments (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "tradeId" uuid NOT NULL,
      version integer NOT NULL,
      comment varchar(500) NOT NULL,
      PRIMARY KEY ("ownerId", "accountId", "tradeId", version),
      FOREIGN KEY ("ownerId", "accountId", "tradeId", version)
        REFERENCES account_trade_versions ("ownerId", "accountId", "tradeId", version)
        ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Trade comments downgrade requires an explicit recovery plan');
  }
}
