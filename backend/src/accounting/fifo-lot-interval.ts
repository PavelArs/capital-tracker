/** A half-open portion of an original FIFO lot, in integer atomic units. */
export interface LotInterval {
  readonly originalQuantity: bigint;
  readonly originalCost: bigint;
  readonly start: bigint;
  readonly end: bigint;
}

export class FifoHistoryError extends Error {
  constructor() {
    super('Invalid trade history');
    this.name = 'FifoHistoryError';
  }
}

function validateInterval(interval: LotInterval): void {
  if (
    typeof interval.originalQuantity !== 'bigint' ||
    typeof interval.originalCost !== 'bigint' ||
    typeof interval.start !== 'bigint' ||
    typeof interval.end !== 'bigint' ||
    interval.originalQuantity <= 0n ||
    interval.originalCost < 0n ||
    interval.start < 0n ||
    interval.end < interval.start ||
    interval.end > interval.originalQuantity
  )
    throw new FifoHistoryError();
}

export function lotInterval(
  originalQuantity: bigint,
  originalCost: bigint,
  start = 0n,
  end = originalQuantity,
): LotInterval {
  const interval = { originalQuantity, originalCost, start, end };
  validateInterval(interval);
  return interval;
}

export function intervalCost(interval: LotInterval): bigint {
  validateInterval(interval);
  const { originalQuantity, originalCost, start, end } = interval;
  return (originalCost * end) / originalQuantity - (originalCost * start) / originalQuantity;
}

export function takePrefix(
  interval: LotInterval,
  quantity: bigint,
): { readonly taken: LotInterval; readonly remainder: LotInterval } {
  validateInterval(interval);
  if (typeof quantity !== 'bigint' || quantity <= 0n || quantity > interval.end - interval.start)
    throw new FifoHistoryError();

  const split = interval.start + quantity;
  return {
    taken: lotInterval(interval.originalQuantity, interval.originalCost, interval.start, split),
    remainder: lotInterval(interval.originalQuantity, interval.originalCost, split, interval.end),
  };
}
