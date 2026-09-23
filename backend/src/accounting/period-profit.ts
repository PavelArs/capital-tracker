import { BadRequestException } from '@nestjs/common';
import { parseAsOf, parseDecimal } from './input';
import { canonicalDecimalToAtoms, formatAtoms } from './money';

export function parseProfitPreview(input: unknown) {
  const bad = (): never => {
    throw new BadRequestException('Invalid accounting input');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const prototype = Object.getPrototypeOf(input);
  const keys = ['from', 'to', 'openingValueUsd', 'closingValueUsd', 'assertReviewed'];
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    return bad();
  const row = input as Record<string, unknown>;
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
