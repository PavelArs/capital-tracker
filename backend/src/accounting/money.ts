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
