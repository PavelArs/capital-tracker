import type { HistoricalPosition } from './historical-accounting';
import { projectUnrealized, projectValuation, type ValuationPrice } from './historical-valuation';

interface AccountIdentity {
  accountId: string;
  name: string;
}
export type PortfolioAccount = AccountIdentity &
  (
    | {
        coverage: 'covered';
        coverageFrom: string;
        journalRevision: number;
        positions: readonly HistoricalPosition[];
      }
    | {
        coverage: 'missing-journal' | 'before-coverage';
        coverageFrom: string | null;
        journalRevision: number | null;
      }
  );

/** Validated distinct accounts and exact prices from the same database snapshot. */
export function projectManualPortfolioValue(
  accounts: readonly PortfolioAccount[],
  prices: readonly ValuationPrice[],
) {
  const coveredPositions = accounts.flatMap((account) =>
    account.coverage === 'covered' ? account.positions : [],
  );
  const aggregate = projectUnrealized(projectValuation(coveredPositions, prices));
  const unavailableAccountCount = accounts.filter(
    (account) => account.coverage !== 'covered',
  ).length;
  const complete = unavailableAccountCount === 0 && aggregate.missingPriceCount === 0;
  return {
    completeness: complete ? ('complete' as const) : ('incomplete' as const),
    unavailableAccountCount,
    missingPriceCount: aggregate.missingPriceCount,
    pricedSubtotalUsd: aggregate.pricedSubtotalUsd,
    totalValueUsd: complete ? aggregate.pricedSubtotalUsd : null,
    unknownCostCount: aggregate.unknownCostCount,
    unrealizedPnlUsd: unavailableAccountCount === 0 ? aggregate.unrealizedPnlUsd : null,
    unrealizedReturnPercent:
      unavailableAccountCount === 0 ? aggregate.unrealizedReturnPercent : null,
    accounts: accounts.map((account) => {
      if (account.coverage !== 'covered')
        return {
          ...account,
          completeness: 'incomplete' as const,
          missingPriceCount: null,
          pricedSubtotalUsd: null,
          totalValueUsd: null,
          unknownCostCount: null,
          unrealizedPnlUsd: null,
          unrealizedReturnPercent: null,
          items: [],
        };
      const { positions, ...metadata } = account;
      return { ...metadata, ...projectUnrealized(projectValuation(positions, prices)) };
    }),
  };
}
