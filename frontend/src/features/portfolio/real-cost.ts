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

const PLAIN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Orders two signed decimal strings exactly, negative when `left` is smaller. Amounts the
 * backend permits are wider than a float, so equal-looking floats must not tie. Anything that
 * is not a plain decimal falls back to the numbers they read as.
 */
export function compareDecimals(left: string, right: string): number {
  const a = PLAIN.exec(left);
  const b = PLAIN.exec(right);
  if (a === null || b === null) return Number(left) - Number(right);
  const places = Math.max(a[3]?.length ?? 0, b[3]?.length ?? 0);
  const scaled = (match: RegExpExecArray) => {
    const magnitude = BigInt(match[2] + (match[3] ?? '').padEnd(places, '0'));
    return match[1] === '-' ? -magnitude : magnitude;
  };
  const difference = scaled(a) - scaled(b);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
