import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoadMore, { PAGE_SIZE, useInfinite } from './InfiniteScroll';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const items = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe('useInfinite', () => {
  it('shows twenty rows and no more control for a list that fits', () => {
    expect(PAGE_SIZE).toBe(20);
    const short = renderHook(() => useInfinite(items(20)));
    expect(short.result.current.rows).toHaveLength(20);
    expect(short.result.current.more).toBeNull();
  });

  it('adds twenty rows each time the end is reached and never takes rows away', () => {
    const { result, rerender } = renderHook(({ count }) => useInfinite(items(count)), {
      initialProps: { count: 45 },
    });
    expect(result.current.rows).toEqual(items(20));
    expect(result.current.more).toMatchObject({ shown: 20, total: 45 });
    act(() => result.current.more?.onMore());
    expect(result.current.rows).toEqual(items(40));
    // More rows arrive in the list: the rows on screen stay.
    rerender({ count: 60 });
    expect(result.current.rows).toEqual(items(40));
    act(() => result.current.more?.onMore());
    act(() => result.current.more?.onMore());
    expect(result.current.rows).toEqual(items(60));
    expect(result.current.more).toBeNull();
  });

  it('starts again at twenty when the reset key changes', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useInfinite(items(60), { resetKey: key }),
      {
        initialProps: { key: 'all' },
      },
    );
    act(() => result.current.more?.onMore());
    expect(result.current.rows).toHaveLength(40);
    rerender({ key: 'search' });
    expect(result.current.rows).toHaveLength(20);
    act(() => result.current.more?.onMore());
    expect(result.current.rows).toHaveLength(40);
  });

  it('brings a row further down on screen, in whole steps of twenty', () => {
    const { result } = renderHook(() => useInfinite(items(100)));
    act(() => result.current.reveal(5));
    expect(result.current.rows).toHaveLength(20);
    act(() => result.current.reveal(44));
    expect(result.current.rows).toHaveLength(60);
    act(() => result.current.reveal(10));
    expect(result.current.rows).toHaveLength(60);
  });
});

describe('LoadMore', () => {
  it('says how much is shown and adds rows with the button', async () => {
    const user = userEvent.setup();
    const onMore = vi.fn();
    render(<LoadMore shown={20} total={45} onMore={onMore} label="things" />);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 20 of 45 things');
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it('omits the total when the end is not known and holds the button while reading', () => {
    render(<LoadMore shown={40} onMore={() => undefined} label="things" busy />);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 40 things');
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('asks for more when its end comes into view, and looks again after each batch', () => {
    const watching: Array<{ callback: IntersectionObserverCallback; disconnected: boolean }> = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        entry: (typeof watching)[number];
        constructor(callback: IntersectionObserverCallback) {
          this.entry = { callback, disconnected: false };
          watching.push(this.entry);
        }
        observe() {}
        disconnect() {
          this.entry.disconnected = true;
        }
        unobserve() {}
        takeRecords() {
          return [];
        }
      },
    );
    const onMore = vi.fn();
    const { rerender } = render(<LoadMore shown={20} total={60} onMore={onMore} label="things" />);
    const fire = (isIntersecting: boolean) =>
      act(() => {
        watching.at(-1)?.callback([{ isIntersecting } as IntersectionObserverEntry], {} as never);
      });
    fire(false);
    expect(onMore).not.toHaveBeenCalled();
    fire(true);
    expect(onMore).toHaveBeenCalledOnce();
    // The batch arrived: the old look is dropped and a new one begins.
    rerender(<LoadMore shown={40} total={60} onMore={onMore} label="things" />);
    expect(watching[0].disconnected).toBe(true);
    expect(watching).toHaveLength(2);
  });

  it('does not watch while rows are being read', () => {
    const constructed = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor() {
          constructed();
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<LoadMore shown={20} onMore={() => undefined} label="things" busy />);
    expect(constructed).not.toHaveBeenCalled();
  });
});
