import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { addMonths } from './goal-forecast';
import { GoalsService } from './goals.service';

const owner = '8b0f2f3e-5a53-4f63-9a2a-0d6f5b9a1c01';
const row = {
  id: 'a0e1f7c2-0a53-4a0f-8d3a-6b8f2a0d9e02',
  name: 'Reserve',
  currency: 'USD',
  targetAmount: '20000.00',
  deadline: '2999-01-01',
  expectedReturnPercent: '8',
  monthlyContribution: '100.00',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const today = new Date().toISOString().slice(0, 10);

function service(complete = true) {
  const source = {
    manager: { query: async () => [{ ...row, deadline: addMonths(today, 36) }] },
    transaction: async (work: (manager: unknown) => unknown) =>
      work({ query: async () => [], queryRunner: { isTransactionActive: true } }),
  };
  const snapshots = {
    current: async () => ({ value: '5000.00', complete, stalePrices: 0 }),
    // Refreshing the stored history on every goal read or preview would be wasted work.
    history: async () => {
      throw new Error('goals read the portfolio now, not its history');
    },
  };
  return new GoalsService(source as unknown as DataSource, snapshots as never);
}

describe('goals service', () => {
  it('GOAL-PREVIEW works out a goal from its terms without storing it', async () => {
    const stored: unknown[] = [];
    const goals = service();
    // Any query against the table would be a store; the preview needs none.
    (goals as unknown as { source: { manager: { query: unknown } } }).source.manager.query = async (
      ...args: unknown[]
    ) => {
      stored.push(args);
      return [];
    };
    const view = await goals.preview(owner, {
      currency: 'USD',
      targetAmount: '20000',
      deadline: addMonths(today, 36),
      expectedReturnPercent: '8',
      monthlyContribution: '100',
    });
    expect(stored).toEqual([]);
    expect(view).not.toHaveProperty('id');
    expect(view).not.toHaveProperty('name');
    expect(view).not.toHaveProperty('createdAt');
    expect(view).toMatchObject({
      currency: 'USD',
      targetAmount: '20000.00',
      monthlyContribution: '100.00',
      progress: { current: '5000.00', complete: true, percent: '25.00' },
      status: 'behind',
    });
    expect(view.scenarios.map((scenario) => scenario.key)).toEqual([
      'pessimistic',
      'base',
      'optimistic',
    ]);
  });

  it('GOAL-CHART dates the forecast and the goals by the instant the portfolio was valued at', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T20:59:59.000Z') });
    try {
      const goals = service();
      const seen: Date[] = [];
      (goals as unknown as { snapshots: { current: unknown } }).snapshots.current = async (
        _owner: string,
        _currency: string,
        at: Date = new Date(),
      ) => {
        seen.push(at);
        // Moscow midnight passes while the portfolio is read.
        jest.setSystemTime(new Date('2026-10-30T21:00:01.000Z'));
        return { value: '5000.00', complete: true };
      };
      expect((await goals.forecast(owner, row.id)).asOf).toBe('2026-10-30');
      jest.setSystemTime(new Date('2026-10-30T20:59:59.000Z'));
      const list = await goals.list(owner);
      expect(list.asOf).toBe('2026-10-30');
      expect(list.items[0].asOf).toBe('2026-10-30');
      expect(seen.map((at) => at.toISOString())).toEqual([
        '2026-10-30T20:59:59.000Z',
        '2026-10-30T20:59:59.000Z',
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('GOAL-PREVIEW refuses a date that is not ahead, as saving would', async () => {
    await expect(
      service().preview(owner, {
        currency: 'USD',
        targetAmount: '20000',
        deadline: today,
        expectedReturnPercent: '8',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('GOAL-CHART charts the saved goal from the portfolio now, ending on its forecast', async () => {
    const goals = service();
    const goal = await goals.get(owner, row.id);
    const forecast = await goals.forecast(owner, row.id);
    expect(forecast.currency).toBe('USD');
    expect(forecast.complete).toBe(true);
    expect(forecast.points[0].base).toBe('5000.00');
    expect(forecast.points.at(-1)?.base).toBe(goal.scenarios[1].projectedAtDeadline);
  });

  it('GOAL-CHART answers 404 for a goal that is not there', async () => {
    const goals = service();
    (goals as unknown as { source: { manager: { query: unknown } } }).source.manager.query =
      async () => [];
    await expect(goals.forecast(owner, row.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads progress from the portfolio now', async () => {
    const { items } = await service().list(owner);
    expect(items[0].progress.complete).toBe(true);
    expect(items[0].status).not.toBe('unknown');
  });

  it('calls the goal unknown while the portfolio now leaves an asset out', async () => {
    const { items } = await service(false).list(owner);
    expect(items[0].progress.complete).toBe(false);
    expect(items[0].status).toBe('unknown');
  });

  it('refuses a deadline too far away for the forecast', async () => {
    const goal = {
      requestId: '5b1d9a6e-6d0b-4b6e-9b66-0f1d3c7a1a01',
      name: 'Far',
      currency: 'USD',
      targetAmount: '100',
      deadline: '2999-01-01',
      expectedReturnPercent: '999',
      monthlyContribution: null,
    };
    await expect(service().create(owner, goal)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    const { requestId, ...fields } = goal;
    expect(requestId).toBeDefined();
    await expect(service().update(owner, row.id, fields)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('goals-35 carries the count of prices older than 2 hours from the portfolio now', async () => {
    const goals = service();
    (goals as unknown as { snapshots: { current: unknown } }).snapshots.current = async () => ({
      value: '5000.00',
      complete: true,
      stalePrices: 2,
    });
    const { items } = await goals.list(owner);
    expect(items[0].progress).toMatchObject({ current: '5000.00', complete: true, stalePrices: 2 });
  });

  describe('goals-28 on the deadline day, a Moscow day', () => {
    // 21:30 UTC on Oct 31 is already Nov 1 in Moscow, across a month end.
    const now = new Date('2026-10-31T21:30:00.000Z');
    const due = '2026-11-01';
    const terms = {
      name: 'Reserve',
      currency: 'USD',
      targetAmount: '20000',
      deadline: due,
      expectedReturnPercent: '8',
      monthlyContribution: '100',
    };
    beforeEach(() =>
      jest.useFakeTimers({
        now,
        doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval'],
      }),
    );
    afterEach(() => jest.useRealTimers());

    /** A service whose one stored goal is due on `stored`; `writes` collects every UPDATE. */
    function storedGoal(stored: string | null, writes: unknown[][] = []) {
      const query = async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith('UPDATE')) writes.push(params);
        return sql.includes('FOR UPDATE')
          ? [{ id: row.id, deadline: stored }]
          : [{ ...row, deadline: stored }];
      };
      const source = {
        manager: { query },
        transaction: async (work: (manager: unknown) => unknown) =>
          work({ query, queryRunner: { isTransactionActive: true } }),
      };
      const snapshots = {
        current: async () => ({ value: '5000.00', complete: true, stalePrices: 0 }),
      };
      return new GoalsService(source as unknown as DataSource, snapshots as never);
    }

    it('reads the goal as still open, not overdue', async () => {
      const goal = await storedGoal(due).get(owner, row.id);
      expect(goal.asOf).toBe(due);
      expect(goal.status).toBe('behind');
      expect(goal.scenarios[1].projectedAtDeadline).toBe('5000.00');
    });

    it('saves an edit that keeps the date, and previews it, but refuses a date moved to today', async () => {
      const writes: unknown[][] = [];
      const goals = storedGoal(due, writes);
      await expect(
        goals.update(owner, row.id, { ...terms, name: 'Renamed' }),
      ).resolves.toMatchObject({ deadline: due });
      expect(writes).toHaveLength(1);
      const { name, ...preview } = terms;
      expect(name).toBeDefined();
      await expect(goals.preview(owner, { ...preview, goalId: row.id })).resolves.toMatchObject({
        status: 'behind',
      });
      await expect(goals.preview(owner, preview)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      const moved = storedGoal('2027-01-01');
      await expect(moved.update(owner, row.id, terms)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(moved.preview(owner, { ...preview, goalId: row.id })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });
});
