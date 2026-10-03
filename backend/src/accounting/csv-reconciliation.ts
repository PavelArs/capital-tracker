import { BadRequestException } from '@nestjs/common';

export type ReconciliationField =
  | 'usdAmount'
  | 'rate'
  | 'currentValue'
  | 'difference'
  | 'returnPercent';
export type ReconciliationColumns = Partial<Record<ReconciliationField | 'currentRate', number>>;
export interface SheetCheck {
  field: ReconciliationField;
  sheet: string;
  app: string | null;
  result: 'match' | 'mismatch' | 'unreadable' | 'unavailable';
}

const queryKeys = [
  'usdAmount',
  'rate',
  'currentRate',
  'currentValue',
  'difference',
  'returnPercent',
] as const;
const checkedFields: ReconciliationField[] = [
  'usdAmount',
  'rate',
  'currentValue',
  'difference',
  'returnPercent',
];

function bad(): never {
  throw new BadRequestException('Invalid CSV reconciliation query');
}

/** Distinct zero-based source column indexes; at least one, unknown keys refused. */
export function parseReconciliationQuery(raw: unknown): ReconciliationColumns {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const row = raw as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length === 0 || keys.some((key) => !(queryKeys as readonly string[]).includes(key)))
    return bad();
  const columns: ReconciliationColumns = {};
  for (const key of queryKeys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]?)$/.test(value) || Number(value) > 31)
      return bad();
    columns[key] = Number(value);
  }
  const indexes = Object.values(columns);
  if (new Set(indexes).size !== indexes.length) return bad();
  return columns;
}

// Exact decimal n / 10^s on bigint; no floating point anywhere in the comparison.
interface Decimal {
  n: bigint;
  s: number;
}
const scale = (value: Decimal, s: number): bigint => value.n * 10n ** BigInt(s - value.s);
const align = (a: Decimal, b: Decimal) => {
  const s = Math.max(a.s, b.s);
  return { a: scale(a, s), b: scale(b, s), s };
};
const add = (a: Decimal, b: Decimal): Decimal => {
  const v = align(a, b);
  return { n: v.a + v.b, s: v.s };
};
const sub = (a: Decimal, b: Decimal): Decimal => add(a, { n: -b.n, s: b.s });
const mul = (a: Decimal, b: Decimal): Decimal => ({ n: a.n * b.n, s: a.s + b.s });
const abs = (a: Decimal): Decimal => ({ n: a.n < 0n ? -a.n : a.n, s: a.s });
const lessOrEqual = (a: Decimal, b: Decimal) => {
  const v = align(a, b);
  return v.a <= v.b;
};
const ONE: Decimal = { n: 1n, s: 0 };
const HUNDRED: Decimal = { n: 100n, s: 0 };

/** Canonical decimal strings from the journal (optionally signed). */
function decimal(value: string): Decimal {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const n = BigInt(whole + fraction);
  return { n: negative ? -n : n, s: fraction.length };
}
function format(value: Decimal): string {
  const negative = value.n < 0n;
  const digits = (negative ? -value.n : value.n).toString().padStart(value.s + 1, '0');
  const whole = digits.slice(0, digits.length - value.s);
  const fraction = digits.slice(digits.length - value.s).replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && text !== '0' ? `-${text}` : text;
}
/** numerator / denominator rounded half away from zero to fixed places (no negative zero). */
function rounded(numerator: Decimal, denominator: Decimal, places: number): string {
  const top = numerator.n * 10n ** BigInt(denominator.s + places);
  const bottom = denominator.n * 10n ** BigInt(numerator.s);
  const negative = top < 0n !== bottom < 0n;
  const t = top < 0n ? -top : top;
  const b = bottom < 0n ? -bottom : bottom;
  const units = (t * 2n + b) / (b * 2n);
  const digits = units.toString().padStart(places + 1, '0');
  const text =
    places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(digits.length - places)}`;
  return negative && units !== 0n ? `-${text}` : text;
}

/** A sheet cell as Excel saved it: optional '-', chosen separator, '%' only for returns. */
function sheetNumber(
  raw: string,
  separator: '.' | ',',
  percent: boolean,
): { value: Decimal; places: number } | null {
  const body = percent && raw.endsWith('%') ? raw.slice(0, -1) : raw;
  const pattern =
    separator === ',' ? /^-?[0-9]{1,48}(?:,[0-9]{1,30})?$/ : /^-?[0-9]{1,48}(?:\.[0-9]{1,30})?$/;
  if (!pattern.test(body)) return null;
  const places = body.includes(separator) ? body.length - body.indexOf(separator) - 1 : 0;
  return { value: decimal(body.replace(separator, '.')), places };
}

/**
 * SHEET-3: compare the app's exact value numerator/denominator with each sheet cell.
 * A cell matches when the exact app value rounds to it: the difference is at most half a
 * unit in the cell's last shown decimal place (ties either way, as Excel's binary doubles may).
 */
export function reconcileCells(input: {
  quantity: string;
  costUsd: string;
  cells: readonly string[];
  columns: ReconciliationColumns;
  decimalSeparator: '.' | ',';
}): SheetCheck[] {
  const quantity = decimal(input.quantity);
  const cost = decimal(input.costUsd);
  const rateCell = input.columns.currentRate;
  const rate =
    rateCell === undefined
      ? null
      : sheetNumber(input.cells[rateCell], input.decimalSeparator, false);
  const value = rate ? mul(quantity, rate.value) : null;
  const difference = value ? sub(value, cost) : null;
  const exact: Record<ReconciliationField, [Decimal, Decimal] | null> = {
    usdAmount: [cost, ONE],
    rate: [cost, quantity],
    currentValue: value ? [value, ONE] : null,
    difference: difference ? [difference, ONE] : null,
    returnPercent: difference && cost.n !== 0n ? [mul(difference, HUNDRED), cost] : null,
  };
  return checkedFields.flatMap((field): SheetCheck[] => {
    const index = input.columns[field];
    if (index === undefined) return [];
    const sheet = input.cells[index];
    const app = exact[field];
    if (!app) return [{ field, sheet, app: null, result: 'unavailable' }];
    const [numerator, denominator] = app;
    const parsed = sheetNumber(sheet, input.decimalSeparator, field === 'returnPercent');
    if (!parsed)
      return [{ field, sheet, app: rounded(numerator, denominator, 2), result: 'unreadable' }];
    // |numerator/denominator - sheet| <= 0.5 * 10^-places, with a positive denominator.
    const gap = abs(sub(numerator, mul(parsed.value, denominator)));
    const tolerance = mul(denominator, { n: 5n, s: parsed.places + 1 });
    return [
      {
        field,
        sheet,
        app: rounded(numerator, denominator, parsed.places),
        result: lessOrEqual(gap, tolerance) ? 'match' : 'mismatch',
      },
    ];
  });
}

/** App value and unrealized result at an explicit price; return is null for zero cost. */
export function unrealizedAtPrice(quantity: string, costUsd: string, priceUsd: string) {
  const cost = decimal(costUsd);
  const value = mul(decimal(quantity), decimal(priceUsd));
  const result = sub(value, cost);
  return {
    valueUsd: format(value),
    unrealizedPnlUsd: format(result),
    unrealizedReturnPercent: cost.n === 0n ? null : rounded(mul(result, HUNDRED), cost, 2),
  };
}

export function sumDecimals(values: readonly string[]): string {
  return format(values.reduce((total, value) => add(total, decimal(value)), { n: 0n, s: 0 }));
}
