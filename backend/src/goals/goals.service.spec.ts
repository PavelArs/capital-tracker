import { UnprocessableEntityException } from '@nestjs/common';
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

function service(points: { complete: boolean }[], complete = false) {
  const source = {
    manager: { query: async () => [{ ...row, deadline: addMonths(today, 36) }] },
    transaction: async (work: (manager: unknown) => unknown) => work({ query: async () => [] }),
  };
  const snapshots = { history: async () => ({ value: '5000.00', complete, points }) };
  return new GoalsService(source as unknown as DataSource, snapshots as never);
}

describe('goals service', () => {
  it('reads completeness from the portfolio now, not from an hour that lacked a price', async () => {
    // An earlier hour was incomplete, so the period as a whole is; the current point is not.
    const { items } = await service([{ complete: false }, { complete: true }]).list(owner);
    expect(items[0].progress.complete).toBe(true);
    expect(items[0].status).not.toBe('unknown');
  });

  it('calls the goal unknown while the portfolio now leaves an asset out', async () => {
    const { items } = await service([{ complete: true }, { complete: false }]).list(owner);
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
    await expect(service([]).create(owner, goal)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    const { requestId, ...fields } = goal;
    expect(requestId).toBeDefined();
    await expect(service([]).update(owner, row.id, fields)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
