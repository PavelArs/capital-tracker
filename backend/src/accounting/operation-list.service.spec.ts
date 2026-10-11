import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { OperationListService } from './operation-list.service';

// Synthetic owner id; the query is read before any row is.
const owner = '00000000-0000-4000-8000-000000000001';
const reached = new Error('reached the database');
const service = () =>
  new OperationListService({
    transaction: async () => {
      throw reached;
    },
  } as unknown as DataSource);

describe('OPS-PERIOD: the query of the operations list', () => {
  it.each([
    [{}],
    [{ currency: 'EUR' }],
    [{ from: '2026-10-01' }],
    [{ to: '2026-10-11' }],
    [{ from: '2026-10-11', to: '2026-10-11' }],
    [{ currency: 'RUB', from: '2024-02-29', to: '2026-10-11' }],
  ])('accepts %j', async (query) => {
    await expect(service().read(owner, query)).rejects.toBe(reached);
  });

  it.each([
    [{ from: '2026-02-30' }],
    [{ from: '2026-2-3' }],
    [{ from: '2025-02-29' }],
    [{ to: 'yesterday' }],
    [{ from: '' }],
    [{ from: ['2026-10-01'] }],
    [{ from: '2026-10-12', to: '2026-10-11' }],
    [{ asset: 'BTC' }],
    [{ currency: 'GBP' }],
    [{ from: '2026-10-01T00:00:00Z' }],
  ])('refuses %j', async (query) => {
    await expect(service().read(owner, query)).rejects.toBeInstanceOf(BadRequestException);
  });
});
