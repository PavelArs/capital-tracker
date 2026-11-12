import type { KeyboardEvent, PointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { chartCursor, niceStep, valueAxis } from './chart';

describe('chart helpers', () => {
  it('rounds an axis step to 1, 2, 5 or 10 times a power of ten, and to 1 without a range', () => {
    expect([0.12, 0.2, 2.5, 4, 8, 40, 1250].map(niceStep)).toEqual([0.1, 0.2, 2, 5, 10, 50, 1000]);
    expect([0, -3, Number.NaN].map(niceStep)).toEqual([1, 1, 1]);
  });

  it('turns to the next round step at exactly 1.5, 3 and 7 times a power of ten', () => {
    expect([1.49, 1.5, 2.99, 3, 6.99, 7].map(niceStep)).toEqual([1, 2, 2, 5, 5, 10]);
    expect([149, 150, 299, 300, 699, 700].map(niceStep)).toEqual([100, 200, 200, 500, 500, 1000]);
  });

  it('reads the pointer against the box that listens, and from 0 when the box has no left edge', () => {
    let active: number | null = null;
    const { onPointerMove } = chartCursor({
      points: [{ time: 0 }, { time: 1 }, { time: 2 }],
      from: 2,
      left: 4,
      innerWidth: 100,
      start: 0,
      span: 2,
      setActive: (next) => {
        active = typeof next === 'function' ? next(active) : next;
      },
    });
    const move = (clientX: number, box: object, child: object) =>
      onPointerMove({
        clientX,
        currentTarget: { getBoundingClientRect: () => box },
        target: { getBoundingClientRect: () => child },
      } as unknown as PointerEvent<HTMLElement>);
    // The box starts at 100, so 154 is the middle of the plot; the child's 0 would read the end.
    move(154, { left: 100 }, { left: 0 });
    expect(active).toBe(1);
    move(54, {}, { left: -100 });
    expect(active).toBe(1);
  });

  it('widens the value axis to round steps and puts a tick on each', () => {
    // A range of 99 in four steps is 24.75 a step: 20, from -20 to 100.
    const { y, ticks } = valueAxis(-12, 87, 10, 200);
    expect(ticks).toEqual([-20, 0, 20, 40, 60, 80, 100]);
    expect([y(-20), y(0), y(100)]).toEqual([210, 176.66666666666669, 10]);
  });

  it('keeps the known issue of the key lookup: a key named after an Object.prototype member counts as a move', () => {
    // React reads such a key as the member itself, so no chart receives one; called directly,
    // moves[event.key] finds the inherited function, the key is prevented and no point stays read.
    let active: number | null = 1;
    const { onKeyDown } = chartCursor({
      points: [{ time: 0 }, { time: 1 }, { time: 2 }],
      from: 2,
      left: 4,
      innerWidth: 100,
      start: 0,
      span: 2,
      setActive: (next) => {
        active = typeof next === 'function' ? next(active) : next;
      },
    });
    const event = { key: 'toString', preventDefault: vi.fn() };
    onKeyDown(event as unknown as KeyboardEvent<HTMLElement>);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(active).toBeNaN();
  });
});
