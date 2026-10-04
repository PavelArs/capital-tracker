const ATOM_SCALE = 10n ** 30n;
export const MAX_INPUT_ATOMS = 10n ** 78n - 1n;

/** Input has already passed the nonnegative, scale-30 decimal boundary. */
export function canonicalDecimalToAtoms(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * ATOM_SCALE + BigInt(fraction.padEnd(30, '0'));
}

/** Derived values may be signed and wider than the stored input precision. */
export function formatAtoms(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  const whole = (magnitude / ATOM_SCALE).toString();
  const fraction = (magnitude % ATOM_SCALE).toString().padStart(30, '0').replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** A product of two nonnegative scale30 inputs retains all60 fractional places. */
export function formatProduct(value: bigint): string {
  const digits = value.toString().padStart(61, '0');
  const fraction = digits.slice(-60).replace(/0+$/, '');
  return `${digits.slice(0, -60)}${fraction ? `.${fraction}` : ''}`;
}

/** Signed scale60 difference of products and lifted scale30 amounts. */
export function formatSignedProduct(value: bigint): string {
  return value < 0n ? `-${formatProduct(-value)}` : formatProduct(value);
}

/** Display ratio numerator/denominator*100, half away from zero, two fixed places. */
export function formatPercent(numerator: bigint, denominator: bigint): string {
  const negative = numerator < 0n !== denominator < 0n;
  const top = (numerator < 0n ? -numerator : numerator) * 10000n;
  const bottom = denominator < 0n ? -denominator : denominator;
  const hundredths = (top * 2n + bottom) / (bottom * 2n);
  const whole = (hundredths / 100n).toString();
  const fraction = (hundredths % 100n).toString().padStart(2, '0');
  return `${negative && hundredths > 0n ? '-' : ''}${whole}.${fraction}`;
}
