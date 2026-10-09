import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackTronWallets1793600000000 implements MigrationInterface {
  name = 'TrackTronWallets1793600000000';

  async up(runner: QueryRunner): Promise<void> {
    // TRON-ADD: Tron addresses join the other networks as the base58check text starting with T.
    // A Tron leg is named by its hex transaction hash, which the txid check already accepts.
    // Existing rows satisfy the widened checks unchanged.
    await runner.query(`ALTER TABLE wallet_addresses
      DROP CONSTRAINT wallet_addresses_network_check,
      DROP CONSTRAINT wallet_addresses_address_check,
      ADD CONSTRAINT wallet_addresses_network_check CHECK (network = 'bitcoin'
        OR network = 'ethereum' OR network = 'solana' OR network = 'bybit' OR network = 'tron'),
      ADD CONSTRAINT wallet_addresses_address_check CHECK (
        (network = 'bitcoin' AND (address ~ '^[1-9A-HJ-NP-Za-km-z]{25,34}$'
          OR address ~ '^bc1[02-9ac-hj-np-z]{11,87}$'
          OR address ~ '^[xyz]pub[1-9A-HJ-NP-Za-km-z]{107,108}$'))
        OR (network = 'ethereum' AND address ~ '^0x[0-9a-f]{40}$')
        OR (network = 'solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
        OR (network = 'bybit' AND address ~ '^[1-9][0-9]{0,19}$')
        OR (network = 'tron' AND address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'))`);
    // TRON-SYNC, TRON-STAKE-STATE: how far a Tron wallet's history is read (the newest block
    // time whose transactions are all stored) and what the chain last reported about its
    // staked TRX, its liquid balance and its rewards not yet claimed (null before that).
    await runner.query(`CREATE TABLE wallet_tron_accounts (
      "ownerId" uuid NOT NULL,
      "addressId" uuid PRIMARY KEY,
      "readTo" timestamptz(3) CHECK (isfinite("readTo")),
      reported jsonb CHECK (jsonb_typeof(reported) = 'object'),
      "reportedAt" timestamptz(3) CHECK (isfinite("reportedAt")),
      CHECK ((reported IS NULL) = ("reportedAt" IS NULL)),
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
    // TRON-STAKE-MOVE: TRX one of the wallet's transactions staked (positive) or got back from
    // staking (negative). The raw leg stays as stored; these rows say which part of it stayed
    // the wallet's.
    await runner.query(`CREATE TABLE wallet_tron_stake_moves (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      txid text NOT NULL CHECK (txid ~ '^[0-9a-f]{64}$'),
      "blockHeight" integer NOT NULL CHECK ("blockHeight" >= 0),
      "blockTime" timestamptz(3) NOT NULL CHECK (isfinite("blockTime")),
      units numeric(78,0) NOT NULL CHECK (units <> 0),
      PRIMARY KEY ("addressId", txid),
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Tron wallet downgrade requires an explicit recovery plan');
  }
}
