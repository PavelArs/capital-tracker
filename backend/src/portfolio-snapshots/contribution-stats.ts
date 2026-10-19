import { formatSignedProduct } from '../accounting/money';
import type { ValuationInputs } from '../accounting/portfolio-valuation.service';
import { AUTOMATIC_COVERAGE_FROM } from '../accounting/trade-journal.store';
import { moscowDate } from '../fx-rates/fx-conversion';
import type { StatedFlow } from './capital-flows';

/** Net contributions in the last twelve completed Moscow months; partial tracking months are omitted. */
export function monthlyContributions(allFlows: readonly StatedFlow[], from: string, today: string) {
  const flows = allFlows.filter((flow) => !flow.baseline);
  const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const end = monthIndex(today);
  const start = Math.max(end - 12, monthIndex(from) + (from.slice(8, 10) === '01' ? 0 : 1));
  const months = Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
    const index = start + offset;
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    const entries = flows.filter((flow) => moscowDate(new Date(flow.at)).slice(0, 7) === month);
    const net = entries.some((flow) => flow.amount === null)
      ? null
      : formatSignedProduct(entries.reduce((sum, flow) => sum + (flow.amount ?? 0n), 0n));
    return { month, net };
  });
  const averages = Object.fromEntries(
    [3, 6, 12].map((count) => {
      const entries = months.slice(-count);
      const known = entries.length === count && entries.every((entry) => entry.net !== null);
      const amount = known
        ? flows
            .filter((flow) => {
              const month = moscowDate(new Date(flow.at)).slice(0, 7);
              return month >= entries[0].month && month <= entries.at(-1)!.month;
            })
            .reduce((sum, flow) => sum + (flow.amount ?? 0n), 0n)
        : 0n;
      const divisor = BigInt(count);
      return [
        count,
        known ? formatSignedProduct((amount - (amount < 0n ? divisor - 1n : 0n)) / divisor) : null,
      ];
    }),
  ) as Record<3 | 6 | 12, string | null>;
  return { months, averages };
}

/** The first whole Moscow day: a partial first day cannot prove a complete first month. */
function firstFullDay(at: Date): string {
  const day = moscowDate(at);
  return at.getTime() === Date.parse(`${day}T00:00:00+03:00`)
    ? day
    : moscowDate(new Date(at.getTime() + 86_400_000));
}

/** Automatic coverage's epoch sentinel proves no calendar history before the first actual record. */
export function contributionStart(inputs: ValuationInputs, today: string): string {
  const dates = inputs.accounts.map((row) => {
    if (row.coverageFrom && row.coverageFrom.toISOString() !== AUTOMATIC_COVERAGE_FROM)
      return firstFullDay(row.coverageFrom);
    const ledger = inputs.ledgers.get(row.accountId);
    const account = ledger?.accounts.get(row.accountId);
    const records = [
      ...(account?.trades ?? []),
      ...(account?.rewards ?? []),
      ...(account?.swaps ?? []),
      ...(account?.capitalReturns ?? []),
      ...(inputs.chainMoves.get(row.accountId) ?? []),
      ...(ledger?.transfers.filter(
        (transfer) =>
          transfer.kind !== 'void' &&
          (transfer.fromAccountId === row.accountId || transfer.toAccountId === row.accountId),
      ) ?? []),
    ];
    return (
      records
        .map((record) => firstFullDay(new Date(record.occurredAt)))
        .filter((date) => date <= today)
        .sort()[0] ?? today
    );
  });
  // Every included account must cover a month before its missing flows can count as quiet.
  return (
    dates.sort().at(-1) ??
    inputs.deposits
      .map((holding) => holding.deposit.startDate)
      .filter((date) => date <= today)
      .sort()[0] ??
    today
  );
}
