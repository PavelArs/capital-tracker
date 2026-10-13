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

  it('drops an answer that arrives after the page was left', async () => {
    const read = source();
    const { result, unmount } = renderHook(() => useCachedRead(read));
    unmount();
    await act(async () => read.asks[0].resolve('late'));
    expect(result.current.data).toBeNull();
  });
});
