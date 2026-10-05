import type { SyncSource } from '@api/sync-status.api';
import { describe, expect, it } from 'vitest';
import { summarizeSync } from './sync-summary';

const now = new Date('2026-10-05T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const source = (changes: Partial<SyncSource>): SyncSource => ({
  key: 'prices',
  kind: 'prices',
  name: 'Prices',
  state: 'synced',
  lastAttemptAt: minutesAgo(12),
  lastSuccessAt: minutesAgo(12),
  errorMessage: null,
  ...changes,
});
const prices = source({});
const fx = source({
  key: 'fx:cbr',
  kind: 'fx',
  name: 'Bank of Russia rates',
  lastSuccessAt: minutesAgo(30),
});
const wallet = (changes: Partial<SyncSource> = {}) =>
  source({
    key: 'wallet:1',
    kind: 'wallet',
    name: 'Trust Wallet BTC',
    lastSuccessAt: minutesAgo(8),
    ...changes,
  });

describe('SYNC-STATUS sidebar summary', () => {
  it('says when everything was last synced', () => {
    expect(summarizeSync([prices, fx, wallet()], now)).toEqual({
      tone: 'pos',
      title: 'All synced',
      detail: 'Prices and wallets 8 min ago',
      problems: [],
    });
    expect(summarizeSync([prices], now).detail).toBe('Prices 12 min ago');
  });

  it('counts sources that need attention and keeps the last good sync of the others', () => {
    const failed = wallet({
      state: 'failed',
      lastSuccessAt: minutesAgo(200),
      errorMessage: 'Bitcoin data is temporarily unavailable.',
    });
    expect(summarizeSync([prices, failed], now)).toEqual({
      tone: 'warn',
      title: '1 source needs attention',
      detail: 'Others synced 12 min ago',
      problems: ['Trust Wallet BTC: Bitcoin data is temporarily unavailable.'],
    });
    const delayed = { ...fx, state: 'delayed' as const, errorMessage: 'No new rates for USD' };
    expect(summarizeSync([prices, delayed, failed], now).title).toBe('2 sources need attention');
  });

  it('gives the reason when nothing else has synced', () => {
    const failed = source({
      state: 'failed',
      lastSuccessAt: null,
      errorMessage: 'Kraken did not answer',
    });
    expect(summarizeSync([failed], now).detail).toBe('Kraken did not answer');
  });

  it('shows a wallet that is loading, including one not started yet', () => {
    expect(summarizeSync([prices, wallet({ state: 'syncing' })], now)).toMatchObject({
      tone: 'info',
      title: 'Syncing…',
      detail: 'Wallet history is loading',
    });
    expect(summarizeSync([prices, wallet({ state: null, lastSuccessAt: null })], now).title).toBe(
      'Syncing…',
    );
  });

  it('claims nothing before any source has run', () => {
    expect(summarizeSync([], now)).toMatchObject({ tone: 'neutral', title: 'Not synced yet' });
  });
});
