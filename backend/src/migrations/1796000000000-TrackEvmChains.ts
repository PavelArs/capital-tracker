import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackEvmChains1796000000000 implements MigrationInterface {
  name = 'TrackEvmChains1796000000000';

  async up(runner: QueryRunner): Promise<void> {
    // EVM-MULTICHAIN: the Ethereum-like chains Etherscan's V2 API reads join the other networks,
    // each as a network of its own with the same lower-case 0x address and the same leg identity
    // as Ethereum (hash, or hash and log index). Every chain planned is named here so that
    // adding one later needs no migration; the application only accepts the ones it reads.
    // Existing rows satisfy the widened checks unchanged.
    await runner.query(`ALTER TABLE wallet_addresses
      DROP CONSTRAINT wallet_addresses_network_check,
      DROP CONSTRAINT wallet_addresses_address_check,
      ADD CONSTRAINT wallet_addresses_network_check CHECK (network = 'bitcoin'
        OR network = 'ethereum' OR network = 'solana' OR network = 'bybit' OR network = 'tron'
        OR network = 'stellar' OR network = 'zcash' OR network = 'base' OR network = 'arbitrum'
        OR network = 'optimism' OR network = 'polygon' OR network = 'bnb'
        OR network = 'avalanche' OR network = 'zksync' OR network = 'linea'
        OR network = 'scroll'),
      ADD CONSTRAINT wallet_addresses_address_check CHECK (
        (network = 'bitcoin' AND (address ~ '^[1-9A-HJ-NP-Za-km-z]{25,34}$'
          OR address ~ '^bc1[02-9ac-hj-np-z]{11,87}$'
          OR address ~ '^[xyz]pub[1-9A-HJ-NP-Za-km-z]{107,108}$'))
        OR (network IN ('ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bnb',
          'avalanche', 'zksync', 'linea', 'scroll') AND address ~ '^0x[0-9a-f]{40}$')
        OR (network = 'solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
        OR (network = 'bybit' AND address ~ '^[1-9][0-9]{0,19}$')
        OR (network = 'tron' AND address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
        OR (network = 'stellar' AND address ~ '^G[A-Z2-7]{55}$')
        OR (network = 'zcash' AND address ~ '^t[13][1-9A-HJ-NP-Za-km-z]{33}$'))`);
  }

  async down(): Promise<void> {
    throw new Error('EVM chain downgrade requires an explicit recovery plan');
  }
}
