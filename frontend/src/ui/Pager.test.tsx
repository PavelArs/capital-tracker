import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import Pager, { usePages } from './Pager';

function Numbers({ count, list }: { count?: number; list?: number[] }) {
  const items = list ?? Array.from({ length: count ?? 0 }, (_unused, index) => index + 1);
  const { rows, pager } = usePages(items, String);
  return (
    <>
      <ul>
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
      {pager && <Pager {...pager} label="numbers" />}
    </>
  );
}

const shown = () => screen.getAllByRole('listitem').map((row) => row.textContent);

afterEach(cleanup);

describe('PAGER a short list five rows at a time', () => {
  it('turns the pages five rows at a time and says which rows are on screen', async () => {
    const user = userEvent.setup();
    render(<Numbers count={12} />);
    expect(shown()).toEqual(['1', '2', '3', '4', '5']);
    expect(screen.getByRole('status')).toHaveTextContent('1–5 of 12 numbers');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(shown()).toEqual(['6', '7', '8', '9', '10']);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(shown()).toEqual(['11', '12']);
    expect(screen.getByRole('status')).toHaveTextContent('11–12 of 12 numbers');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(shown()).toEqual(['6', '7', '8', '9', '10']);
  });

  it('shows no pager when five rows or fewer fit on one page', () => {
    render(<Numbers count={5} />);
    expect(shown()).toHaveLength(5);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('opens the page a new row landed on, so a saved row is always in sight', async () => {
    // Codex P2: a movement saved while on page 2 lands on page 1 when it is the newest, and on a
    // later page when it is backdated.
    const user = userEvent.setup();
    const twelve = Array.from({ length: 12 }, (_unused, index) => (index + 1) * 10);
    const { rerender } = render(<Numbers list={twelve} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    rerender(<Numbers list={[5, ...twelve]} />);
    expect(shown()).toEqual(['5', '10', '20', '30', '40']);
    rerender(<Numbers list={[5, ...twelve.slice(0, 10), 105, ...twelve.slice(10)]} />);
    expect(shown()).toEqual(['100', '105', '110', '120']);
    expect(screen.getByRole('status')).toHaveTextContent('11–14 of 14 numbers');
  });

  it('keeps its page when a row goes, and stays on the last page when that one empties', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Numbers count={12} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    rerender(<Numbers count={11} />);
    expect(shown()).toEqual(['6', '7', '8', '9', '10']);
  });

  it('stays on the last page when the list shrinks', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Numbers count={12} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    rerender(<Numbers count={8} />);
    expect(shown()).toEqual(['6', '7', '8']);
  });
});
