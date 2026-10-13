/**
 * What inflation added to the cost: the real cost less the paid cost, both nonnegative decimal
 * strings, exact to every digit (the amounts may be wider than a float holds) and negative
 * when prices fell.
 */
export function inflationAdjustment(real: string, paid: string): string {
  const [realWhole, realFraction = ''] = real.split('.');
  const [paidWhole, paidFraction = ''] = paid.split('.');
  const places = Math.max(realFraction.length, paidFraction.length);
  const scaled = (whole: string, fraction: string) => BigInt(whole + fraction.padEnd(places, '0'));
  const difference = scaled(realWhole, realFraction) - scaled(paidWhole, paidFraction);
  const sign = difference < 0n ? '-' : '';
  const digits = String(difference < 0n ? -difference : difference).padStart(places + 1, '0');
  if (places === 0) return `${sign}${digits}`;
  const fraction = digits.slice(-places).replace(/0+$/, '');
  const whole = digits.slice(0, -places);
  return fraction ? `${sign}${whole}.${fraction}` : difference === 0n ? '0' : `${sign}${whole}`;
}
