import { BadRequestException } from '@nestjs/common';
import { parseUuid } from '../accounting/input';

/** INS-RULES: what the owner wants watched; the thresholds are percentages as exact text. */
export interface InsightRules {
  /** The share of the portfolio wanted in an asset; what is left over is "everything else". */
  targets: { instrumentId: string; percent: string }[];
  /** Percentage points an asset may stray from its target before it is worth a look. */
  driftPoints: string;
  /** Review an asset whose known-cost return rises to this percent; null: off. */
  gainReviewPercent: string | null;
  /** Review an asset whose known-cost return falls this percent below cost; null: off. */
  lossReviewPercent: string | null;
}

const MAX_TARGETS = 50;

const bad = (): never => {
  throw new BadRequestException('Invalid settings input');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const onlyKeys = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).some((key) => !keys.includes(key))) bad();
};

/** Hundredths of a percent in [min, max], canonical: no trailing zeros, no leading zeros. */
function parsePercent(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || !/^[0-9]{1,5}(\.[0-9]{1,2})?$/.test(value)) return bad();
  const hundredths = Math.round(Number(value) * 100);
  if (hundredths < min * 100 || hundredths > max * 100) return bad();
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const optionalPercent = (value: unknown, min: number, max: number): string | null =>
  value === null ? null : parsePercent(value, min, max);

/** Rules, or null to switch every rule off. */
export function parseInsightRules(input: unknown): InsightRules | null {
  if (input === null) return null;
  if (!isRecord(input)) return bad();
  onlyKeys(input, ['targets', 'driftPoints', 'gainReviewPercent', 'lossReviewPercent']);
  if (!Array.isArray(input.targets) || input.targets.length > MAX_TARGETS) return bad();
  const seen = new Set<string>();
  let total = 0;
  const targets = input.targets.map((entry: unknown) => {
    if (!isRecord(entry)) return bad();
    onlyKeys(entry, ['instrumentId', 'percent']);
    const instrumentId = parseUuid(entry.instrumentId);
    if (seen.has(instrumentId)) return bad();
    seen.add(instrumentId);
    const percent = parsePercent(entry.percent, 0.01, 100);
    total += Math.round(Number(percent) * 100);
    return { instrumentId, percent };
  });
  if (total > 10_000) return bad();
  return {
    targets,
    driftPoints: parsePercent(input.driftPoints, 0.01, 50),
    gainReviewPercent: optionalPercent(input.gainReviewPercent, 0.01, 10_000),
    // A loss of 100 percent is the whole cost; a level at or above it can never be crossed.
    lossReviewPercent: optionalPercent(input.lossReviewPercent, 0.01, 99.99),
  };
}
