import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OwnedTransferForm, type TransferDraft } from './OwnedTransferForm';

const accounts = [
  { id: 'account-a', name: 'Счёт A' },
  { id: 'account-b', name: 'Счёт B' },
];
const instruments = [{ id: 'instrument-a', name: 'Bitcoin', symbol: 'BTC' }];
const initialDraft: TransferDraft = {
  fromAccountId: 'account-a',
  toAccountId: 'account-b',
  instrumentId: 'instrument-a',
  quantity: '1.5',
  occurredAt: '2025-01-03T00:00:00.000Z',
  orderWithinTimestamp: '0',
  feeInstrumentId: 'instrument-a',
  feeQuantity: '0.1',
  assertInternal: false,
};

function ControlledForm({
  mode = 'create',
  reviewed = true,
  onSubmit = vi.fn(),
}: {
  mode?: 'create' | 'correct' | 'void';
  reviewed?: boolean;
  onSubmit?: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  return (
    <>
      <OwnedTransferForm
        draft={draft}
        accounts={accounts}
        instruments={instruments}
        mode={mode}
        busy={false}
        reviewed={reviewed}
        onChange={setDraft}
        onReview={vi.fn()}
        onSubmit={onSubmit}
      />
      <output aria-label="raw quantity">{draft.quantity}</output>
    </>
  );
}

describe('OwnedTransferForm', () => {
  it('preserves amount text and requires review plus internal-transfer attestation', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ControlledForm onSubmit={onSubmit} />);

    const submit = screen.getByRole('button', { name: 'Записать перевод' });
    expect(submit).toBeDisabled();
    await user.clear(screen.getByLabelText('Количество получателю'));
    await user.type(screen.getByLabelText('Количество получателю'), '0.0000000000000000000000001');
    expect(screen.getByLabelText('raw quantity')).toHaveTextContent('0.0000000000000000000000001');
    await user.click(screen.getByLabelText('Это перевод между моими счетами'));
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('keeps correction accounts fixed and lets a reviewed void submit without attestation', () => {
    const { rerender } = render(<ControlledForm mode="correct" />);
    expect(screen.getByLabelText('Со счёта')).toBeDisabled();
    expect(screen.getByLabelText('На счёт')).toBeDisabled();

    rerender(<ControlledForm mode="void" />);
    expect(screen.getByLabelText('Количество получателю')).toBeDisabled();
    expect(screen.queryByLabelText('Это перевод между моими счетами')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подтвердить отмену' })).toBeEnabled();
  });
});
