import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('ConfirmDialog', () => {
  it('is an alertdialog named by its title and described by the consequence, Cancel focused', () => {
    render(
      <ConfirmDialog
        title="Delete goal?"
        confirmLabel="Delete goal"
        failure="Could not delete the goal."
        onConfirm={() => Promise.resolve()}
        onClose={() => {}}
      >
        The goal and its plan go away. Your accounts stay as they are.
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete goal?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(
      'The goal and its plan go away. Your accounts stay as they are.',
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete goal' })).toHaveClass('ui-btn--danger');
  });

  it('Cancel and Escape close it without acting', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => Promise.resolve());
    const close = vi.fn();
    render(
      <ConfirmDialog
        title="Remove wallet?"
        confirmLabel="Remove wallet"
        failure="Could not remove."
        onConfirm={confirm}
        onClose={close}
      >
        Its history is removed.
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('while the action runs it is busy and cannot be cancelled; a failure stays as an alert', async () => {
    const user = userEvent.setup();
    const run = deferred();
    const close = vi.fn();
    render(
      <ConfirmDialog
        title="Delete transaction?"
        confirmLabel="Delete transaction"
        busyLabel="Deleting…"
        failure={(error) => `Could not delete: ${(error as Error).message}`}
        onConfirm={() => run.promise}
        onClose={close}
      >
        Totals are recalculated.
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Delete transaction' }));
    const busy = screen.getByRole('button', { name: 'Deleting…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(close).not.toHaveBeenCalled();
    await act(async () => {
      run.reject(new Error('network'));
      await run.promise.catch(() => {});
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not delete: network');
    expect(screen.getByRole('alertdialog', { name: 'Delete transaction?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete transaction' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('a primary confirmation uses the primary button and a fixed failure text', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        title="Make new recovery codes?"
        confirmLabel="Make new codes"
        tone="primary"
        failure="Could not make new codes."
        onConfirm={() => Promise.reject(new Error('x'))}
        onClose={() => {}}
      >
        The old codes stop working.
      </ConfirmDialog>,
    );
    const confirm = screen.getByRole('button', { name: 'Make new codes' });
    expect(confirm).toHaveClass('ui-btn--primary');
    await user.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not make new codes.');
  });
});
