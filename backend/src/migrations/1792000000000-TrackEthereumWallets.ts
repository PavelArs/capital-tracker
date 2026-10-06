import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackEthereumWallets1792000000000 implements MigrationInterface {
  name = 'TrackEthereumWallets1792000000000';

  async up(runner: QueryRunner): Promise<void> {
    // WAL-ADD, ETH-IDENTITY: Ethereum addresses join Bitcoin ones, stored in lower case. Their
    // history is read block range by block range, so "scannedBlock" is the last block whose
    // transactions are all stored. Existing Bitcoin rows satisfy the widened checks unchanged.
    await runner.query(`ALTER TABLE wallet_addresses
      DROP CONSTRAINT wallet_addresses_network_check,
      DROP CONSTRAINT wallet_addresses_address_check,
      ADD CONSTRAINT wallet_addresses_network_check
        CHECK (network = 'bitcoin' OR network = 'ethereum'),
      ADD CONSTRAINT wallet_addresses_address_check CHECK (
        (network = 'bitcoin' AND (address ~ '^[1-9A-HJ-NP-Za-km-z]{25,34}$'
          OR address ~ '^bc1[02-9ac-hj-np-z]{11,87}$'))
        OR (network = 'ethereum' AND address ~ '^0x[0-9a-f]{40}$')),
      ADD COLUMN "scannedBlock" integer`);
    // PR-WAL-3: one Ethereum hash can move ETH and a token. The coin's leg keeps the bare hash;
    // a token transfer's leg is the hash and its log index, and names its token in "asset"
    // (null: the network's own coin). An internal transfer carries no block hash. The
    // application validates the asset, so no CHECK is added that a restore could reword.
    await runner.query(`ALTER TABLE wallet_address_transactions
      DROP CONSTRAINT wallet_address_transactions_txid_check,
      ADD CONSTRAINT wallet_address_transactions_txid_check
        CHECK (txid ~ '^[0-9a-f]{64}(-[0-9]{1,9})?$'),
      ALTER COLUMN "blockHash" DROP NOT NULL,
      ADD COLUMN asset varchar(8)`);
  }

  async down(): Promise<void> {
    throw new Error('Ethereum wallet downgrade requires an explicit recovery plan');
  }
}
