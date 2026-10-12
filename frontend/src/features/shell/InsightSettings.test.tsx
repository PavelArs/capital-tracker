import { type InsightRules, type OwnerSettings, ownerSettingsApi } from '@api/owner-settings.api';
import { type PortfolioValuation, portfolioValuationApi } from '@api/portfolio-valuation.api';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InsightSettings from './InsightSettings';
import { MainCurrencyProvider, useMainCurrency } from './main-currency';

// Synthetic ids and names only.
const btc = '00000000-0000-4000-8000-000000000001';
const eth = '00000000-0000-4000-8000-000000000002';

const get = vi.spyOn(ownerSettingsApi, 'get');
const update = vi.spyOn(ownerSettingsApi, 'update');
const valued = vi.spyOn(portfolioValuationApi, 'get');

const settings = (insightRules: InsightRules | null): OwnerSettings => ({
  mainCurrency: 'USD',
  dustThresholdUsd: null,
  insightRules,
});

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue(settings(null));
  update.mockReset();
  update.mockImplementation(async (changed) => ({ ...settings(null), ...changed }));
  valued.mockReset();
  valued.mockResolvedValue({
    assets: [
      { instrumentId: btc, symbol: 'BTC', name: 'Bitcoin', holdings: [] },
      { instrumentId: eth, symbol: 'ETH', name: 'Ethereum', holdings: [] },
    ],
  } as unknown as PortfolioValuation);
});
afterEach(cleanup);

describe('insight rules in Settings', () => {
  it('INS-SETTINGS saves a target with the tolerance and a review level', async () => {
    const user = userEvent.setup();
    render(<InsightSettings />);
    await user.click(await screen.findByRole('button', { name: 'Add target' }));
    await user.selectOptions(screen.getByLabelText('Target asset 1'), 'BTC · Bitcoin');
    await user.type(screen.getByLabelText('Target share of 1, percent'), '50');
    await user.type(screen.getByLabelText('Review an asset down by, percent on cost'), '40');
    expect(screen.getByText('Together 50%; the other 50% is everything else.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        insightRules: {
          targets: [{ instrumentId: btc, percent: '50' }],
          driftPoints: '5',
          gainReviewPercent: null,
          lossReviewPercent: '40',
        },
      }),
    );
    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
  });

  it('INS-SETTINGS leaving everything empty turns the rules off', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(
      settings({
        targets: [{ instrumentId: btc, percent: '50' }],
        driftPoints: '5',
        gainReviewPercent: null,
        lossReviewPercent: null,
      }),
    );
    render(<InsightSettings />);
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ insightRules: null }));
  });

  it('INS-SETTINGS refuses targets above 100 together without asking the server', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(
      settings({
        targets: [
          { instrumentId: btc, percent: '60' },
          { instrumentId: eth, percent: '50' },
        ],
        driftPoints: '5',
        gainReviewPercent: null,
        lossReviewPercent: null,
      }),
    );
    render(<InsightSettings />);
    await screen.findByText('Together 110%: more than the whole portfolio.');
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the numbers');
    expect(update).not.toHaveBeenCalled();
  });

  it('INS-SETTINGS offers an asset once and says when a save failed', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(
      settings({
        targets: [{ instrumentId: btc, percent: '50' }],
        driftPoints: '5',
        gainReviewPercent: null,
        lossReviewPercent: null,
      }),
    );
    update.mockRejectedValue(new Error('offline'));
    render(<InsightSettings />);
    await user.click(await screen.findByRole('button', { name: 'Add target' }));
    const second = screen.getByLabelText('Target asset 2') as HTMLSelectElement;
    expect([...second.options].map((option) => option.text)).toEqual([
      'Choose an asset',
      'ETH · Ethereum',
    ]);
    await user.selectOptions(second, 'ETH · Ethereum');
    await user.type(screen.getByLabelText('Target share of 2, percent'), '10');
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the insight rules; nothing changed.',
    );
  });

  it('INS-SETTINGS: tells same-ticker assets apart by the account that holds them', async () => {
    valued.mockResolvedValue({
      assets: [
        {
          instrumentId: btc,
          symbol: 'USDT',
          name: 'Tether',
          holdings: [{ accountName: 'Main wallet' }],
        },
        {
          instrumentId: eth,
          symbol: 'USDT',
          name: 'Tether',
          holdings: [{ accountName: 'Exchange' }],
        },
      ],
    } as unknown as PortfolioValuation);
    render(<InsightSettings />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add target' }));
    const select = screen.getByLabelText('Target asset 1') as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual([
      'Choose an asset',
      'USDT · Tether · Main wallet',
      'USDT · Tether · Exchange',
    ]);
  });

  it('INS-SETTINGS: falls back to the end of the id when labels still collide', async () => {
    valued.mockResolvedValue({
      assets: [
        { instrumentId: btc, symbol: 'USDT', name: 'Tether', holdings: [] },
        { instrumentId: eth, symbol: 'USDT', name: 'Tether', holdings: [] },
      ],
    } as unknown as PortfolioValuation);
    render(<InsightSettings />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add target' }));
    const select = screen.getByLabelText('Target asset 1') as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual([
      'Choose an asset',
      `USDT · Tether · #${btc.slice(-6)}`,
      `USDT · Tether · #${eth.slice(-6)}`,
    ]);
  });

  it('INS-SETTINGS: shows a saved target whose asset is hidden instead of an empty choice', async () => {
    const hidden = '00000000-0000-4000-8000-000000000009';
    get.mockResolvedValue(
      settings({
        targets: [{ instrumentId: hidden, percent: '20' }],
        driftPoints: '5',
        gainReviewPercent: null,
        lossReviewPercent: null,
      }),
    );
    render(<InsightSettings />);
    const select = (await screen.findByLabelText('Target asset 1')) as HTMLSelectElement;
    expect(select.value).toBe(hidden);
    expect(select.selectedOptions[0].text).toBe('Hidden or removed asset');
  });

  it('INS-SETTINGS: keeps Add target available for a visible asset beside a hidden target', async () => {
    get.mockResolvedValue(
      settings({
        targets: [{ instrumentId: '00000000-0000-4000-8000-000000000009', percent: '20' }],
        driftPoints: '5',
        gainReviewPercent: null,
        lossReviewPercent: null,
      }),
    );
    valued.mockResolvedValue({
      assets: [{ instrumentId: btc, symbol: 'BTC', name: 'Bitcoin', holdings: [] }],
    } as unknown as PortfolioValuation);
    render(<InsightSettings />);
    expect(await screen.findByRole('button', { name: 'Add target' })).toBeEnabled();
  });

  it('INS-SETTINGS: still loads and saves the rules when the portfolio cannot be read', async () => {
    valued.mockRejectedValue(new Error('offline'));
    get.mockResolvedValue(
      settings({
        targets: [],
        driftPoints: '5',
        gainReviewPercent: '80',
        lossReviewPercent: null,
      }),
    );
    const user = userEvent.setup();
    render(<InsightSettings />);
    expect(await screen.findByDisplayValue('80')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add target' })).toBeDisabled();
    expect(screen.getByText(/assets could not be loaded/)).toBeInTheDocument();
    await user.clear(screen.getByDisplayValue('80'));
    await user.type(screen.getAllByPlaceholderText('Off')[1], '60');
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(update).toHaveBeenCalled();
  });

  it('INS-SETTINGS: shares the rules with the shell after its own first read failed', async () => {
    const rules: InsightRules = {
      targets: [],
      driftPoints: '5',
      gainReviewPercent: '80',
      lossReviewPercent: null,
    };
    get.mockRejectedValueOnce(new Error('offline'));
    get.mockResolvedValue(settings(rules));
    const Probe = () => {
      const { insightRules } = useMainCurrency();
      return <p>{`shell rules: ${insightRules?.gainReviewPercent ?? 'none'}`}</p>;
    };
    const Page = () => {
      const [open, setOpen] = useState(false);
      return (
        <MainCurrencyProvider>
          <Probe />
          <button type="button" onClick={() => setOpen(true)}>
            Open settings
          </button>
          {open && <InsightSettings />}
        </MainCurrencyProvider>
      );
    };
    const user = userEvent.setup();
    render(<Page />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(screen.getByText('shell rules: none')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(await screen.findByText('shell rules: 80')).toBeInTheDocument();
  });
});
