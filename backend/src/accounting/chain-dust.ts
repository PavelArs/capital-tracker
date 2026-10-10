// CLS-DUST: a receipt worth less than the owner's dust threshold is not worth asking about.
// It is a status of the list only: the raw row and any answer stay as they are, and the coins
// still count like any unanswered movement (D1), so the wallet balance stays in step.

/** A non-negative decimal of up to 60 places as scale-60 atoms. */
function scale60(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 60n + BigInt(fraction.padEnd(60, '0'));
}

/**
 * Whether a chain leg nobody has answered is dust. A leg of a token the address leaves out
 * (TOKEN-HIDE) is, whichever way it went; that covers the tokens no price source lists and the
 * ones the owner hid, and a token the owner brought back asks again. Otherwise it is incoming
 * and worth less than the threshold at the price stored for its time (EST-AT-TIME). Without a
 * threshold, or a price, a leg is never dust, and what the owner sent always asks, however small.
 */
export function isDust(
  direction: 'in' | 'out' | 'self',
  estimatedValueUsd: string | null,
  thresholdUsd: string | null,
  hiddenToken = false,
): boolean {
  if (hiddenToken) return true;
  if (direction !== 'in') return false;
  if (estimatedValueUsd === null || thresholdUsd === null) return false;
  return scale60(estimatedValueUsd) < scale60(thresholdUsd);
}
