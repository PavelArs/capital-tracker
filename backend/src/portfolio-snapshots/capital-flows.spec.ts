import type { ConnectedLedger } from '../accounting/connected-accounting.store';
import type { FifoCarryInInput, FifoTrade } from '../accounting/fifo';
import type { ValuationInputs } from '../accounting/portfolio-valuation.service';
import { FxConverter, type FxRates } from '../fx-rates/fx-conversion';
import {
  type CapitalFlow,
  capitalFlows,
  investedAt,
  type StatedFlow,
  splitChange,
  stateFlows,
} from './capital-flows';

const at = (iso: string) => Date.parse(iso);
const SCALE = 10n ** 60n;
const usd = (amount: number): StatedFlow['amount'] => BigInt(amount) * SCALE;

function trade(
  side: 'buy' | 'sell',
  occurredAt: string,
  grossUsd: string,
  feeUsd = '0',
): FifoTrade {
  return {
    tradeId: `${side}-${occurredAt}`,
    version: 1,
    instrumentId: 'btc',
    instrumentName: 'Bitcoin',
    instrumentSymbol: 'BTC',
    side,
    occurredAt,
    orderWithinTimestamp: 0,
    quantity: '1',
    grossUsd,
    feeUsd,
  };
}
function carryIn(acquiredAt: string, originalCostUsd: string, carried: string): FifoCarryInInput {
  return {
    lotId: `lot-${acquiredAt}`,
    openingRevision: 1,
    ordinal: 1,
    instrumentId: 'btc',
    instrumentName: 'Bitcoin',
    instrumentSymbol: 'BTC',
    acquiredAt,
    orderWithinTimestamp: 0,
    originalQuantity: '2',
    originalCostUsd,
    carriedQuantity: carried,
  };
}
function inputs(
  accounts: {
    id: string;
    coverageFrom: string;
    trades?: FifoTrade[];
    initialLots?: FifoCarryInInput[];
  }[],
): ValuationInputs {
  // Two accounts joined by an own transfer share one ledger; each is read once.
  const ledger = {
    accounts: new Map(
      accounts.map((account) => [
        account.id,
        {
          accountId: account.id,
          coverageFrom: account.coverageFrom,
          trades: account.trades ?? [],
          initialLots: account.initialLots ?? [],
        },
      ]),
    ),
  } as unknown as ConnectedLedger;
  return {
    instruments: [],
    accounts: [],
    ledgers: new Map(accounts.map((account) => [account.id, ledger])),
  };
}
const shown = (flows: CapitalFlow[]) =>
  flows.map((flow) => [new Date(flow.at).toISOString(), flow.usd.toString(), flow.rateDate]);
const units = (amount: number) => (BigInt(amount) * 10n ** 30n).toString();

// 80 RUB per USD and 90 RUB per EUR from 2025-06-02; nothing earlier.
const rates: FxRates = {
  USD: [
    { date: '2025-06-02', rubPerUnit: '80' },
    { date: '2025-09-01', rubPerUnit: '95' },
  ],
  EUR: [{ date: '2025-06-02', rubPerUnit: '100' }],
};

describe('capital flows: market versus flows (split-market-and-flows)', () => {
  it('a buy paid from outside deposits its gross and fee; a sell withdraws its net proceeds', () => {
    const flows = capitalFlows(
      inputs([
        {
          id: 'trezor',
          coverageFrom: '2025-06-01T00:00:00.000Z',
          trades: [
            trade('sell', '2025-09-10T12:00:00.000Z', '30000', '25'),
            trade('buy', '2025-06-13T10:00:00.000Z', '25000', '10'),
          ],
        },
      ]),
    );
    expect(shown(flows)).toEqual([
      ['2025-06-13T10:00:00.000Z', units(25010), '2025-06-13'],
      ['2025-09-10T12:00:00.000Z', (-BigInt(units(29975))).toString(), '2025-09-10'],
    ]);
  });

  it('holdings carried into a journal enter at its start with their carried cost', () => {
    const flows = capitalFlows(
      inputs([
        {
          id: 'bybit',
          coverageFrom: '2025-07-01T00:00:00.000Z',
          initialLots: [carryIn('2024-11-20T00:00:00.000Z', '60000', '1')],
        },
      ]),
    );
    // Half of a 2-unit lot bought for 60000 is carried in: 30000, at its purchase date's rate.
    expect(shown(flows)).toEqual([['2025-07-01T00:00:00.000Z', units(30000), '2024-11-20']]);
  });

  it('XFER-CAPITAL an own transfer adds no flow; a connected ledger is read once', () => {
    const flows = capitalFlows(
      inputs([
        {
          id: 'a',
          coverageFrom: '2025-06-01T00:00:00.000Z',
          trades: [trade('buy', '2025-06-13T10:00:00.000Z', '1000')],
        },
        { id: 'b', coverageFrom: '2025-06-01T00:00:00.000Z' },
      ]),
    );
    expect(flows).toHaveLength(1);
  });

  it('flows are stated in each currency at their own date, null without a rate (Q1)', () => {
    const flows: CapitalFlow[] = [
      { at: at('2025-06-13T10:00:00.000Z'), usd: 1000n * 10n ** 30n, rateDate: '2025-06-13' },
      { at: at('2025-09-10T10:00:00.000Z'), usd: -500n * 10n ** 30n, rateDate: '2025-09-10' },
    ];
    const rub = stateFlows(flows, new FxConverter(rates, 'RUB'));
    expect(rub.map((flow) => flow.amount)).toEqual([usd(80000), usd(-47500)]);
    const eur = stateFlows(flows, new FxConverter(rates, 'EUR'));
    expect(eur.map((flow) => flow.amount)).toEqual([usd(800), (-47500n * SCALE) / 100n]);
    const early = stateFlows(
      [{ at: at('2025-01-10T00:00:00.000Z'), usd: 10n ** 30n, rateDate: '2025-01-10' }],
      new FxConverter(rates, 'RUB'),
    );
    expect(early).toEqual([{ at: at('2025-01-10T00:00:00.000Z'), amount: null }]);
  });

  it('CUR-PAID-RUB a trade paid in RUB or EUR is exact in its own currency, USD as stored', () => {
    const paid = (
      base: FifoTrade,
      currency: 'RUB' | 'EUR',
      gross: string,
      fee: string,
      perUsd: string,
    ): FifoTrade => ({
      ...base,
      paid: {
        currency,
        gross,
        fee,
        rateDate: base.occurredAt.slice(0, 10),
        perUsd,
        rateSource: 'owner',
      },
    });
    const flows = capitalFlows(
      inputs([
        {
          id: 'trezor',
          coverageFrom: '2025-06-01T00:00:00.000Z',
          trades: [
            // 7000 RUB at the owner's 70 RUB per USD, not the Bank of Russia's 80.
            paid(trade('buy', '2025-06-13T10:00:00.000Z', '100'), 'RUB', '7000', '0', '70'),
            paid(
              trade('sell', '2025-09-10T12:00:00.000Z', '450', '4.5'),
              'EUR',
              '400',
              '4',
              '0.88',
            ),
          ],
        },
      ]),
    );
    const stated = (currency: 'USD' | 'EUR' | 'RUB') =>
      stateFlows(flows, new FxConverter(rates, currency)).map((flow) => flow.amount);
    expect(stated('USD')).toEqual([usd(100), (-4455n * SCALE) / 10n]);
    expect(stated('RUB')).toEqual([usd(7000), usd(-39600)]);
    expect(stated('EUR')).toEqual([usd(70), usd(-396)]);
  });

  it('net invested steps with each flow and is unknown after a flow without a rate', () => {
    const flows: StatedFlow[] = [
      { at: at('2025-06-13T10:00:00.000Z'), amount: usd(1000) },
      { at: at('2025-06-20T00:00:00.000Z'), amount: usd(-300) },
      { at: at('2025-07-01T00:00:00.000Z'), amount: null },
    ];
    const instants = [
      '2025-06-13T00:00:00.000Z',
      '2025-06-14T00:00:00.000Z',
      '2025-06-20T00:00:00.000Z',
      '2025-06-30T00:00:00.000Z',
      '2025-07-01T00:00:00.000Z',
    ].map(at);
    expect(investedAt(flows, instants)).toEqual(['0', '1000', '700', '700', null]);
  });

  it('FLOW-SPLIT-DEPOSIT V0 100000, a 10000 buy paid from outside, V1 110000', () => {
    const start = { at: at('2026-09-05T00:00:00.000Z'), value: '100000' };
    const end = { at: at('2026-10-05T00:00:00.000Z'), value: '110000' };
    const flows = [{ at: at('2026-09-20T00:00:00.000Z'), amount: usd(10000) }];
    expect(splitChange(start, end, flows)).toEqual({
      deposits: '10000',
      withdrawals: '0',
      netFlow: '10000',
      marketEffect: '0',
      marketReturnPercent: '0.00',
    });
  });

  it('FLOW-SPLIT-MIXED the same deposit and V1 115000: market +5000, return 4.55 %', () => {
    const start = { at: at('2026-09-05T00:00:00.000Z'), value: '100000' };
    const end = { at: at('2026-10-05T00:00:00.000Z'), value: '115000' };
    const flows = [
      // Flows at or before the start are already in V0; later ones are not in the period yet.
      { at: at('2026-09-05T00:00:00.000Z'), amount: usd(99999) },
      { at: at('2026-09-20T00:00:00.000Z'), amount: usd(10000) },
      { at: at('2026-10-06T00:00:00.000Z'), amount: usd(99999) },
    ];
    expect(splitChange(start, end, flows)).toEqual({
      deposits: '10000',
      withdrawals: '0',
      netFlow: '10000',
      marketEffect: '5000',
      marketReturnPercent: '4.55',
    });
  });

  it('FLOW-SPLIT-TRANSFER only an own transfer with a 6 USD fee: net flow 0, market −6', () => {
    const start = { at: at('2026-09-05T00:00:00.000Z'), value: '60000' };
    const end = { at: at('2026-10-05T00:00:00.000Z'), value: '59994' };
    expect(splitChange(start, end, [])).toEqual({
      deposits: '0',
      withdrawals: '0',
      netFlow: '0',
      marketEffect: '-6',
      marketReturnPercent: '-0.01',
    });
  });

  it('withdrawals reduce net flow; all time from zero divides by deposits; unknowns stay null', () => {
    const start = { at: at('2025-01-01T00:00:00.000Z'), value: '0' };
    const end = { at: at('2026-10-05T00:00:00.000Z'), value: '1200' };
    const flows = [
      { at: at('2025-06-13T00:00:00.000Z'), amount: usd(1000) },
      { at: at('2025-09-13T00:00:00.000Z'), amount: usd(-400) },
    ];
    expect(splitChange(start, end, flows)).toEqual({
      deposits: '1000',
      withdrawals: '400',
      netFlow: '600',
      marketEffect: '600',
      marketReturnPercent: '60.00',
    });
    // Nothing deposited and nothing held: no return, never a division by zero.
    expect(splitChange(start, { ...end, value: '0' }, []).marketReturnPercent).toBeNull();
    const unknown = {
      deposits: null,
      withdrawals: null,
      netFlow: null,
      marketEffect: null,
      marketReturnPercent: null,
    };
    expect(splitChange(null, end, flows)).toEqual(unknown);
    expect(splitChange(start, end, [{ at: at('2025-06-13T00:00:00.000Z'), amount: null }])).toEqual(
      unknown,
    );
    // A value without a rate keeps the known flows and leaves the market effect unknown.
    expect(splitChange(start, { ...end, value: null }, flows)).toMatchObject({
      netFlow: '600',
      marketEffect: null,
      marketReturnPercent: null,
    });
  });
});
