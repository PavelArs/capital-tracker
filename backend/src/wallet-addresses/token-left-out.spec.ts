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
