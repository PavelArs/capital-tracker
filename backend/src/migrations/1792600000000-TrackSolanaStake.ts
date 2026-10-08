import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackSolanaStake1792600000000 implements MigrationInterface {
  name = 'TrackSolanaStake1792600000000';

  async up(runner: QueryRunner): Promise<void> {
    // SOL-STAKE-FIND: the stake accounts a Solana wallet acted on in its own transactions, with
    // the balance, validator and state the chain showed when last read (null before that).
    await runner.query(`CREATE TABLE wallet_stake_accounts (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      account text NOT NULL CHECK (account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
      lamports numeric(78,0) CHECK (lamports >= 0),
      validator text CHECK (validator ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
      state text CHECK (state = 'activating' OR state = 'active' OR state = 'deactivating'
        OR state = 'inactive' OR state = 'closed'),
      "observedAt" timestamptz(3) CHECK (isfinite("observedAt")),
      "discoveredAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
        CHECK (isfinite("discoveredAt")),
      PRIMARY KEY ("addressId", account),
      CHECK ((lamports IS NULL) = ("observedAt" IS NULL) AND (lamports IS NULL) = (state IS NULL)),
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
    // SOL-STAKE-MOVE: how much one of the wallet's transactions changed a stake account. The
    // raw leg stays as stored; these rows say which part of it stayed inside the wallet.
    await runner.query(`CREATE TABLE wallet_stake_moves (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      signature text NOT NULL CHECK (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
      account text NOT NULL,
      slot integer NOT NULL CHECK (slot >= 0),
      "blockTime" timestamptz(3) NOT NULL CHECK (isfinite("blockTime")),
      units numeric(78,0) NOT NULL CHECK (units <> 0),
      PRIMARY KEY ("addressId", signature, account),
      FOREIGN KEY ("addressId", account)
        REFERENCES wallet_stake_accounts ("addressId", account) ON DELETE RESTRICT
    )`);
    // SOL-STAKE-REWARD: growth of a stake account that no transaction explains, recorded at the
    // finalized slot it was first seen.
    await runner.query(`CREATE TABLE wallet_stake_rewards (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      account text NOT NULL,
      slot integer NOT NULL CHECK (slot >= 0),
      "observedAt" timestamptz(3) NOT NULL CHECK (isfinite("observedAt")),
      units numeric(78,0) NOT NULL CHECK (units > 0),
      PRIMARY KEY ("addressId", account, slot),
      FOREIGN KEY ("addressId", account)
        REFERENCES wallet_stake_accounts ("addressId", account) ON DELETE RESTRICT
    )`);
    // Addresses whose stored history has been read for stake accounts; an address synced
    // before this migration is read once from the raw transactions already stored.
    await runner.query(`CREATE TABLE wallet_stake_scans (
      "ownerId" uuid NOT NULL,
      "addressId" uuid PRIMARY KEY,
      "scannedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("scannedAt")),
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Solana stake downgrade requires an explicit recovery plan');
  }
}
