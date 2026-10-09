import { MigrationInterface, QueryRunner } from 'typeorm';

export class SyncBybitAccount1793300000000 implements MigrationInterface {
  name = 'SyncBybitAccount1793300000000';

  async up(runner: QueryRunner): Promise<void> {
    // BYBIT-KEY (M22, D8): a Bybit account is tracked like a wallet, named by its Bybit user ID.
    // Existing rows satisfy the widened checks unchanged.
    await runner.query(`ALTER TABLE wallet_addresses
      DROP CONSTRAINT wallet_addresses_network_check,
      DROP CONSTRAINT wallet_addresses_address_check,
      ADD CONSTRAINT wallet_addresses_network_check CHECK (network = 'bitcoin'
        OR network = 'ethereum' OR network = 'solana' OR network = 'bybit'),
      ADD CONSTRAINT wallet_addresses_address_check CHECK (
        (network = 'bitcoin' AND (address ~ '^[1-9A-HJ-NP-Za-km-z]{25,34}$'
          OR address ~ '^bc1[02-9ac-hj-np-z]{11,87}$'
          OR address ~ '^[xyz]pub[1-9A-HJ-NP-Za-km-z]{107,108}$'))
        OR (network = 'ethereum' AND address ~ '^0x[0-9a-f]{40}$')
        OR (network = 'solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
        OR (network = 'bybit' AND address ~ '^[1-9][0-9]{0,19}$'))`);
    // BYBIT-TRADES, BYBIT-DEPOSIT: Bybit's records are raw legs of the account. A deposit or
    // withdrawal on a tracked chain keeps that chain's transaction identity, so it meets the
    // other side in the owner's wallet; a trade and anything off chain carry Bybit's own ID.
    await runner.query(`ALTER TABLE wallet_address_transactions
      DROP CONSTRAINT wallet_address_transactions_txid_check,
      ADD CONSTRAINT wallet_address_transactions_txid_check CHECK (
        txid ~ '^([0-9a-f]{64}|[1-9A-HJ-NP-Za-km-z]{64,88})(-[0-9]{1,9})?$'
        OR txid ~ '^bybit-(trade|deposit|withdrawal)-[0-9A-Za-z_-]{1,80}$')`);
    // The read-only API key, encrypted with a key derived from the server's MFA key and never
    // returned; how far each of Bybit's record lists has been read; and the balances Bybit
    // reported on the last complete pass (BYBIT-GAPS).
    await runner.query(`CREATE TABLE bybit_accounts (
      "ownerId" uuid NOT NULL,
      "walletId" uuid PRIMARY KEY,
      credentials jsonb NOT NULL CHECK (jsonb_typeof(credentials) = 'object'),
      "keyHint" text NOT NULL CHECK ("keyHint" ~ '^[0-9A-Za-z]{4}$'),
      "ipBound" boolean NOT NULL,
      "keyExpiresAt" timestamptz(3) CHECK (isfinite("keyExpiresAt")),
      "keySavedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("keySavedAt")),
      "historyFrom" timestamptz(3) NOT NULL CHECK (isfinite("historyFrom")),
      "tradesReadTo" timestamptz(3) NOT NULL CHECK (isfinite("tradesReadTo")),
      "depositsReadTo" timestamptz(3) NOT NULL CHECK (isfinite("depositsReadTo")),
      "internalReadTo" timestamptz(3) NOT NULL CHECK (isfinite("internalReadTo")),
      "withdrawalsReadTo" timestamptz(3) NOT NULL CHECK (isfinite("withdrawalsReadTo")),
      balances jsonb CHECK (jsonb_typeof(balances) = 'array'),
      "balancesAt" timestamptz(3) CHECK (isfinite("balancesAt")),
      FOREIGN KEY ("ownerId", "walletId") REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Bybit account downgrade requires an explicit recovery plan');
  }
}
