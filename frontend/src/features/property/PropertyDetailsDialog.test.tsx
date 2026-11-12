import { type PropertyDetails, propertyDetailsApi } from '@api/property-details.api';
import { ToastProvider } from '@contexts/ToastContext';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PropertyDetailsDialog from './PropertyDetailsDialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A synthetic property only.
const instrumentId = '00000000-0000-4000-8000-000000000001';
const saved: PropertyDetails = {
  instrumentId,
  monthlyRent: '45000',
  currency: 'RUB',
  note: null,
  updatedAt: '2026-10-11T12:00:00.000Z',
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
    <ToastProvider>
      <PropertyDetailsDialog
        instrumentId={instrumentId}
        currency="RUB"
        details={null}
        onClose={onClose}
        onSaved={onSaved}
      />
    </ToastProvider>,
  );
  return { dialog: screen.getByRole('dialog', { name: 'Rent and notes' }), onClose, onSaved };
}

async function save(dialog: HTMLElement) {
  const user = userEvent.setup();
  await user.type(within(dialog).getByLabelText('Rent a month, RUB'), '45000');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  return user;
}

describe('PROP-DETAILS: the rent and notes dialog', () => {
  it('is a narrow dialog with a quiet Cancel that closes it unsent and a primary Save', async () => {
    const set = vi.spyOn(propertyDetailsApi, 'set');
    const { dialog, onClose } = open();
    expect(dialog).toHaveClass('ui-modal', 'ui-modal--narrow');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const submit = within(dialog).getByRole('button', { name: 'Save' });
    expect(cancel).toHaveAttribute('type', 'button');
    expect(cancel).toHaveClass('ui-btn', 'ui-btn--ghost');
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit).toHaveClass('ui-btn', 'ui-btn--primary');
    expect(submit.parentElement).toHaveClass('ui-modal__foot');
    expect(cancel.nextElementSibling).toBe(submit);
    await userEvent.setup().click(cancel);
    expect(onClose).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
  });

  it('holds Cancel, Save, the ✕ and Escape while the details are saved, and Save says Saving…', async () => {
    let answer: (details: PropertyDetails) => void = () => undefined;
    const set = vi
      .spyOn(propertyDetailsApi, 'set')
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { dialog, onClose, onSaved } = open();
    const user = await save(dialog);
    expect(set).toHaveBeenCalledWith(instrumentId, { monthlyRent: '45000', note: null });
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer(saved));
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'no answer',
      new AxiosError('Network Error', 'ERR_NETWORK'),
      'Could not reach the server. Try again; saving the same details twice changes nothing.',
    ],
    ['refused details', httpError(400), 'Check the rent and the note and try again.'],
    ['a removed property', httpError(404), 'This property no longer exists. Reload the page.'],
    ['an ended session', httpError(401), 'Your session has ended. Sign in again.'],
    ['a server error', httpError(500), 'Could not save the details. Try again.'],
  ])(
    'says what %s means in the dialog and frees its buttons for another try',
    async (_, error, text) => {
      vi.spyOn(propertyDetailsApi, 'set').mockRejectedValue(error);
      const { dialog, onSaved } = open();
      await save(dialog);
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
