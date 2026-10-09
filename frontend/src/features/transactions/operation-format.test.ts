import type { Operation } from '@api/operations.api';
import { describe, expect, it } from 'vitest';
import {
  exchangeRecord,
  sourceLabel,
  statusLabel,
  transactionHash,
  walletLabel,
} from './operation-format';

// Synthetic hashes and signatures, never an owner's transaction.
const leg = (network: 'bitcoin' | 'ethereum' | 'solana' | 'bybit', txid: string) =>
  ({
    chain: { txid },
    wallet: { id: 'w', network, address: 'synthetic', label: null },
  }) as unknown as Operation;

describe('the hash a chain operation shows', () => {
  const hex = 'ab'.repeat(32);
  const signature =
    '5mt57dE8bXApgQb9YsEisaZkJaHfQmgG9ugpng2gLKLryJRStLK6TLUFTExTAzvU99cipvEgBuo39t1yHVLcXxYB';

  it('drops the leg number a token transfer adds to its hash', () => {
    expect(transactionHash(leg('bitcoin', hex))).toBe(hex);
    expect(transactionHash(leg('ethereum', `${hex}-7`))).toBe(`0x${hex}`);
    // SOL-IDENTITY (M15): a Solana signature is shown as is, without its token number.
    expect(transactionHash(leg('solana', `${signature}-2`))).toBe(signature);
    expect(transactionHash(leg('solana', signature))).toBe(signature);
  });

  it('has none for a manual operation', () => {
    expect(transactionHash({ chain: null } as unknown as Operation)).toBeNull();
  });
});

describe('a Bybit record (M22)', () => {
  const hex = 'cd'.repeat(32);

  it('keeps the chain hash of a deposit and names a trade by its Bybit id', () => {
    expect(transactionHash(leg('bybit', hex))).toBe(hex);
    expect(exchangeRecord(leg('bybit', hex))).toBeNull();
    const trade = leg('bybit', 'bybit-trade-2100000000000000001');
    expect(transactionHash(trade)).toBeNull();
    expect(exchangeRecord(trade)).toBe('Trade 2100000000000000001');
    expect(exchangeRecord(leg('bybit', 'bybit-deposit-internal-9000001'))).toBe('Deposit 9000001');
    expect(exchangeRecord(leg('bybit', 'bybit-withdrawal-7000001'))).toBe('Withdrawal 7000001');
  });

  it('names the account by its user ID and an automatic fill as a Bybit trade', () => {
    expect(walletLabel({ id: 'w', network: 'bybit', address: '123456789', label: null })).toBe(
      'Bybit account UID 123456789',
    );
    const automatic = (type: Operation['type']) =>
      ({
        type,
        status: 'recorded',
        classification: { automatic: true },
      }) as unknown as Operation;
    expect(statusLabel(automatic('buy'))).toBe('Auto: Bybit trade');
    expect(statusLabel(automatic('transfer'))).toBe('Auto: own wallets');
  });

  it('says a record came from Bybit, not from a blockchain', () => {
    const from = (network: 'bitcoin' | 'bybit') =>
      ({ ...leg(network, hex), source: 'chain' }) as Operation;
    expect(sourceLabel(from('bybit'))).toBe('Bybit');
    expect(sourceLabel(from('bitcoin'))).toBe('Blockchain');
    expect(sourceLabel({ source: 'manual', wallet: null } as unknown as Operation)).toBe('Manual');
  });
});
