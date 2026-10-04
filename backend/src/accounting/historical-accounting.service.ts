import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readHistoricalState } from './historical-accounting.store';
import { parseHistoricalQuery } from './historical-accounting-input';
import { parseUuid } from './input';

@Injectable()
export class HistoricalAccountingService {
  constructor(private readonly source: DataSource) {}

  async getSnapshot(ownerId: string, accountId: string, rawQuery: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const query = parseHistoricalQuery(rawQuery);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const { positions, ...snapshot } = await readHistoricalState(
        manager,
        owner,
        id,
        query.at,
        query.journalRevision,
      );
      const end = query.offset + query.limit;
      return {
        ...snapshot,
        items: positions.slice(query.offset, end),
        nextOffset: end < positions.length ? end : null,
      };
    });
  }
}
