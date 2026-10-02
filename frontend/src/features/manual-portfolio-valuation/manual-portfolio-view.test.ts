import type { ManualPortfolioValuationResponse } from '@api/manual-portfolio-valuation.api';
import { describe, expect, it } from 'vitest';
import { toManualPortfolioView } from './manual-portfolio-view';

const at = '2025-01-04T00:00:00.000Z';
const shared = '11111111-1111-4111-8111-111111111111';
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const complete: ManualPortfolioValuationResponse = {
  at,
  accountIds: [first, second],
  scope: 'selected-manual-accounts',
  basis: 'current-effective-history',
  priceSource: 'manual',
  quoteCurrency: 'USD',
  pricePolicy: 'exact-instant',
  completeness: 'complete',
  unavailableAccountCount: 0,
  missingPriceCount: 0,
  pricedSubtotalUsd: '308.64',
  totalValueUsd: '308.64',
  allocation: [],
  accounts: [
    {
      accountId: first,
      name: 'Первый',
      coverage: 'covered',
      coverageFrom: '2025-01-01T00:00:00.000Z',
      journalRevision: 1,
      completeness: 'complete',
      missingPriceCount: 0,
      pricedSubtotalUsd: '61.728',
      totalValueUsd: '61.728',
      items: [
        {
          instrumentId: shared,
          instrumentName: 'Актив',
          instrumentSymbol: 'ABC',
          quantity: '0.5',
          costUsd: '50',
          price: { priceUsd: '123.456', observedAt: at, revision: 2 },
          valueUsd: '61.728',
        },
      ],
    },
    {
      accountId: second,
      name: 'Второй',
      coverage: 'covered',
      coverageFrom: '2025-01-01T00:00:00.000Z',
      journalRevision: 3,
      completeness: 'complete',
      missingPriceCount: 0,
      pricedSubtotalUsd: '246.912',
      totalValueUsd: '246.912',
      items: [
        {
          instrumentId: shared,
          instrumentName: 'Актив',
          instrumentSymbol: 'ABC',
          quantity: '2',
          costUsd: '200',
          price: { priceUsd: '123.456', observedAt: at, revision: 2 },
          valueUsd: '246.912',
        },
      ],
    },
  ],
};

describe('selected manual-account valuation presentation', () => {
  it('passes through exact aggregate and per-account decimal strings', () => {
    const view = toManualPortfolioView(complete);
    expect(view).toMatchObject({
      statusText: 'Полная оценка выбранных счетов',
      totalText: '308.64',
      subtotalText: '308.64',
      rows: [
        { accountId: first, name: 'Первый', coverageText: 'История доступна', totalText: '61.728' },
        {
          accountId: second,
          name: 'Второй',
          coverageText: 'История доступна',
          totalText: '246.912',
        },
      ],
    });
  });

  it('keeps a missing price and an absent journal unknown despite a known subtotal', () => {
    const partial: ManualPortfolioValuationResponse = {
      ...complete,
      completeness: 'incomplete',
      unavailableAccountCount: 1,
      missingPriceCount: 1,
      pricedSubtotalUsd: '61.728',
      totalValueUsd: null,
      accounts: [
        {
          ...complete.accounts[0],
          completeness: 'incomplete',
          missingPriceCount: 1,
          totalValueUsd: null,
          items: [
            complete.accounts[0].items[0],
            {
              instrumentId: '22222222-2222-4222-8222-222222222222',
              instrumentName: 'Другой актив',
              instrumentSymbol: 'ABC',
              quantity: '1',
              costUsd: '1',
              price: null,
              valueUsd: null,
            },
          ],
        },
        {
          ...complete.accounts[1],
          coverage: 'missing-journal',
          coverageFrom: null,
          journalRevision: null,
          completeness: 'incomplete',
          missingPriceCount: null,
          pricedSubtotalUsd: null,
          totalValueUsd: null,
          items: [],
        },
      ],
    };
    const view = toManualPortfolioView(partial);
    expect(view).toMatchObject({
      statusText: 'Неполная оценка выбранных счетов',
      totalText: 'Не определена',
      subtotalText: '61.728',
      rows: [
        { totalText: 'Не определена', missingPriceText: '1' },
        {
          coverageText: 'История не инициализирована',
          subtotalText: 'Не определена',
          totalText: 'Не определена',
          missingPriceText: 'Не определено',
        },
      ],
    });
  });

  it('distinguishes precoverage from a covered empty account with known zero', () => {
    const zero: ManualPortfolioValuationResponse = {
      ...complete,
      completeness: 'incomplete',
      unavailableAccountCount: 1,
      missingPriceCount: 0,
      pricedSubtotalUsd: '0',
      totalValueUsd: null,
      accounts: [
        {
          ...complete.accounts[0],
          items: [],
          pricedSubtotalUsd: '0',
          totalValueUsd: '0',
        },
        {
          ...complete.accounts[1],
          coverage: 'before-coverage',
          completeness: 'incomplete',
          missingPriceCount: null,
          pricedSubtotalUsd: null,
          totalValueUsd: null,
          items: [],
        },
      ],
    };
    expect(toManualPortfolioView(zero).rows).toMatchObject([
      { totalText: '0', subtotalText: '0' },
      {
        coverageText: 'Момент раньше начала истории',
        totalText: 'Не определена',
        subtotalText: 'Не определена',
      },
    ]);
  });
});
