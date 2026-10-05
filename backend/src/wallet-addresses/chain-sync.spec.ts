import { presentSource } from '../sync-status/sync-source';
import { failureMessage, outcomeOf } from './chain-sync';

const now = new Date('2026-10-05T12:00:00.000Z');
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

describe('PR-SYN-1 wallet source state', () => {
  it('checks a synced wallet again in an hour and a long history at the next tick', () => {
    expect(outcomeOf('Bitcoin', { outcome: 'complete', reason: null, imported: 3 }, now)).toEqual({
      state: 'synced',
      errorCode: null,
      errorMessage: null,
      nextRunAt: later(60),
    });
    expect(outcomeOf('Bitcoin', { outcome: 'partial', reason: null, imported: 250 }, now)).toEqual({
      state: 'syncing',
      errorCode: null,
      errorMessage: null,
      nextRunAt: now,
    });
  });

  it('delays on a rate limit, fails on other provider errors and retries in 15 minutes', () => {
    const step = (reason: 'rate_limited' | 'unavailable' | 'invalid_response') =>
      outcomeOf('Bitcoin', { outcome: 'provider_error', reason, imported: 0 }, now);
    expect(step('rate_limited')).toEqual({
      state: 'delayed',
      errorCode: 'rate_limited',
      errorMessage: 'The Bitcoin data source is busy. The app tries again in a few minutes.',
      nextRunAt: later(15),
    });
    expect(step('unavailable')).toMatchObject({
      state: 'failed',
      errorMessage: 'Bitcoin data is temporarily unavailable.',
    });
    expect(step('invalid_response')).toMatchObject({
      state: 'failed',
      errorMessage: 'The Bitcoin data source sent an answer the app cannot read.',
    });
  });

  it('names a network without an adapter and an unexpected error without internals', () => {
    expect(outcomeOf('Ethereum', { failure: 'unsupported' }, now)).toMatchObject({
      state: 'failed',
      errorCode: 'unsupported',
      errorMessage: 'Syncing Ethereum wallets is not supported yet.',
    });
    expect(failureMessage('Bitcoin', 'error')).toBe('The sync stopped unexpectedly.');
  });

  it('keeps every message within the stored limits', () => {
    for (const reason of [
      'rate_limited',
      'unavailable',
      'invalid_response',
      'unsupported',
      'error',
    ] as const) {
      const message = failureMessage('Bitcoin', reason);
      expect(message.length).toBeLessThanOrEqual(300);
      expect([...message].every((char) => char.charCodeAt(0) >= 32)).toBe(true);
      expect(reason).toMatch(/^[a-z_]{1,40}$/);
    }
  });
});

describe('a stored source as the owner sees it', () => {
  const row = {
    state: 'syncing' as const,
    lastAttemptAt: later(-16),
    lastSuccessAt: later(-80),
    nextRunAt: later(-1),
    errorCode: null,
    errorMessage: null,
  };

  it('reads a pass that has been syncing for more than 15 minutes as interrupted', () => {
    expect(presentSource(row, now)).toEqual({
      state: 'failed',
      lastAttemptAt: later(-16).toISOString(),
      lastSuccessAt: later(-80).toISOString(),
      nextRunAt: later(-1).toISOString(),
      errorCode: 'interrupted',
      errorMessage: 'The sync stopped before it finished.',
    });
  });

  it('shows a running pass as syncing', () => {
    expect(presentSource({ ...row, lastAttemptAt: later(-2) }, now).state).toBe('syncing');
  });
});
