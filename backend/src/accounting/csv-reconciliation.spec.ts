import { BadRequestException } from '@nestjs/common';
import { parseReconciliationQuery, reconcileCells, unrealizedAtPrice } from './csv-reconciliation';

// Excel cells of the owner's sample row, as saved with decimal commas.
const cells = [
  '13.06.2025',
  'BTC',
  '0,00918359',
  'USDT',
  '1000',
  '1000',
  '108889,8786',
  '84945',
  '780,1000526',
  '-219,8999475',
  '-21,99%',
];
const columns = {
  usdAmount: 5,
  rate: 6,
  currentRate: 7,
  currentValue: 8,
  difference: 9,
  returnPercent: 10,
};
const position = { quantity: '0.00918359', costUsd: '1000' };

describe('SHEET-3 reconciliation arithmetic', () => {
  it('SHEET-RECON-SAMPLE matches every derived cell of the sample row', () => {
    expect(reconcileCells({ ...position, cells, columns, decimalSeparator: ',' })).toEqual([
      { field: 'usdAmount', sheet: '1000', app: '1000', result: 'match' },
      { field: 'rate', sheet: '108889,8786', app: '108889.8786', result: 'match' },
      { field: 'currentValue', sheet: '780,1000526', app: '780.1000526', result: 'match' },
      { field: 'difference', sheet: '-219,8999475', app: '-219.8999475', result: 'match' },
      { field: 'returnPercent', sheet: '-21,99%', app: '-21.99', result: 'match' },
    ]);
    expect(unrealizedAtPrice(position.quantity, position.costUsd, '84945')).toEqual({
      valueUsd: '780.10005255',
      unrealizedPnlUsd: '-219.89994745',
      unrealizedReturnPercent: '-21.99',
    });
  });

  it('SHEET-RECON-MISMATCH allows half a unit in the last shown place and no more', () => {
    const at = (index: number, value: string) => cells.map((c, i) => (i === index ? value : c));
    const check = (row: string[], field: string) =>
      reconcileCells({ ...position, cells: row, columns, decimalSeparator: ',' }).find(
        (item) => item.field === field,
      );
    // Exact 780.10005255: both 780,1000525 and 780,1000526 are a half-unit tie; 780,1000527 is not.
    expect(check(at(8, '780,1000525'), 'currentValue')?.result).toBe('match');
    expect(check(at(8, '780,1000527'), 'currentValue')?.result).toBe('mismatch');
    expect(check(at(8, '780,10'), 'currentValue')).toEqual({
      field: 'currentValue',
      sheet: '780,10',
      app: '780.10',
      result: 'match',
    });
    expect(check(at(8, '780'), 'currentValue')?.result).toBe('match');
    expect(check(at(8, '781'), 'currentValue')?.result).toBe('mismatch');
    expect(check(at(5, '1001'), 'usdAmount')?.result).toBe('mismatch');
    expect(check(at(6, '108889,9'), 'rate')?.result).toBe('match');
    expect(check(at(6, '108889,8'), 'rate')?.result).toBe('mismatch');
    expect(check(at(10, '-22%'), 'returnPercent')?.result).toBe('match');
    expect(check(at(10, '-21,98%'), 'returnPercent')?.result).toBe('mismatch');
    expect(check(at(10, '-21,99'), 'returnPercent')?.result).toBe('match');
    expect(check(at(10, '#DIV/0!'), 'returnPercent')).toEqual({
      field: 'returnPercent',
      sheet: '#DIV/0!',
      app: '-21.99',
      result: 'unreadable',
    });
    for (const unreadable of ['1 000', '1000.0', '+1000', '1e3', '', '1000%', '−5'])
      expect(check(at(5, unreadable), 'usdAmount')?.result).toBe('unreadable');
    const noRate = reconcileCells({
      ...position,
      cells: at(7, 'n/a'),
      columns,
      decimalSeparator: ',',
    });
    expect(noRate.map((item) => [item.field, item.app, item.result])).toEqual([
      ['usdAmount', '1000', 'match'],
      ['rate', '108889.8786', 'match'],
      ['currentValue', null, 'unavailable'],
      ['difference', null, 'unavailable'],
      ['returnPercent', null, 'unavailable'],
    ]);
    const { currentRate: _omitted, ...withoutRate } = columns;
    expect(
      reconcileCells({ ...position, cells, columns: withoutRate, decimalSeparator: ',' }).map(
        (item) => item.result,
      ),
    ).toEqual(['match', 'match', 'unavailable', 'unavailable', 'unavailable']);
  });

  it('SHEET-RECON-STATE accepts only distinct bounded column indexes', () => {
    expect(parseReconciliationQuery({ currentRate: '7', difference: '9' })).toEqual({
      currentRate: 7,
      difference: 9,
    });
    for (const raw of [
      {},
      { rate: '-1' },
      { rate: '32' },
      { rate: '07' },
      { rate: '1.5' },
      { rate: ['1', '2'] },
      { rate: '1', difference: '1' },
      { quantity: '2' },
      null,
    ])
      expect(() => parseReconciliationQuery(raw)).toThrow(BadRequestException);
  });

  it('reports a known-zero-cost return as null and keeps exact unrealized amounts', () => {
    expect(unrealizedAtPrice('2', '0', '5')).toEqual({
      valueUsd: '10',
      unrealizedPnlUsd: '10',
      unrealizedReturnPercent: null,
    });
    expect(unrealizedAtPrice('1', '100', '100.005')).toEqual({
      valueUsd: '100.005',
      unrealizedPnlUsd: '0.005',
      unrealizedReturnPercent: '0.01',
    });
  });
});
