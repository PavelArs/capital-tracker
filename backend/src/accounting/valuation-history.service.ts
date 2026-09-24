import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readHistoricalStates } from './historical-accounting.store';
import { parseUuid } from './input';
import { projectValuationSeries } from './valuation-history';
import { parseValuationHistoryQuery } from './valuation-history-input';
import { readValuationPrices } from './valuation-price.store';

@Injectable()
export class ValuationHistoryService {
  constructor(private readonly source: DataSource) {}

  async getSeries(ownerId: string, accountId: string, rawQuery: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const { from, to, instants } = parseValuationHistoryQuery(rawQuery);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const states = await readHistoricalStates(manager, owner, id, instants);
      const instruments = [
        ...new Set(states.flatMap((state) => state.positions.map((p) => p.instrumentId))),
      ];
      const prices = await readValuationPrices(manager, owner, instruments, instants);
      const {
        positions: _positions,
        initialCostUsd: _cost,
        summary: _summary,
        at: _at,
        ...metadata
      } = states[0];
      return {
        ...metadata,
        from,
        to,
        priceSource: 'manual' as const,
        quoteCurrency: 'USD' as const,
        pricePolicy: 'exact-instant' as const,
        sampling: '24h-from-start-and-end' as const,
        points: projectValuationSeries(states, prices),
      };
    });
  }
}
