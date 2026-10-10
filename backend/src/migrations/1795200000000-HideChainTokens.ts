import { MigrationInterface, QueryRunner } from 'typeorm';

export class HideChainTokens1795200000000 implements MigrationInterface {
  name = 'HideChainTokens1795200000000';

  async up(runner: QueryRunner): Promise<void> {
    // TOKEN-HIDE: which of an address's other tokens the owner left out of its balances. A
    // token is named by its contract (Ethereum, lower case) or mint (Solana), as a leg names it.
    // "hiddenTokens" are the owner's own choices; "shownTokens" are tokens the app would hide by
    // itself (a negative balance, a copy of USDT) that the owner brought back. The application
    // validates the values, so no CHECK is added that a restore could reword.
    await runner.query(`ALTER TABLE wallet_addresses
      ADD COLUMN "hiddenTokens" text[] NOT NULL DEFAULT '{}',
      ADD COLUMN "shownTokens" text[] NOT NULL DEFAULT '{}'`);
  }

  async down(): Promise<void> {
    throw new Error('Token hiding downgrade requires an explicit recovery plan');
  }
}
