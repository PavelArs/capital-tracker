import {
  type HistoryPeriod,
  type PortfolioHistory,
  portfolioHistoryApi,
} from '@api/portfolio-history.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

const history = (changes: Partial<PortfolioHistory> = {}): PortfolioHistory => ({
  period: '1M',
  currency: 'USD',
  mainCurrency: 'USD',
  from: '2026-09-04T12:30:00.000Z',
  at: '2026-10-04T12:30:00.000Z',
  value: '115000',
  complete: true,
  change: '15000',
  changePercent: '15.00',
  points: [
    { at: '2026-09-05T00:00:00.000Z', value: '100000', complete: true },
    { at: '2026-09-06T00:00:00.000Z', value: '104000.5', complete: true },
    { at: '2026-10-04T12:30:00.000Z', value: '115000', complete: true },
  ],
  ...changes,
});

const get = vi.spyOn(portfolioHistoryApi, 'get');

function renderPage(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (period: HistoryPeriod, currency?: AccountingCurrency) =>
    history({ period, currency: currency ?? 'USD' }),
  );
});
afterEach(cleanup);

describe('record-portfolio-snapshots dashboard', () => {
  it('DASH-MAIN shows net worth, the change for the default month and the chart', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    expect(get).toHaveBeenCalledWith('1M', undefined);
    expect(within(hero).getByText('Total net worth · USD')).toBeInTheDocument();
    expect(within(hero).getByText('$115,000.00')).toBeInTheDocument();
    const delta = within(hero).getByLabelText('Change for the past month');
    expect(delta).toHaveTextContent('▲ +$15,000.00+15.00%past month');
    expect(delta).toHaveClass('portfolio-pos');
    const chart = screen.getByRole('region', { name: 'Portfolio value over time' });
    expect(within(chart).getByRole('tab', { name: '1M' })).toHaveAttribute('aria-selected', 'true');
    expect(
      within(chart).getByRole('img', {
        name: 'Portfolio value, past month, from $100,000.00 to $115,000.00',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not built yet/i)).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('CHART-PERIODS switches the period and reads each point with its date, value and change', async () => {
    const user = userEvent.setup();
    renderPage();
    const chart = await screen.findByRole('region', { name: 'Portfolio value over time' });
    for (const period of ['24H', '7D', '3M', '1Y', 'ALL', '1M'] as const) {
      await user.click(within(chart).getByRole('tab', { name: period }));
      await waitFor(() =>
        expect(within(chart).getByRole('tab', { name: period })).toHaveAttribute(
          'aria-selected',
          'true',
        ),
      );
      expect(get).toHaveBeenLastCalledWith(period, undefined);
    }
    await user.click(within(chart).getByRole('tab', { name: '7D' }));
    await screen.findByLabelText('Change for the past 7 days');
    const plot = within(chart).getByRole('group');
    plot.focus();
    await user.keyboard('{Home}');
    let tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Sep 5, 00:00 UTC');
    expect(tip).toHaveTextContent('$100,000.00');
    expect(tip).toHaveTextContent('Change in period$0.00');
    await user.keyboard('{ArrowRight}');
    tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Sep 6, 00:00 UTC');
    expect(tip).toHaveTextContent('$104,000.50');
    expect(tip).toHaveTextContent('Change in period+$4,000.50');
    await user.keyboard('{End}');
    expect(within(chart).getByRole('status')).toHaveTextContent('Now$115,000.00');
    await user.keyboard('{Escape}');
    expect(within(chart).queryByRole('status')).toBeNull();
  });

  it('switches the currency and keeps it in the address', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('region', { name: 'Net worth' });
    await user.click(screen.getByRole('radio', { name: 'EUR' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('1M', 'EUR'));
    expect(await screen.findByText('Total net worth · EUR')).toBeInTheDocument();
    expect(screen.getByText('€115,000.00')).toBeInTheDocument();
  });

  it('marks an incomplete period, a falling value and a missing rate honestly', async () => {
    get.mockResolvedValue(
      history({
        complete: false,
        change: '-500',
        changePercent: '-0.50',
        points: [
          { at: '2026-09-05T00:00:00.000Z', value: null, complete: false },
          { at: '2026-09-06T00:00:00.000Z', value: '100000', complete: false },
          { at: '2026-10-04T12:30:00.000Z', value: '99500', complete: true },
        ],
        value: '99500',
      }),
    );
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(hero).getByLabelText('Change for the past month')).toHaveTextContent(
      '▼ -$500.00-0.50%',
    );
    expect(within(hero).getByRole('note')).toHaveTextContent(/Incomplete/);
    cleanup();
    get.mockResolvedValue(
      history({
        value: null,
        change: null,
        changePercent: null,
        complete: false,
        points: [{ at: '2026-10-04T12:30:00.000Z', value: null, complete: false }],
      }),
    );
    renderPage('/dashboard?currency=RUB');
    const empty = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(empty).getByText('No rate')).toBeInTheDocument();
    expect(within(empty).getByLabelText('Change for the past month')).toHaveTextContent('—');
    expect(screen.getByText(/No value can be shown for this period/)).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('1M', 'RUB');
  });

  it('says when the history cannot be loaded and retries', async () => {
    const user = userEvent.setup();
    get.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your capital history');
    expect(document.body.textContent).not.toMatch(/\$0\.00/);
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Net worth' })).toBeInTheDocument();
  });
});
