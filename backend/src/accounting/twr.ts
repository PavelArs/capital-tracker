import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { parseProfitPreview } from './period-profit';
import type { FlowVersion } from './portfolio-flow';

const RATE_SCALE = 10n ** 12n;
const RATE_UNITS_TO_ATOMS = 10n ** 18n;

/** Items are the complete effective, canonical [from,to) period from the owner snapshot. */
export function projectTwr(
  input: ReturnType<typeof parseProfitPreview>,
  items: readonly FlowVersion[],
) {
  const netByInstant = new Map<string, bigint>();
  for (const item of items) {
    const amount = canonicalDecimalToAtoms(item.amountUsd);
    const signed = item.direction === 'contribution' ? amount : -amount;
    netByInstant.set(item.occurredAt, (netByInstant.get(item.occurredAt) ?? 0n) + signed);
  }
  const startNet = netByInstant.get(input.from) ?? 0n;
  const startingCapital = canonicalDecimalToAtoms(input.openingValueUsd) + startNet;
  let interiorCount = 0;
  for (const [instant, net] of netByInstant) {
    if (instant !== input.from && net !== 0n) interiorCount++;
  }
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
  const numerator = (change < 0n ? -change : change) * RATE_SCALE;
  let magnitude = numerator / startingCapital;
  if ((numerator % startingCapital) * 2n >= startingCapital) magnitude++;
  const rounded = change < 0n ? -magnitude : magnitude;
  // Lift the final scale12 rate to the existing canonical scale30 formatter.
  const rateAtoms = rounded * RATE_UNITS_TO_ATOMS;
  return {
    ...metadata,
    status: 'available' as const,
    reason: null,
    periodRate: formatAtoms(rateAtoms),
    periodPercent: formatAtoms(rateAtoms * 100n),
  };
}
