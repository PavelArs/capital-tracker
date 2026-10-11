import { MigrationInterface, QueryRunner } from 'typeorm';

export class HideAssets1796400000000 implements MigrationInterface {
  name = 'HideAssets1796400000000';

  async up(runner: QueryRunner): Promise<void> {
    // ASSET-HIDE: an asset the owner hid leaves the portfolio, its totals and its history; the
    // asset, its operations and the books they are in stay untouched. One row for each hidden
    // asset, removed when the owner shows it again.
    await runner.query(`CREATE TABLE hidden_assets (
      "ownerId" uuid NOT NULL,
      "instrumentId" uuid NOT NULL,
      "hiddenAt" timestamptz(3) NOT NULL DEFAULT now(),
      PRIMARY KEY ("ownerId", "instrumentId"),
      FOREIGN KEY ("ownerId", "instrumentId")
        REFERENCES accounting_instruments ("ownerId", id) ON DELETE CASCADE
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Hidden assets downgrade requires an explicit recovery plan');
  }
}
