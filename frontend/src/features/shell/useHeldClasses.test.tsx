import { accountingApi } from '@api/accounting.api';
import { forgetReads } from '@api/read-cache';
import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
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
});
