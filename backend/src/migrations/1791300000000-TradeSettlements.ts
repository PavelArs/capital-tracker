import { MigrationInterface, QueryRunner } from 'typeorm';

export class TradeSettlements1791300000000 implements MigrationInterface {
  name = 'TradeSettlements1791300000000';

  async up(runner: QueryRunner): Promise<void> {
    // OPS-SELL-CASH, OPS-BUY-CASH: the cash asset in the same account that settles a trade
    // version. A sale adds its net proceeds to it; a buy spent this much of it, the rest came
    // from outside. No row keeps a trade's earlier meaning: settled with money from outside.
    // The application validates the quantity, so the table adds no CHECK constraint that a
    // restore could reword.
    await runner.query(`CREATE TABLE account_trade_version_settlements (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "tradeId" uuid NOT NULL,
      version integer NOT NULL,
      "instrumentId" uuid NOT NULL,
      quantity numeric(78,30) NOT NULL,
      PRIMARY KEY ("ownerId", "accountId", "tradeId", version),
      FOREIGN KEY ("ownerId", "accountId", "tradeId", version)
        REFERENCES account_trade_versions ("ownerId", "accountId", "tradeId", version)
        ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "instrumentId")
        REFERENCES accounting_instruments ("ownerId", id) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Trade settlements downgrade requires an explicit recovery plan');
  }
}
