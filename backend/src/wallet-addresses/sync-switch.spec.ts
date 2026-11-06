import type { EntityManager } from 'typeorm';
import type { SourceOutcome, StepResult } from './chain-sync';
import { DISABLE_AFTER_FAILURES, passKind, recordPass, setSyncEnabled } from './sync-switch';

const at = new Date('2026-11-05T12:00:00Z');
const outcome = (state: SourceOutcome['state']): SourceOutcome => ({
  state,
  errorCode: state === 'failed' ? 'unavailable' : null,
  errorMessage: state === 'failed' ? 'Arbitrum One data is temporarily unavailable.' : null,
  nextRunAt: at,
});
const step = (overrides: Partial<StepResult>): StepResult => ({
  outcome: 'provider_error',
  reason: 'unavailable',
  imported: 0,
  ...overrides,
});

describe('WALLET-SYNC-OFF which passes count as a failure', () => {
  it('counts a pass that ended in an error and stored nothing', () => {
    expect(passKind(outcome('failed'), step({}))).toBe('failed');
  });

  it('counts a pass that stopped unexpectedly or met an unsupported network', () => {
    expect(passKind(outcome('failed'), null)).toBe('failed');
  });

  it('does not count a pass that stored rows before the provider refused', () => {
    expect(passKind(outcome('failed'), step({ imported: 4 }))).toBe('ok');
  });

  it('resets on a finished pass and on a partial one', () => {
    expect(passKind(outcome('synced'), step({ outcome: 'complete', reason: null }))).toBe('ok');
    expect(passKind(outcome('syncing'), step({ outcome: 'partial', reason: null }))).toBe('ok');
  });

  it('leaves the count alone when the provider only asked to wait', () => {
    expect(passKind(outcome('delayed'), step({ reason: 'rate_limited' }))).toBe('neutral');
  });

  it('switches a wallet off after three failures in a row', () => {
    expect(DISABLE_AFTER_FAILURES).toBe(3);
  });
});

describe('WALLET-SYNC-OFF statements', () => {
  function fake(rows: unknown[]) {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      manager: {
        query: async (sql: string, params: unknown[]) => {
          calls.push({ sql, params });
          return rows;
        },
      } as unknown as Pick<EntityManager, 'query'>,
    };
  }

  it('records a failed pass in one statement and reports a wallet it switched off', async () => {
    const { manager, calls } = fake([[{ switchedOff: true }], 1]);
    await expect(recordPass(manager, 'w1', 'failed', at)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('"syncFailures" + 1');
    expect(calls[0].params).toEqual(['w1', true, 3, at]);
  });

  it('records a good pass as a reset', async () => {
    const { manager, calls } = fake([[{ switchedOff: false }], 1]);
    await expect(recordPass(manager, 'w1', 'ok', at)).resolves.toBe(false);
    expect(calls[0].params.slice(0, 2)).toEqual(['w1', false]);
  });

  it('writes nothing for a pass that only asked to wait', async () => {
    const { manager, calls } = fake([]);
    await expect(recordPass(manager, 'w1', 'neutral', at)).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('switching on clears the failures and makes the wallet due at once', async () => {
    const { manager, calls } = fake([[{ wasOff: true }], 1]);
    await expect(setSyncEnabled(manager, 'o1', 'w1', true)).resolves.toBe(true);
    expect(calls[0].sql).toContain('"syncDisabledAt" = NULL');
    expect(calls[0].sql).toContain('"syncFailures" = 0');
    expect(calls[1].sql).toContain('UPDATE sync_sources SET "nextRunAt"');
  });

  it('switching on a wallet that is already on leaves its schedule alone', async () => {
    const { manager, calls } = fake([[{ wasOff: false }], 1]);
    await expect(setSyncEnabled(manager, 'o1', 'w1', true)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('switching off keeps the first reason and deletes nothing', async () => {
    const { manager, calls } = fake([[{ id: 'w1' }], 1]);
    await expect(setSyncEnabled(manager, 'o1', 'w1', false)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('COALESCE("syncDisabledAt"');
    expect(calls[0].sql).not.toMatch(/DELETE/i);
  });

  it("says so when the wallet is not the owner's", async () => {
    const { manager } = fake([[], 0]);
    await expect(setSyncEnabled(manager, 'o1', 'w9', false)).resolves.toBe(false);
  });
});
