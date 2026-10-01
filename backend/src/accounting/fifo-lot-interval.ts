/** A half-open portion of an original FIFO lot, in integer atomic units. */
export interface LotInterval {
  readonly originalQuantity: bigint;
  readonly originalCost: bigint | null;
  readonly start: bigint;
  readonly end: bigint;
}
export interface KnownLotInterval extends LotInterval {
  readonly originalCost: bigint;
}
export interface UnknownLotInterval extends LotInterval {
  readonly originalCost: null;
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
    (interval.originalCost !== null && typeof interval.originalCost !== 'bigint') ||
    typeof interval.start !== 'bigint' ||
    typeof interval.end !== 'bigint' ||
    interval.originalQuantity <= 0n ||
    (interval.originalCost !== null && interval.originalCost < 0n) ||
    interval.start < 0n ||
    interval.end < interval.start ||
    interval.end > interval.originalQuantity
  )
    throw new FifoHistoryError();
}

export function lotInterval(
  originalQuantity: bigint,
  originalCost: bigint,
  start?: bigint,
  end?: bigint,
): KnownLotInterval;
export function lotInterval(
  originalQuantity: bigint,
  originalCost: null,
  start?: bigint,
  end?: bigint,
): UnknownLotInterval;
export function lotInterval(
  originalQuantity: bigint,
  originalCost: bigint | null,
  start?: bigint,
  end?: bigint,
): LotInterval;
export function lotInterval(
  originalQuantity: bigint,
  originalCost: bigint | null,
  start = 0n,
  end = originalQuantity,
): LotInterval {
  const interval = { originalQuantity, originalCost, start, end };
  validateInterval(interval);
  return interval;
}

export function intervalCost(interval: KnownLotInterval): bigint;
export function intervalCost(interval: UnknownLotInterval): null;
export function intervalCost(interval: LotInterval): bigint | null;
export function intervalCost(interval: LotInterval): bigint | null {
  validateInterval(interval);
  const { originalQuantity, originalCost, start, end } = interval;
  if (originalCost === null) return null;
  return (originalCost * end) / originalQuantity - (originalCost * start) / originalQuantity;
}

export function takePrefix(
  interval: KnownLotInterval,
  quantity: bigint,
): { readonly taken: KnownLotInterval; readonly remainder: KnownLotInterval };
export function takePrefix(
  interval: UnknownLotInterval,
  quantity: bigint,
): { readonly taken: UnknownLotInterval; readonly remainder: UnknownLotInterval };
export function takePrefix(
  interval: LotInterval,
  quantity: bigint,
): { readonly taken: LotInterval; readonly remainder: LotInterval };
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
