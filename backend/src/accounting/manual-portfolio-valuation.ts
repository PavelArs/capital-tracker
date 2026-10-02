import type { HistoricalPosition } from './historical-accounting';
import { type ValuationPrice, projectValuation } from './historical-valuation';
import { canonicalDecimalToAtoms, formatAtoms, formatProduct } from './money';

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

function allocationPercent(value: bigint, total: bigint): string {
  const scaled = value * 10000n;
  const whole = scaled / total;
  const rounded = (scaled % total) * 2n >= total ? whole + 1n : whole;
  return `${rounded / 100n}.${(rounded % 100n).toString().padStart(2, '0')}`;
}

/** Validated distinct accounts and exact prices from the same database snapshot. */
export function projectManualPortfolioValue(
  accounts: readonly PortfolioAccount[],
  prices: readonly ValuationPrice[],
) {
  const coveredPositions = accounts.flatMap((account) =>
    account.coverage === 'covered' ? account.positions : [],
  );
  const aggregate = projectValuation(coveredPositions, prices);
  const unavailableAccountCount = accounts.filter(
    (account) => account.coverage !== 'covered',
  ).length;
  const complete = unavailableAccountCount === 0 && aggregate.missingPriceCount === 0;
  const accountRows = accounts.map((account) => {
    if (account.coverage !== 'covered')
      return {
        ...account,
        completeness: 'incomplete' as const,
        missingPriceCount: null,
        pricedSubtotalUsd: null,
        totalValueUsd: null,
        items: [],
      };
    const { positions, ...metadata } = account;
    return { ...metadata, ...projectValuation(positions, prices) };
  });
  const byInstrument = new Map<
    string,
    {
      instrumentId: string;
      instrumentName: string;
      instrumentSymbol: string | null;
      quantity: bigint;
      value: bigint;
      priced: boolean;
    }
  >();
  for (const account of accountRows) {
    for (const item of account.items) {
      let row = byInstrument.get(item.instrumentId);
      if (!row) {
        row = {
          instrumentId: item.instrumentId,
          instrumentName: item.instrumentName,
          instrumentSymbol: item.instrumentSymbol,
          quantity: 0n,
          value: 0n,
          priced: true,
        };
        byInstrument.set(item.instrumentId, row);
      }
      row.quantity += canonicalDecimalToAtoms(item.quantity);
      if (item.price === null) row.priced = false;
      else
        row.value +=
          canonicalDecimalToAtoms(item.quantity) * canonicalDecimalToAtoms(item.price.priceUsd);
    }
  }
  const totalValue = [...byInstrument.values()].reduce((sum, row) => sum + row.value, 0n);
  const allocation = [...byInstrument.values()]
    .sort((left, right) =>
      left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0,
    )
    .map((row) => ({
      instrumentId: row.instrumentId,
      instrumentName: row.instrumentName,
      instrumentSymbol: row.instrumentSymbol,
      quantity: formatAtoms(row.quantity),
      valueUsd: row.priced ? formatProduct(row.value) : null,
      allocationPercent:
        complete && totalValue > 0n ? allocationPercent(row.value, totalValue) : null,
    }));
  return {
    completeness: complete ? ('complete' as const) : ('incomplete' as const),
    unavailableAccountCount,
    missingPriceCount: aggregate.missingPriceCount,
    pricedSubtotalUsd: aggregate.pricedSubtotalUsd,
    totalValueUsd: complete ? aggregate.pricedSubtotalUsd : null,
    accounts: accountRows,
    allocation,
  };
}
