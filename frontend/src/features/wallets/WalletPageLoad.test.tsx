import { accountingApi } from '@api/accounting.api';
import { hiddenAssetsApi } from '@api/hidden-assets.api';
import { operationsApi } from '@api/operations.api';
import { type PortfolioValuation, portfolioValuationApi } from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WalletPage from './WalletPage';

// Synthetic ids and names only.
const trust = '00000000-0000-4000-8000-000000000010';

const portfolio: PortfolioValuation = {
  at: '2026-10-05T12:00:00.000Z',
  currency: 'USD',
  mainCurrency: 'USD',
  rates: [],
  completeness: 'complete',
  totalValue: '0',
  pricedSubtotal: '0',
  missingPriceCount: 0,
  stalePriceCount: 0,
  unavailableAccountCount: 0,
  depositsValue: '0',
  unratedDepositCount: 0,
  costBasis: null,
  knownCostSubtotal: '0',
  unknownCostCount: 0,
  missingRateCount: 0,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
  realizedPnl: null,
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  assets: [],
  allocation: { complete: true, byAsset: [], byType: [], byAccount: [] },
  accounts: [
    {
      accountId: trust,
      name: 'Trust Wallet',
      coverage: 'covered',
      pricedValue: '0',
      missingPriceCount: 0,
    },
  ],
};

function setup(valuation: () => Promise<PortfolioValuation>) {
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
    items: [
      {
        id: trust,
        name: 'Trust Wallet',
        kind: null,
        currentRevision: 0,
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    nextCursor: null,
  });
  const read = vi.spyOn(portfolioValuationApi, 'get').mockImplementation(valuation);
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([]);
  vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
  vi.spyOn(operationsApi, 'list').mockResolvedValue({
    at: '2026-10-05T12:00:00.000Z',
    quoteCurrency: 'USD',
    needsClassificationCount: 0,
    dustThresholdUsd: null,
    operations: [],
  });
  render(
    <MemoryRouter initialEntries={[`/wallets/${trust}`]}>
      <Routes>
        <Route path="/wallets/:accountId" element={<WalletPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return { read, user: userEvent.setup() };
}

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
});
afterEach(() => {
  cleanup();
});

describe('WAL-PAGE: loading one wallet', () => {
  it('shows a busy skeleton while the wallet is read', () => {
    setup(() => new Promise(() => undefined));
    expect(screen.getByRole('status', { name: 'Loading wallet' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByRole('heading', { name: 'Trust Wallet' })).toBeNull();
  });

  it('says when the wallet cannot be read and reads it again', async () => {
    const { read, user } = setup(() => Promise.reject(new Error('offline')));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load this wallet. Nothing you saved is lost.",
    );
    expect(screen.queryByRole('status', { name: 'Loading wallet' })).toBeNull();
    read.mockResolvedValue(portfolio);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Trust Wallet' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
