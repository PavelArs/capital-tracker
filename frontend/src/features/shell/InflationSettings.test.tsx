import { type CurrencyInflation, type InflationOverview, inflationApi } from '@api/inflation.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InflationSettings, { monthText, pendingMonths } from './InflationSettings';

const monthsAgo = (count: number) => {
  const now = new Date();
  const number = now.getUTCFullYear() * 12 + now.getUTCMonth() - count;
  return `${Math.floor(number / 12)}-${String((number % 12) + 1).padStart(2, '0')}`;
};

const row = (over: Partial<CurrencyInflation> = {}): CurrencyInflation => ({
  currency: 'USD',
  officialSource: 'OECD (US CPI-U)',
  officialLastMonth: monthsAgo(3),
  lastMonth: monthsAgo(3),
  comparableFrom: '2009-01',
  trailingYearPercent: '2.9412',
  officialTrailingYearPercent: '2.9412',
  estimatedMonthlyPercent: '0.24',
  personalRatePercent: null,
  manualMonths: [],
  ...over,
});

const overview = (currencies: CurrencyInflation[]): InflationOverview => ({
  currencies,
  sync: { state: 'idle', lastSuccessAt: '2026-10-12T08:00:00.000Z', errorMessage: null },
});

const standard = () =>
  overview([
    row(),
    row({
      currency: 'EUR',
      officialSource: 'Eurostat HICP (euro area)',
      trailingYearPercent: '2.2',
      officialTrailingYearPercent: '2.2',
      officialLastMonth: monthsAgo(1),
    }),
    row({
      currency: 'RUB',
      officialSource: 'Bank of Russia',
      trailingYearPercent: '8.1',
      officialTrailingYearPercent: '8.1',
      personalRatePercent: '14',
      officialLastMonth: monthsAgo(2),
    }),
  ]);

const stored = new Map<string, string>();

beforeEach(() => {
  vi.restoreAllMocks();
  stored.clear();
  vi.mocked(window.localStorage.getItem).mockImplementation((key) => stored.get(key) ?? null);
  vi.mocked(window.localStorage.setItem).mockImplementation((key, value) => {
    stored.set(key, String(value));
  });
});

afterEach(cleanup);

describe('INFL-UI pending months', () => {
  it('INFL-UI-A: lists the months after the last official one up to the last full month', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(pendingMonths('2026-08', now)).toEqual(['2026-09']);
    expect(pendingMonths('2026-05', now)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(pendingMonths('2026-09', now)).toEqual([]);
    expect(pendingMonths(null, now)).toEqual([]);
  });

  it('INFL-UI-B: offers at most the newest twelve and names a month as the page does', () => {
    const months = pendingMonths('2020-01', new Date('2026-10-12T10:00:00Z'));
    expect(months).toHaveLength(12);
    expect(months[11]).toBe('2026-09');
    expect(monthText('2026-09')).toBe('Sep 2026');
  });
});

describe('INFL-UI Settings → Inflation', () => {
  it('INFL-UI-C: shows each currency with its official rate, source and last published month', async () => {
    vi.spyOn(inflationApi, 'overview').mockResolvedValue(standard());
    render(<InflationSettings />);
    expect(await screen.findByLabelText('USD · my rate a year')).toBeInTheDocument();
    expect(
      screen.getByText(
        `Official 2.9% over 12 months · OECD (US CPI-U) · published to ${monthText(monthsAgo(3))}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('USD · my rate a year')).toHaveAttribute('placeholder', '2.9');
    expect(screen.getByLabelText('RUB · my rate a year')).toHaveValue('14');
    expect(screen.getByText(/Eurostat HICP \(euro area\)/)).toBeInTheDocument();
  });

  it('INFL-UI-D: the rate for real values is official until the owner picks their own, and is remembered', async () => {
    vi.spyOn(inflationApi, 'overview').mockResolvedValue(standard());
    const user = userEvent.setup();
    render(<InflationSettings />);
    expect(await screen.findByRole('radio', { name: 'Official' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'My rate' }));
    expect(screen.getByRole('radio', { name: 'My rate' })).toBeChecked();
    expect(stored.get('inflation-basis')).toBe('personal');
    await user.click(screen.getByRole('radio', { name: 'Official' }));
    expect(stored.get('inflation-basis')).toBe('official');
  });

  it("INFL-UI-E: saves the owner's yearly rate and reads the rates again", async () => {
    const overviewSpy = vi.spyOn(inflationApi, 'overview').mockResolvedValue(standard());
    const save = vi.spyOn(inflationApi, 'setPersonalRate').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InflationSettings />);
    const input = await screen.findByLabelText('USD · my rate a year');
    await user.type(input, '5,5');
    await user.click(
      within(input.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith('USD', '5.5'));
    await waitFor(() => expect(overviewSpy).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
  });

  it('INFL-UI-F: emptying the field removes the rate so the official one stands in', async () => {
    vi.spyOn(inflationApi, 'overview').mockResolvedValue(standard());
    const save = vi.spyOn(inflationApi, 'setPersonalRate').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InflationSettings />);
    const input = await screen.findByLabelText('RUB · my rate a year');
    await user.clear(input);
    await user.click(
      within(input.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith('RUB', null));
  });

  it('INFL-UI-G: refuses a rate that is not a number or is out of range without asking the server', async () => {
    vi.spyOn(inflationApi, 'overview').mockResolvedValue(standard());
    const save = vi.spyOn(inflationApi, 'setPersonalRate').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InflationSettings />);
    const input = await screen.findByLabelText('USD · my rate a year');
    const form = input.closest('form') as HTMLElement;
    await user.type(input, 'lots');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Enter a yearly rate');
    await user.clear(input);
    await user.type(input, '1500');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Enter a yearly rate');
    expect(save).not.toHaveBeenCalled();
  });

  it('INFL-UI-H: says when a rate could not be saved', async () => {
    vi.spyOn(inflationApi, 'overview').mockResolvedValue(standard());
    vi.spyOn(inflationApi, 'setPersonalRate').mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<InflationSettings />);
    const input = await screen.findByLabelText('EUR · my rate a year');
    await user.type(input, '4');
    await user.click(
      within(input.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server; your EUR rate was not saved.',
    );
  });

  it('INFL-UI-I: enters a month the index has not published and reads the rates again', async () => {
    const overviewSpy = vi.spyOn(inflationApi, 'overview').mockResolvedValue(standard());
    const save = vi.spyOn(inflationApi, 'setMonth').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InflationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Enter a month' }));
    const dialog = screen.getByRole('dialog', { name: 'Enter a month' });
    // EUR was published to last month: only USD and RUB have months to enter.
    expect(
      within(within(dialog).getByLabelText('Currency'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['USD', 'RUB']);
    await user.type(within(dialog).getByLabelText(/How much prices changed/), '0,6');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('USD', monthsAgo(1), '0.6'));
    await waitFor(() => expect(overviewSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('INFL-UI-J: refuses a month change outside -5% to 20%', async () => {
    vi.spyOn(inflationApi, 'overview').mockResolvedValue(standard());
    const save = vi.spyOn(inflationApi, 'setMonth').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InflationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Enter a month' }));
    const dialog = screen.getByRole('dialog', { name: 'Enter a month' });
    await user.type(within(dialog).getByLabelText(/How much prices changed/), '40');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText(/between -5% and 20%/)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('INFL-UI-K: lists the months the owner entered and removes one', async () => {
    const entered = overview([
      row({ manualMonths: [{ month: monthsAgo(1), changePercent: '0.6' }] }),
      row({ currency: 'EUR', officialLastMonth: monthsAgo(1) }),
      row({ currency: 'RUB' }),
    ]);
    const overviewSpy = vi
      .spyOn(inflationApi, 'overview')
      .mockResolvedValueOnce(entered)
      .mockResolvedValue(standard());
    const remove = vi.spyOn(inflationApi, 'removeMonth').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InflationSettings />);
    expect(
      await screen.findByText(/Entered by you · prices rose 0\.60% over the month/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Remove USD ${monthText(monthsAgo(1))}` }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('USD', monthsAgo(1)));
    await waitFor(() => expect(overviewSpy).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Entered by you/)).not.toBeInTheDocument();
  });

  it('INFL-UI-L: says when the official figure has come out after the owner entered the month', async () => {
    vi.spyOn(inflationApi, 'overview').mockResolvedValue(
      overview([row({ manualMonths: [{ month: monthsAgo(4), changePercent: '-0.2' }] })]),
    );
    render(<InflationSettings />);
    expect(await screen.findByText(/prices fell 0\.20% over the month/)).toHaveTextContent(
      'The official figure is out; yours is used until you remove it.',
    );
  });

  it('INFL-UI-N: shows a saved month and a removed month even when reading the rates again fails', async () => {
    const first = overview([row(), row({ currency: 'EUR' }), row({ currency: 'RUB' })]);
    vi.spyOn(inflationApi, 'overview')
      .mockResolvedValueOnce(first)
      .mockRejectedValue(new Error('offline'));
    vi.spyOn(inflationApi, 'setMonth').mockResolvedValue(undefined);
    const remove = vi.spyOn(inflationApi, 'removeMonth').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InflationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Enter a month' }));
    const dialog = screen.getByRole('dialog', { name: 'Enter a month' });
    await user.type(within(dialog).getByLabelText(/How much prices changed/), '0.6');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(/Entered by you · prices rose 0\.60% over the month/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Remove USD/ }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Entered by you/)).not.toBeInTheDocument());
  });

  it('INFL-UI-O: shows a saved rate even when reading the rates again fails', async () => {
    vi.spyOn(inflationApi, 'overview')
      .mockResolvedValueOnce(standard())
      .mockRejectedValue(new Error('offline'));
    vi.spyOn(inflationApi, 'setPersonalRate').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InflationSettings />);
    const input = await screen.findByLabelText('USD · my rate a year');
    await user.type(input, '5.50');
    await user.click(
      within(input.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }),
    );
    expect(await screen.findByText('Saved. Your USD rate is 5.5% a year.')).toBeInTheDocument();
    expect(input).toHaveValue('5.5');
  });

  it('INFL-UI-P: a slow older read does not undo a newer save', async () => {
    let releaseFirst: (value: InflationOverview) => void = () => undefined;
    const slow = new Promise<InflationOverview>((resolve) => {
      releaseFirst = resolve;
    });
    vi.spyOn(inflationApi, 'overview')
      .mockResolvedValueOnce(standard())
      // read after the first save: slow, and it knows nothing of the second save
      .mockReturnValueOnce(slow)
      .mockResolvedValue(
        overview([
          row({ personalRatePercent: '5' }),
          row({ currency: 'EUR', personalRatePercent: '6' }),
          row({ currency: 'RUB', personalRatePercent: '14' }),
        ]),
      );
    vi.spyOn(inflationApi, 'setPersonalRate').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InflationSettings />);
    const usd = await screen.findByLabelText('USD · my rate a year');
    await user.type(usd, '5');
    await user.click(
      within(usd.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }),
    );
    const eur = screen.getByLabelText('EUR · my rate a year');
    await user.type(eur, '6');
    await user.click(
      within(eur.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }),
    );
    await waitFor(() => expect(inflationApi.overview).toHaveBeenCalledTimes(3));
    // the first, older answer arrives last, with USD and EUR still unset
    releaseFirst(standard());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByLabelText('USD · my rate a year')).toHaveValue('5');
    expect(screen.getByLabelText('EUR · my rate a year')).toHaveValue('6');
  });

  it('INFL-UI-Q: names the published figure as official even when an entered month is in the year', async () => {
    vi.spyOn(inflationApi, 'overview').mockResolvedValue(
      overview([
        row({
          trailingYearPercent: '3.4',
          officialTrailingYearPercent: '2.9412',
          manualMonths: [{ month: monthsAgo(1), changePercent: '0.6' }],
        }),
      ]),
    );
    render(<InflationSettings />);
    expect(await screen.findByText(/^Official 2\.9% over 12 months/)).toBeInTheDocument();
    expect(screen.queryByText(/3\.4%/)).not.toBeInTheDocument();
  });

  it('INFL-UI-M: reports when the rates cannot be loaded', async () => {
    vi.spyOn(inflationApi, 'overview').mockRejectedValue(new Error('offline'));
    render(<InflationSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the inflation rates; try again later.',
    );
  });
});
