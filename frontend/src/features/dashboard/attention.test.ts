import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';
import type { SyncSource } from '@api/sync-status.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import { describe, expect, it } from 'vitest';
import { type AttentionInput, collectAttention } from './attention';

// Synthetic ids, names and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = id(10);
const cold = id(11);
const now = new Date('2026-10-07T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

const source = (changes: Partial<SyncSource>): SyncSource => ({
  key: 'prices',
  kind: 'prices',
  name: 'Prices',
  state: 'synced',
  lastAttemptAt: minutesAgo(8),
  lastSuccessAt: minutesAgo(8),
  errorMessage: null,
  ...changes,
});

const wallet = (n: number, changes: Partial<WalletAddress> = {}): WalletAddress => ({
  id: id(20 + n),
  network: 'bitcoin',
  address: `bc1qsynthetic${n}`,
  accountId: trust,
  label: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: 3,
  chainBalance: '0.01',
  balances: null,
  sync: {
    state: 'complete',
    completedAt: minutesAgo(30),
    status: 'synced',
    lastAttemptAt: minutesAgo(30),
    lastSuccessAt: minutesAgo(30),
    nextRunAt: null,
    errorMessage: null,
  },
  ...changes,
});

const failedEthereum = wallet(2, {
  network: 'ethereum',
  address: `0x${'ab'.repeat(20)}`,
  accountId: cold,
  label: 'Cold ETH',
  chainBalance: null,
  balances: null,
  sync: {
    state: 'partial',
    completedAt: null,
    status: 'failed',
    lastAttemptAt: minutesAgo(5),
    lastSuccessAt: minutesAgo(26 * 60),
    nextRunAt: null,
    errorMessage: 'Ethereum sync needs a valid Etherscan API key on the server.',
  },
});

const asset = (changes: Partial<AssetValuation>): AssetValuation =>
  ({
    instrumentId: id(1),
    name: 'Bitcoin',
    symbol: 'BTC',
    assetType: 'crypto',
    quantity: '0.01',
    price: { value: '80000', observedAt: minutesAgo(8), source: 'kraken', status: 'fresh' },
    holdings: [{ accountId: trust, accountName: 'Trust Wallet', quantity: '0.01', value: '800' }],
    ...changes,
  }) as AssetValuation;

const portfolio = (assets: AssetValuation[] = [asset({})]): PortfolioValuation =>
  ({
    assets,
    stalePriceCount: assets.filter((item) => item.price?.status === 'stale').length,
    accounts: [
      { accountId: trust, name: 'Trust Wallet' },
      { accountId: cold, name: 'Cold storage' },
    ],
  }) as unknown as PortfolioValuation;

const input = (changes: Partial<AttentionInput> = {}): AttentionInput => ({
  toClassify: 0,
  sources: [source({})],
  wallets: [wallet(1)],
  portfolio: portfolio(),
  now,
  ...changes,
});

const titles = (attention: ReturnType<typeof collectAttention>) =>
  attention.items.map((item) => item.title);

describe('DASH-ATTENTION: what needs the owner on the dashboard', () => {
  it('lists exactly three unclassified transactions, a failed Ethereum sync and old prices', () => {
    const attention = collectAttention(
      input({
        toClassify: 3,
        sources: [
          source({
            state: 'failed',
            lastAttemptAt: minutesAgo(3),
            lastSuccessAt: minutesAgo(125),
            errorMessage: 'Kraken and CoinGecko did not answer',
          }),
          source({ key: 'fx:cbr', kind: 'fx', name: 'Bank of Russia rates' }),
          source({ key: `wallet:${id(21)}`, kind: 'wallet', name: 'Bitcoin' }),
          source({ key: `wallet:${id(22)}`, kind: 'wallet', name: 'Cold ETH', state: 'failed' }),
        ],
        wallets: [wallet(1), failedEthereum],
      }),
    );
    expect(attention.items).toEqual([
      {
        key: 'prices',
        tone: 'warn',
        icon: 'clock',
        title: 'Prices are 2 hours old',
        detail: 'Kraken and CoinGecko did not answer. Values use the last stored prices.',
      },
      {
        key: 'classify',
        tone: 'warn',
        icon: 'tag',
        title: '3 blockchain transactions need classification',
        detail: 'Found by wallet sync',
        action: { label: 'Review', to: '/transactions?status=needs-classification' },
      },
      {
        key: `wallet:${id(22)}`,
        tone: 'neg',
        icon: 'alert',
        title: 'Ethereum wallet sync failed',
        detail:
          'Cold ETH · Ethereum sync needs a valid Etherscan API key on the server. Last success 26 h ago.',
        action: { label: 'Open', to: `/wallets/${cold}` },
      },
    ]);
    expect(attention.checked).toBe(true);
    // The prices are the problem, so the footer does not claim they are up to date.
    expect(attention.pricesUpdatedAt).toBeNull();
  });

  it('collapses to nothing when all is well and says when prices last updated', () => {
    const attention = collectAttention(input());
    expect(attention.items).toEqual([]);
    expect(attention.checked).toBe(true);
    expect(attention.pricesUpdatedAt).toBe(minutesAgo(8));
  });

  it('counts one transaction in the singular', () => {
    expect(titles(collectAttention(input({ toClassify: 1 })))).toEqual([
      '1 blockchain transaction needs classification',
    ]);
  });

  it('PRC-OUTAGE: a held asset priced hours ago is delayed even before the price job reports', () => {
    const stale = asset({
      price: { value: '80000', observedAt: minutesAgo(190), source: 'kraken', status: 'stale' },
    });
    const attention = collectAttention(input({ sources: [], portfolio: portfolio([stale]) }));
    expect(attention.items).toEqual([
      {
        key: 'prices',
        tone: 'warn',
        icon: 'clock',
        title: 'Prices are 3 hours old',
        detail: 'Market data is temporarily unavailable. Values use the last stored prices.',
      },
    ]);
  });

  it('names prices that never loaded and old Bank of Russia rates', () => {
    const attention = collectAttention(
      input({
        sources: [
          source({ state: 'failed', lastSuccessAt: null, errorMessage: null }),
          source({
            key: 'fx:cbr',
            kind: 'fx',
            name: 'Bank of Russia rates',
            state: 'delayed',
            lastSuccessAt: minutesAgo(3 * 24 * 60),
            errorMessage: 'cbr.ru did not answer',
          }),
        ],
      }),
    );
    expect(attention.items.map(({ title, detail }) => [title, detail])).toEqual([
      ['Prices have not loaded yet', 'Market data is temporarily unavailable.'],
      [
        'Bank of Russia rates are not updating',
        'cbr.ru did not answer. Last success 3 d ago; EUR and RUB use the last stored rate.',
      ],
    ]);
  });

  it('says a delayed wallet waits for its source and links a wallet without an account to Wallets', () => {
    const delayed = wallet(3, {
      network: 'solana',
      accountId: null,
      label: null,
      chainBalance: null,
      sync: {
        state: 'never',
        completedAt: null,
        status: 'delayed',
        lastAttemptAt: minutesAgo(2),
        lastSuccessAt: null,
        nextRunAt: null,
        errorMessage: 'The Solana data source is busy. Try again in a few minutes.',
      },
    });
    expect(collectAttention(input({ wallets: [delayed] })).items).toEqual([
      {
        key: `wallet:${id(23)}`,
        tone: 'warn',
        icon: 'alert',
        title: 'Solana wallet sync delayed',
        detail:
          'Solana wallet · The Solana data source is busy. Try again in a few minutes. Never synced.',
        action: { label: 'Open', to: '/wallets' },
      },
    ]);
  });

  it('SYNC-RECONCILE: lists a wallet whose chain balance differs from its transactions', () => {
    const attention = collectAttention(
      input({
        portfolio: portfolio([
          asset({
            holdings: [
              { accountId: trust, accountName: 'Trust Wallet', quantity: '0.0098', value: '784' },
            ],
          }),
        ]),
      }),
    );
    expect(attention.items).toEqual([
      {
        key: `balance:${trust}`,
        tone: 'warn',
        icon: 'scale',
        title: 'Balance differs in Trust Wallet',
        detail: 'The blockchain shows 0.0002 BTC more than your transactions.',
        action: { label: 'Open', to: `/wallets/${trust}` },
      },
    ]);
  });

  it('does not compare a wallet that is still loading or failing its history', () => {
    const loading = wallet(1, { chainBalance: null });
    expect(
      collectAttention(
        input({
          wallets: [loading],
          portfolio: portfolio([asset({ holdings: [] })]),
        }),
      ).items,
    ).toEqual([]);
  });

  it('never claims everything is fine when a check could not run', () => {
    const attention = collectAttention(input({ sources: null }));
    expect(attention.items).toEqual([]);
    expect(attention.checked).toBe(false);
    expect(collectAttention(input({ toClassify: null })).checked).toBe(false);
    expect(collectAttention(input({ wallets: null })).checked).toBe(false);
    expect(collectAttention(input({ portfolio: null })).checked).toBe(false);
    // What is known is still listed.
    expect(titles(collectAttention(input({ sources: null, toClassify: 2 })))).toEqual([
      '2 blockchain transactions need classification',
    ]);
  });
});
