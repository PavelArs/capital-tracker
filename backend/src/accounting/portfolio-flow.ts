import { canonicalDecimalToAtoms, formatAtoms } from './money';

export interface FlowVersion {
  flowId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  kind: 'create' | 'correct' | 'void';
  direction: 'contribution' | 'withdrawal';
  occurredAt: string;
  amountUsd: string;
  createdAt: string;
}

/** Heads are canonical current versions, not an operation history or cash balance. */
export function projectFlowPeriod(heads: readonly FlowVersion[], from: string, to: string) {
  const items = heads
    .filter((row) => row.kind !== 'void' && row.occurredAt >= from && row.occurredAt < to)
    .sort((left, right) => {
      const a = `${left.occurredAt}/${left.flowId}`;
      const b = `${right.occurredAt}/${right.flowId}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  let contributions = 0n;
  let withdrawals = 0n;
  for (const row of items) {
    const amount = canonicalDecimalToAtoms(row.amountUsd);
    if (row.direction === 'contribution') contributions += amount;
    else withdrawals += amount;
  }
  return {
    summary: {
      contributionsUsd: formatAtoms(contributions),
      withdrawalsUsd: formatAtoms(withdrawals),
      netContributionsUsd: formatAtoms(contributions - withdrawals),
      flowCount: items.length,
    },
    items,
  };
}
