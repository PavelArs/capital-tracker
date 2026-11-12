import type { EntityManager } from 'typeorm';
import { forgetTokens, rememberTokens } from './chain-assets';
import { leftOut, type TokenHolder, withDust } from './token-left-out';

const contract = `0x${'7f3a'.repeat(10)}`;
const now = new Date('2026-10-18T12:00:00Z');

describe('TOKEN-DUST-FRESH: only a fresh quote can automatically hide a priced holding', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now });
    rememberTokens([
      {
        network: 'ethereum',
        token: contract,
        symbol: 'SYN',
        name: 'Synthetic',
        decimals: 18,
        contract,
        listed: true,
      },
    ]);
  });
  afterEach(() => {
    jest.useRealTimers();
    forgetTokens();
  });

  it.each([
    [2 * 60 * 60_000, true],
    [2 * 60 * 60_000 + 1, false],
    [365 * 24 * 60 * 60_000, false],
  ])('TOKEN-DUST-FRESH at age %s milliseconds hidden=%s', async (age, hidden) => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ dustThresholdUsd: '1' }])
        .mockResolvedValueOnce([
          {
            asset: 'SYN',
            price: '0.5',
            observedAt: new Date(now.getTime() - age),
            source: 'coingecko',
          },
        ]),
    } as unknown as EntityManager;
    const holder: TokenHolder = {
      network: 'ethereum',
      tokenBackfillTo: null,
      hiddenTokens: [],
      shownTokens: [],
      balances: [{ asset: contract, units: '1000000000000000000' }],
    };
    await withDust(manager, 'synthetic-owner', [holder]);
    expect(leftOut(holder).has(contract)).toBe(hidden);
    holder.hiddenTokens = [contract];
    expect(leftOut(holder).get(contract)).toBe('owner');
  });
});

describe('TOKEN-DUST: which other tokens withDust marks as worth nothing', () => {
  const unlisted = `0x${'5c1e'.repeat(10)}`;
  const empty = `0x${'0e0e'.repeat(10)}`;
  beforeEach(() => {
    jest.useFakeTimers({ now });
    rememberTokens([
      {
        network: 'ethereum',
        token: contract,
        symbol: 'SYN',
        name: 'Synthetic',
        decimals: 18,
        contract,
        listed: true,
      },
      {
        network: 'ethereum',
        token: unlisted,
        symbol: 'JNK',
        name: 'Junk',
        decimals: 6,
        contract: unlisted,
        listed: false,
      },
      {
        network: 'ethereum',
        token: empty,
        symbol: 'EMT',
        name: 'Empty',
        decimals: 6,
        contract: empty,
        listed: true,
      },
    ]);
  });
  afterEach(() => {
    jest.useRealTimers();
    forgetTokens();
  });

  it('TOKEN-DUST marks a cheap priced holding and an unlisted unpriced one, never an empty priced one or another network', async () => {
    const quote = (asset: string, price: string) => ({
      asset,
      price,
      observedAt: new Date(now.getTime() - 60_000),
      source: 'coingecko',
    });
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ dustThresholdUsd: '1' }])
      .mockResolvedValueOnce([quote('EMT', '0.0001'), quote('SYN', '0.5')]);
    const manager = { query } as unknown as EntityManager;
    const ethereum: TokenHolder = {
      network: 'ethereum',
      tokenBackfillTo: null,
      hiddenTokens: [],
      shownTokens: [],
      balances: [
        { asset: null, units: '5' },
        { asset: contract, units: '1000000000000000000' },
        { asset: unlisted, units: '5000000' },
        { asset: empty, units: '0' },
      ],
    };
    const bitcoin: TokenHolder = {
      network: 'bitcoin',
      tokenBackfillTo: null,
      hiddenTokens: [],
      shownTokens: [],
      balances: [{ asset: null, units: '1' }],
    };
    const rows = await withDust(manager, 'synthetic-owner', [bitcoin, ethereum]);
    expect(rows).toEqual([bitcoin, ethereum]);
    expect([...(ethereum.dustTokens ?? [])].sort()).toEqual([contract, unlisted].sort());
    expect(bitcoin.dustTokens).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1][0]).toEqual(['SYN', 'JNK', 'EMT']);
    expect([...leftOut(ethereum, true).entries()].sort()).toEqual(
      [
        [contract, 'dust'],
        [unlisted, 'dust'],
      ].sort(),
    );
  });

  it('TOKEN-DUST reads no prices and marks nothing when no address can hold other tokens', async () => {
    const query = jest.fn();
    const bitcoin: TokenHolder = {
      network: 'bitcoin',
      tokenBackfillTo: null,
      hiddenTokens: [],
      shownTokens: [],
      balances: [{ asset: null, units: '1' }],
    };
    await withDust({ query } as unknown as EntityManager, 'synthetic-owner', [bitcoin]);
    expect(query).not.toHaveBeenCalled();
    expect(bitcoin.dustTokens).toBeUndefined();
  });
});
