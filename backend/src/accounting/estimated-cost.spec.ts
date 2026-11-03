import { FxConverter } from '../fx-rates/fx-conversion';
import { nearKey, withEstimatedCosts } from './estimated-cost';
import type {
  PortfolioAccountInput,
  PortfolioInstrument,
  StoredPrice,
} from './portfolio-valuation';

// Synthetic ids, amounts and rates only.
const btc: PortfolioInstrument = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Bitcoin',
  symbol: 'BTC',
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'market',
};
const bond: PortfolioInstrument = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Bond',
  symbol: null,
  assetType: 'manual',
  valuationCurrency: 'RUB',
  priceSource: 'manual',
};
const usd = new FxConverter({ USD: [{ date: '2026-06-01', rubPerUnit: '100' }], EUR: [] }, 'USD');
const lot = (
  instrumentId: string,
  quantity: string,
  costUsd: string | null,
  acquiredAt: string,
) => ({
  instrumentId,
  quantity,
  costUsd,
  acquiredAt,
});
const account = (lots: PortfolioAccountInput['lots']): PortfolioAccountInput[] => [
  { accountId: 'account', name: 'Wallet', coverage: 'covered', lots, realizations: [] },
];
const price = (priceUsd: string, observedAt: string, currency?: 'RUB'): StoredPrice => ({
  priceUsd,
  observedAt,
  source: 'synthetic',
  ...(currency ? { currency } : {}),
});

describe('COST-ESTIMATE a lot without a purchase price is costed at its price when it came in', () => {
  it('COST-ESTIMATE costs it at the price nearest its time, in USD, and marks it', () => {
    const at = '2026-06-02T10:00:00.000Z';
    const near = new Map([
      [nearKey(btc.id, at), price('60000', '2026-06-02T09:00:00.000Z')],
      [nearKey(bond.id, at), price('1000', '2026-06-01T00:00:00.000Z', 'RUB')],
    ]);
    const [result] = withEstimatedCosts(
      account([lot(btc.id, '0.5', null, at), lot(bond.id, '3', null, at)]),
      [btc, bond],
      near,
      [],
      usd,
    );
    expect(result.lots).toEqual([
      { ...lot(btc.id, '0.5', '30000', at), costEstimated: true },
      // 1000 RUB a unit at 100 RUB per USD.
      { ...lot(bond.id, '3', '30', at), costEstimated: true },
    ]);
  });

  it('COST-ESTIMATE leaves a known cost, an asset with no price, cash and a property alone', () => {
    const at = '2026-06-02T10:00:00.000Z';
    const cash: PortfolioInstrument = {
      ...btc,
      id: 'cash',
      symbol: 'USD',
      assetType: 'fiat',
      priceSource: 'fixed',
    };
    const near = new Map([
      [nearKey(bond.id, at), price('1000', '2026-06-01T00:00:00.000Z', 'RUB')],
    ]);
    const lots = [
      lot(btc.id, '1', '50000', at),
      lot(btc.id, '1', null, at),
      lot('cash', '5', null, at),
    ];
    expect(withEstimatedCosts(account(lots), [btc, bond, cash], near, [], usd)[0].lots).toEqual(
      lots,
    );
    const property = [
      { ...account([lot(bond.id, '3', null, at)])[0], assetClass: 'property' as const },
    ];
    expect(withEstimatedCosts(property, [bond], near, [], usd)[0].lots).toEqual([
      lot(bond.id, '3', null, at),
    ]);
  });

  it('COST-ESTIMATE costs the units held now when a split followed the price', () => {
    const at = '2026-06-02T10:00:00.000Z';
    const split = [
      { splitId: 's', instrumentId: bond.id, effectiveAt: '2026-06-10T00:00:00.000Z', ratio: 2 },
    ];
    // 3 units now were 1.5 when they came in, at 1000 RUB (10 USD) each before the split.
    const before = new Map([
      [nearKey(bond.id, at), price('1000', '2026-06-01T00:00:00.000Z', 'RUB')],
    ]);
    expect(
      withEstimatedCosts(account([lot(bond.id, '3', null, at)]), [bond], before, split, usd)[0]
        .lots,
    ).toEqual([{ ...lot(bond.id, '3', '15', at), costEstimated: true }]);
    // A split recorded for later than the valuation is not in the units held yet.
    const future = [{ ...split[0], effectiveAt: '2026-12-01T00:00:00.000Z' }];
    expect(
      withEstimatedCosts(
        account([lot(bond.id, '3', null, at)]),
        [bond],
        before,
        future,
        usd,
        '2026-11-03T00:00:00.000Z',
      )[0].lots,
    ).toEqual([{ ...lot(bond.id, '3', '30', at), costEstimated: true }]);
    // A price after the split is already per unit held now.
    const after = new Map([
      [nearKey(bond.id, at), price('1000', '2026-06-20T00:00:00.000Z', 'RUB')],
    ]);
    expect(
      withEstimatedCosts(account([lot(bond.id, '3', null, at)]), [bond], after, split, usd)[0].lots,
    ).toEqual([{ ...lot(bond.id, '3', '30', at), costEstimated: true }]);
  });
});
