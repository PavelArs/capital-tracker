import type { LotOrigin } from './owned-transfer-types';
import { isPurchase } from './portfolio-valuation';

const trade: LotOrigin = {
  accountId: 'a',
  kind: 'trade',
  tradeId: 't',
  version: 1,
  acquiredAt: '2025-01-02T00:00:00.000Z',
  orderWithinTimestamp: 0,
  originalQuantity: '1',
  originalCostUsd: '100',
};
const reward: LotOrigin = {
  accountId: 'a',
  kind: 'reward',
  rewardId: 'r',
  version: 1,
  category: 'staking',
  acquiredAt: '2025-01-02T00:00:00.000Z',
  orderWithinTimestamp: 0,
  originalQuantity: '1',
  originalCostUsd: null,
} as LotOrigin;

describe('INFL-REAL-LOTS-ORIGIN which held lots are purchases', () => {
  it('a bought lot is a purchase, and so is one carried in from a purchase', () => {
    expect(isPurchase({ buyTradeId: 't1' })).toBe(true);
    expect(isPurchase({ sourceKind: 'carry-in' })).toBe(true);
  });

  it('an own transfer keeps the origin: a bought coin stays a purchase after it moved', () => {
    expect(isPurchase({ sourceKind: 'transfer', origin: trade })).toBe(true);
  });

  it('a reward, a swap or a coin received without a purchase is not a purchase', () => {
    expect(isPurchase({ origin: reward })).toBe(false);
    expect(isPurchase({ sourceKind: 'transfer', origin: reward })).toBe(false);
    const swap: LotOrigin = { ...reward, kind: 'swap', swapId: 's' } as unknown as LotOrigin;
    expect(isPurchase({ origin: swap })).toBe(false);
    expect(isPurchase({})).toBe(false);
  });
});
