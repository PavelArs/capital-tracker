import { BadRequestException } from '@nestjs/common';
import { parseCsvConfirm, parseCsvPreview } from './csv-input';
import { normalizeCsvRows } from './csv-parser';
import { convertPaidToUsd } from './paid-currency';
import { projectTradeVersion } from './trade-journal.store';

const instrumentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const headers = ['asset', 'side', 'at', 'order', 'quantity', 'gross', 'fee', 'currency', 'rate'];

type Columns = Record<string, number>;
function settings(columns: Columns = {}, extra: Record<string, unknown> = {}) {
  return {
    format: { delimiter: ';', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: {
      columns: {
        instrument: 0,
        side: 1,
        occurredAt: 2,
        order: 3,
        quantity: 4,
        grossUsd: 5,
        feeUsd: 6,
        ...columns,
      },
      instruments: [{ source: 'BTC', instrumentId }],
      sides: [{ source: 'B', side: 'buy' }],
    },
    assertUsd: true,
    ...extra,
  };
}
function document(cells: string[][]) {
  return {
    valid: true as const,
    headers: [...headers],
    rows: cells.map((values, index) => ({
      ordinal: index + 1,
      startLine: index + 2,
      cells: values,
    })),
    error: null,
  };
}
function row(gross: string, fee = '0', currency = '', rate = '', order = '0'): string[] {
  return ['BTC', 'B', '2025-11-21T00:00:00Z', order, '0.01', gross, fee, currency, rate];
}
function normalize(cells: string[][], raw: ReturnType<typeof settings>) {
  return normalizeCsvRows(document(cells), parseCsvPreview(raw));
}
function rejects(run: () => unknown) {
  expect(run).toThrow(BadRequestException);
}

describe('PCUR-2 conversion rule', () => {
  it('divides by units-per-USD and rounds half up to 8 places, exact at rate 1', () => {
    expect(convertPaidToUsd('100000', '79.0246')).toBe('1265.42873991');
    expect(convertPaidToUsd('30000', '77.9568')).toBe('384.82852041');
    expect(convertPaidToUsd('0', '79.0246')).toBe('0');
    expect(convertPaidToUsd('1000.123456789', '1')).toBe('1000.123456789');
    expect(convertPaidToUsd('0.000000005', '1.0000000000')).toBe('0.000000005');
    expect(convertPaidToUsd('0.000000005', '1.0000000001')).toBe('0');
    expect(convertPaidToUsd('0.000000005', '0.9999999999')).toBe('0.00000001');
    expect(convertPaidToUsd('0.000000004', '2')).toBe('0');
    expect(convertPaidToUsd('1', '3')).toBe('0.33333333');
    expect(convertPaidToUsd('2', '3')).toBe('0.66666667');
    expect(convertPaidToUsd('86', '0.86')).toBe('100');
  });
});

describe('PCUR-RUB file-wide currency and rate', () => {
  it('converts paid amounts and keeps the exact payment beside the USD execution', () => {
    const result = normalize(
      [row('100000', '150')],
      settings({}, { payment: { currency: 'RUB', perUsd: '79.0246' } }),
    );
    expect(result.rowErrors).toEqual([]);
    expect(result.rows).toEqual([
      {
        ordinal: 1,
        startLine: 2,
        execution: {
          instrumentId,
          side: 'buy',
          occurredAt: '2025-11-21T00:00:00.000Z',
          orderWithinTimestamp: 0,
          quantity: '0.01',
          grossUsd: '1265.42873991',
          feeUsd: '1.89814311',
        },
        payment: { currency: 'RUB', gross: '100000', fee: '150', perUsd: '79.0246' },
      },
    ]);
  });

  it('reads a decimal-comma rate with the declared separator', () => {
    const raw = settings({}, { payment: { currency: 'RUB', perUsd: '79.0246' } });
    raw.format.decimalSeparator = ',';
    const comma = (rate: string) =>
      [...row('100000', '0', '', rate)].map((cell, index) => (index === 4 ? '0,01' : cell));
    const parsed = normalize([comma('')], raw);
    expect(parsed.rows[0].execution?.grossUsd).toBe('1265.42873991');
    const column = normalize([comma('79,0246')], {
      ...settings({ rate: 8 }, { payment: { currency: 'RUB' } }),
      format: raw.format,
    });
    expect(column.rowErrors).toEqual([]);
    expect(column.rows[0].payment).toEqual({
      currency: 'RUB',
      gross: '100000',
      fee: '0',
      perUsd: '79.0246',
    });
  });
});

describe('PCUR-MIXED currency column, stablecoin default and rate column', () => {
  it('keeps USD rows without payment, USDT at 1 and RUB at its row rate', () => {
    const result = normalize(
      [
        row('500', '1', 'USD', '', '0'),
        row('1000.5', '0.5', 'USDT', '', '1'),
        row('30000', '0', 'RUB', '77.9568', '2'),
        row('10', '0', 'USD', '1', '3'),
      ],
      settings({ currency: 7, rate: 8 }),
    );
    expect(result.rowErrors).toEqual([]);
    expect(result.rows.map((r) => [r.execution?.grossUsd, r.execution?.feeUsd, r.payment])).toEqual(
      [
        ['500', '1', undefined],
        ['1000.5', '0.5', { currency: 'USDT', gross: '1000.5', fee: '0.5', perUsd: '1' }],
        ['384.82852041', '0', { currency: 'RUB', gross: '30000', fee: '0', perUsd: '77.9568' }],
        ['10', '0', undefined],
      ],
    );
    expect(result.rows[0]).not.toHaveProperty('payment');
    expect(result.rows[3]).not.toHaveProperty('payment');
  });

  it('defaults a file-wide USDC currency to rate 1 without a rate setting', () => {
    const result = normalize([row('250', '0')], settings({}, { payment: { currency: 'USDC' } }));
    expect(result.rows[0].payment).toEqual({
      currency: 'USDC',
      gross: '250',
      fee: '0',
      perUsd: '1',
    });
    expect(result.rows[0].execution?.grossUsd).toBe('250');
  });
});

describe('PCUR-ERRORS missing or invalid currency data is never guessed', () => {
  it.each([
    [row('100', '0', 'EUR', ''), 'rate', 'missing-rate'],
    [row('100', '0', 'usd', ''), 'currency', 'invalid-currency'],
    [row('100', '0', 'RU', ''), 'currency', 'invalid-currency'],
    [row('100', '0', '', ''), 'currency', 'invalid-currency'],
    [row('100', '0', ' RUB', '80'), 'currency', 'invalid-currency'],
    [row('100', '0', 'RUB', '0'), 'rate', 'invalid-rate'],
    [row('100', '0', 'RUB', '1e2'), 'rate', 'invalid-rate'],
    [row('100', '0', 'RUB', ' 80'), 'rate', 'invalid-rate'],
    [row('100', '0', 'USD', '2'), 'rate', 'invalid-rate'],
    [row('0.000000001', '0', 'RUB', '80'), 'grossUsd', 'converted-gross-zero'],
  ])('row %j fails on %s with %s', (cells, field, code) => {
    const result = normalize([cells], settings({ currency: 7, rate: 8 }));
    expect(result.rowErrors).toEqual([{ ordinal: 1, field, code }]);
    expect(result.rows[0]).toEqual({ ordinal: 1, startLine: 2, execution: null });
  });

  it('requires a rate for a file-wide non-stablecoin currency', () => {
    const result = normalize([row('100')], settings({}, { payment: { currency: 'EUR' } }));
    expect(result.rowErrors).toEqual([{ ordinal: 1, field: 'rate', code: 'missing-rate' }]);
  });

  it('refuses contradictory or malformed payment settings before any read', () => {
    const base = settings({}, { payment: { currency: 'RUB', perUsd: '79.0246' } });
    expect(parseCsvPreview(base)).toMatchObject({
      payment: { currency: 'RUB', perUsd: '79.0246' },
    });
    for (const payment of [
      { currency: 'USD' },
      { currency: 'rub' },
      { currency: 'RU' },
      { currency: 'RUBLESROUBL' },
      { currency: 'RUB', perUsd: '0' },
      { currency: 'RUB', perUsd: '1e2' },
      { currency: 'RUB', perUsd: 79 },
      { currency: 'RUB', other: true },
      { perUsd: '79' },
      null,
      [],
      'RUB',
    ])
      rejects(() => parseCsvPreview({ ...base, payment }));
    rejects(() => parseCsvPreview(settings({ currency: 7 }, { payment: { currency: 'RUB' } })));
    rejects(() =>
      parseCsvPreview(settings({ rate: 8 }, { payment: { currency: 'RUB', perUsd: '79' } })),
    );
    rejects(() => parseCsvPreview(settings({ rate: 6 })));
    expect(
      parseCsvConfirm({
        ...base,
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expectedJournalRevision: 0,
        parserVersion: 'usd-csv-v1',
        previewHash: '0'.repeat(64),
      }),
    ).toMatchObject({ payment: { currency: 'RUB', perUsd: '79.0246' } });
  });

  it('flags buy cost overflow from a tiny rate', () => {
    const result = normalize(
      [row('1'.repeat(40), '0', 'RUB', '0.000000000001')],
      settings({ currency: 7, rate: 8 }),
    );
    expect(result.rowErrors).toEqual([
      { ordinal: 1, field: 'grossUsd', code: 'buy-cost-overflow' },
    ]);
  });
});

describe('PCUR-COMPAT USD-only settings keep their parsed shape', () => {
  it('does not add payment or rate keys when they were not sent', () => {
    const parsed = parseCsvPreview(settings());
    expect(parsed).not.toHaveProperty('payment');
    expect(parsed.mapping.columns).not.toHaveProperty('rate');
    const result = normalize([row('100', '0')], settings());
    expect(result.rows[0]).toEqual({
      ordinal: 1,
      startLine: 2,
      execution: expect.objectContaining({ grossUsd: '100', feeUsd: '0' }),
    });
  });
});

describe('PCUR-SHAPE trade version projection', () => {
  const base = {
    tradeId: instrumentId,
    version: 1,
    journalRevision: 1,
    requestId: instrumentId,
    canonicalPayload: '{}',
    kind: 'create' as const,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    instrumentId,
    instrumentName: 'Bitcoin',
    instrumentSymbol: 'BTC',
    side: 'buy' as const,
    occurredAt: new Date('2025-11-21T00:00:00Z'),
    orderWithinTimestamp: 0,
    quantity: '0.010000000000000000000000000000',
    grossUsd: '1265.428739910000000000000000000000',
    feeUsd: '0.000000000000000000000000000000',
  };
  it('omits payment for USD versions', () => {
    const value = projectTradeVersion({
      ...base,
      paidCurrency: null,
      paidGross: null,
      paidFee: null,
      paidPerUsd: null,
    });
    expect(value).not.toHaveProperty('payment');
  });
  it('returns canonical payment strings for paid-currency versions', () => {
    const value = projectTradeVersion({
      ...base,
      paidCurrency: 'RUB',
      paidGross: '100000.000000000000000000000000000000',
      paidFee: '0.000000000000000000000000000000',
      paidPerUsd: '79.024600000000000000000000000000',
    });
    expect(value.payment).toEqual({
      currency: 'RUB',
      gross: '100000',
      fee: '0',
      perUsd: '79.0246',
    });
    expect(value.grossUsd).toBe('1265.42873991');
  });
});
