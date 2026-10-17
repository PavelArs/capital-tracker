import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chip, ChipGroup } from './Chip';

afterEach(cleanup);

describe('Chip', () => {
  it('a filter chip is a toggle button that says whether it is on', async () => {
    const click = vi.fn();
    const { rerender } = render(
      <Chip pressed={false} onClick={click}>
        Crypto
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Crypto' });
    expect(chip).toHaveAttribute('type', 'button');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(click).toHaveBeenCalledOnce();
    rerender(
      <Chip pressed onClick={click}>
        Crypto
      </Chip>,
    );
    expect(screen.getByRole('button', { name: 'Crypto' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a quick pick without `pressed` is a plain action button', () => {
    render(<Chip onClick={() => {}}>Use your 6-month average</Chip>);
    expect(screen.getByRole('button', { name: 'Use your 6-month average' })).not.toHaveAttribute(
      'aria-pressed',
    );
  });

  it('reads the count with what it counts, and shows the number amber by default', () => {
    render(
      <Chip pressed={false} count={3} countLabel="3 to classify" onClick={() => {}}>
        Needs classification
      </Chip>,
    );
    const chip = screen.getByRole('button', {
      name: 'Needs classification, 3 to classify',
    });
    const count = chip.querySelector('.ui-chip__count');
    expect(count).toHaveTextContent('3');
    expect(count).toHaveClass('ui-chip__count--warn');
  });

  it('a muted count is a plain number in the name', () => {
    render(
      <Chip pressed count={12} countTone="muted" onClick={() => {}}>
        Stocks
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Stocks 12' });
    expect(chip.querySelector('.ui-chip__count')).not.toHaveClass('ui-chip__count--warn');
  });
});

describe('ChipGroup', () => {
  it('groups its chips under a name', () => {
    render(
      <ChipGroup label="Asset class">
        <Chip pressed onClick={() => {}}>
          All
        </Chip>
        <Chip pressed={false} onClick={() => {}}>
          Crypto
        </Chip>
      </ChipGroup>,
    );
    const group = screen.getByRole('group', { name: 'Asset class' });
    expect(within(group).getAllByRole('button')).toHaveLength(2);
  });
});
