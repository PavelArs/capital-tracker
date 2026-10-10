import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import { describe, expect, it } from 'vitest';
import {
  accountNamed,
  checkAddress,
  checkApiKey,
  checkBitcoinAddress,
  reconcile,
  shortAddress,
  sum,
} from './wallets';

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
  balances: null,
  sync: {
    state: 'complete',
    completedAt: '2026-10-05T10:00:00.000Z',
    status: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextRunAt: null,
    errorMessage: null,
  },
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
      assets: [
        { symbol: 'BTC', chain: '0.01', recorded: '0.0098', difference: '0.0002', exchange: false },
      ],
    });
  });

  it('BYBIT-HIDDEN: what the owner hid from the records is no difference of an exchange', () => {
    const bybit = (hidden: { symbol: string; quantity: string }[]) =>
      address(1, {
        network: 'bybit',
        address: '123456789',
        chainBalance: null,
        balances: [{ symbol: 'BTC', quantity: '0.0102' }],
        exchange: {
          keyHint: 'ab12',
          ipBound: true,
          keyExpiresAt: null,
          reportedAt: null,
          untracked: [],
          historyFrom: '2024-10-01T00:00:00.000Z',
          hidden,
        },
      });
    const records = portfolio([{ accountId: trust, quantity: '0.01' }]);
    expect(reconcile([bybit([])], records, trust)).toMatchObject({
      state: 'differs',
      assets: [{ symbol: 'BTC', difference: '0.0002', exchange: true }],
    });
    expect(reconcile([bybit([{ symbol: 'BTC', quantity: '0.0002' }])], records, trust)).toEqual({
      state: 'match',
    });
    expect(
      reconcile([bybit([{ symbol: 'BTC', quantity: '0.0001' }])], records, trust),
    ).toMatchObject({
      state: 'differs',
      assets: [{ symbol: 'BTC', difference: '0.0001' }],
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
    ).toEqual({ state: 'match' });
  });

  it('is negative when the records hold more than the chain', () => {
    const result = reconcile(
      [address(1, { chainBalance: '0.00000000' })],
      portfolio([{ accountId: trust, quantity: '0.000000001' }]),
      trust,
    );
    expect(result).toMatchObject({
      state: 'differs',
      assets: [{ symbol: 'BTC', difference: '-0.000000001' }],
    });
  });

  it('waits while any address has no complete history', () => {
    expect(
      reconcile(
        [
          address(1, {}),
          address(2, {
            chainBalance: null,
            sync: {
              state: 'partial',
              completedAt: null,
              status: null,
              lastAttemptAt: null,
              lastSuccessAt: null,
              nextRunAt: null,
              errorMessage: null,
            },
          }),
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

  it('compares an Ethereum address asset by asset: ETH, USDT and USDC (M14)', () => {
    const ethereum = address(4, {
      network: 'ethereum',
      address: `0x${'a1'.repeat(20)}`,
      chainBalance: '1.500000000000000000',
      balances: [
        { symbol: 'ETH', quantity: '1.500000000000000000' },
        { symbol: 'USDT', quantity: '0.000000' },
        { symbol: 'USDC', quantity: '250.000000' },
      ],
    });
    const held = {
      assets: [
        { symbol: 'ETH', assetType: 'crypto', holdings: [{ accountId: trust, quantity: '1.5' }] },
        { symbol: 'USDC', assetType: 'crypto', holdings: [{ accountId: trust, quantity: '200' }] },
      ],
    } as unknown as PortfolioValuation;
    expect(reconcile([ethereum], held, trust)).toEqual({
      state: 'differs',
      assets: [
        { symbol: 'USDC', chain: '250', recorded: '200', difference: '50', exchange: false },
      ],
    });
  });

  it('TOKEN-ANY checks another token once the portfolio counts it; an airdrop nobody recorded is no difference', () => {
    const ethereum = address(5, {
      network: 'ethereum',
      address: `0x${'b2'.repeat(20)}`,
      chainBalance: '1.000000000000000000',
      balances: [
        { symbol: 'ETH', quantity: '1.000000000000000000' },
        { symbol: 'USDT', quantity: '0.000000' },
        { symbol: 'USDC', quantity: '0.000000' },
        { symbol: 'SYN', quantity: '12.5' },
        { symbol: 'FREEDROP', quantity: '1000' },
      ],
    });
    const held = {
      assets: [
        { symbol: 'ETH', assetType: 'crypto', holdings: [{ accountId: trust, quantity: '1' }] },
        { symbol: 'SYN', assetType: 'crypto', holdings: [{ accountId: trust, quantity: '10' }] },
      ],
    } as unknown as PortfolioValuation;
    expect(reconcile([ethereum], held, trust)).toEqual({
      state: 'differs',
      assets: [
        { symbol: 'SYN', chain: '12.5', recorded: '10', difference: '2.5', exchange: false },
      ],
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
    // M21: the BIP-84 test vector's account key, kept exactly as pasted.
    [
      ' zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs ',
      'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
      'Account public key · every address of this account will be tracked',
    ],
  ])('accepts %s', (input, normalized, kind) => {
    expect(checkBitcoinAddress(input)).toEqual({ ok: true, address: normalized, kind });
  });

  it.each([
    ['', 'Paste the wallet address.'],
    ['0x3B9e4f8A2c71D05e6aF1b2C9d8E07a4F5c6D8F31', 'This looks like an Ethereum address.'],
    ['DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy', 'pick Solana to track it'],
    ['bitcoin', 'This is not a valid Bitcoin address.'],
    [`zpub${'6'.repeat(90)}`, 'This is not a valid Bitcoin address.'],
    [`tpub${'6'.repeat(107)}`, 'Testnet keys are not tracked'],
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
    ['an account private key', `zprv${'6'.repeat(107)}`],
    ['an extended private key', `xprv${'9'.repeat(107)}`],
  ])('marks %s as a secret', (_case, input) => {
    expect(checkBitcoinAddress(input)).toMatchObject({ ok: false, secret: true });
  });
});

describe('WAL-INVALID, WAL-NO-SECRETS: the Ethereum address field (M14)', () => {
  it('accepts an address in any case and keeps it in lower case', () => {
    expect(checkAddress('ethereum', ' 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed ')).toEqual({
      ok: true,
      address: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
      kind: 'Ethereum address',
    });
  });

  it.each([
    ['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'This is not an Ethereum address'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'looks like a Bitcoin address'],
    ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA', 'This is not a valid Ethereum address.'],
  ])('refuses %j', (input, message) => {
    const result = checkAddress('ethereum', input);
    expect(result.ok === false && result.message).toContain(message);
  });

  it.each([
    ['a 12-word phrase', Array(11).fill('abandon').concat('about').join(' ')],
    ['a hex private key', `0x${'4c'.repeat(32)}`],
    ['a bare hex private key', '4c'.repeat(32)],
  ])('marks %s as a secret', (_case, input) => {
    expect(checkAddress('ethereum', input)).toMatchObject({ ok: false, secret: true });
  });
});

describe('WAL-INVALID, WAL-NO-SECRETS: the Solana address field (M15)', () => {
  // Base58 of the SHA-256 of a fixed label: a synthetic key, never an owner's wallet.
  const solana = '74jkuZyPNbBxRF7N6TgmYPi4jTtnk93yH9kpFyNQHypf';

  it('accepts a 32-byte base58 address exactly as pasted', () => {
    expect(checkAddress('solana', ` ${solana} `)).toEqual({
      ok: true,
      address: solana,
      kind: 'Solana address',
    });
    expect(checkAddress('solana', '11111111111111111111111111111111')).toMatchObject({ ok: true });
  });

  it.each([
    ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'it looks like an Ethereum address'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'it looks like a Bitcoin address'],
    ['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'it looks like a Bitcoin address'],
    [solana.slice(0, 40), 'This is not a valid Solana address.'],
    [`${solana.slice(0, -1)}0`, 'This is not a valid Solana address.'],
  ])('refuses %j', (input, message) => {
    const result = checkAddress('solana', input);
    expect(result.ok === false && result.message).toContain(message);
    expect(result.ok === false && result.secret).toBeUndefined();
  });

  it.each([
    ['a 12-word phrase', Array(11).fill('abandon').concat('about').join(' ')],
    [
      'a base58 secret key',
      '5mt57dE8bXApgQb9YsEisaZkJaHfQmgG9ugpng2gLKLryJRStLK6TLUFTExTAzvU99cipvEgBuo39t1yHVLcXxYB',
    ],
    ['a keypair file', `[${Array(64).fill('17').join(',')}]`],
  ])('marks %s as a secret', (_case, input) => {
    expect(checkAddress('solana', input)).toMatchObject({ ok: false, secret: true });
    expect(checkAddress('bitcoin', input)).toMatchObject({ ok: false, secret: true });
  });
});

describe('TRON-ADD, WAL-NO-SECRETS: the Tron address field', () => {
  // Base58check of the SHA-256 of a fixed label: a synthetic account, never an owner's wallet.
  const tron = 'TKtDzrC3Hw7WVmzzeQtkvSknuV16HZGafR';

  it('accepts a "T…" address exactly as pasted', () => {
    expect(checkAddress('tron', ` ${tron} `)).toEqual({
      ok: true,
      address: tron,
      kind: 'Tron address',
    });
  });

  it.each([
    ['416cc0027fd992863e7472490919d2769e0aa0e8d9', 'the hex form of a Tron address'],
    ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'it looks like an Ethereum address'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'it looks like a Bitcoin address'],
    ['74jkuZyPNbBxRF7N6TgmYPi4jTtnk93yH9kpFyNQHypf', 'it looks like a Solana address'],
    [tron.slice(0, 30), 'This is not a valid Tron address.'],
    [`${tron.slice(0, -1)}0`, 'This is not a valid Tron address.'],
  ])('refuses %j', (input, message) => {
    const result = checkAddress('tron', input);
    expect(result.ok === false && result.message).toContain(message);
    expect(result.ok === false && result.secret).toBeUndefined();
  });

  it('points a Tron address pasted for another network to Tron', () => {
    for (const network of ['bitcoin', 'ethereum', 'solana'] as const) {
      const result = checkAddress(network, tron);
      expect(result.ok === false && result.message).toContain('Tron');
    }
  });

  it.each([
    ['a 12-word phrase', Array(11).fill('abandon').concat('about').join(' ')],
    ['a hex private key', '4c'.repeat(32)],
  ])('marks %s as a secret', (_case, input) => {
    expect(checkAddress('tron', input)).toMatchObject({ ok: false, secret: true });
  });
});

describe('STELLAR-ADD, WAL-NO-SECRETS: the Stellar address field (M23)', () => {
  // StrKey of the SHA-256 of a fixed label: a synthetic account, never an owner's wallet.
  const stellar = 'GDVAYF5L5VO3TB4443DGK74NKBY547UED3O3537NINFDO4TBNHIUV3HD';

  it('accepts a "G…" account exactly as pasted', () => {
    expect(checkAddress('stellar', ` ${stellar} `)).toEqual({
      ok: true,
      address: stellar,
      kind: 'Stellar account',
    });
  });

  it.each([
    ['MDZJJ4ZBLLGQPC2IPM5AHTNFJQOP3UMC2M6JNHVNK2SJO4TFUS3C4AAAAAAAAAAAAAL44', 'muxed address'],
    ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'it looks like an Ethereum address'],
    ['TKtDzrC3Hw7WVmzzeQtkvSknuV16HZGafR', 'it looks like a Tron address'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'it looks like a Bitcoin address'],
    [stellar.slice(0, 40), 'This is not a valid Stellar address.'],
    [stellar.toLowerCase(), 'This is not a valid Stellar address.'],
  ])('refuses %j', (input, message) => {
    const result = checkAddress('stellar', input);
    expect(result.ok === false && result.message).toContain(message);
    expect(result.ok === false && result.secret).toBeUndefined();
  });

  it('points a Stellar address pasted for another network to Stellar', () => {
    for (const network of ['bitcoin', 'ethereum', 'solana', 'tron'] as const) {
      const result = checkAddress(network, stellar);
      expect(result.ok === false && result.message).toContain('Stellar');
    }
  });

  it('marks a Stellar secret seed as a secret on any network', () => {
    for (const network of ['stellar', 'bitcoin'] as const)
      expect(
        checkAddress(network, 'SAPRFEI6OHGMDPWC44RAWNDFCCPYODWT5XXCT4XO6K77HGLCMPI63P26'),
      ).toMatchObject({ ok: false, secret: true });
  });
});

describe('EVM-MULTICHAIN: the 0x address of an Ethereum-like chain', () => {
  const lower = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';

  it('is checked like an Ethereum address on every chain', () => {
    for (const network of [
      'ethereum',
      'base',
      'arbitrum',
      'optimism',
      'polygon',
      'bnb',
      'avalanche',
    ] as const) {
      expect(checkAddress(network, ` ${lower} `)).toEqual({
        ok: true,
        address: lower,
        kind: 'Ethereum address',
      });
      expect(checkAddress(network, 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toMatchObject({
        ok: false,
      });
    }
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

describe('BYBIT-KEY: the API key fields (M22)', () => {
  it('takes letters and digits, trimmed, and refuses a seed phrase', () => {
    expect(checkApiKey(' SyntheticKey0001 ', 'key')).toEqual({
      ok: true,
      value: 'SyntheticKey0001',
    });
    expect(checkApiKey('', 'secret')).toEqual({ ok: false, message: 'Paste the API secret.' });
    expect(checkApiKey('not-a-key!', 'key').ok).toBe(false);
    const words = Array(11).fill('abandon').concat('about').join(' ');
    expect(checkApiKey(words, 'secret')).toMatchObject({ ok: false, secret: true });
  });
});

describe('ZCASH-ADD, WAL-NO-SECRETS: the Zcash address field (M24)', () => {
  // Base58Check of the SHA-256 of a fixed label: synthetic addresses, never an owner's wallet.
  const zcash = 't1T2xng63Qs7DtbK4cNwLsjWtMmciMZWTc5';
  const script = 't3SNXaHvbjJNC9Lv7KimsH8QMsDaAZFUZnq';

  it('accepts a transparent "t1…" or "t3…" address exactly as pasted', () => {
    expect(checkAddress('zcash', ` ${zcash} `)).toEqual({
      ok: true,
      address: zcash,
      kind: 'Transparent address',
    });
    expect(checkAddress('zcash', script)).toMatchObject({ kind: 'Transparent script address' });
  });

  it.each([
    [`zs1${'q'.repeat(75)}`, 'This is a shielded address'],
    [`u1${'q'.repeat(104)}`, 'This is a shielded address'],
    [`tex1${'q'.repeat(38)}`, 'exchange (TEX) address'],
    [`tm${zcash.slice(2)}`, 'Testnet addresses are not tracked'],
    ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'it looks like an Ethereum address'],
    ['TKtDzrC3Hw7WVmzzeQtkvSknuV16HZGafR', 'it looks like a Tron address'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'it looks like a Bitcoin address'],
    [zcash.slice(0, 30), 'This is not a valid Zcash address.'],
  ])('refuses %j', (input, message) => {
    const result = checkAddress('zcash', input);
    expect(result.ok === false && result.message).toContain(message);
    expect(result.ok === false && result.secret).toBeUndefined();
  });

  it('points a Zcash address pasted for another network to Zcash', () => {
    for (const network of ['bitcoin', 'ethereum', 'solana', 'tron', 'stellar'] as const) {
      const result = checkAddress(network, zcash);
      expect(result.ok === false && result.message).toContain('Zcash');
    }
  });
});
