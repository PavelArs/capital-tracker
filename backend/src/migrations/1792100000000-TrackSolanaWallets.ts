import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackSolanaWallets1792100000000 implements MigrationInterface {
  name = 'TrackSolanaWallets1792100000000';

  async up(runner: QueryRunner): Promise<void> {
    // WAL-ADD: Solana addresses join Bitcoin and Ethereum ones, as the case-sensitive base58
    // text of a 32-byte key. Their history is read slot by slot, so "scannedBlock" holds the
    // last slot whose transactions are all stored. Existing rows satisfy the widened checks.
    await runner.query(`ALTER TABLE wallet_addresses
      DROP CONSTRAINT wallet_addresses_network_check,
      DROP CONSTRAINT wallet_addresses_address_check,
      ADD CONSTRAINT wallet_addresses_network_check
        CHECK (network = 'bitcoin' OR network = 'ethereum' OR network = 'solana'),
      ADD CONSTRAINT wallet_addresses_address_check CHECK (
        (network = 'bitcoin' AND (address ~ '^[1-9A-HJ-NP-Za-km-z]{25,34}$'
          OR address ~ '^bc1[02-9ac-hj-np-z]{11,87}$'))
        OR (network = 'ethereum' AND address ~ '^0x[0-9a-f]{40}$')
        OR (network = 'solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'))`);
    // SOL-IDENTITY: a Solana leg is named by its base58 signature. The SOL leg (with the fee)
    // keeps the bare signature; a USDT or USDC leg adds the token's number, so the sending
    // and the receiving wallet name the same token movement alike.
    await runner.query(`ALTER TABLE wallet_address_transactions
      DROP CONSTRAINT wallet_address_transactions_txid_check,
      ADD CONSTRAINT wallet_address_transactions_txid_check
        CHECK (txid ~ '^([0-9a-f]{64}|[1-9A-HJ-NP-Za-km-z]{64,88})(-[0-9]{1,9})?$')`);
  }

  async down(): Promise<void> {
    throw new Error('Solana wallet downgrade requires an explicit recovery plan');
  }
}
