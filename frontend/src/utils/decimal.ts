// Exact arithmetic on the decimal strings the API returns, without binary floating point.

const SCALE = 30;
const units = (value: string) => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[-+]/, '').split('.');
  const scaled = BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -scaled : scaled;
};

const text = (total: bigint) => {
  const digits = (total < 0n ? -total : total).toString().padStart(SCALE + 1, '0');
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  return `${total < 0n ? '-' : ''}${digits.slice(0, -SCALE)}${fraction ? `.${fraction}` : ''}`;
};

/** The exact sum of decimal strings, without binary floating point. */
export function sumDecimals(values: readonly string[]): string {
  return text(values.reduce((sum, value) => sum + units(value), 0n));
}

/** The exact product of two non-negative decimal strings, cut down to `places` decimals. */
export function productDown(left: string, right: string, places: number): string {
  const product = units(left) * units(right); // 2 * SCALE decimals
  return text((product / 10n ** BigInt(2 * SCALE - places)) * 10n ** BigInt(SCALE - places));
}

/** The exact product of two decimal strings, or null when it needs more than `places` decimals. */
export function exactProduct(left: string, right: string, places: number): string | null {
  if (![left, right].every((value) => (value.split('.')[1] ?? '').length <= SCALE)) return null;
  const product = units(left) * units(right); // 2 * SCALE decimals
  if (product % 10n ** BigInt(2 * SCALE - places) !== 0n) return null;
  return text(product / 10n ** BigInt(SCALE));
}
