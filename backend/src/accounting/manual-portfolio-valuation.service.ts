import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readHistoricalState } from './historical-accounting.store';
import { parseUuid } from './input';
import { type PortfolioAccount, projectManualPortfolioValue } from './manual-portfolio-valuation';
import { parseManualPortfolioRequest } from './manual-portfolio-valuation-input';
import { readValuationPrices } from './valuation-price.store';

interface CoverageRow {
  accountId: string;
  name: string;
  coverageFrom: Date | null;
  journalRevision: number | null;
}

@Injectable()
export class ManualPortfolioValuationService {
  constructor(private readonly source: DataSource) {}

  async preview(ownerId: string, rawBody: unknown, rawQuery: unknown) {
    const owner = parseUuid(ownerId);
    const { at, accountIds } = parseManualPortfolioRequest(rawBody, rawQuery);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const rows: CoverageRow[] = await manager.query(
        `SELECT a.id AS "accountId",a.name,j."coverageFrom",j."currentRevision" AS "journalRevision"
        FROM manual_accounts a LEFT JOIN account_trade_journals j
          ON j."ownerId"=a."ownerId" AND j."accountId"=a.id
        WHERE a."ownerId"=$1 AND a.id=ANY($2::uuid[]) ORDER BY a.id`,
        [owner, accountIds],
      );
      // Resolve the complete selected set before loading or disclosing any history.
      if (rows.length !== accountIds.length) throw new NotFoundException();
      const accounts: PortfolioAccount[] = [];
      for (const row of rows) {
        const metadata = {
          accountId: row.accountId,
          name: row.name,
          coverageFrom: row.coverageFrom?.toISOString() ?? null,
          journalRevision: row.journalRevision,
        };
        if (!row.coverageFrom) {
          accounts.push({ ...metadata, coverage: 'missing-journal' });
        } else if (row.coverageFrom.toISOString() > at) {
          accounts.push({ ...metadata, coverage: 'before-coverage' });
        } else {
          // Persisted FIFO/SQL failures must remain errors, never ordinary coverage gaps.
          const state = await readHistoricalState(manager, owner, row.accountId, at);
          accounts.push({
            ...metadata,
            coverage: 'covered',
            coverageFrom: state.coverageFrom,
            journalRevision: state.journalRevision,
            positions: state.positions,
          });
        }
      }
      const instrumentIds = [
        ...new Set(
          accounts.flatMap((account) =>
            account.coverage === 'covered' ? account.positions.map((p) => p.instrumentId) : [],
          ),
        ),
      ];
      const prices = await readValuationPrices(manager, owner, instrumentIds, [at]);
      return {
        at,
        accountIds,
        scope: 'selected-manual-accounts' as const,
        basis: 'current-effective-history' as const,
        priceSource: 'manual' as const,
        quoteCurrency: 'USD' as const,
        pricePolicy: 'exact-instant' as const,
        ...projectManualPortfolioValue(accounts, prices),
      };
    });
  }
}
