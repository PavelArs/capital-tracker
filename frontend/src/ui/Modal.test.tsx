import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Modal from './Modal';

afterEach(cleanup);

function Page({ onEscape }: { onEscape?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal titleId="t" onEscape={onEscape}>
          <h2 id="t">Rename</h2>
          <button type="button">First</button>
          <input aria-label="Name" />
          <button type="button" disabled>
            Busy
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Last
          </button>
        </Modal>
      )}
    </>
  );
}

describe('Modal', () => {
  it('names the dialog by its heading and starts on the first control', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Rename' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside, skipping disabled controls', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });

  it('closes on Escape only when it is allowed to', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const { rerender } = render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    expect(close).not.toHaveBeenCalled();
    rerender(<Page onEscape={close} />);
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('gives the keyboard back to what opened it', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Last' }));
    expect(opener).toHaveFocus();
  });

  it('can start elsewhere and be an alert dialog', () => {
    render(
      <Modal
        titleId="t"
        role="alertdialog"
        describedBy="d"
        initialFocus={(root) => root.querySelector('input')}
      >
        <h2 id="t">Remove</h2>
        <p id="d">This cannot be undone.</p>
        <button type="button">Cancel</button>
        <input aria-label="Type to confirm" />
      </Modal>,
    );
    expect(screen.getByRole('alertdialog', { name: 'Remove' })).toHaveAccessibleDescription(
      'This cannot be undone.',
    );
    expect(screen.getByLabelText('Type to confirm')).toHaveFocus();
  });
});
