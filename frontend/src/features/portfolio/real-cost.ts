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
