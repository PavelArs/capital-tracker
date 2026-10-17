import type { ConnectedLedger } from '../accounting/connected-accounting.store';
import type { FifoCarryInInput } from '../accounting/fifo';
import type { PortfolioInstrument } from '../accounting/portfolio-valuation';
import type { ValuationInputs } from '../accounting/portfolio-valuation.service';
import { FxConverter, type FxRates } from '../fx-rates/fx-conversion';
import { valuesAt } from './portfolio-snapshots.service';

// Synthetic instruments, holdings and rates only.
const rubles: PortfolioInstrument = {
  id: 'rub',
  name: 'Rubles',
  symbol: 'RUB',
  assetType: 'fiat',
  valuationCurrency: 'RUB',
  priceSource: 'fixed',
};
const bitcoin: PortfolioInstrument = {
  id: 'btc',
  name: 'Bitcoin',
  symbol: 'BTC',
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'market',
};
const lot = (instrument: PortfolioInstrument, quantity: string, order = 0): FifoCarryInInput => ({
  lotId: `lot-${instrument.id}`,
  openingRevision: 1,
  ordinal: order + 1,
  instrumentId: instrument.id,
  instrumentName: instrument.name,
  instrumentSymbol: instrument.symbol,
  acquiredAt: '2025-06-01T00:00:00.000Z',
  orderWithinTimestamp: order,
  originalQuantity: quantity,
  originalCostUsd: '0',
  carriedQuantity: quantity,
});
function holding(lots: FifoCarryInInput[]): ValuationInputs {
  const coverageFrom = '2025-06-01T00:00:00.000Z';
  const ledger = {
    accounts: new Map([
      ['bank', { accountId: 'bank', coverageFrom, trades: [], initialLots: lots, swaps: [] }],
    ]),
    transfers: [],
    participants: new Set(),
    rewardParticipants: new Set(),
    swapParticipants: new Set(),
  } as unknown as ConnectedLedger;
  return {
    instruments: [rubles, bitcoin],
    hidden: new Set(),
    accounts: [{ accountId: 'bank', name: 'Bank', coverageFrom: new Date(coverageFrom) }],
    ledgers: new Map([['bank', ledger]]),
    chainMoves: new Map(),
    deposits: [],
  };
}
// The dollar rate stopped on 2025-06-02; the euro rate is still collected.
const rates: FxRates = {
  USD: [{ date: '2025-06-02', rubPerUnit: '80' }],
  EUR: [
    { date: '2025-06-02', rubPerUnit: '100' },
    { date: '2025-07-01', rubPerUnit: '100' },
  ],
};
const at = Date.parse('2025-07-01T12:00:00.000Z');
const prices = {
  market: new Map([
    ['BTC', { priceUsd: '100000', observedAt: '2025-07-01T11:00:00.000Z', source: 'kraken' }],
  ]),
  manual: new Map(),
};
const shown = (inputs: ValuationInputs) =>
  valuesAt(inputs, at, prices, [
    new FxConverter(rates, 'RUB'),
    new FxConverter(rates, 'EUR'),
    new FxConverter(rates, 'USD'),
  ]).map(({ currency, value, complete }) => [currency, value, complete]);

describe('a history point and a stale exchange rate', () => {
  it('FX-STALE-SNAPSHOT keeps a point that needs no stale rate', () => {
    // 1000 RUB is 1000 RUB and 10 EUR without the dollar; only the dollar value is unknown.
    expect(shown(holding([lot(rubles, '1000')]))).toEqual([
      ['RUB', expect.stringMatching(/^1000(\.0+)?$/), true],
      ['EUR', expect.stringMatching(/^10(\.0+)?$/), true],
      ['USD', null, false],
    ]);
  });

  it('FX-STALE-SNAPSHOT leaves a point missing when a held asset needs the stale rate', () => {
    // A dollar-priced coin needs the stopped dollar rate in rubles and euros.
    expect(shown(holding([lot(rubles, '1000'), lot(bitcoin, '1', 1)]))).toEqual([
      ['RUB', null, false],
      ['EUR', null, false],
      ['USD', null, false],
    ]);
  });
});
