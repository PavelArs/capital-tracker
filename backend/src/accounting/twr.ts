import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { parseProfitPreview } from './period-profit';
import type { FlowVersion } from './portfolio-flow';

const RATE_SCALE = 10n ** 12n;
const RATE_UNITS_TO_ATOMS = 10n ** 18n;

/** Canonical effective heads supplied by the complete owner snapshot. */
export function groupTwrFlows(from: string, items: readonly FlowVersion[]) {
  const netByInstant = new Map<string, bigint>();
  for (const item of items) {
    const amount = canonicalDecimalToAtoms(item.amountUsd);
    const signed = item.direction === 'contribution' ? amount : -amount;
    netByInstant.set(item.occurredAt, (netByInstant.get(item.occurredAt) ?? 0n) + signed);
  }
  const startNet = netByInstant.get(from) ?? 0n;
  const interior = [...netByInstant]
    .filter(([at, net]) => at !== from && net !== 0n)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { startNet, interior };
}

/** Round a signed exact rational return once; denominator must be positive. */
export function formatTwrReturn(change: bigint, denominator: bigint) {
  const numerator = (change < 0n ? -change : change) * RATE_SCALE;
  let magnitude = numerator / denominator;
  if ((numerator % denominator) * 2n >= denominator) magnitude++;
  const rounded = change < 0n ? -magnitude : magnitude;
  const rateAtoms = rounded * RATE_UNITS_TO_ATOMS;
  return {
    periodRate: formatAtoms(rateAtoms),
    periodPercent: formatAtoms(rateAtoms * 100n),
  };
}

/** Items are the complete effective, canonical [from,to) period from the owner snapshot. */
export function projectTwr(
  input: ReturnType<typeof parseProfitPreview>,
  items: readonly FlowVersion[],
) {
  const { startNet, interior } = groupTwrFlows(input.from, items);
  const startingCapital = canonicalDecimalToAtoms(input.openingValueUsd) + startNet;
  const interiorCount = interior.length;
  const metadata = {
    method: 'endpoint-ratio-UTC-ms' as const,
    rateRoundingBound: '0.0000000000005' as const,
    netFlowAtStartUsd: formatAtoms(startNet),
    startingCapitalUsd: formatAtoms(startingCapital),
    interiorNetFlowDateCount: interiorCount,
  };
  const reason =
    interiorCount > 0
      ? ('missing-flow-boundary-valuations' as const)
      : startingCapital <= 0n
        ? ('nonpositive-opening-capital' as const)
        : null;
  if (reason) {
    return {
      ...metadata,
      status: 'unavailable' as const,
      reason,
      periodRate: null,
      periodPercent: null,
    };
  }

  const change = canonicalDecimalToAtoms(input.closingValueUsd) - startingCapital;
  return {
    ...metadata,
    status: 'available' as const,
    reason: null,
    ...formatTwrReturn(change, startingCapital),
  };
}
