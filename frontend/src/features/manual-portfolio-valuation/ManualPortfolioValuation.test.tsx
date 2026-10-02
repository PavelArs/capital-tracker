import type { AccountSummary } from '@api/accounting.api';
import { manualPortfolioValuationApi } from '@api/manual-portfolio-valuation.api';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualPortfolioValuation } from './ManualPortfolioValuation';

const at = '2025-01-04T00:00:00.000Z';
const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instrumentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const account: AccountSummary = {
  id: accountId,
  name: 'Первый',
  currentRevision: 1,
  createdAt: at,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MPV-ALLOC-005 selected manual allocation table', () => {
  it('shows exact values and unknown shares in a labelled table, then invalidates it on UTC edit', async () => {
    vi.spyOn(manualPortfolioValuationApi, 'preview').mockResolvedValue({
      at,
      accountIds: [accountId],
      scope: 'selected-manual-accounts',
      basis: 'current-effective-history',
      priceSource: 'manual',
      quoteCurrency: 'USD',
      pricePolicy: 'exact-instant',
      completeness: 'incomplete',
      unavailableAccountCount: 0,
      missingPriceCount: 1,
      pricedSubtotalUsd: '61.728',
      totalValueUsd: null,
      accounts: [
        {
          accountId,
          name: 'Первый',
          coverage: 'covered',
          coverageFrom: at,
          journalRevision: 1,
          completeness: 'incomplete',
          missingPriceCount: 1,
          pricedSubtotalUsd: '61.728',
          totalValueUsd: null,
          items: [],
        },
      ],
      allocation: [
        {
          instrumentId,
          instrumentName: 'Актив',
          instrumentSymbol: 'ABC',
          quantity: '0.5',
          valueUsd: '61.728',
          allocationPercent: null,
        },
        {
          instrumentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          instrumentName: 'Без цены',
          instrumentSymbol: 'ABC',
          quantity: '2',
          valueUsd: null,
          allocationPercent: null,
        },
      ],
    } as Awaited<ReturnType<typeof manualPortfolioValuationApi.preview>>);
    render(
      <MemoryRouter>
        <ManualPortfolioValuation accounts={[account]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Включить счет Первый' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Момент оценки (UTC)' }), {
      target: { value: at },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать оценку' }));
    const table = await screen.findByRole('table', {
      name: 'Распределение по инструментам выбранных счетов',
    });
    expect(screen.getAllByText(/Только выбранные ручные счета/)).toHaveLength(2);
    const explanation = screen.getByText('Что входит в оценку');
    fireEvent.click(explanation);
    expect(screen.getByText(/сохранённые ручные цены USD/)).toBeVisible();
    expect(manualPortfolioValuationApi.preview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Неполная оценка выбранных счетов' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Включить счет Первый' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Момент оценки (UTC)' })).toHaveValue(at);
    fireEvent.click(explanation);
    expect(screen.getByText(/сохранённые ручные цены USD/)).not.toBeVisible();
    expect(manualPortfolioValuationApi.preview).toHaveBeenCalledTimes(1);
    expect(
      within(table).getByRole('row', { name: /Актив ABC 0.5 61.728 Не определена/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Оценка по счетам — прокручиваемая таблица' }),
    ).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('table', { name: 'Оценка по счетам' })).toBeVisible();
    expect(
      screen.getByRole('region', {
        name: 'Распределение по инструментам выбранных счетов — прокручиваемая таблица',
      }),
    ).toHaveAttribute('tabindex', '0');
    expect(
      screen
        .getAllByRole('region')
        .filter((region) => region.getAttribute('tabindex') === '0')
        .map((region) => region.getAttribute('aria-label')),
    ).toEqual([
      'Распределение по инструментам выбранных счетов — прокручиваемая таблица',
      'Оценка по счетам — прокручиваемая таблица',
    ]);
    expect(within(table).getByRole('columnheader', { name: 'Доля, %' })).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: 'Актив ABC' })).toBeVisible();
    expect(
      within(table).getByRole('row', { name: /Актив ABC 0.5 61.728 Не определена/ }),
    ).toBeVisible();
    expect(
      within(table).getByRole('row', { name: /Без цены ABC 2 Не определена Не определена/ }),
    ).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Момент оценки (UTC)' }), {
      target: { value: '2025-01-05T00:00:00.000Z' },
    });
    expect(
      screen.queryByRole('table', { name: 'Распределение по инструментам выбранных счетов' }),
    ).not.toBeInTheDocument();
  });
});
