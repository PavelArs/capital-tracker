import { type Goal, goalsApi } from '@api/goals.api';
import { portfolioHistoryApi } from '@api/portfolio-history.api';
import { forgetReads } from '@api/read-cache';
import { ToastProvider } from '@contexts/ToastContext';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInflationBasis } from '../shell/inflation-basis';
import { setValueView } from '../shell/value-view';
import GoalPage from './GoalPage';
import GoalsPage from './GoalsPage';
import NearestGoal from './NearestGoal';

// Synthetic goals and sums only. The inflation figures are made up: 9.5% official, 7% own.
const point = (
  key: 'pessimistic' | 'base' | 'optimistic',
  returnPercent: string,
  at: string[],
) => ({
  key,
  returnPercent,
  requiredMonthly: at[0],
  monthsToTarget: Number(at[1]),
  reachedOn: at[2],
  projectedAtDeadline: at[3],
  gap: at[4],
});
const nominal = [
  point('pessimistic', '10', ['500000.00', '90', '2034-04-13', '13000000.00', '9000000.00']),
  point('base', '14', ['420000.00', '70', '2032-08-13', '15000000.00', '7000000.00']),
  point('optimistic', '18', ['350000.00', '55', '2031-05-13', '23000000.00', '-1000000.00']),
];
const official = [
  point('pessimistic', '0.4566', ['560000.00', '120', '2036-10-13', '9000000.00', '13000000.00']),
  point('base', '4.1096', ['480000.00', '95', '2034-09-13', '12000000.00', '10000000.00']),
  point('optimistic', '7.7625', ['410000.00', '70', '2032-08-13', '17000000.00', '5000000.00']),
];
const personal = [
  point('pessimistic', '2.8037', ['530000.00', '100', '2035-02-13', '11000000.00', '11000000.00']),
  point('base', '6.5421', ['450000.00', '80', '2033-06-13', '13500000.00', '8500000.00']),
  point('optimistic', '10.2804', ['380000.00', '62', '2031-12-13', '19000000.00', '3000000.00']),
];
const flat: Goal = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Down payment A',
  currency: 'RUB',
  targetAmount: '22000000.00',
  deadline: '2099-12-01',
  expectedReturnPercent: '14.0000',
  monthlyContribution: '150000.00',
  createdAt: '2026-10-01T00:00:00.000Z',
  asOf: '2026-10-13',
  progress: {
    current: '5500000.00',
    complete: true,
    percent: '25.00',
    remaining: '16500000.00',
    stalePrices: 0,
  },
  status: 'behind',
  scenarios: nominal,
  real: {
    official: {
      inflationPercent: '9.5',
      returnPercent: '4.1096',
      status: 'behind',
      scenarios: official,
    },
    personal: {
      inflationPercent: '7',
      returnPercent: '6.5421',
      status: 'behind',
      scenarios: personal,
    },
  },
};
const noOfficial: Goal = {
  ...flat,
  real: { official: null, personal: flat.real?.personal ?? null },
};

const nominalVerdict =
  'Behind by ₽270,000 a month. Reaching it by Dec 2099 needs ₽420,000 a month; at ₽150,000 it takes until Aug 2032.';
const realVerdict =
  'Behind by ₽330,000 a month. Reaching it by Dec 2099 needs ₽480,000 a month; at ₽150,000 it takes until Sep 2034.';

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
  setValueView('nominal');
  setInflationBasis('official');
  vi.spyOn(goalsApi, 'list').mockResolvedValue({ asOf: '2026-10-13', items: [flat] });
  vi.spyOn(goalsApi, 'get').mockResolvedValue(flat);
  vi.spyOn(goalsApi, 'preview').mockResolvedValue(flat);
  vi.spyOn(goalsApi, 'insights').mockRejectedValue(new Error('not read here'));
  vi.spyOn(goalsApi, 'forecast').mockResolvedValue({
    currency: 'RUB',
    asOf: '2026-10-13',
    complete: true,
    points: [],
  });
  vi.spyOn(portfolioHistoryApi, 'get').mockRejectedValue(new Error('not read here'));
});
afterEach(() => {
  cleanup();
  setValueView('nominal');
  setInflationBasis('official');
});

const withRouter = (ui: React.ReactNode, path = '/goals') =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/goals/:goalId" element={<GoalPage />} />
          <Route path="/" element={ui} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

/** The text of the page without the Nominal / Real switch, which is the one place both words live. */
function pageText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  for (const node of clone.querySelectorAll('[role="radiogroup"][aria-label="Values"]'))
    node.remove();
  return clone.textContent ?? '';
}

describe('GOAL-REAL-LIST: the goals in the mode that is chosen', () => {
  it('GOAL-REAL-ONE-NOMINAL shows the goals as counted and says nothing about inflation', async () => {
    withRouter(null);
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    expect(within(card).getByText('By Dec 1, 2099 · 14% a year')).toBeInTheDocument();
    expect(within(card).getByText('of ₽22,000,000')).toBeInTheDocument();
    expect(within(card).getByText(nominalVerdict)).toBeInTheDocument();
    expect(pageText()).not.toMatch(/inflation|today's money|real/i);
  });

  it("GOAL-REAL-ONE-REAL shows the real reading only, in today's money", async () => {
    setValueView('real');
    withRouter(null);
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    expect(
      within(card).getByText('By Dec 1, 2099 · 4.1% a year after inflation'),
    ).toBeInTheDocument();
    expect(within(card).getByText("of ₽22,000,000 in today's money")).toBeInTheDocument();
    expect(within(card).getByText(realVerdict)).toBeInTheDocument();
    expect(screen.queryByText(nominalVerdict)).toBeNull();
    // The bar and the sum now are the same portfolio, whatever the mode.
    expect(within(card).getByText('₽5,500,000')).toBeInTheDocument();
    expect(
      screen.getByText(
        /In today's money\. Targets keep their value, and returns count after inflation: RUB 9\.5% a year/,
      ),
    ).toBeInTheDocument();
    expect(pageText()).not.toMatch(/nominal/i);
  });

  it('GOAL-REAL-BASIS reads the reading of the inflation basis that is chosen', async () => {
    setValueView('real');
    setInflationBasis('personal');
    withRouter(null);
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    expect(
      within(card).getByText('By Dec 1, 2099 · 6.5% a year after inflation'),
    ).toBeInTheDocument();
    expect(screen.getByText(/RUB 7% a year, your own rate/)).toBeInTheDocument();
    expect(
      within(card).getByText(
        'Behind by ₽300,000 a month. Reaching it by Dec 2099 needs ₽450,000 a month; at ₽150,000 it takes until Jun 2033.',
      ),
    ).toBeInTheDocument();
  });

  it('GOAL-REAL-UNKNOWN shows why there is no real figure, not the nominal verdict', async () => {
    vi.spyOn(goalsApi, 'list').mockResolvedValue({ asOf: '2026-10-13', items: [noOfficial] });
    setValueView('real');
    withRouter(null);
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    expect(within(card).getByText('Not known')).toBeInTheDocument();
    expect(
      within(card).getByText('No real figure: there is no official inflation figure for RUB yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(nominalVerdict)).toBeNull();
    expect(within(card).queryByText(/14%/)).toBeNull();
    expect(pageText()).not.toMatch(/nominal/i);
  });

  it('GOAL-REAL-UNKNOWN-OWN names the missing rate of your own when that basis is chosen', async () => {
    vi.spyOn(goalsApi, 'list').mockResolvedValue({
      asOf: '2026-10-13',
      items: [{ ...flat, real: { official: flat.real?.official ?? null, personal: null } }],
    });
    setValueView('real');
    setInflationBasis('personal');
    withRouter(null);
    expect(
      await screen.findByText(
        'No real figure: no RUB inflation rate of your own is set in Settings.',
      ),
    ).toBeInTheDocument();
  });

  it('GOAL-REAL-OLD-ANSWER shows no real figure for an answer kept from before the server sent one', async () => {
    const { real: _real, ...old } = flat;
    vi.spyOn(goalsApi, 'list').mockResolvedValue({ asOf: '2026-10-13', items: [old] });
    setValueView('real');
    withRouter(null);
    expect(await screen.findByText(/^No real figure:/)).toBeInTheDocument();
    expect(screen.queryByText(nominalVerdict)).toBeNull();
  });
});

describe('GOAL-REAL-DASH: the nearest goal in the mode that is chosen', () => {
  const show = () =>
    render(
      <MemoryRouter>
        <NearestGoal />
      </MemoryRouter>,
    );

  it('GOAL-REAL-ONE-NOMINAL keeps the card as counted', async () => {
    show();
    const card = await screen.findByRole('region', { name: 'Nearest goal' });
    expect(within(card).getByText(nominalVerdict)).toBeInTheDocument();
    expect(within(card).getByText('of ₽22,000,000')).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/inflation|today's money/i);
  });

  it("GOAL-REAL-ONE-REAL judges the nearest goal in today's money", async () => {
    setValueView('real');
    show();
    const card = await screen.findByRole('region', { name: 'Nearest goal' });
    expect(within(card).getByText(realVerdict)).toBeInTheDocument();
    expect(within(card).getByText("of ₽22,000,000 in today's money")).toBeInTheDocument();
    expect(within(card).queryByText(nominalVerdict)).toBeNull();
  });

  it('GOAL-REAL-UNKNOWN shows why, not the nominal verdict', async () => {
    vi.spyOn(goalsApi, 'list').mockResolvedValue({ asOf: '2026-10-13', items: [noOfficial] });
    setValueView('real');
    show();
    const card = await screen.findByRole('region', { name: 'Nearest goal' });
    expect(
      within(card).getByText('No real figure: there is no official inflation figure for RUB yet.'),
    ).toBeInTheDocument();
    expect(within(card).queryByText(nominalVerdict)).toBeNull();
  });
});

describe('GOAL-REAL-PAGE: one goal in the mode that is chosen', () => {
  const open = () => withRouter(null, `/goals/${flat.id}`);

  it('GOAL-REAL-ONE-NOMINAL shows the goal as counted and says nothing about inflation', async () => {
    open();
    await screen.findByText('Forecast for Dec 2099');
    expect(screen.getByText('14% a year')).toBeInTheDocument();
    expect(screen.getAllByText('₽15,000,000').length).toBeGreaterThan(0);
    expect(pageText()).not.toMatch(/inflation|today's money|real/i);
  });

  it("GOAL-REAL-ONE-REAL shows the target in today's money and the real return and forecast", async () => {
    setValueView('real');
    open();
    await screen.findByText('Forecast for Dec 2099');
    const stat = (label: string) => screen.getByText(label).closest('div') as HTMLElement;
    expect(within(stat('Target')).getByText('₽22,000,000')).toBeInTheDocument();
    expect(within(stat('Target')).getByText("In today's money")).toBeInTheDocument();
    expect(within(stat('Expected return')).getByText('4.1% a year')).toBeInTheDocument();
    expect(within(stat('Expected return')).getByText('After 9.5% inflation')).toBeInTheDocument();
    expect(within(stat('Forecast for Dec 2099')).getByText('₽12,000,000')).toBeInTheDocument();
    expect(screen.getByText(realVerdict)).toBeInTheDocument();
    expect(screen.queryAllByText('₽15,000,000')).toEqual([]);
    expect(pageText()).not.toMatch(/nominal/i);
  });

  it('GOAL-REAL-CASES lists the three cases with their real returns', async () => {
    setValueView('real');
    open();
    const table = (await screen.findByText('Three cases')).closest('section') as HTMLElement;
    expect(within(table).getByText('0.4%')).toBeInTheDocument();
    expect(within(table).getByText('4.1%')).toBeInTheDocument();
    expect(within(table).getByText('7.7%')).toBeInTheDocument();
    expect(within(table).queryByText('14%')).toBeNull();
    expect(
      within(table).getByText(/the same return every year after inflation/),
    ).toBeInTheDocument();
  });

  it('GOAL-REAL-UNKNOWN shows dashes and why, not the nominal figures', async () => {
    vi.spyOn(goalsApi, 'get').mockResolvedValue(noOfficial);
    setValueView('real');
    open();
    expect(
      await screen.findByText('No real figure: there is no official inflation figure for RUB yet.'),
    ).toBeInTheDocument();
    expect(screen.queryAllByText('₽15,000,000')).toEqual([]);
    expect(screen.queryByText('Three cases')).toBeNull();
    expect(screen.queryByText(/14% a year/)).toBeNull();
    expect(pageText()).not.toMatch(/nominal/i);
  });
});

describe('GOAL-REAL-PREVIEW: the plan in the dialog in the mode that is chosen', () => {
  async function typing() {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue({ asOf: '2026-10-13', items: [] });
    withRouter(null);
    await user.click(await screen.findByRole('button', { name: 'Add goal' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('RUB'));
    await user.type(within(dialog).getByLabelText('Sum to reach'), '22000000');
    await user.type(within(dialog).getByLabelText(/^By/), '2099-12-01');
    await user.type(within(dialog).getByLabelText(/^You put in a month/), '150000');
    return within(dialog);
  }

  it("GOAL-REAL-ONE-REAL says what the plan is in today's money", async () => {
    setValueView('real');
    const dialog = await typing();
    const plan = await dialog.findByRole('status', { name: 'Plan' });
    expect(plan).toHaveTextContent(`${realVerdict} A projection, not a promise.`);
    expect(plan).not.toHaveTextContent(nominalVerdict);
  });

  it('GOAL-REAL-ONE-NOMINAL says what the plan is as counted', async () => {
    const dialog = await typing();
    const plan = await dialog.findByRole('status', { name: 'Plan' });
    expect(plan).toHaveTextContent(`${nominalVerdict} A projection, not a promise.`);
  });
});
