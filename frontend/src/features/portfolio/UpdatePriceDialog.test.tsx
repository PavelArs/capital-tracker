import { manualPricesApi, type PriceBook, type PriceReceipt } from '@api/manual-prices.api';
import { ToastProvider } from '@contexts/ToastContext';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpdatePriceDialog from './UpdatePriceDialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A synthetic hand-valued asset only.
const instrumentId = '00000000-0000-4000-8000-000000000001';
const book: PriceBook = {
  instrument: { id: instrumentId, name: 'Painting A', symbol: 'PAINT', namespace: 'manual' },
  currentRevision: 3,
  source: 'manual',
  quoteCurrency: 'RUB',
  items: [],
  nextOffset: null,
};
const receipt: PriceReceipt = {
  instrumentId,
  revision: 4,
  requestId: '00000000-0000-4000-8000-0000000000aa',
  observedAt: '2026-10-11T12:00:00Z',
  createdAt: '2026-10-11T12:00:00.000Z',
  source: 'manual',
  quoteCurrency: 'RUB',
  priceUsd: null,
  kind: 'set',
  price: '500000',
};

const httpError = (status: number) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'refused',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

function open(estimate = false) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <ToastProvider>
      <UpdatePriceDialog
        instrumentId={instrumentId}
        name="Painting A"
        currency="RUB"
        estimate={estimate}
        onClose={onClose}
        onSaved={onSaved}
      />
    </ToastProvider>,
  );
  const title = estimate ? 'Update estimate' : 'Update price';
  return { dialog: screen.getByRole('dialog', { name: title }), onClose, onSaved };
}

async function save(dialog: HTMLElement) {
  const user = userEvent.setup();
  await user.type(within(dialog).getByLabelText('Price of one unit, RUB'), '500000');
  await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
  return user;
}

describe('AST-MANUAL-VALUE: the update price dialog', () => {
  it.each([
    [false, 'Save price'],
    [true, 'Save estimate'],
  ])(
    'is a narrow dialog with a quiet Cancel that closes it unsent and a primary Save (estimate: %s)',
    async (estimate, label) => {
      const set = vi.spyOn(manualPricesApi, 'set');
      const { dialog, onClose } = open(estimate);
      expect(dialog).toHaveClass('ui-modal', 'ui-modal--narrow');
      const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
      const submit = within(dialog).getByRole('button', { name: label });
      expect(cancel).toHaveAttribute('type', 'button');
      expect(cancel).toHaveClass('ui-btn', 'ui-btn--ghost');
      expect(submit).toHaveAttribute('type', 'submit');
      expect(submit).toHaveClass('ui-btn', 'ui-btn--primary');
      expect(submit.parentElement).toHaveClass('ui-modal__foot');
      expect(cancel.nextElementSibling).toBe(submit);
      await userEvent.setup().click(cancel);
      expect(onClose).toHaveBeenCalledOnce();
      expect(set).not.toHaveBeenCalled();
    },
  );

  it('holds Cancel, Save, the ✕ and Escape while the price is saved, and Save says Saving…', async () => {
    vi.spyOn(manualPricesApi, 'list').mockResolvedValue(book);
    let answer: (receipt: PriceReceipt) => void = () => undefined;
    const set = vi
      .spyOn(manualPricesApi, 'set')
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { dialog, onClose, onSaved } = open();
    const user = await save(dialog);
    expect(set).toHaveBeenCalledWith(instrumentId, {
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expectedRevision: 3,
      observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      price: '500000',
      currency: 'RUB',
      assertReviewed: true,
    });
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer(receipt));
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'no answer',
      new AxiosError('Network Error', 'ERR_NETWORK'),
      'Could not reach the server. Try again; the same request will not save the price twice.',
    ],
    ['a refused price', httpError(400), 'Check the price and try again.'],
    ['a removed asset', httpError(404), 'This asset no longer exists. Reload the page.'],
    ['a price changed elsewhere', httpError(409), 'The price was changed elsewhere. Try again.'],
    ['an ended session', httpError(401), 'Your session has ended. Sign in again.'],
    ['a server error', httpError(500), 'Could not save the price. Try again.'],
  ])(
    'says what %s means in the dialog and frees its buttons for another try',
    async (_, error, text) => {
      vi.spyOn(manualPricesApi, 'list').mockResolvedValue(book);
      vi.spyOn(manualPricesApi, 'set').mockRejectedValue(error);
      const { dialog, onSaved } = open();
      await save(dialog);
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveClass('ui-banner--neg');
      expect(alert.parentElement).toHaveClass('ui-modal__body');
      expect(within(dialog).getByRole('button', { name: 'Save price' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
      expect(onSaved).not.toHaveBeenCalled();
    },
  );
});
