import { FifoHistoryError } from './fifo';
import { intervalCost, lotInterval, takePrefix } from './fifo-lot-interval';

describe('FIFO-RANGE-PARTITION original quantity coordinates', () => {
  it('retains the independently calculated7/11 atom partition4,2,5', () => {
    const original = Object.freeze(lotInterval(7n, 11n));
    const { taken: first, remainder } = takePrefix(original, 3n);
    const { taken: middle, remainder: last } = takePrefix(remainder, 1n);
    expect([first, middle, last].map(intervalCost)).toEqual([4n, 2n, 5n]);
    expect(middle).toEqual({ originalQuantity: 7n, originalCost: 11n, start: 3n, end: 4n });
    expect(original).toEqual({ originalQuantity: 7n, originalCost: 11n, start: 0n, end: 7n });
    expect(intervalCost(original)).toBe(11n);
  });

  it('preserves the carry-in suffix phase1,0,1 without rebasing3/2', () => {
    let held = lotInterval(4n, 2n, 1n);
    const costs: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      const split = takePrefix(held, 1n);
      costs.push(intervalCost(split.taken));
      held = split.remainder;
    }
    expect(costs).toEqual([1n, 0n, 1n]);
    expect(held).toEqual({ originalQuantity: 4n, originalCost: 2n, start: 4n, end: 4n });
    expect(intervalCost(held)).toBe(0n);
  });

  it('conserves every cost atom across all small whole-lot partitions', () => {
    for (let quantity = 1n; quantity <= 16n; quantity++) {
      for (let cost = 0n; cost <= 16n; cost++) {
        const full = lotInterval(quantity, cost);
        for (let cut = 1n; cut <= quantity; cut++) {
          const split = takePrefix(full, cut);
          expect(intervalCost(split.taken) + intervalCost(split.remainder)).toBe(cost);
          let slicedCost = 0n;
          let held = full;
          while (held.start < held.end) {
            const next = takePrefix(held, 1n);
            slicedCost += intervalCost(next.taken);
            held = next.remainder;
          }
          expect(slicedCost).toBe(cost);
        }
      }
    }
  });

  it('preserves fragment cost under further splits and out-of-order inspection', () => {
    const fragment = Object.freeze(lotInterval(7n, 11n, 2n, 6n));
    const split = takePrefix(fragment, 2n);
    const nested = takePrefix(split.taken, 1n);
    expect([split.remainder, nested.taken, nested.remainder].map(intervalCost)).toEqual([
      3n,
      1n,
      2n,
    ]);
    expect(intervalCost(fragment)).toBe(6n);
    expect(fragment.start).toBe(2n);
    expect(fragment.end).toBe(6n);
  });

  it('retains full precision and the final atom after a156-digit product', () => {
    const maximum = 10n ** 78n - 1n;
    const split = takePrefix(lotInterval(maximum, maximum), maximum - 1n);
    expect(intervalCost(split.taken)).toBe(maximum - 1n);
    expect(intervalCost(split.remainder)).toBe(1n);
  });
});

describe('FIFO-RANGE-BOUNDS shared history error and immutable split', () => {
  it.each([
    [0n, 1n, 0n, 0n],
    [-1n, 1n, 0n, 0n],
    [1n, -1n, 0n, 1n],
    [2n, 1n, -1n, 1n],
    [2n, 1n, 0n, 3n],
    [2n, 1n, 2n, 1n],
  ])('rejects invalid interval%# with the existing history error', (q, c, start, end) => {
    expect(() => lotInterval(q, c, start, end)).toThrow(FifoHistoryError);
    const invalid = { originalQuantity: q, originalCost: c, start, end };
    expect(() => intervalCost(invalid)).toThrow(FifoHistoryError);
    expect(() => takePrefix(invalid, 1n)).toThrow(FifoHistoryError);
  });
  it.each([0n, -1n, 3n])('rejects invalid prefix%s', (quantity) => {
    expect(() => takePrefix(lotInterval(7n, 11n, 3n, 5n), quantity)).toThrow(FifoHistoryError);
  });
  it('permits an empty zero-cost remainder but no positive take from it', () => {
    const full = Object.freeze(lotInterval(7n, 11n, 3n, 5n));
    const split = takePrefix(full, 2n);
    expect(split.taken).toEqual(full);
    expect(split.taken).not.toBe(full);
    expect(intervalCost(split.remainder)).toBe(0n);
    expect(() => takePrefix(split.remainder, 1n)).toThrow(FifoHistoryError);
  });
});
