import type { InsightRules } from '@api/owner-settings.api';
import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';
import { describe, expect, it } from 'vitest';
import { collectInsights } from './insights';

// Synthetic ids, names and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const btc = id(1);
const eth = id(2);
const sol = id(3);

const asset = (instrumentId: string, symbol: string, changes: Partial<AssetValuation>) =>
  ({
    instrumentId,
    name: symbol,
    symbol,
    quantity: '1',
    allocationPercent: '0',
    knownCostQuantity: '1',
    knownUnrealizedReturnPercent: null,
    ...changes,
  }) as AssetValuation;

const portfolio = (
  assets: AssetValuation[],
  changes: Partial<PortfolioValuation> = {},
): PortfolioValuation =>
  ({
    currency: 'USD',
    totalValue: '10000',
    assets,
    allocation: { complete: true, byAsset: [], byType: [], byAccount: [] },
    ...changes,
  }) as PortfolioValuation;

const rules = (changes: Partial<InsightRules> = {}): InsightRules => ({
  targets: [],
  driftPoints: '5',
  gainReviewPercent: null,
  lossReviewPercent: null,
  ...changes,
});

describe('collectInsights', () => {
  it('INS-OFF: says nothing without rules or with rules that watch nothing', () => {
    const held = portfolio([asset(btc, 'BTC', { allocationPercent: '70' })]);
    expect(collectInsights(held, null)).toEqual({ items: [], note: null });
    expect(collectInsights(held, rules())).toEqual({ items: [], note: null });
  });

  it('INS-DRIFT: reports an asset above its target by more than the tolerance, with the amount', () => {
    const { items } = collectInsights(
      portfolio([asset(btc, 'BTC', { allocationPercent: '62' })]),
      rules({ targets: [{ instrumentId: btc, percent: '50' }] }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: `drift:${btc}`,
      title: 'BTC is above its target',
    });
    expect(items[0].detail).toBe(
      '62% of your portfolio against a 50% target: 12 points over, about $1,200.00.',
    );
  });

  it('INS-DRIFT: reports an asset below its target, even one no longer held', () => {
    const { items } = collectInsights(
      portfolio([
        asset(btc, 'BTC', { allocationPercent: '60' }),
        asset(eth, 'ETH', { allocationPercent: '20' }),
        asset(sol, 'SOL', { quantity: '0', allocationPercent: null }),
      ]),
      rules({
        targets: [
          { instrumentId: eth, percent: '30' },
          { instrumentId: sol, percent: '10' },
        ],
      }),
    );
    expect(items.map((item) => item.key)).toEqual([`drift:${eth}`, `drift:${sol}`]);
    expect(items[0].title).toBe('ETH is below its target');
    expect(items[0].detail).toBe(
      '20% of your portfolio against a 30% target: 10 points under, about $1,000.00.',
    );
    expect(items[1].detail).toBe(
      '0% of your portfolio against a 10% target: 10 points under, about $1,000.00.',
    );
  });

  it('INS-DRIFT: stays quiet inside the tolerance, boundary included', () => {
    const { items } = collectInsights(
      portfolio([asset(btc, 'BTC', { allocationPercent: '55' })]),
      rules({ targets: [{ instrumentId: btc, percent: '50' }] }),
    );
    expect(items).toEqual([]);
  });

  it('INS-DRIFT: lists the widest stray first', () => {
    const { items } = collectInsights(
      portfolio([
        asset(btc, 'BTC', { allocationPercent: '58' }),
        asset(eth, 'ETH', { allocationPercent: '12' }),
      ]),
      rules({
        targets: [
          { instrumentId: btc, percent: '50' },
          { instrumentId: eth, percent: '30' },
        ],
      }),
    );
    expect(items.map((item) => item.key)).toEqual([`drift:${eth}`, `drift:${btc}`]);
  });

  it('INS-DRIFT: skips a target whose asset is no longer in the portfolio', () => {
    const { items } = collectInsights(
      portfolio([asset(btc, 'BTC', { allocationPercent: '50' })]),
      rules({ targets: [{ instrumentId: eth, percent: '30' }] }),
    );
    expect(items).toEqual([]);
  });

  it('INS-DRIFT-UNPRICED: does not compare shares while a holding has no price', () => {
    const result = collectInsights(
      portfolio([asset(btc, 'BTC', { allocationPercent: '90' })], {
        allocation: { complete: false, byAsset: [], byType: [], byAccount: [] },
      }),
      rules({ targets: [{ instrumentId: btc, percent: '50' }] }),
    );
    expect(result.items).toEqual([]);
    expect(result.note).toBe('Some holdings have no price yet, so shares are not compared.');
  });

  it('INS-REVIEW: flags a return at or above the gain level and at or below the loss level', () => {
    const { items } = collectInsights(
      portfolio([
        asset(btc, 'BTC', { knownUnrealizedReturnPercent: '120.5' }),
        asset(eth, 'ETH', { knownUnrealizedReturnPercent: '-45' }),
        asset(sol, 'SOL', { knownUnrealizedReturnPercent: '12' }),
      ]),
      rules({ gainReviewPercent: '100', lossReviewPercent: '40' }),
    );
    expect(items.map((item) => item.key)).toEqual([`review:${btc}`, `review:${eth}`]);
    expect(items[0].title).toBe('BTC is up 120.5% on its cost');
    expect(items[0].detail).toBe('At or above your +100% review level.');
    expect(items[1].title).toBe('ETH is down 45% on its cost');
    expect(items[1].detail).toBe('At or below your −40% review level.');
  });

  it('INS-REVIEW: ignores assets whose cost is unknown and rules that are off', () => {
    const none = asset(btc, 'BTC', { knownCostQuantity: '0', knownUnrealizedReturnPercent: null });
    const off = asset(eth, 'ETH', { knownUnrealizedReturnPercent: '500' });
    expect(
      collectInsights(portfolio([none, off]), rules({ lossReviewPercent: '10' })).items,
    ).toEqual([]);
  });
});
