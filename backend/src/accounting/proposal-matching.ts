// XFER-PROPOSED and CLS-DUPLICATE match legs against candidates and offer a pair only when each
// side is the other's single closest candidate. Both share the bookkeeping and the work bound
// below, so an account with a very dense history stays cheap to read.

/**
 * The most candidate pairs one proposal read compares in one group (one coin; one account, coin
 * and way), and in all groups together. A group over the bound offers nothing: the owner
 * classifies those transactions by hand, as before; no pair is guessed and no transaction is lost.
 */
export const MAX_GROUP_COMPARISONS = 500_000;
export const MAX_TOTAL_COMPARISONS = 2_000_000;

/**
 * Keeps, for each key, the single closest edge seen and whether another edge is exactly as
 * close. Memory is one entry per key however many edges are offered. `compare` is negative when
 * its first edge is closer, positive when farther and zero when the two are equally close.
 */
export class ClosestEdges<K, E> {
  private readonly held = new Map<K, { edge: E; tied: boolean }>();

  constructor(private readonly compare: (left: E, right: E) => number) {}

  offer(key: K, edge: E): void {
    const current = this.held.get(key);
    if (current === undefined) {
      this.held.set(key, { edge, tied: false });
      return;
    }
    const order = this.compare(edge, current.edge);
    if (order < 0) this.held.set(key, { edge, tied: false });
    else if (order === 0) current.tied = true;
  }

  /** The closest edge of the key, or undefined when none was offered or two were equally close. */
  closest(key: K): E | undefined {
    const current = this.held.get(key);
    return current === undefined || current.tied ? undefined : current.edge;
  }

  /** Every key's closest edge that has no equally close rival. */
  *unique(): IterableIterator<E> {
    for (const { edge, tied } of this.held.values()) if (!tied) yield edge;
  }
}

/** The first index of the sorted list whose value is not below `target`. */
export function lowerBound<T>(sorted: readonly T[], value: (item: T) => number, target: number) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (value(sorted[middle]) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The first index of the sorted list whose value is above `target`. */
export function upperBound<T>(sorted: readonly T[], value: (item: T) => number, target: number) {
  return lowerBound(sorted, value, target + 1);
}

/**
 * Which of the groups fit the work bound: the cheapest first, until a group exceeds its own
 * bound or the total would. Deterministic, and a spam of one coin cannot starve another.
 */
export function withinBudget(work: readonly number[]): boolean[] {
  const allowed = work.map(() => false);
  let spent = 0;
  const order = work.map((_cost, index) => index).sort((left, right) => work[left] - work[right]);
  for (const index of order) {
    if (work[index] > MAX_GROUP_COMPARISONS || spent + work[index] > MAX_TOTAL_COMPARISONS) break;
    spent += work[index];
    allowed[index] = true;
  }
  return allowed;
}
