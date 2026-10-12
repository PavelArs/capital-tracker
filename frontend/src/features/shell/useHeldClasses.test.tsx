import { accountingApi } from '@api/accounting.api';
import { forgetReads } from '@api/read-cache';
import { renderHook, waitFor } from '@testing-library/react';
import { act, StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHeldClasses } from './useHeldClasses';

const property = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio',
  kind: null,
  assetClass: 'property' as const,
  currentRevision: 1,
  createdAt: '2026-10-12T00:00:00Z',
};

describe('useHeldClasses (v8)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    forgetReads();
  });

  it('keeps the classes read on arrival, also when effects run twice', async () => {
    const list = vi
      .spyOn(accountingApi, 'listAccounts')
      .mockResolvedValue({ items: [property], nextCursor: null });
    const { result } = renderHook(() => useHeldClasses('/dashboard'), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.has('property')).toBe(true));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keeps a read that answers after the owner has moved on to another page', async () => {
    let answer: (value: { items: (typeof property)[]; nextCursor: null }) => void = () => {};
    vi.spyOn(accountingApi, 'listAccounts').mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const { result, rerender } = renderHook(({ path }) => useHeldClasses(path), {
      initialProps: { path: '/dashboard' },
    });
    rerender({ path: '/portfolio' });
    answer({ items: [property], nextCursor: null });
    await waitFor(() => expect(result.current.has('property')).toBe(true));
  });

  it('tries a failed read again on the next page', async () => {
    const list = vi
      .spyOn(accountingApi, 'listAccounts')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ items: [property], nextCursor: null });
    const { result, rerender } = renderHook(({ path }) => useHeldClasses(path), {
      initialProps: { path: '/dashboard' },
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    rerender({ path: '/portfolio' });
    await waitFor(() => expect(result.current.has('property')).toBe(true));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('ignores an older read that answers after a newer one', async () => {
    // Codex P2: a read started before the owner added a property must not hide it again.
    let older: (value: { items: (typeof property)[]; nextCursor: null }) => void = () => {};
    vi.spyOn(accountingApi, 'listAccounts')
      .mockImplementationOnce(() => new Promise((resolve) => (older = resolve)))
      .mockResolvedValue({ items: [property], nextCursor: null });
    const { result, rerender } = renderHook(({ path }) => useHeldClasses(path), {
      initialProps: { path: '/dashboard' },
    });
    forgetReads();
    rerender({ path: '/real-estate' });
    await waitFor(() => expect(result.current.has('property')).toBe(true));
    await act(async () => older({ items: [], nextCursor: null }));
    expect(result.current.has('property')).toBe(true);
  });
});
