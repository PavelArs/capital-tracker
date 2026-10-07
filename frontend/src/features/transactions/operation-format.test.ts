import type { Operation } from '@api/operations.api';
import { describe, expect, it } from 'vitest';
import { transactionHash } from './operation-format';

// Synthetic hashes and signatures, never an owner's transaction.
const leg = (network: 'bitcoin' | 'ethereum' | 'solana', txid: string) =>
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
