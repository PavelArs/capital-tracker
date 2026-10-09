// CLS-DUST: a receipt worth less than the owner's dust threshold is not worth asking about.
// It is a status of the list only: the raw row and any answer stay as they are, and the coins
// still count like any unanswered movement (D1), so the wallet balance stays in step.

/** A non-negative decimal of up to 60 places as scale-60 atoms. */
function scale60(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 60n + BigInt(fraction.padEnd(60, '0'));
}

/**
 * Whether a chain leg nobody has answered is dust: incoming, priced, and worth less than the
 * threshold at the price stored for its time (EST-AT-TIME). Without a threshold nothing is
 * dust, and what the owner sent always asks, however small. Without a price a receipt is dust
 * only when it is a token no price source lists (TOKEN-ANY): the airdrops scam tokens send.
 */
export function isDust(
  direction: 'in' | 'out' | 'self',
  estimatedValueUsd: string | null,
  thresholdUsd: string | null,
  unlistedToken = false,
): boolean {
  if (thresholdUsd === null || direction !== 'in') return false;
  if (estimatedValueUsd === null) return unlistedToken;
  return scale60(estimatedValueUsd) < scale60(thresholdUsd);
}
