import type { SourceOutcome } from './chain-sync';
import {
  JOURNAL_KEPT,
  JOURNAL_SHOWN,
  journalState,
  journalSync,
  readJournal,
} from './sync-journal';

const outcome = (state: SourceOutcome['state'], code: SourceOutcome['errorCode'] = null) =>
  ({
    state,
    errorCode: code,
    errorMessage: code ? 'It stopped.' : null,
    nextRunAt: new Date(),
  }) as SourceOutcome;

describe('SYNC-JOURNAL', () => {
  it('names how a pass ended: a page of history is "partial", not "syncing"', () => {
    expect(
      journalState(outcome('synced'), { outcome: 'complete', reason: null, imported: 1 }),
    ).toBe('synced');
    expect(
      journalState(outcome('syncing'), { outcome: 'partial', reason: null, imported: 40 }),
    ).toBe('partial');
    expect(
      journalState(outcome('delayed', 'rate_limited'), {
        outcome: 'provider_error',
        reason: 'rate_limited',
        imported: 0,
      }),
    ).toBe('delayed');
    expect(journalState(outcome('failed', 'error'), null)).toBe('failed');
  });

  it('appends one row and prunes the wallet to the newest rows kept', async () => {
    const calls: [string, unknown[]][] = [];
    const manager = {
      query: async (sql: string, params: unknown[]) => {
        calls.push([sql, params]);
        return [] as never;
      },
    };
    const now = new Date('2026-10-10T10:00:00.000Z');
    await journalSync(
      manager,
      { id: 'wallet-1', ownerId: 'owner-1' },
      outcome('failed', 'unavailable'),
      { outcome: 'provider_error', reason: 'unavailable', imported: 2 },
      now,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toEqual([
      'owner-1',
      'wallet-1',
      now,
      'failed',
      'unavailable',
      'It stopped.',
      2,
    ]);
    expect(calls[1][0]).toMatch(/DELETE FROM wallet_sync_runs/);
    expect(calls[1][1]).toEqual(['wallet-1', JOURNAL_KEPT]);
  });

  it("reads one owner's wallet, newest first, as the owner sees it", async () => {
    const calls: unknown[][] = [];
    const rows = [
      {
        ranAt: new Date('2026-10-10T10:00:00.000Z'),
        state: 'failed',
        errorCode: 'unavailable',
        errorMessage: 'It stopped.',
        imported: 0,
      },
    ];
    const manager = {
      query: async (_sql: string, params: unknown[]) => {
        calls.push(params);
        return rows as never;
      },
    };
    expect(await readJournal(manager, 'owner-1', 'wallet-1')).toEqual([
      {
        at: '2026-10-10T10:00:00.000Z',
        state: 'failed',
        errorCode: 'unavailable',
        message: 'It stopped.',
        imported: 0,
      },
    ]);
    expect(calls[0]).toEqual(['owner-1', 'wallet-1', JOURNAL_SHOWN]);
  });
});
