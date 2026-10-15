import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCachedRead } from './useCachedRead';

afterEach(cleanup);

function source(kept?: string) {
  const asks: Array<{ resolve: (value: string) => void; reject: (reason: unknown) => void }> = [];
  const last = vi.fn((..._args: string[]) => kept);
  const load = vi.fn(
    (..._args: string[]) =>
      new Promise<string>((resolve, reject) => {
        asks.push({ resolve, reject });
      }),
  );
  return { last, load, asks };
}

describe('READ-HOOK-STALE: figures whose refresh failed', () => {
  it('warns about kept figures whose refresh failed before, until an answer replaces them', async () => {
    const read = { ...source('kept'), failed: vi.fn(() => true) };
    const { result } = renderHook(() => useCachedRead(read, 'a'));
    expect(result.current.data).toBe('kept');
    expect(result.current.stale).toBe(true);
    expect(read.failed).toHaveBeenCalledWith('a');
    read.failed.mockReturnValue(false);
    await act(async () => read.asks[0].resolve('fresh'));
    expect(result.current.stale).toBe(false);
  });

  it('warns when a load fails while figures are shown, not when there are none', async () => {
    const shown = source('kept');
    const { result } = renderHook(() => useCachedRead(shown));
    await act(async () => shown.asks[0].reject(new Error('offline')));
    expect(result.current.stale).toBe(true);
    const empty = source();
    const { result: none } = renderHook(() => useCachedRead(empty));
    await act(async () => empty.asks[0].reject(new Error('offline')));
    expect(none.current.error).not.toBeNull();
    expect(none.current.stale).toBe(false);
  });

  it('keeps the warning through a quiet retry after the cache dropped the figures shown', async () => {
    const read = source('kept');
    const { result } = renderHook(() => useCachedRead(read));
    await act(async () => read.asks[0].reject(new Error('offline')));
    expect(result.current.stale).toBe(true);
    // A sync emptied the cache (or the figures grew too old to keep); the page still shows them.
    read.last.mockReturnValue(undefined);
    act(() => result.current.reload(true));
    expect(result.current.data).toBe('kept');
    expect(result.current.error).toBeNull();
    expect(result.current.stale).toBe(true);
    await act(async () => read.asks[1].resolve('fresh'));
    expect(result.current.stale).toBe(false);
  });

  it('does not warn about an answer the page got elsewhere', async () => {
    const read = { ...source('kept'), failed: () => true };
    const { result } = renderHook(() => useCachedRead(read));
    act(() => result.current.replace('saved'));
    expect(result.current.data).toBe('saved');
    expect(result.current.stale).toBe(false);
  });
});

describe('READ-HOOK: the way a page reads', () => {
  it('shows the last answer at once and the server answer when it arrives', async () => {
    const read = source('kept');
    const { result } = renderHook(() => useCachedRead(read, 'a'));
    expect(result.current.data).toBe('kept');
    expect(read.load).toHaveBeenCalledWith('a');
    await act(async () => read.asks[0].resolve('fresh'));
    expect(result.current.data).toBe('fresh');
    expect(result.current.error).toBeNull();
  });

  it('has nothing to show until the first answer when nothing was kept', async () => {
    const read = source();
    const { result } = renderHook(() => useCachedRead(read));
    expect(result.current.data).toBeNull();
    await act(async () => read.asks[0].resolve('fresh'));
    expect(result.current.data).toBe('fresh');
  });

  it('keeps what is shown when a load fails, and reports why', async () => {
    const read = source('kept');
    const { result } = renderHook(() => useCachedRead(read));
    const failure = new Error('offline');
    await act(async () => read.asks[0].reject(failure));
    expect(result.current.data).toBe('kept');
    expect(result.current.error).toBe(failure);
  });

  it('lets only the newest load change the page', async () => {
    const read = source();
    const { result } = renderHook(() => useCachedRead(read));
    act(() => result.current.reload(true));
    await act(async () => read.asks[1].resolve('newer'));
    await act(async () => read.asks[0].resolve('older'));
    expect(result.current.data).toBe('newer');
  });

  it('keeps the answer on a quiet reload and drops it on a plain one', async () => {
    const read = source();
    const { result } = renderHook(() => useCachedRead(read));
    await act(async () => read.asks[0].resolve('first'));
    act(() => result.current.reload(true));
    expect(result.current.data).toBe('first');
    act(() => result.current.reload());
    expect(result.current.data).toBeNull();
    await act(async () => read.asks[2].resolve('third'));
    expect(result.current.data).toBe('third');
  });

  it('shows an answer the page got elsewhere and ignores the load still on its way', async () => {
    const read = source();
    const { result } = renderHook(() => useCachedRead(read));
    act(() => result.current.replace('saved'));
    await act(async () => read.asks[0].resolve('stale'));
    expect(result.current.data).toBe('saved');
  });

  it('loads again for other arguments and never shows the old ones', async () => {
    const read = source();
    const { result, rerender } = renderHook(({ id }) => useCachedRead(read, id), {
      initialProps: { id: 'a' },
    });
    await act(async () => read.asks[0].resolve('answer a'));
    rerender({ id: 'b' });
    await waitFor(() => expect(read.load).toHaveBeenLastCalledWith('b'));
    expect(result.current.data).toBeNull();
    await act(async () => read.asks[0].resolve('late a'));
    await act(async () => read.asks[1].resolve('answer b'));
    expect(result.current.data).toBe('answer b');
  });

  it('never shows the answer of the old arguments, not even for one render', async () => {
    const read = source();
    const shown: Array<string | null> = [];
    const { rerender } = renderHook(
      ({ id }) => {
        const { data } = useCachedRead(read, id);
        shown.push(data);
        return data;
      },
      { initialProps: { id: 'a' } },
    );
    await act(async () => read.asks[0].resolve('answer a'));
    shown.length = 0;
    rerender({ id: 'b' });
    expect(shown).not.toContain('answer a');
    expect(shown[0]).toBeNull();
  });

  it('shows the kept answer of the new arguments at once', async () => {
    const kept: Record<string, string> = { b: 'kept b' };
    const read = { ...source(), last: vi.fn((id: string) => kept[id]) };
    const { result, rerender } = renderHook(({ id }) => useCachedRead(read, id), {
      initialProps: { id: 'a' },
    });
    rerender({ id: 'b' });
    expect(result.current.data).toBe('kept b');
  });

  it('drops an answer that arrives after the page was left', async () => {
    const read = source();
    const { result, unmount } = renderHook(() => useCachedRead(read));
    unmount();
    await act(async () => read.asks[0].resolve('late'));
    expect(result.current.data).toBeNull();
  });
});
