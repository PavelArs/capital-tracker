import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readHistoricalState } from './historical-accounting.store';
import { projectValuation } from './historical-valuation';
import { parseValuationQuery } from './historical-valuation-input';
import { parseDecimal, parseUuid } from './input';

interface PriceRow {
  instrumentId: string;
  observedAt: Date;
  priceUsd: string | null;
  revision: number;
  kind: 'set' | 'void';
}

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
      const rows: PriceRow[] =
        positions.length === 0
          ? []
          : await manager.query(
              `SELECT DISTINCT ON ("instrumentId") "instrumentId", "observedAt", "priceUsd"::text, revision, kind
          FROM manual_usd_price_versions
          WHERE "ownerId"=$1 AND "instrumentId"=ANY($2::uuid[]) AND "observedAt"=$3
          ORDER BY "instrumentId", revision DESC`,
              [owner, positions.map((position) => position.instrumentId), at],
            );
      const prices = rows
        .filter((row) => row.kind === 'set')
        .map((row) => ({
          instrumentId: row.instrumentId,
          priceUsd: parseDecimal(row.priceUsd, false),
          observedAt: row.observedAt.toISOString(),
          revision: row.revision,
        }));
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
