import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackStellarWallets1795000000000 implements MigrationInterface {
  name = 'TrackStellarWallets1795000000000';

  async up(runner: QueryRunner): Promise<void> {
    // STELLAR-ADD: Stellar accounts join the other networks as their "G…" StrKey. A Stellar leg
    // is named by its hex transaction hash, which the txid check already accepts. Existing rows
    // satisfy the widened checks unchanged.
    await runner.query(`ALTER TABLE wallet_addresses
      DROP CONSTRAINT wallet_addresses_network_check,
      DROP CONSTRAINT wallet_addresses_address_check,
      ADD CONSTRAINT wallet_addresses_network_check CHECK (network = 'bitcoin'
        OR network = 'ethereum' OR network = 'solana' OR network = 'bybit' OR network = 'tron'
        OR network = 'stellar'),
      ADD CONSTRAINT wallet_addresses_address_check CHECK (
        (network = 'bitcoin' AND (address ~ '^[1-9A-HJ-NP-Za-km-z]{25,34}$'
          OR address ~ '^bc1[02-9ac-hj-np-z]{11,87}$'
          OR address ~ '^[xyz]pub[1-9A-HJ-NP-Za-km-z]{107,108}$'))
        OR (network = 'ethereum' AND address ~ '^0x[0-9a-f]{40}$')
        OR (network = 'solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
        OR (network = 'bybit' AND address ~ '^[1-9][0-9]{0,19}$')
        OR (network = 'tron' AND address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
        OR (network = 'stellar' AND address ~ '^G[A-Z2-7]{55}$'))`);
    // STELLAR-SYNC, STELLAR-REPORTED: how far a Stellar wallet's history is read (the total
    // order ID of the newest transaction whose legs are stored) and the XLM balance Horizon last
    // reported (null before that).
    await runner.query(`CREATE TABLE wallet_stellar_accounts (
      "ownerId" uuid NOT NULL,
      "addressId" uuid PRIMARY KEY,
      "readTo" bigint CHECK ("readTo" > 0),
      "reportedUnits" numeric(78,0) CHECK ("reportedUnits" >= 0),
      "reportedAt" timestamptz(3) CHECK (isfinite("reportedAt")),
      CHECK (("reportedUnits" IS NULL) = ("reportedAt" IS NULL)),
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Stellar wallet downgrade requires an explicit recovery plan');
  }
}
