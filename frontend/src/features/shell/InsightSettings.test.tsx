import { type InsightRules, type OwnerSettings, ownerSettingsApi } from '@api/owner-settings.api';
import { type PortfolioValuation, portfolioValuationApi } from '@api/portfolio-valuation.api';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InsightSettings from './InsightSettings';

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
      { instrumentId: btc, symbol: 'BTC', name: 'Bitcoin' },
      { instrumentId: eth, symbol: 'ETH', name: 'Ethereum' },
    ],
  } as PortfolioValuation);
});
afterEach(cleanup);

describe('insight rules in Settings', () => {
  it('INS-SETTINGS saves a target with the tolerance and a review level', async () => {
    const user = userEvent.setup();
    render(<InsightSettings />);
    await user.click(await screen.findByRole('button', { name: 'Add target' }));
    await user.selectOptions(screen.getByLabelText('Target asset 1'), 'BTC');
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
    expect([...second.options].map((option) => option.text)).toEqual(['Choose an asset', 'ETH']);
    await user.selectOptions(second, 'ETH');
    await user.type(screen.getByLabelText('Target share of 2, percent'), '10');
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the insight rules; nothing changed.',
    );
  });
});
