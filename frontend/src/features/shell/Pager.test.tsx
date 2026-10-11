import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Pager, { PAGE_SIZE, usePaged } from './Pager';

afterEach(cleanup);

const items = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe('usePaged', () => {
  it('cuts a list into pages of twenty and has no pager for one page', () => {
    expect(PAGE_SIZE).toBe(20);
    const short = renderHook(() => usePaged(items(20)));
    expect(short.result.current.rows).toHaveLength(20);
    expect(short.result.current.pager).toBeNull();

    const long = renderHook(() => usePaged(items(45)));
    expect(long.result.current.rows).toEqual(items(20));
    expect(long.result.current.pager).toMatchObject({ page: 1, total: 45, hasNext: true });
    act(() => long.result.current.setPage(3));
    expect(long.result.current.rows).toEqual([41, 42, 43, 44, 45]);
    expect(long.result.current.pager).toMatchObject({ page: 3, hasNext: false });
  });

  it('falls back to the last page when the list shrinks under the page', () => {
    const { result, rerender } = renderHook(({ count }) => usePaged(items(count)), {
      initialProps: { count: 45 },
    });
    act(() => result.current.setPage(3));
    rerender({ count: 25 });
    expect(result.current.page).toBe(2);
    expect(result.current.rows).toEqual([21, 22, 23, 24, 25]);
    rerender({ count: 5 });
    expect(result.current.page).toBe(1);
    expect(result.current.pager).toBeNull();
  });

  it('goes back to the first page when the reset key changes', () => {
    const { result, rerender } = renderHook(({ key }) => usePaged(items(45), { resetKey: key }), {
      initialProps: { key: 'all' },
    });
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
    rerender({ key: 'search' });
    expect(result.current.page).toBe(1);
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
  });

  it('can keep the page elsewhere, like the address', () => {
    const onPage = vi.fn();
    const { result } = renderHook(() => usePaged(items(45), { page: 2, onPage }));
    expect(result.current.rows).toEqual(items(40).slice(20));
    act(() => result.current.setPage(3));
    expect(onPage).toHaveBeenCalledWith(3);
    expect(result.current.page).toBe(2);
  });

  it('says which page a row falls on', () => {
    const { result } = renderHook(() => usePaged(items(45)));
    expect(result.current.pageOf(0)).toBe(1);
    expect(result.current.pageOf(19)).toBe(1);
    expect(result.current.pageOf(20)).toBe(2);
    expect(result.current.pageOf(44)).toBe(3);
  });
});

describe('Pager', () => {
  it('names the page and the rows on it and disables what leads nowhere', async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    render(<Pager page={2} total={45} hasNext onPage={onPage} label="things" />);
    const nav = screen.getByRole('navigation', { name: 'Pages of things' });
    expect(nav).toHaveTextContent('21–40 of 45Page 2 of 3');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPage.mock.calls).toEqual([[3], [1]]);
  });

  it('shows only the page when the end is not known and can be held while reading', () => {
    render(<Pager page={4} hasNext={false} onPage={() => undefined} label="things" busy />);
    expect(screen.getByText('Page 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
