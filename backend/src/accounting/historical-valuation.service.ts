import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readHistoricalState } from './historical-accounting.store';
import { projectValuation } from './historical-valuation';
import { parseValuationQuery } from './historical-valuation-input';
import { parseUuid } from './input';
import { readValuationPrices } from './valuation-price.store';

@Injectable()
export class HistoricalValuationService {
  constructor(private readonly source: DataSource) {}

  async getSnapshot(ownerId: string, accountId: string, rawQuery: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const { at } = parseValuationQuery(rawQuery);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const {
        positions,
        initialCostUsd: _initialCost,
        summary: _summary,
        ...snapshot
      } = await readHistoricalState(manager, owner, id, at);
      const prices = await readValuationPrices(
        manager,
        owner,
        positions.map((position) => position.instrumentId),
        [at],
      );
      return {
        ...snapshot,
        priceSource: 'manual' as const,
        quoteCurrency: 'USD' as const,
        pricePolicy: 'exact-instant' as const,
        ...projectValuation(positions, prices),
      };
    });
  }
}
