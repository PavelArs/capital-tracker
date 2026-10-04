import {
  type HistoricalValuationSnapshot,
  type ValuationPosition,
  historicalValuationApi,
} from '@api/historical-valuation.api';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoricalValuation } from './HistoricalValuation';

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const at = '2025-06-13T00:00:00.000Z';
const btc = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const eth = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const excelRow = {
  instrumentId: btc,
  instrumentName: 'Bitcoin',
  instrumentSymbol: 'BTC',
  quantity: '0.00918359',
  costUsd: '1000',
  price: { priceUsd: '84945', observedAt: at, revision: 1 },
  valueUsd: '780.10005255',
  unrealizedPnlUsd: '-219.89994745',
  unrealizedReturnPercent: '-21.99',
} as ValuationPosition;

const snapshot = {
  accountId,
  at,
  coverageFrom: '2025-01-01T00:00:00.000Z',
  journalRevision: 1,
  basis: 'current-effective-history',
  originKind: 'declared-empty',
  openingRevision: null,
  priceSource: 'manual',
  quoteCurrency: 'USD',
  pricePolicy: 'exact-instant',
  completeness: 'complete',
  missingPriceCount: 0,
  unknownCostCount: 0,
  pricedSubtotalUsd: '780.10005255',
  totalValueUsd: '780.10005255',
  unrealizedPnlUsd: '-219.89994745',
  unrealizedReturnPercent: '-21.99',
  items: [excelRow],
} as HistoricalValuationSnapshot;

async function calculate(result: HistoricalValuationSnapshot) {
  vi.spyOn(historicalValuationApi, 'snapshot').mockResolvedValue(result);
  render(<HistoricalValuation accountId={accountId} journalRevision={1} />);
  fireEvent.change(screen.getByLabelText('Момент оценки (ISO)'), { target: { value: at } });
  fireEvent.click(screen.getByRole('button', { name: 'Рассчитать стоимость' }));
  return screen.findByRole('table', { name: 'Оценка позиций' });
}

function summaryValue(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling;
}

describe('UPNL-UI account valuation shows unrealized result', () => {
  it('shows the spreadsheet difference and return in the summary and the position row', async () => {
    const table = await calculate(snapshot);
    expect(summaryValue('Нереализованная прибыль, USD')).toHaveTextContent('-219.89994745');
    expect(summaryValue('Доход, %')).toHaveTextContent('-21.99 %');
    expect(
      within(table).getByRole('columnheader', { name: 'Нереализованная прибыль, USD' }),
    ).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Доход, %' })).toBeInTheDocument();
    const row = within(table).getByRole('row', { name: /Bitcoin/ });
    expect(within(row).getByText('-219.89994745')).toBeInTheDocument();
    expect(within(row).getByText('-21.99 %')).toBeInTheDocument();
    expect(screen.queryByText(/не включает денежный остаток, весь портфель,\s+прибыль/)).toBeNull();
  });

  it('explains unavailable results instead of showing zero', async () => {
    const table = await calculate({
      ...snapshot,
      completeness: 'incomplete',
      missingPriceCount: 1,
      unknownCostCount: 1,
      pricedSubtotalUsd: '50',
      totalValueUsd: null,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
      items: [
        {
          ...excelRow,
          price: null,
          valueUsd: null,
          unrealizedPnlUsd: null,
          unrealizedReturnPercent: null,
        },
        {
          ...excelRow,
          instrumentId: eth,
          instrumentName: 'Ether',
          instrumentSymbol: 'ETH',
          quantity: '1',
          costUsd: null,
          knownCostSubtotalUsd: '10',
          unknownCostQuantity: '0.5',
          price: { priceUsd: '50', observedAt: at, revision: 1 },
          valueUsd: '50',
          unrealizedPnlUsd: null,
          unrealizedReturnPercent: null,
        },
      ],
    } as HistoricalValuationSnapshot);
    expect(
      screen.getByText(
        'Нереализованная прибыль недоступна: нет точной цены для 1 позиций; неизвестна себестоимость 1 позиций.',
      ),
    ).toBeInTheDocument();
    const unpriced = within(table).getByRole('row', { name: /Bitcoin/ });
    expect(within(unpriced).getByText('Нет точной цены')).toBeInTheDocument();
    expect(within(unpriced).getByText('Нужна точная цена')).toBeInTheDocument();
    const unknownCost = within(table).getByRole('row', { name: /Ether/ });
    expect(within(unknownCost).getByText('Неизвестна себестоимость')).toBeInTheDocument();
  });
});
