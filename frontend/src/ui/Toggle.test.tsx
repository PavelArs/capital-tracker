import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle';

afterEach(cleanup);

function Form({ onChange }: { onChange?: (checked: boolean) => void }) {
  const [on, setOn] = useState(false);
  return (
    <>
      <Toggle
        id="count"
        checked={on}
        describedBy="count-hint"
        onChange={(checked) => {
          setOn(checked);
          onChange?.(checked);
        }}
      >
        Count as a deposit
      </Toggle>
      <p id="count-hint">Adds the amount to what you put in.</p>
    </>
  );
}

describe('Toggle', () => {
  it('is a native checkbox named by its label and described by the hint', () => {
    render(<Form />);
    const box = screen.getByRole('checkbox', { name: 'Count as a deposit' });
    expect(box).toHaveAttribute('id', 'count');
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription('Adds the amount to what you put in.');
  });

  it('turns on and off with a click on the label and with Space', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<Form onChange={change} />);
    await user.click(screen.getByText('Count as a deposit'));
    const box = screen.getByRole('checkbox', { name: 'Count as a deposit' });
    expect(box).toBeChecked();
    expect(change).toHaveBeenLastCalledWith(true);
    box.focus();
    await user.keyboard(' ');
    expect(box).not.toBeChecked();
    expect(change).toHaveBeenLastCalledWith(false);
  });

  it('cannot be changed while disabled', async () => {
    const change = vi.fn();
    render(
      <Toggle checked disabled onChange={change}>
        Include fees
      </Toggle>,
    );
    const box = screen.getByRole('checkbox', { name: 'Include fees' });
    expect(box).toBeDisabled();
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(change).not.toHaveBeenCalled();
  });
});
