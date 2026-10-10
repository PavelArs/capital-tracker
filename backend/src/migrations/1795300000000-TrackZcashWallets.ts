import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackZcashWallets1795300000000 implements MigrationInterface {
  name = 'TrackZcashWallets1795300000000';

  async up(runner: QueryRunner): Promise<void> {
    // ZCASH-ADD: transparent Zcash addresses ("t1…", "t3…") join the other networks. A Zcash leg
    // is named by its hex txid in a block with a hex hash, which the existing checks accept.
    // Existing rows satisfy the widened checks unchanged.
    await runner.query(`ALTER TABLE wallet_addresses
      DROP CONSTRAINT wallet_addresses_network_check,
      DROP CONSTRAINT wallet_addresses_address_check,
      ADD CONSTRAINT wallet_addresses_network_check CHECK (network = 'bitcoin'
        OR network = 'ethereum' OR network = 'solana' OR network = 'bybit' OR network = 'tron'
        OR network = 'stellar' OR network = 'zcash'),
      ADD CONSTRAINT wallet_addresses_address_check CHECK (
        (network = 'bitcoin' AND (address ~ '^[1-9A-HJ-NP-Za-km-z]{25,34}$'
          OR address ~ '^bc1[02-9ac-hj-np-z]{11,87}$'
          OR address ~ '^[xyz]pub[1-9A-HJ-NP-Za-km-z]{107,108}$'))
        OR (network = 'ethereum' AND address ~ '^0x[0-9a-f]{40}$')
        OR (network = 'solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
        OR (network = 'bybit' AND address ~ '^[1-9][0-9]{0,19}$')
        OR (network = 'tron' AND address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
        OR (network = 'stellar' AND address ~ '^G[A-Z2-7]{55}$')
        OR (network = 'zcash' AND address ~ '^t[13][1-9A-HJ-NP-Za-km-z]{33}$'))`);
    // ZCASH-SYNC: the newest block whose transactions are all stored, and the walk under way:
    // its last block, the next page to read and the page count it found (null before the first
    // page is read).
    await runner.query(`CREATE TABLE wallet_zcash_accounts (
      "ownerId" uuid NOT NULL,
      "addressId" uuid PRIMARY KEY,
      "readTo" integer CHECK ("readTo" >= 0),
      "walkTo" integer CHECK ("walkTo" >= 0),
      "walkPage" integer CHECK ("walkPage" >= 1),
      "walkPages" integer CHECK ("walkPages" >= 1),
      CHECK (("walkTo" IS NULL) = ("walkPage" IS NULL)),
      CHECK ("walkTo" IS NOT NULL OR "walkPages" IS NULL),
      CHECK ("walkTo" > "readTo"),
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Zcash wallet downgrade requires an explicit recovery plan');
  }
}
