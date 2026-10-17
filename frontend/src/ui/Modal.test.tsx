import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Modal, { ModalBody, ModalHeader } from './Modal';

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
  it('keeps the page behind still while any dialog is open', async () => {
    const user = userEvent.setup();
    const locked = () => document.documentElement.classList.contains('ui-scroll-locked');
    const { rerender } = render(<Page />);
    expect(locked()).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(locked()).toBe(true);
    // A second dialog over the first: closing it leaves the first one's lock.
    rerender(
      <>
        <Page />
        <Modal titleId="c">
          <h2 id="c">Confirm</h2>
        </Modal>
      </>,
    );
    rerender(<Page />);
    expect(locked()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Last' }));
    expect(locked()).toBe(false);
  });

  it('MODAL-FOCUS names the dialog by its heading and starts on its first field', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Rename' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('MODAL-FOCUS without a field starts on the first choice, never on the close button', () => {
    render(
      <Modal titleId="t">
        <ModalHeader titleId="t" title="Add to portfolio" onClose={() => undefined} />
        <ModalBody>
          <button type="button" aria-pressed="false">
            Crypto wallet
          </button>
        </ModalBody>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: /^Crypto wallet/ })).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside, skipping disabled controls', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // From the first control, Shift+Tab wraps to the last one.
    act(() => screen.getByRole('button', { name: 'First' }).focus());
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

  it('auth-02 keeps Tab inside when the focused control was disabled and the keyboard fell to the page', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Behind</button>
        <Modal titleId="t">
          <h2 id="t">Set up again</h2>
          <input aria-label="Code" />
          <button type="button">Continue</button>
        </Modal>
      </>,
    );
    // A submit button that turns disabled while busy drops the keyboard to the body.
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Code')).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
  });

  it('auth-02 brings Tab back inside from a control behind the scrim', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <Modal titleId="t">
          <h2 id="t">Generate new codes</h2>
          <input aria-label="Code" />
          <button type="button">Generate</button>
        </Modal>
        <button type="button">After</button>
      </>,
    );
    screen.getByRole('button', { name: 'After' }).focus();
    await user.tab();
    expect(screen.getByLabelText('Code')).toHaveFocus();
  });

  it('goals-01 starts on the first control when the chosen start is not in the dialog', () => {
    render(
      <Modal titleId="t" initialFocus={(root) => root.querySelector<HTMLElement>('input, select')}>
        <h2 id="t">Delete goal</h2>
        <p>The goal and its history go away.</p>
        <button type="button">Cancel</button>
        <button type="button">Delete</button>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
