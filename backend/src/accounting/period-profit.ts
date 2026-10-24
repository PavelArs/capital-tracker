import { BadRequestException } from '@nestjs/common';
import { strictRecord } from '../shared/strict-input';
import { parseAsOf, parseDecimal } from './input';
import { canonicalDecimalToAtoms, formatAtoms } from './money';

export function parseProfitPreview(input: unknown) {
  const bad = (): never => {
    throw new BadRequestException('Invalid accounting input');
  };
  const row =
    strictRecord(input, ['from', 'to', 'openingValueUsd', 'closingValueUsd', 'assertReviewed']) ??
    bad();
  if (row.assertReviewed !== true) return bad();
  const from = parseAsOf(row.from);
  const to = parseAsOf(row.to);
  if (from >= to) return bad();
  return {
    from,
    to,
    openingValueUsd: parseDecimal(row.openingValueUsd, false),
    closingValueUsd: parseDecimal(row.closingValueUsd, false),
    assertReviewed: true as const,
  };
}

/** Values and complete period totals are canonical nonnegative decimal strings. */
export function projectPeriodProfit(
  openingValueUsd: string,
  closingValueUsd: string,
  flows: { contributionsUsd: string; withdrawalsUsd: string },
): string {
  return formatAtoms(
    canonicalDecimalToAtoms(closingValueUsd) -
      canonicalDecimalToAtoms(openingValueUsd) -
      canonicalDecimalToAtoms(flows.contributionsUsd) +
      canonicalDecimalToAtoms(flows.withdrawalsUsd),
  );
}
