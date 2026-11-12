import { accountingApi } from '@api/accounting.api';
import { hiddenAssetsApi } from '@api/hidden-assets.api';
import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import {
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DASH, money } from '../portfolio/format';
import WalletPage from './WalletPage';
import { holdingShare } from './wallets';

// Synthetic ids, names, addresses and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = id(10);
const cold = id(11);

const tracked = (n: number): WalletAddress => ({
  id: id(20 + n),
  network: 'bitcoin',
  address: `bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5md${n}`,
  accountId: trust,
  label: `Savings ${n}`,
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: 0,
  chainBalance: '0.01',
  balances: null,
  sync: {
    state: 'complete',
    completedAt: '2026-10-05T12:00:00.000Z',
    status: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextRunAt: null,
    errorMessage: null,
  },
});

const asset = (n: number, quantity: string, value: string | null): AssetValuation => ({
  instrumentId: id(n),
  name: `Coin ${n}`,
  symbol: `C${n}`,
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'market',
  quantity,
  price: null,
  priceChange24hPercent: null,
  missingPrice: null,
  value,
  allocationPercent: null,
  costBasis: null,
  knownCostSubtotal: '0',
  unknownCostQuantity: '0',
  missingRateQuantity: '0',
  averageBuyPrice: null,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
  knownCostQuantity: '0',
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
  realizedPnl: null,
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  holdings: [{ accountId: trust, accountName: 'Trust Wallet', quantity, value }],
});

const portfolio = (assets: AssetValuation[]): PortfolioValuation => ({
  at: '2026-10-05T12:00:00.000Z',
  currency: 'USD',
  mainCurrency: 'USD',
  rates: [],
  completeness: 'complete',
  totalValue: '800',
  pricedSubtotal: '800',
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
  assets,
  allocation: { complete: true, byAsset: [], byType: [], byAccount: [] },
  accounts: [
    {
      accountId: trust,
      name: 'Trust Wallet',
      coverage: 'covered',
      pricedValue: '800',
      missingPriceCount: 0,
    },
    {
      accountId: cold,
      name: 'Cold storage',
      coverage: 'covered',
      pricedValue: '0',
      missingPriceCount: 0,
    },
  ],
});

const transfer: Operation = {
  id: `transfer:${id(41)}`,
  kind: 'transfer',
  type: 'transfer',
  direction: 'internal',
  occurredAt: '2025-06-15T00:00:00.000Z',
  orderWithinTimestamp: 0,
  asset: { instrumentId: id(1), symbol: 'C1', name: 'Coin 1' },
  quantity: '0.01',
  counterAsset: null,
  counterQuantity: null,
  valueUsd: null,
  estimatedValueUsd: null,
  costBasisUsd: null,
  feeUsd: null,
  value: null,
  estimatedValue: null,
  costBasis: null,
  feeValue: null,
  fee: null,
  paid: null,
  settlement: null,
  comment: null,
  classification: null,
  account: { id: cold, name: 'Cold storage' },
  counterAccount: { id: trust, name: 'Trust Wallet' },
  wallet: null,
  counterWallet: null,
  chain: null,
  status: 'recorded',
  source: 'manual',
  version: 1,
};

const list = (operations: Operation[]): OperationList => ({
  at: '2026-10-05T12:00:00.000Z',
  quoteCurrency: 'USD',
  needsClassificationCount: 0,
  dustThresholdUsd: null,
  operations,
});

function setup({
  addresses = [] as WalletAddress[],
  assets = [] as AssetValuation[],
  operations = Promise.resolve(list([])) as Promise<OperationList>,
  entry = `/wallets/${trust}`,
} = {}) {
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
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio(assets));
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue(addresses);
  vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
  const read = vi.spyOn(operationsApi, 'list').mockReturnValue(operations);
  render(
    <MemoryRouter initialEntries={[entry]}>
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

describe('WAL-PAGE: the states of one wallet', () => {
  it('says a wallet tracked by hand holds no assets and no transactions yet', async () => {
    setup();
    const assets = await screen.findByRole('region', { name: 'Assets' });
    expect(within(assets).getByText('No assets in this wallet.')).toBeInTheDocument();
    const transactions = screen.getByRole('region', { name: /^Transactions/ });
    expect(await within(transactions).findByText('No transactions yet.')).toBeInTheDocument();
    expect(within(transactions).queryByRole('link', { name: 'Open in Transactions' })).toBeNull();
    expect(
      screen.getByText(/is tracked by hand: balances come from the transactions you add\./),
    ).toHaveTextContent(
      'Trust Wallet is tracked by hand: balances come from the transactions you add. Add a wallet address to compare them with the blockchain.',
    );
  });

  it('says when the transactions cannot be read and reads them again', async () => {
    const { read, user } = setup({ operations: Promise.reject(new Error('offline')) });
    const transactions = await screen.findByRole('region', { name: /^Transactions/ });
    expect(
      await within(transactions).findByText("Could not load this wallet's transactions."),
    ).toBeInTheDocument();
    read.mockResolvedValue(list([transfer]));
    await user.click(within(transactions).getByRole('button', { name: 'Try again' }));
    expect(await within(transactions).findByRole('link', { name: /Transfer/ })).toBeVisible();
  });

  it('names both sides of a transfer and keeps the asked currency in its link', async () => {
    setup({
      operations: Promise.resolve(list([transfer])),
      entry: `/wallets/${trust}?currency=RUB`,
    });
    const transactions = await screen.findByRole('region', { name: /^Transactions/ });
    const link = await within(transactions).findByRole('link', {
      name: /Cold storage → Trust Wallet/,
    });
    expect(link).toHaveTextContent(' · Cold storage → Trust Wallet');
    expect(link).toHaveAttribute(
      'href',
      `/transactions?open=${encodeURIComponent(transfer.id)}&currency=RUB`,
    );
    expect(
      within(transactions).getByRole('link', { name: 'Open in Transactions' }),
    ).toHaveAttribute('href', `/transactions?account=${encodeURIComponent(trust)}`);
  });

  it('shows a dash for an asset with no value and the share of one with a value', async () => {
    setup({ assets: [asset(1, '0.01', '800'), asset(2, '5', null)] });
    const assets = await screen.findByRole('region', { name: 'Assets' });
    const rows = within(assets).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(`${money('800', 'USD')}${holdingShare('800', '800')}`);
    expect(rows[1].querySelector('.wallets-holdings__side')?.textContent).toBe(DASH);
  });

  it.each([
    [
      0,
      'Trust Wallet leaves your wallets. A wallet that holds recorded transactions cannot be removed, because they are your history.',
    ],
    [
      2,
      'Trust Wallet leaves your wallets and its 2 addresses stop syncing. A wallet that holds recorded transactions cannot be removed, because they are your history; remove its addresses instead.',
    ],
  ])('WALLET-REMOVE says what a wallet with %s addresses leaves behind', async (count, text) => {
    const { user } = setup({ addresses: Array.from({ length: count }, (_, n) => tracked(n)) });
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('alertdialog', { name: 'Remove Trust Wallet?' })).toHaveTextContent(
      text,
    );
  });
});
