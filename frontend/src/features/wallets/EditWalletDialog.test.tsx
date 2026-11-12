import { type AccountSummary, accountingApi } from '@api/accounting.api';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EditWalletDialog from './EditWalletDialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A synthetic wallet only.
const accountId = '00000000-0000-4000-8000-000000000001';
const saved: AccountSummary = {
  id: accountId,
  name: 'Wallet B',
  kind: null,
  currentRevision: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const httpError = (status: number) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'refused',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

function open() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <EditWalletDialog
      accountId={accountId}
      name="Wallet A"
      kind={null}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { dialog: screen.getByRole('dialog', { name: 'Edit wallet' }), onClose, onSaved };
}

async function rename(dialog: HTMLElement) {
  const user = userEvent.setup();
  const field = within(dialog).getByLabelText('Name');
  await user.clear(field);
  await user.type(field, 'Wallet B');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  return user;
}

describe('WAL-RENAME: the edit wallet dialog', () => {
  it('is a narrow dialog with a quiet Cancel that closes it unsent and a primary Save', async () => {
    const update = vi.spyOn(accountingApi, 'updateAccount');
    const { dialog, onClose } = open();
    expect(dialog).toHaveClass('ui-modal', 'ui-modal--narrow');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(cancel).toHaveAttribute('type', 'button');
    expect(cancel).toHaveClass('ui-btn', 'ui-btn--ghost');
    expect(save).toHaveAttribute('type', 'submit');
    expect(save).toHaveClass('ui-btn', 'ui-btn--primary');
    expect(save.parentElement).toHaveClass('ui-modal__foot');
    expect(cancel.nextElementSibling).toBe(save);
    await userEvent.setup().click(cancel);
    expect(onClose).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it('holds Cancel, Save, the ✕ and Escape while the change is saved, and Save says Saving…', async () => {
    let answer: (account: AccountSummary) => void = () => undefined;
    const update = vi
      .spyOn(accountingApi, 'updateAccount')
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { dialog, onClose, onSaved } = open();
    const user = await rename(dialog);
    expect(update).toHaveBeenCalledWith(accountId, { name: 'Wallet B' });
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer(saved));
    expect(onSaved).toHaveBeenCalledWith({ name: 'Wallet B' });
  });

  it.each([
    [
      'no answer',
      new AxiosError('Network Error', 'ERR_NETWORK'),
      'Could not reach the server. Try again.',
    ],
    ['a refused name', httpError(400), 'Use a name of 1 to 120 characters on one line.'],
    ['a removed wallet', httpError(404), 'This wallet no longer exists. Reload the page.'],
    ['an ended session', httpError(401), 'Your session has ended. Sign in again.'],
    ['a server error', httpError(500), 'Could not save the wallet. Try again.'],
  ])(
    'says what %s means in the dialog and frees its buttons for another try',
    async (_, error, text) => {
      vi.spyOn(accountingApi, 'updateAccount').mockRejectedValue(error);
      const { dialog, onSaved } = open();
      await rename(dialog);
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveClass('ui-banner--neg');
      expect(alert.parentElement).toHaveClass('ui-modal__body');
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
      expect(onSaved).not.toHaveBeenCalled();
    },
  );
});
