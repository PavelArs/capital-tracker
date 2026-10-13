import type { AccountSummary } from '@api/accounting.api';
import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';
import { describe, expect, it } from 'vitest';
import {
  type BrokerEntry,
  blankPosition,
  brokerAccountName,
  brokerProblems,
  freshRates,
  holdingTrade,
  moscowDate,
  positionAsset,
  times,
} from './broker';
import { brokerAccountsOf, brokerShare, sumDecimals } from './brokers';

// Synthetic names, ids and amounts only.
const entry = (changes: Partial<BrokerEntry> = {}): BrokerEntry => ({
  broker: 'Sample Broker',
  account: 'Regular',
  currency: 'USD',
  positions: [{ ticker: 'VWRA', quantity: '30', price: '142.10' }],
  cash: '',
  ...changes,
});

describe('BROKER-ADD the entry', () => {
  it('needs the broker and at least one position or the cash', () => {
    expect(brokerProblems(entry())).toEqual(new Set());
    expect(brokerProblems(entry({ broker: '  ' }))).toEqual(new Set(['broker']));
    expect(brokerProblems(entry({ positions: [blankPosition()] }))).toEqual(new Set(['holdings']));
    expect(brokerProblems(entry({ positions: [blankPosition()], cash: '250' }))).toEqual(new Set());
    expect(brokerProblems(entry({ positions: [blankPosition()], cash: '0' }))).toEqual(
      new Set(['cash']),
    );
  });

  it('flags each part of a row that is filled in only partly, and ignores empty rows', () => {
    expect(
      brokerProblems(
        entry({
          positions: [
            { ticker: 'VWRA', quantity: '30', price: '142.10' },
            blankPosition(),
            { ticker: '', quantity: '1,500', price: '' },
          ],
        }),
      ),
    ).toEqual(new Set(['ticker-2', 'quantity-2', 'price-2']));
  });

  it('keeps amounts within what the server stores, alone and multiplied', () => {
    // Codex P2: the server keeps 48 whole digits and 30 places.
    const row = (quantity: string, price = '1') =>
      brokerProblems(entry({ positions: [{ ticker: 'VWRA', quantity, price }] }));
    expect(row(`0.${'1'.repeat(15)}`)).toEqual(new Set());
    expect(row(`0.${'1'.repeat(16)}`)).toEqual(new Set(['quantity-0']));
    expect(row('9'.repeat(24))).toEqual(new Set());
    expect(row('9'.repeat(25))).toEqual(new Set(['quantity-0']));
    expect(row('1', `1.${'5'.repeat(16)}`)).toEqual(new Set(['price-0']));
    expect(brokerProblems(entry({ cash: `1.${'0'.repeat(15)}1` }))).toEqual(new Set(['cash']));
  });

  it('accepts only recent rates for RUB and EUR amounts', () => {
    const report = (usd: string | null, eur: string | null) => ({
      date: '2026-10-13',
      source: 'cbr' as const,
      rates: [
        { currency: 'USD' as const, rubPerUnit: usd && '90.12', date: usd },
        { currency: 'EUR' as const, rubPerUnit: eur && '100.5', date: eur },
      ],
      sync: null,
    });
    expect(freshRates('RUB', report('2026-09-28', null), '2026-10-13')).toBe(true);
    expect(freshRates('RUB', report('2026-09-27', null), '2026-10-13')).toBe(false);
    expect(freshRates('EUR', report('2026-10-13', null), '2026-10-13')).toBe(false);
    expect(freshRates('EUR', report('2026-10-12', '2026-10-12'), '2026-10-13')).toBe(true);
  });

  it('dates the rate by the Moscow calendar, as the server does', () => {
    // Codex P2: from 21:00 UTC it is already the next day in Moscow.
    expect(moscowDate(new Date('2026-10-13T20:59:00Z'))).toBe('2026-10-13');
    expect(moscowDate(new Date('2026-10-13T21:00:00Z'))).toBe('2026-10-14');
  });

  it('names an individual investment account after its broker', () => {
    expect(brokerAccountName({ broker: ' Sample Broker ', account: 'Regular' })).toBe(
      'Sample Broker',
    );
    expect(brokerAccountName({ broker: 'Sample Broker', account: 'IIS' })).toBe(
      'Sample Broker · IIS',
    );
  });

  it('keeps a ticker-like entry as the ticker, and a name as only the name', () => {
    expect(positionAsset({ ticker: 'vwra', quantity: '1', price: '1' }, 'EUR')).toEqual({
      name: 'vwra',
      symbol: 'VWRA',
      assetType: 'manual',
      valuationCurrency: 'EUR',
    });
    expect(positionAsset({ ticker: 'Bond fund 2030', quantity: '1', price: '1' }, 'RUB')).toEqual({
      name: 'Bond fund 2030',
      assetType: 'manual',
      valuationCurrency: 'RUB',
    });
  });

  it('multiplies the quantity by the price exactly', () => {
    expect(times('30', '142.10')).toBe('4263');
    expect(times('0.1', '0.2')).toBe('0.02');
    expect(times('1 500', '2,5')).toBe('3750');
    expect(times('3', '0.333333333333333333')).toBe('0.999999999999999999');
  });

  it('records a holding as money put in at the current minute', () => {
    expect(
      holdingTrade(
        { quantity: '30', total: '4263', currency: 'USD' },
        'instrument',
        new Date('2026-10-13T08:15:42Z'),
        { requestId: 'request', expectedJournalRevision: 2 },
      ),
    ).toEqual({
      instrumentId: 'instrument',
      side: 'buy',
      occurredAt: '2026-10-13T08:15:00.000Z',
      quantity: '30',
      grossUsd: '4263',
      feeUsd: '0',
      requestId: 'request',
      expectedJournalRevision: 2,
    });
    const rub = holdingTrade(
      { quantity: '10', total: '15000', currency: 'RUB' },
      'instrument',
      new Date('2026-10-13T08:15:42Z'),
      { requestId: 'request', expectedJournalRevision: 0 },
    );
    expect(rub).toMatchObject({ paid: { currency: 'RUB', gross: '15000', fee: '0' } });
    expect(rub).not.toHaveProperty('settlementCurrency');
  });
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = (n: number, name: string, assetClass: AccountSummary['assetClass']) => ({
  id: id(n),
  name,
  kind: null,
  assetClass,
  currentRevision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
});
const held = (
  n: number,
  name: string,
  holdings: AssetValuation['holdings'],
  assetType: AssetValuation['assetType'] = 'manual',
) => ({ instrumentId: id(n), name, symbol: name, assetType, holdings }) as AssetValuation;

describe('BROKERS the page figures', () => {
  const portfolio = {
    totalValue: '20000',
    assets: [
      held(21, 'VWRA', [
        { accountId: id(1), accountName: 'Sample Broker', quantity: '30', value: '4263' },
        { accountId: id(2), accountName: 'Other Broker', quantity: '10', value: '1421' },
      ]),
      held(22, 'BOND', [
        { accountId: id(1), accountName: 'Sample Broker', quantity: '5', value: null },
      ]),
      held(
        23,
        'USD',
        [{ accountId: id(1), accountName: 'Sample Broker', quantity: '9000', value: '9000' }],
        'fiat',
      ),
      {
        ...held(25, 'EUFUND', [
          { accountId: id(2), accountName: 'Other Broker', quantity: '2', value: null },
        ]),
        missingPrice: 'no-rate',
      },
      held(24, 'BTC', [
        { accountId: id(3), accountName: 'Cold wallet', quantity: '1', value: '5' },
      ]),
    ],
  } as unknown as PortfolioValuation;
  const accounts = [
    account(2, 'Other Broker', 'broker'),
    account(1, 'Sample Broker', 'broker'),
    account(3, 'Cold wallet', null),
    account(4, 'Empty Broker', 'broker'),
  ];

  it('groups what each broker account holds, securities first, then its cash', () => {
    const brokers = brokerAccountsOf(portfolio, accounts);
    expect(
      brokers.map(({ name, value, unpriced, unrated, positions }) => [
        name,
        value,
        unpriced,
        unrated,
        positions.map(({ asset, quantity }) => `${asset.name} ${quantity}`),
      ]),
    ).toEqual([
      ['Sample Broker', '13263', 1, 0, ['VWRA 30', 'BOND 5', 'USD 9000']],
      ['Other Broker', '1421', 0, 1, ['VWRA 10', 'EUFUND 2']],
      ['Empty Broker', '0', 0, 0, []],
    ]);
  });

  it('gives the share of net worth only while the net worth is known', () => {
    expect(brokerShare('5000', portfolio)).toBe(25);
    expect(brokerShare('5000', { ...portfolio, totalValue: null })).toBeNull();
  });

  it('adds values exactly', () => {
    // Codex P2: 0.001 + 1.134 in binary floating point shows as $1.13.
    expect(sumDecimals(['0.001', '1.134'])).toBe('1.135');
    expect(sumDecimals(['9007199254740993', '0.01'])).toBe('9007199254740993.01');
    expect(sumDecimals([])).toBe('0');
  });
});
