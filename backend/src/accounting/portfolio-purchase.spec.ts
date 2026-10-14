import { calculateFifo, type FifoTrade } from './fifo';
import type { LotOrigin } from './owned-transfer-types';
import { isPurchase, portfolioAccount } from './portfolio-valuation';

/** The trades that are purchases: a buy with no purpose (income, gifts and fees are not). */
const bought = new Set(['t1:1', 't:1']);
const isBoughtTrade = (tradeId: string, version: number) => bought.has(`${tradeId}:${version}`);

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
const id = '00000000-0000-4000-8000-000000000001';
const buy = (tradeId: string, purpose?: FifoTrade['purpose']): FifoTrade => ({
  tradeId,
  version: 1,
  instrumentId: id,
  instrumentName: 'Bitcoin',
  instrumentSymbol: 'BTC',
  side: 'buy',
  occurredAt: '2025-01-02T00:00:00.000Z',
  orderWithinTimestamp: 0,
  quantity: '1',
  grossUsd: '100',
  feeUsd: '0',
  ...(purpose ? { purpose } : {}),
});

describe('INFL-REAL-LOTS-ORIGIN which held lots are purchases', () => {
  it('a bought lot is a purchase', () => {
    expect(isPurchase({ buyTradeId: 't1', buyVersion: 1 }, isBoughtTrade)).toBe(true);
  });

  it('a carried-in opening lot is not a purchase: its cost is not a recorded purchase', () => {
    expect(isPurchase({ sourceKind: 'carry-in' }, isBoughtTrade)).toBe(false);
    const opening: LotOrigin = {
      ...trade,
      kind: 'carry-in',
      lotId: 'l',
      openingRevision: 1,
      ordinal: 1,
    } as LotOrigin;
    expect(isPurchase({ sourceKind: 'transfer', origin: opening }, isBoughtTrade)).toBe(false);
  });

  it('an own transfer keeps the origin: a bought coin stays a purchase after it moved', () => {
    expect(isPurchase({ sourceKind: 'transfer', origin: trade }, isBoughtTrade)).toBe(true);
  });

  it('a reward, a swap or a coin received without a purchase is not a purchase', () => {
    expect(isPurchase({ origin: reward }, isBoughtTrade)).toBe(false);
    expect(isPurchase({ sourceKind: 'transfer', origin: reward }, isBoughtTrade)).toBe(false);
    const swap: LotOrigin = { ...reward, kind: 'swap', swapId: 's' } as unknown as LotOrigin;
    expect(isPurchase({ origin: swap }, isBoughtTrade)).toBe(false);
    expect(isPurchase({}, isBoughtTrade)).toBe(false);
  });

  it('cash a sale brought in, or an income or gift, is not a purchase though it has a buy trade', () => {
    expect(isPurchase({ buyTradeId: 'sell1', buyVersion: 1 }, isBoughtTrade)).toBe(false);
    const gift: LotOrigin = { ...trade, tradeId: 'gift', version: 1 };
    expect(isPurchase({ sourceKind: 'transfer', origin: gift }, isBoughtTrade)).toBe(false);
  });

  it('a lot whose buy trade version is not known is not taken for a purchase', () => {
    expect(isPurchase({ buyTradeId: 't1' }, isBoughtTrade)).toBe(false);
  });
});

describe('INFL-REAL-LOTS-PURCHASE which bought lots reach the purchases list', () => {
  const account = (trades: FifoTrade[]) =>
    portfolioAccount({ accountId: id, name: 'Wallet' }, calculateFifo(trades, []), {
      trades,
      initialLots: [],
    });

  it('a plain buy is a purchase', () => {
    expect(account([buy('t1')]).lots.map((lot) => lot.purchase)).toEqual([true]);
  });

  it('an income or a gift received is held but is not a purchase', () => {
    expect(account([buy('income', 'income')]).lots.map((lot) => lot.purchase)).toEqual([undefined]);
    expect(account([buy('gift', 'gift-received')]).lots.map((lot) => lot.purchase)).toEqual([
      undefined,
    ]);
  });
});
