import { closeInstant, closeObservations } from './broker-price-history';
import { parseBondNominal, parseCandles } from './tbank-client';

// The recorded GetCandles shape (CANDLE_INTERVAL_DAY), with synthetic prices: a day candle is
// stamped 00:00 UTC of its trading date, today's is not complete, and a bond is quoted in
// percent of its nominal ("pt.").
const candle = (date: string, units: string, nano = 0, isComplete = true) => ({
  open: { units, nano },
  high: { units, nano },
  low: { units, nano },
  close: { units, nano },
  volume: '1000',
  time: `${date}T00:00:00Z`,
  ...(isComplete ? { isComplete } : {}),
  candleSource: 'CANDLE_SOURCE_EXCHANGE',
  volumeBuy: '500',
  volumeSell: '500',
});
const instrument = '00000000-0000-4000-8000-0000000000a1';

describe('BPH-PARSE GetCandles and BondBy answers are read strictly', () => {
  it('keeps the close of each complete day as exact text with the price currency', () => {
    expect(
      parseCandles({
        candles: [
          candle('2025-01-03', '268', 340000000),
          candle('2025-01-04', '270'),
          candle('2026-10-27', '271', 0, false),
        ],
        priceCurrency: 'rub',
      }),
    ).toEqual({
      currency: 'rub',
      closes: [
        { date: '2025-01-03', close: '268.34' },
        { date: '2025-01-04', close: '270' },
      ],
    });
  });

  it('reads an empty answer as no closes', () => {
    expect(parseCandles({ candles: [], priceCurrency: 'rub' })).toEqual({
      currency: 'rub',
      closes: [],
    });
  });

  it('refuses a candle without a date at midnight UTC or with a broken close', () => {
    expect(() =>
      parseCandles({
        candles: [{ ...candle('2025-01-03', '1'), time: '2025-01-03T07:00:00Z' }],
        priceCurrency: 'rub',
      }),
    ).toThrow();
    expect(() =>
      parseCandles({
        candles: [{ ...candle('2025-01-03', '1'), close: { units: 'x' } }],
        priceCurrency: 'rub',
      }),
    ).toThrow();
    expect(() => parseCandles({ candles: [candle('2025-01-03', '1')] })).toThrow();
  });

  it('gives the nominal of a bond whose nominal never changed, and none otherwise', () => {
    const bond = (over: Record<string, unknown>) => ({
      instrument: {
        uid: instrument,
        nominal: { currency: 'rub', units: '1000', nano: 0 },
        initialNominal: { currency: 'rub', units: '1000', nano: 0 },
        amortizationFlag: false,
        ...over,
      },
    });
    expect(parseBondNominal(bond({}), instrument)).toEqual({ amount: '1000', currency: 'rub' });
    // JSON leaves out a false flag.
    expect(parseBondNominal(bond({ amortizationFlag: undefined }), instrument)).toEqual({
      amount: '1000',
      currency: 'rub',
    });
    expect(parseBondNominal(bond({ amortizationFlag: true }), instrument)).toBeNull();
    expect(
      parseBondNominal(
        bond({ nominal: { currency: 'rub', units: '1050', nano: 120000000 } }),
        instrument,
      ),
    ).toBeNull();
    expect(() => parseBondNominal(bond({ uid: 'another' }), instrument)).toThrow();
  });
});

describe('BPH-CLOSE a day close values the end of its Moscow day', () => {
  it('stamps the close at the last millisecond of the Moscow day', () => {
    expect(closeInstant('2025-01-03').toISOString()).toBe('2025-01-03T20:59:59.999Z');
  });

  it('keeps each close in the currency T-Bank quotes it in', () => {
    expect(
      closeObservations(
        instrument,
        {
          currency: 'rub',
          closes: [
            { date: '2025-01-03', close: '268.34' },
            { date: '2025-01-04', close: '0' },
          ],
        },
        null,
        [],
      ),
    ).toEqual([
      {
        instrumentId: instrument,
        price: '268.34',
        currency: 'RUB',
        observedAt: closeInstant('2025-01-03'),
      },
    ]);
  });

  it('turns a bond close in percent into money at its nominal', () => {
    expect(
      closeObservations(
        instrument,
        { currency: 'pt.', closes: [{ date: '2025-02-10', close: '98.765' }] },
        { amount: '1000', currency: 'rub' },
        [],
      ).map((row) => [row.price, row.currency]),
    ).toEqual([['987.65', 'RUB']]);
  });

  it('keeps nothing for a bond without a fixed nominal or an unknown currency', () => {
    const closes = [{ date: '2025-02-10', close: '98' }];
    expect(closeObservations(instrument, { currency: 'pt.', closes }, null, [])).toEqual([]);
    expect(closeObservations(instrument, { currency: 'cny', closes }, null, [])).toEqual([]);
  });

  it('BPH-SPLIT puts a close before a split back in the units of its day', () => {
    // T-Bank adjusts past candles to today's units; the valuation divides a price by the
    // splits after it, so a close before the split is stored in the old units.
    const split = {
      splitId: 's1',
      instrumentId: instrument,
      effectiveAt: '2026-04-16T21:00:00.000Z',
      ratio: 10,
    };
    const other = { ...split, splitId: 's2', instrumentId: 'another' };
    expect(
      closeObservations(
        instrument,
        {
          currency: 'rub',
          closes: [
            { date: '2026-04-10', close: '319.5' },
            { date: '2026-04-17', close: '326' },
          ],
        },
        null,
        [split, other],
      ).map((row) => row.price),
    ).toEqual(['3195', '326']);
  });
});
