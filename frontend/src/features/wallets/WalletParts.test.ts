import type { WalletAddress } from '@api/wallet-addresses.api';
import { describe, expect, it } from 'vitest';
import { addressValue } from './WalletParts';

// Synthetic ids and amounts only.
const wallet = (balances: WalletAddress['balances']): WalletAddress =>
  ({
    id: '00000000-0000-4000-8000-000000000020',
    network: 'ethereum',
    address: '0x0000000000000000000000000000000000000001',
    accountId: null,
    label: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    transactionCount: 1,
    chainBalance: balances?.[0]?.quantity ?? null,
    balances,
    sync: null,
  }) as unknown as WalletAddress;

describe('WAL-VALUE the value of a wallet row', () => {
  const prices = new Map([
    ['ETH', '2000'],
    ['USDC', '1'],
  ]);

  it('adds up the priced coins and counts the unpriced ones aloud', () => {
    const mixed = wallet([
      { symbol: 'ETH', quantity: '1.5' },
      { symbol: 'USDC', quantity: '250' },
      { symbol: 'ORB', quantity: '900' },
    ]);
    expect(addressValue(mixed, prices, 'USD')).toBe('$3,250.00 + 1 unpriced');
  });

  it('shows the plain sum when every coin has a price', () => {
    expect(addressValue(wallet([{ symbol: 'ETH', quantity: '1.5' }]), prices, 'USD')).toBe(
      '$3,000.00',
    );
  });

  it('shows a dash when nothing held has a price or the balance is unknown', () => {
    expect(addressValue(wallet([{ symbol: 'ORB', quantity: '900' }]), prices, 'USD')).toBe('—');
    expect(addressValue(wallet(null), prices, 'USD')).toBe('—');
  });

  it('ignores a coin the wallet no longer holds', () => {
    const gone = wallet([
      { symbol: 'ETH', quantity: '1' },
      { symbol: 'ORB', quantity: '0' },
    ]);
    expect(addressValue(gone, prices, 'USD')).toBe('$2,000.00');
  });
});
