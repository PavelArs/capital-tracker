import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReadBybitEarn1794000000000 implements MigrationInterface {
  name = 'ReadBybitEarn1794000000000';

  async up(runner: QueryRunner): Promise<void> {
    // BYBIT-EARN: a paid Earn yield is a raw leg of the Bybit account, named by its product kind
    // and Bybit's id. Existing rows satisfy the widened check unchanged.
    await runner.query(`ALTER TABLE wallet_address_transactions
      DROP CONSTRAINT wallet_address_transactions_txid_check,
      ADD CONSTRAINT wallet_address_transactions_txid_check CHECK (
        txid ~ '^([0-9a-f]{64}|[1-9A-HJ-NP-Za-km-z]{64,88})(-[0-9]{1,9})?$'
        OR txid ~ '^bybit-(trade|deposit|withdrawal)-[0-9A-Za-z_-]{1,80}$'
        OR txid ~ '^bybit-earn-(flexible|onchain)-[0-9A-Za-z_-]{1,80}$')`);
    // Whether the key may read Earn, as Bybit last said (null before the first pass that asked);
    // how far each product's yield is read (null until the key could read it); and what the
    // Earn positions held on the last complete pass, already inside "balances".
    await runner.query(`ALTER TABLE bybit_accounts
      ADD COLUMN "earnAllowed" boolean,
      ADD COLUMN "flexibleReadTo" timestamptz(3) CHECK (isfinite("flexibleReadTo")),
      ADD COLUMN "onchainReadTo" timestamptz(3) CHECK (isfinite("onchainReadTo")),
      ADD COLUMN earn jsonb CHECK (jsonb_typeof(earn) = 'array')`);
  }

  async down(): Promise<void> {
    throw new Error('Bybit Earn downgrade requires an explicit recovery plan');
  }
}
