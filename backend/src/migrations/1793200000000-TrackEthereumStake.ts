import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackEthereumStake1793200000000 implements MigrationInterface {
  name = 'TrackEthereumStake1793200000000';

  async up(runner: QueryRunner): Promise<void> {
    // ETH-STAKE-FIND: the pooled staking contracts (Kiln style: stake() and
    // balanceOfUnderlying) an Ethereum wallet deposited ether into, with the ether the contract
    // reported for the wallet at the last block read (null before that) and its token symbol.
    await runner.query(`CREATE TABLE wallet_ether_stake_positions (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      contract text NOT NULL CHECK (contract ~ '^0x[0-9a-f]{40}$'),
      symbol text CHECK (symbol ~ '^[A-Za-z0-9.]{1,16}$'),
      units numeric(78,0) CHECK (units >= 0),
      "observedBlock" integer CHECK ("observedBlock" >= 0),
      "observedAt" timestamptz(3) CHECK (isfinite("observedAt")),
      "discoveredAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
        CHECK (isfinite("discoveredAt")),
      PRIMARY KEY ("addressId", contract),
      CHECK ((units IS NULL) = ("observedAt" IS NULL)
        AND (units IS NULL) = ("observedBlock" IS NULL)),
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
    // ETH-STAKE-MOVE: ether one of the wallet's transactions put into a pool (positive) or got
    // back from it (negative). The raw leg stays as stored; these rows say which part of it
    // stayed the wallet's.
    await runner.query(`CREATE TABLE wallet_ether_stake_moves (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      txid text NOT NULL CHECK (txid ~ '^[0-9a-f]{64}$'),
      contract text NOT NULL,
      "blockHeight" integer NOT NULL CHECK ("blockHeight" >= 0),
      "blockTime" timestamptz(3) NOT NULL CHECK (isfinite("blockTime")),
      units numeric(78,0) NOT NULL CHECK (units <> 0),
      PRIMARY KEY ("addressId", txid, contract),
      FOREIGN KEY ("addressId", contract)
        REFERENCES wallet_ether_stake_positions ("addressId", contract) ON DELETE RESTRICT
    )`);
    // ETH-STAKE-REWARD: growth of a position that no transaction explains, recorded at the block
    // it was read at.
    await runner.query(`CREATE TABLE wallet_ether_stake_rewards (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      contract text NOT NULL,
      "blockHeight" integer NOT NULL CHECK ("blockHeight" >= 0),
      "observedAt" timestamptz(3) NOT NULL CHECK (isfinite("observedAt")),
      units numeric(78,0) NOT NULL CHECK (units > 0),
      PRIMARY KEY ("addressId", contract, "blockHeight"),
      FOREIGN KEY ("addressId", contract)
        REFERENCES wallet_ether_stake_positions ("addressId", contract) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Ethereum stake downgrade requires an explicit recovery plan');
  }
}
