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
  invested: '90000',
  profit: '25000',
  profitPercent: '27.78',
  deposits: '10000',
  withdrawals: '0',
  netFlow: '10000',
  marketEffect: '5000',
  marketReturnPercent: '4.55',
  points: [
    { at: '2026-09-05T00:00:00.000Z', value: '100000', complete: true, invested: '80000' },
    { at: '2026-09-06T00:00:00.000Z', value: '104000.5', complete: true, invested: '90000' },
    { at: '2026-10-04T12:30:00.000Z', value: '115000', complete: true, invested: '90000' },
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
  it('DASH-MAIN shows net worth, the profit to date, the month and the chart', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    expect(get).toHaveBeenCalledWith('1M', undefined);
    expect(within(hero).getByText('Total net worth · USD')).toBeInTheDocument();
    expect(within(hero).getByText('$115,000.00')).toBeInTheDocument();
    const profit = within(hero).getByLabelText('Profit or loss to date');
    expect(profit).toHaveTextContent('▲ +$25,000.00+27.78%on $90,000.00 net invested');
    expect(profit).toHaveClass('portfolio-pos');
    expect(within(hero).getByLabelText('What changed')).toHaveTextContent(/^Past month/);
    expect(within(hero).queryByText('+$15,000.00')).toBeNull();
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
    await waitFor(() =>
      expect(screen.getByLabelText('What changed')).toHaveTextContent(/^Past 7 days/),
    );
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
        profit: '-500',
        profitPercent: '-0.50',
        invested: '100000',
        points: [
          { at: '2026-09-05T00:00:00.000Z', value: null, complete: false, invested: null },
          { at: '2026-09-06T00:00:00.000Z', value: '100000', complete: false, invested: null },
          { at: '2026-10-04T12:30:00.000Z', value: '99500', complete: true, invested: null },
        ],
        value: '99500',
      }),
    );
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const loss = within(hero).getByLabelText('Profit or loss to date');
    expect(loss).toHaveTextContent('▼ -$500.00-0.50%on $100,000.00 net invested');
    expect(loss).toHaveClass('portfolio-neg');
    expect(within(hero).getByRole('note')).toHaveTextContent(/Incomplete/);
    cleanup();
    get.mockResolvedValue(
      history({
        value: null,
        change: null,
        changePercent: null,
        complete: false,
        invested: null,
        profit: null,
        profitPercent: null,
        deposits: null,
        withdrawals: null,
        netFlow: null,
        marketEffect: null,
        marketReturnPercent: null,
        points: [{ at: '2026-10-04T12:30:00.000Z', value: null, complete: false, invested: null }],
      }),
    );
    renderPage('/dashboard?currency=RUB');
    const empty = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(empty).getByText('No rate')).toBeInTheDocument();
    expect(within(empty).getByLabelText('Profit or loss to date')).toHaveTextContent('—');
    expect(within(empty).getByLabelText('What changed')).toHaveTextContent(
      'Past monthMarket—Net deposits—',
    );
    expect(screen.getByText(/No value can be shown for this period/)).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('1M', 'RUB');
  });

  it('PROFIT-ALL-TIME the profit line is net worth minus all-time net invested, whatever the period', async () => {
    const user = userEvent.setup();
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const chart = screen.getByRole('region', { name: 'Portfolio value over time' });
    for (const period of ['24H', 'ALL'] as const) {
      await user.click(within(chart).getByRole('tab', { name: period }));
      await waitFor(() => expect(get).toHaveBeenLastCalledWith(period, undefined));
      expect(within(hero).getByLabelText('Profit or loss to date')).toHaveTextContent(
        '▲ +$25,000.00+27.78%on $90,000.00 net invested',
      );
    }
    cleanup();
    // A month where only the market rose still shows the loss against the money put in.
    get.mockResolvedValue(
      history({
        value: '80000',
        change: '8000',
        changePercent: '11.11',
        profit: '-10000',
        profitPercent: '-11.11',
        deposits: '0',
        netFlow: '0',
        marketEffect: '8000',
        marketReturnPercent: '11.11',
      }),
    );
    renderPage();
    const down = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(down).getByLabelText('Profit or loss to date')).toHaveTextContent(
      '▼ -$10,000.00-11.11%on $90,000.00 net invested',
    );
    expect(within(down).getByLabelText('What changed')).toHaveTextContent(
      'Past monthMarket+$8,000.00+11.11%Net deposits$0.00',
    );
    cleanup();
    // More taken out than put in: no percentage of nothing.
    get.mockResolvedValue(history({ invested: '-2000', profit: '117000', profitPercent: null }));
    renderPage();
    const out = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(out).getByLabelText('Profit or loss to date')).toHaveTextContent(
      '▲ +$117,000.00on -$2,000.00 net invested',
    );
  });

  it('FLOW-SPLIT splits the change into market and net deposits for the period', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const split = within(hero).getByLabelText('What changed');
    expect(split).toHaveTextContent('Past monthMarket+$5,000.00+4.55%Net deposits+$10,000.00');
    expect(within(split).getByText('+$5,000.00')).toHaveClass('portfolio-pos');
    expect(within(split).getByText('+$10,000.00')).not.toHaveClass('portfolio-pos');
    cleanup();
    get.mockResolvedValue(
      history({
        value: '99994',
        change: '-6',
        changePercent: '-0.01',
        deposits: '0',
        withdrawals: '0',
        netFlow: '0',
        marketEffect: '-6',
        marketReturnPercent: '-0.01',
      }),
    );
    renderPage();
    const transfer = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(transfer).getByLabelText('What changed')).toHaveTextContent(
      'Past monthMarket-$6.00-0.01%Net deposits$0.00',
    );
    cleanup();
    get.mockResolvedValue(history({ withdrawals: '2500', netFlow: '-2500', deposits: '0' }));
    renderPage();
    const sold = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(sold).getByLabelText('What changed')).toHaveTextContent('Net deposits-$2,500.00');
  });

  it('draws the net invested line and reads it with each point', async () => {
    const user = userEvent.setup();
    renderPage();
    const chart = await screen.findByRole('region', { name: 'Portfolio value over time' });
    const legend = within(chart).getByLabelText('Chart legend');
    expect(legend).toHaveTextContent('Portfolio valueNet investedDeposit');
    expect(
      within(chart).getByRole('img', {
        name: 'Portfolio value, past month, from $100,000.00 to $115,000.00',
      }),
    ).toBeInTheDocument();
    const plot = within(chart).getByRole('group');
    plot.focus();
    await user.keyboard('{Home}');
    let tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Net invested$80,000.00');
    expect(tip).not.toHaveTextContent('Deposit');
    await user.keyboard('{ArrowRight}');
    tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Net invested$90,000.00');
    expect(tip).toHaveTextContent('Deposit+$10,000.00');
    await user.keyboard('{End}');
    tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Net invested$90,000.00');
    expect(tip).not.toHaveTextContent('Deposit');
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
