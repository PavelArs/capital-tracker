import {
  type AssetLots,
  type LotAfterInflation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInflationBasis } from '../shell/inflation-basis';
import AssetLotsCard from './AssetLots';

const lot: LotAfterInflation = {
  accountId: '00000000-0000-4000-8000-000000000101',
  accountName: 'Trust Wallet',
  acquiredAt: '2026-01-10T09:00:00.000Z',
  quantity: '0.2',
  paid: '12000',
  value: '16000',
  nominalPnl: '4000',
  real: {
    official: {
      inflationPercent: '10.00',
      costBasis: '13200',
      unrealizedPnl: '2800',
      unrealizedReturnPercent: '21.21',
      estimated: true,
    },
    personal: {
      inflationPercent: '7.00',
      costBasis: '12840',
      unrealizedPnl: '3160',
      unrealizedReturnPercent: '24.61',
      estimated: true,
      ownRate: true,
    },
  },
};

const answer = (currency: AssetLots['currency']): AssetLots => ({
  instrumentId: '00000000-0000-4000-8000-000000000201',
  currency,
  complete: true,
  lots: [lot],
});

beforeEach(() => {
  vi.restoreAllMocks();
  setInflationBasis('official');
});
afterEach(() => {
  cleanup();
  setInflationBasis('official');
});

describe('INFL-REAL-LOTS card header', () => {
  it("settings-11 says the purchases are in today's money of the report currency, at the official rate", async () => {
    vi.spyOn(portfolioValuationApi, 'lots').mockResolvedValue(answer('EUR'));
    render(<AssetLotsCard instrumentId={answer('EUR').instrumentId} asked="EUR" values="a" />);
    const region = await screen.findByRole('region', { name: 'Purchases after inflation' });
    await waitFor(() => expect(within(region).queryByRole('status')).toBeNull());
    expect(
      within(region).getByText("In today's EUR, at the official rate, latest months estimated"),
    ).toBeVisible();
  });

  it("settings-11 says the purchases are in today's money at the owner's own rate", async () => {
    setInflationBasis('personal');
    vi.spyOn(portfolioValuationApi, 'lots').mockResolvedValue(answer('USD'));
    render(
      <AssetLotsCard instrumentId={answer('USD').instrumentId} asked={undefined} values="a" />,
    );
    const region = await screen.findByRole('region', { name: 'Purchases after inflation' });
    await waitFor(() => expect(within(region).queryByRole('status')).toBeNull());
    expect(within(region).getByText("In today's USD, at your own rate")).toBeVisible();
  });
});
