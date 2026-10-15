// Exact arithmetic on the decimal strings the API returns, without binary floating point.

const SCALE = 30;
const units = (value: string) => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[-+]/, '').split('.');
  const scaled = BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -scaled : scaled;
};

/** The exact sum of decimal strings, without binary floating point. */
export function sumDecimals(values: readonly string[]): string {
  const total = values.reduce((sum, value) => sum + units(value), 0n);
  const digits = (total < 0n ? -total : total).toString().padStart(SCALE + 1, '0');
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  return `${total < 0n ? '-' : ''}${digits.slice(0, -SCALE)}${fraction ? `.${fraction}` : ''}`;
}
