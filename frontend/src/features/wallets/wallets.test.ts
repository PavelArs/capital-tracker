import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import { describe, expect, it } from 'vitest';
import { accountNamed, checkBitcoinAddress, reconcile, shortAddress, sum } from './wallets';

// Synthetic ids and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = id(10);
const cold = id(11);

const address = (n: number, changes: Partial<WalletAddress>): WalletAddress => ({
  id: id(20 + n),
  network: 'bitcoin',
  address: `bc1qsynthetic${n}`,
  accountId: trust,
  label: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: 3,
  chainBalance: '0.01000000',
  sync: { state: 'complete', completedAt: '2026-10-05T10:00:00.000Z' },
  ...changes,
});

const portfolio = (holdings: { accountId: string; quantity: string }[]) =>
  ({
    assets: [
      {
        instrumentId: id(1),
        name: 'Bitcoin',
        symbol: 'btc',
        assetType: 'crypto',
        holdings: holdings.map((holding) => ({ ...holding, accountName: 'x', value: null })),
      },
      {
        instrumentId: id(2),
        name: 'Gold bar named BTC',
        symbol: 'BTC',
        assetType: 'manual',
        holdings: [{ accountId: trust, accountName: 'x', quantity: '5', value: null }],
      },
    ],
  }) as unknown as PortfolioValuation;

describe('SYNC-RECONCILE: chain balance against the account transactions', () => {
  it('shows the difference when the chain holds more', () => {
    expect(
      reconcile([address(1, {})], portfolio([{ accountId: trust, quantity: '0.0098' }]), trust),
    ).toEqual({
      state: 'differs',
      chain: '0.01',
      recorded: '0.0098',
      difference: '0.0002',
    });
  });

  it('adds every address of the account and only crypto BTC holdings', () => {
    expect(
      reconcile(
        [
          address(1, {}),
          address(2, { chainBalance: '0.00500000' }),
          address(3, { accountId: cold, chainBalance: '9' }),
        ],
        portfolio([
          { accountId: trust, quantity: '0.015' },
          { accountId: cold, quantity: '1' },
        ]),
        trust,
      ),
    ).toEqual({ state: 'match', chain: '0.015' });
  });

  it('is negative when the records hold more than the chain', () => {
    const result = reconcile(
      [address(1, { chainBalance: '0.00000000' })],
      portfolio([{ accountId: trust, quantity: '0.000000001' }]),
      trust,
    );
    expect(result).toMatchObject({ state: 'differs', difference: '-0.000000001' });
  });

  it('waits while any address has no complete history', () => {
    expect(
      reconcile(
        [
          address(1, {}),
          address(2, { chainBalance: null, sync: { state: 'partial', completedAt: null } }),
        ],
        portfolio([]),
        trust,
      ),
    ).toEqual({ state: 'pending' });
  });

  it('has nothing to compare without an address', () => {
    expect(reconcile([address(1, { accountId: null })], portfolio([]), trust)).toEqual({
      state: 'none',
    });
  });

  it('sums exact decimals', () => {
    expect(sum(['0.1', '0.2'])).toBe('0.3');
    expect(sum([])).toBe('0');
  });
});

describe('WAL-INVALID, WAL-NO-SECRETS: the address field', () => {
  it.each([
    [
      'BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ',
      'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      'Native SegWit address',
    ],
    [
      '  1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2 ',
      '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      'Legacy address',
    ],
    ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'Script address'],
  ])('accepts %s', (input, normalized, kind) => {
    expect(checkBitcoinAddress(input)).toEqual({ ok: true, address: normalized, kind });
  });

  it.each([
    ['', 'Paste the wallet address.'],
    ['0x3B9e4f8A2c71D05e6aF1b2C9d8E07a4F5c6D8F31', 'This looks like an Ethereum address.'],
    ['DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy', 'This looks like a Solana address.'],
    ['bitcoin', 'This is not a valid Bitcoin address.'],
    [`zpub${'6'.repeat(107)}`, 'Account public keys (xpub, zpub) are not supported yet.'],
  ])('refuses %j', (input, message) => {
    const result = checkBitcoinAddress(input);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain(message);
    expect(result.ok === false && result.secret).toBeUndefined();
  });

  it.each([
    ['a 12-word phrase', Array(11).fill('abandon').concat('about').join(' ')],
    ['a 24-word phrase', Array(23).fill('abandon').concat('art').join('\n')],
    ['a private key', `5${'H'.repeat(50)}`],
  ])('marks %s as a secret', (_case, input) => {
    expect(checkBitcoinAddress(input)).toMatchObject({ ok: false, secret: true });
  });
});

describe('names', () => {
  it('shortens an address to its start and end', () => {
    expect(shortAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('bc1qar0s…wf5mdq');
  });

  it('finds an account by name whatever the case', () => {
    expect(accountNamed([{ name: 'Trust Wallet' }], '  trust wallet ')).toEqual({
      name: 'Trust Wallet',
    });
    expect(accountNamed([{ name: 'Trust Wallet' }], 'Trezor')).toBeUndefined();
  });
});
