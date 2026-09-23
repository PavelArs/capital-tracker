import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FifoHistoryError } from './fifo';
import { projectHistoricalAccounting } from './historical-accounting';
import { parseHistoricalQuery } from './historical-accounting-input';
import { parseUuid } from './input';
import { readBaseline, readJournal, readOwnedAccount, readTradeHeads } from './trade-journal.store';

const conflict = () => new ConflictException('Trade request conflicts with saved state');

@Injectable()
export class HistoricalAccountingService {
  constructor(private readonly source: DataSource) {}

  async getSnapshot(ownerId: string, accountId: string, rawQuery: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const query = parseHistoricalQuery(rawQuery);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      await readOwnedAccount(manager, owner, id);
      const journal = await readJournal(manager, owner, id);
      if (
        !journal ||
        query.at < journal.coverageFrom.toISOString() ||
        (query.journalRevision !== undefined && query.journalRevision !== journal.currentRevision)
      )
        throw conflict();
      try {
        const heads = await readTradeHeads(manager, owner, id);
        const baseline = await readBaseline(manager, owner, id, journal);
        const { initialCostUsd, summary, positions } = projectHistoricalAccounting(
          heads,
          baseline,
          query.at,
        );
        const end = query.offset + query.limit;
        return {
          accountId: id,
          at: query.at,
          coverageFrom: journal.coverageFrom.toISOString(),
          journalRevision: journal.currentRevision,
          basis: 'current-effective-history' as const,
          originKind: journal.originKind,
          openingRevision: journal.openingRevision,
          initialCostUsd,
          summary,
          items: positions.slice(query.offset, end),
          nextOffset: end < positions.length ? end : null,
        };
      } catch (error) {
        // Input was parsed before the transaction. These validation errors concern
        // persisted history; SQL/programming failures retain the private500 path.
        if (error instanceof FifoHistoryError || error instanceof BadRequestException)
          throw conflict();
        throw error;
      }
    });
  }
}
