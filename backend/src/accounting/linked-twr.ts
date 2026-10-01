import { BadRequestException } from '@nestjs/common';
import {
  TWR_BOUNDARY_LIMIT,
  type parseLinkedTwrPreview,
  type parseTwrBoundaryQuery,
} from './linked-twr-input';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { FlowVersion } from './portfolio-flow';
import { formatTwrReturn, groupTwrFlows } from './twr';

export function projectTwrBoundaries(
  input: ReturnType<typeof parseTwrBoundaryQuery>,
  items: readonly FlowVersion[],
) {
  const { startNet, interior } = groupTwrFlows(input.from, items);
  const exceedsLimit = interior.length > TWR_BOUNDARY_LIMIT;
  return {
    boundaryLimit: TWR_BOUNDARY_LIMIT,
    netFlowAtStartUsd: formatAtoms(startNet),
    interiorNetFlowDateCount: interior.length,
    status: exceedsLimit ? ('unavailable' as const) : ('ready' as const),
    reason: exceedsLimit ? ('too-many-boundaries' as const) : null,
    boundaries: exceedsLimit
      ? []
      : interior.map(([at, net]) => ({ at, netFlowUsd: formatAtoms(net) })),
  };
}

/** Exact rational linking; bounded inputs keep products below2700 decimal digits. */
export function projectLinkedTwr(
  input: ReturnType<typeof parseLinkedTwrPreview>,
  items: readonly FlowVersion[],
) {
  const { startNet, interior } = groupTwrFlows(input.from, items);
  const startingCapital = canonicalDecimalToAtoms(input.openingValueUsd) + startNet;
  const exceedsLimit = interior.length > TWR_BOUNDARY_LIMIT;
  const required = new Set(interior.map(([at]) => at));
  if (!exceedsLimit && input.boundaryValuations.some(({ at }) => !required.has(at))) {
    throw new BadRequestException('Invalid accounting input');
  }
  const values = new Map(
    input.boundaryValuations.map(({ at, valueBeforeUsd }) => [at, valueBeforeUsd]),
  );
  const boundaries = (exceedsLimit ? [] : interior).map(([at, net]) => {
    const before = values.get(at) ?? null;
    const after = before === null ? null : canonicalDecimalToAtoms(before) + net;
    return {
      at,
      netFlowUsd: formatAtoms(net),
      valueBeforeUsd: before,
      valueAfterUsd: after === null ? null : formatAtoms(after),
    };
  });
  // Validate all denominators, even when an earlier zero numerator makes the product zero.
  const missing = interior.some(([at]) => !values.has(at));
  const badCapital = interior.some(([at, net]) => {
    const before = values.get(at);
    return before !== undefined && canonicalDecimalToAtoms(before) + net <= 0n;
  });
  const reason = exceedsLimit
    ? ('too-many-boundaries' as const)
    : missing
      ? ('missing-flow-boundary-valuations' as const)
      : startingCapital <= 0n
        ? ('nonpositive-opening-capital' as const)
        : badCapital
          ? ('nonpositive-subperiod-capital' as const)
          : null;
  const metadata = {
    method: 'geometrically-linked-UTC-ms' as const,
    rateRoundingBound: '0.0000000000005' as const,
    boundaryLimit: TWR_BOUNDARY_LIMIT,
    netFlowAtStartUsd: formatAtoms(startNet),
    startingCapitalUsd: formatAtoms(startingCapital),
    interiorNetFlowDateCount: interior.length,
    boundaries,
  };
  if (reason)
    return {
      ...metadata,
      status: 'unavailable' as const,
      reason,
      periodRate: null,
      periodPercent: null,
    };
  let numerator = canonicalDecimalToAtoms(input.closingValueUsd);
  let denominator = startingCapital;
  for (const [at, net] of interior) {
    const before = canonicalDecimalToAtoms(values.get(at)!);
    numerator *= before;
    denominator *= before + net;
  }
  return {
    ...metadata,
    status: 'available' as const,
    reason: null,
    ...formatTwrReturn(numerator - denominator, denominator),
  };
}
