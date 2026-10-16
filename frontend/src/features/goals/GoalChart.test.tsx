import { type Goal, type GoalForecast, goalsApi } from '@api/goals.api';
import { type PortfolioHistory, portfolioHistoryApi } from '@api/portfolio-history.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GoalChart from './GoalChart';

// Synthetic goal, history and projections only.
const goal: Goal = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Down payment A',
  currency: 'RUB',
  targetAmount: '22000000.00',
  deadline: '2027-01-28',
  expectedReturnPercent: '14',
  monthlyContribution: '150000.00',
  createdAt: '2026-10-01T00:00:00.000Z',
  asOf: '2026-10-13',
  progress: { current: '5500000.00', complete: true, percent: '25.00', remaining: '16500000.00' },
  status: 'behind',
  scenarios: (['pessimistic', 'base', 'optimistic'] as const).map((key, index) => ({
    key,
    returnPercent: ['10', '14', '18'][index],
    requiredMonthly: '4000000.00',
    monthsToTarget: 90,
    reachedOn: '2034-04-13',
    projectedAtDeadline: ['6100000.40', '6150000.60', '6200000.80'][index],
    gap: '15000000.00',
  })),
};

const history: PortfolioHistory = {
  period: 'ALL',
  currency: 'RUB',
  mainCurrency: 'USD',
  from: '2025-01-01T00:00:00.000Z',
  at: '2026-10-13T09:00:00.000Z',
  value: '5500000.00',
  complete: true,
  change: '1500000.00',
  changePercent: '37.50',
  invested: '4800000.00',
  profit: '700000.00',
  profitPercent: '14.58',
  deposits: '800000.00',
  withdrawals: '0.00',
  netFlow: '800000.00',
  marketEffect: '700000.00',
  marketReturnPercent: '14.58',
  points: [
    { at: '2026-08-01T00:00:00.000Z', value: '4000000.00', complete: true, invested: '4000000.00' },
    { at: '2026-09-01T00:00:00.000Z', value: null, complete: false, invested: '4400000.00' },
    { at: '2026-10-01T00:00:00.000Z', value: '5200000.00', complete: true, invested: '4800000.00' },
    { at: '2026-10-13T09:00:00.000Z', value: '5500000.00', complete: true, invested: '4800000.00' },
  ],
};

const forecast: GoalForecast = {
  currency: 'RUB',
  asOf: '2026-10-13',
  complete: true,
  points: [
    { on: '2026-10-13', pessimistic: '5500000.00', base: '5500000.00', optimistic: '5500000.00' },
    { on: '2026-11-13', pessimistic: '5690000.10', base: '5710000.20', optimistic: '5730000.30' },
    { on: '2026-12-13', pessimistic: '5890000.10', base: '5920000.20', optimistic: '5950000.30' },
    { on: '2027-01-13', pessimistic: '6080000.10', base: '6130000.20', optimistic: '6180000.30' },
    { on: '2027-01-28', pessimistic: '6100000.40', base: '6150000.60', optimistic: '6200000.80' },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
});
afterEach(cleanup);

function show(shown: Goal = goal) {
  render(<GoalChart goal={shown} />);
  return screen.findByRole('group', { name: /Use the arrow keys/ });
}

describe('GOAL-CHART goal chart', () => {
  it('reads the history in the goal currency and draws the forecast fan to the deadline', async () => {
    const read = vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    const ask = vi.spyOn(goalsApi, 'forecast').mockResolvedValue(forecast);
    const chart = await show();
    const legend = await screen.findByLabelText('Chart legend');
    expect(read).toHaveBeenCalledWith('ALL', 'RUB');
    expect(ask).toHaveBeenCalledWith(goal.id);
    expect(within(legend).getByText('Portfolio')).toBeInTheDocument();
    expect(within(legend).getByText('Money put in')).toBeInTheDocument();
    expect(await within(legend).findByText('Forecast at 14%')).toBeInTheDocument();
    expect(within(legend).getByText('10% to 18%')).toBeInTheDocument();
    expect(within(legend).getByText('Sum to reach')).toBeInTheDocument();
    expect(chart.querySelector('.goal-chart__forecast')).not.toBeNull();
    expect(chart.querySelector('.goal-chart__band')).not.toBeNull();
    expect(chart.querySelectorAll('.goal-chart__case')).toHaveLength(2);
    expect(chart.querySelector('.goal-chart__deadline-label')).toHaveTextContent('Jan 2027');
    expect(within(chart).getByText('Today')).toBeInTheDocument();
    expect(within(chart).getByText('Sum ₽22M')).toBeInTheDocument();
    // A day with no value breaks the portfolio line instead of joining across it.
    expect(chart.querySelector('.goal-chart__line')?.getAttribute('d')?.match(/M/g)).toHaveLength(
      2,
    );
  });

  it('reads each point with the keys: the history, then the forecast to the deadline', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue(forecast);
    const user = userEvent.setup();
    const chart = await show();
    await within(chart).findByText('Today');
    chart.focus();

    await user.keyboard('{ArrowRight}');
    let tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Nov 2026 · forecast');
    expect(tip).toHaveTextContent('₽5,710,000');
    expect(tip).toHaveTextContent('Pessimistic₽5,690,000');
    expect(tip).toHaveTextContent('Optimistic₽5,730,000');
    expect(tip).toHaveTextContent('Of the sum25%');

    await user.keyboard('{End}');
    tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Jan 28, 2027 · forecast');
    expect(tip).toHaveTextContent('₽6,150,000');
    expect(tip).toHaveTextContent('Optimistic₽6,200,000');

    await user.keyboard('{Home}');
    tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Aug 1, 2026');
    expect(tip).toHaveTextContent('₽4,000,000');
    expect(tip).toHaveTextContent('Money put in₽4,000,000');
    expect(tip).toHaveTextContent('Of the sum18%');
    expect(tip).toHaveTextContent(
      'Money put in leaves out a deposit or withdrawal with no rate on its day.',
    );

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(within(chart).getByRole('status')).toHaveTextContent('Now');

    await user.keyboard('{Escape}');
    expect(within(chart).queryByRole('status')).toBeNull();
  });

  it('reads the forecast again when the goal terms change, and draws the new one', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    const later: GoalForecast = {
      ...forecast,
      points: [
        ...forecast.points.slice(0, 4),
        {
          on: '2027-02-13',
          pessimistic: '6300000.10',
          base: '6350000.20',
          optimistic: '6400000.30',
        },
      ],
    };
    const ask = vi
      .spyOn(goalsApi, 'forecast')
      .mockResolvedValueOnce(forecast)
      .mockResolvedValueOnce(later);
    const user = userEvent.setup();
    const { rerender } = render(<GoalChart goal={goal} />);
    await screen.findByText('Forecast at 14%');
    rerender(<GoalChart goal={{ ...goal, deadline: '2027-02-13' }} />);
    const chart = screen.getByRole('group', { name: /Use the arrow keys/ });
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    chart.focus();
    await user.keyboard('{End}');
    expect(await within(chart).findByRole('status')).toHaveTextContent('₽6,350,000');
  });

  it('keeps the whole fan inside the chart when the optimistic case runs far above the sum', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue({
      ...forecast,
      points: [
        ...forecast.points.slice(0, 4),
        {
          on: '2027-01-28',
          pessimistic: '6100000.40',
          base: '6150000.60',
          optimistic: '90000000.00',
        },
      ],
    });
    const chart = await show();
    await within(chart).findByText('Today');
    const optimistic = chart.querySelectorAll('.goal-chart__case')[1].getAttribute('d') ?? '';
    const ys = [...optimistic.matchAll(/[ML][\d.]+ ([\d.-]+)/g)].map((match) => Number(match[1]));
    expect(ys.length).toBeGreaterThan(1);
    // The plot box starts 24 px from the top; nothing of the case is clipped above it.
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(24);
  });

  it('warns that the chart may be out of date when a refresh of the history fails', async () => {
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue(forecast);
    const read = vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    const { unmount } = render(<GoalChart goal={goal} />);
    await screen.findByText('Forecast at 14%');
    unmount();
    read.mockRejectedValue(new Error('offline'));
    render(<GoalChart goal={goal} />);
    expect(
      await screen.findByText('Could not refresh the chart. The figures below may be out of date.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Use the arrow keys/ })).toBeInTheDocument();
  });

  it('says so when the forecast cannot be loaded, and still draws the portfolio', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    vi.spyOn(goalsApi, 'forecast').mockRejectedValue(new Error('offline'));
    const chart = await show();
    expect(
      await screen.findByText(
        'Could not load the forecast, so only the portfolio so far is drawn.',
      ),
    ).toBeInTheDocument();
    expect(chart.querySelector('.goal-chart__line')).not.toBeNull();
    expect(chart.querySelector('.goal-chart__forecast')).toBeNull();
  });

  it('starts the forecast from the value the server forecast from', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue({
      ...forecast,
      points: [
        {
          on: '2026-10-13',
          pessimistic: '5000000.00',
          base: '5000000.00',
          optimistic: '5000000.00',
        },
        ...forecast.points.slice(1),
      ],
    });
    const chart = await show();
    await within(chart).findByText('Today');
    const firstY = (selector: string, last = false) => {
      const ys = [
        ...(chart.querySelector(selector)?.getAttribute('d') ?? '').matchAll(
          /[ML][\d.]+ ([\d.-]+)/g,
        ),
      ].map((match) => Number(match[1]));
      return last ? ys.at(-1) : ys[0];
    };
    // The goal says 5,500,000 now, the forecast was made from 5,000,000: the forecast starts lower.
    expect(firstY('.goal-chart__forecast')).toBeGreaterThan(firstY('.goal-chart__line', true) ?? 0);
  });

  it('puts today on the forecast day when the forecast was made after Moscow midnight', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue({
      ...forecast,
      asOf: '2026-10-14',
      points: [
        {
          on: '2026-10-14',
          pessimistic: '5500000.00',
          base: '5500000.00',
          optimistic: '5500000.00',
        },
        ...forecast.points.slice(1),
      ],
    });
    const chart = await show();
    await within(chart).findByText('Today');
    const today = chart.querySelector('.goal-chart__today')?.getAttribute('x1');
    const origin = chart.querySelector('circle.goal-chart__dot')?.getAttribute('cx');
    expect(Number(today)).toBeCloseTo(Number(origin), 1);
  });

  it('leaves the forecast out while an asset has no price, and says why', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue(forecast);
    const chart = await show({
      ...goal,
      progress: { ...goal.progress, complete: false },
      status: 'unknown',
    });
    expect(
      await screen.findByText(
        'The forecast needs every asset priced, so only the portfolio so far is drawn.',
      ),
    ).toBeInTheDocument();
    expect(chart.querySelector('.goal-chart__deadline-label')).toBeNull();
    expect(chart.querySelector('.goal-chart__forecast')).toBeNull();
    expect(screen.queryByText(/Forecast at/)).toBeNull();
    expect(chart.querySelector('.goal-chart__line')).not.toBeNull();
  });

  it('leaves the forecast out when the server says the value now is incomplete', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue({ ...forecast, complete: false, points: [] });
    const chart = await show();
    expect(
      await screen.findByText(
        'The forecast needs every asset priced, so only the portfolio so far is drawn.',
      ),
    ).toBeInTheDocument();
    expect(chart.querySelector('.goal-chart__forecast')).toBeNull();
  });

  it('marks a past day whose value left out an asset, and says so in its tooltip', async () => {
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue(forecast);
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue({
      ...history,
      points: history.points.map((point, index) =>
        index === 2 ? { ...point, complete: false } : point,
      ),
    });
    const user = userEvent.setup();
    const chart = await show();
    await within(chart).findByText('Today');
    expect(chart.querySelectorAll('.goal-chart__incomplete')).toHaveLength(1);
    chart.focus();
    await user.keyboard('{Home}{ArrowRight}');
    const tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Oct 1, 2026');
    expect(tip).toHaveTextContent('Incomplete: an asset had no price or rate');
  });

  it('says so when the history cannot be loaded but the forecast can', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockRejectedValue(new Error('offline'));
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue(forecast);
    const chart = await show();
    expect(
      await screen.findByText(
        'Could not load the portfolio history, so only the forecast is drawn.',
      ),
    ).toBeInTheDocument();
    expect(chart.querySelector('.goal-chart__forecast')).not.toBeNull();
  });

  it('keeps the money put in inside the chart when withdrawals took it below zero', async () => {
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue(forecast);
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue({
      ...history,
      points: history.points.map((point) => ({ ...point, invested: '-3000000.00' })),
    });
    const chart = await show();
    await within(chart).findByText('Today');
    const invested = chart.querySelector('.goal-chart__invested')?.getAttribute('d') ?? '';
    const ys = [...invested.matchAll(/(?:M[\d.]+ |V)([\d.-]+)/g)].map((match) => Number(match[1]));
    expect(ys.length).toBeGreaterThan(1);
    // The plot box ends 28 px above the 290 px bottom edge.
    for (const y of ys) expect(y).toBeLessThanOrEqual(262);
  });

  it('says so when the portfolio has no figures in the currency yet', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue({
      ...history,
      value: null,
      points: history.points.map((point) => ({ ...point, value: null })),
    });
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue({ ...forecast, points: [] });
    render(<GoalChart goal={{ ...goal, progress: { ...goal.progress, current: null } }} />);
    expect(await screen.findByText('No portfolio figures in RUB yet.')).toBeInTheDocument();
  });

  it('says so when the history cannot be loaded', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockRejectedValue(new Error('offline'));
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue({ ...forecast, points: [] });
    render(<GoalChart goal={goal} />);
    expect(
      await screen.findByText('Could not load the portfolio history. Try again later.'),
    ).toBeInTheDocument();
  });
  it('says which held prices the forecast valued as stale, from its own response', async () => {
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue({ ...forecast, stalePrices: 2 });
    const chart = await show();
    expect(
      await screen.findByText('2 prices are older than 2 hours; the last stored prices are used.'),
    ).toBeInTheDocument();
    expect(chart).toBeInTheDocument();
  });

  it('does not call an older value Now when the newest history point has no value', async () => {
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue(forecast);
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue({
      ...history,
      value: null,
      points: [
        ...history.points.slice(0, 3),
        { at: '2026-10-13T09:00:00.000Z', value: null, complete: false, invested: '4800000.00' },
      ],
    });
    const user = userEvent.setup();
    const chart = await show();
    await within(chart).findByText('Today');
    chart.focus();
    await user.keyboard('{Home}{ArrowRight}');
    const tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Oct 1, 2026');
    expect(tip).not.toHaveTextContent('Now');
  });
  it('draws the money put in as a step: it holds, then changes where the flow is recorded', async () => {
    vi.spyOn(goalsApi, 'forecast').mockResolvedValue(forecast);
    vi.spyOn(portfolioHistoryApi, 'get').mockResolvedValue(history);
    const chart = await show();
    await within(chart).findByText('Today');
    const invested = chart.querySelector('.goal-chart__invested')?.getAttribute('d') ?? '';
    // Four points, three levels of money put in: one move, then a horizontal run and a vertical
    // jump to each later level, with no slanted segment between snapshots.
    expect(invested).toMatch(/^M[\d.]+ [\d.-]+(H[\d.]+V[\d.-]+){3}$/);
    expect(invested).not.toContain('L');
  });
});
