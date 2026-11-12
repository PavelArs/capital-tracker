import { type DepositDetail, depositsApi } from '@api/deposits.api';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddDepositDialog, CheckDialog, MovementDialog, RateDialog } from './DepositDialogs';

beforeEach(() => {
  // The figures of the deposit being entered are not what these tests are about.
  vi.spyOn(depositsApi, 'preview').mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A synthetic deposit only.
const id = '00000000-0000-4000-8000-000000000001';
const saved: DepositDetail = {
  id,
  name: 'Savings A',
  bank: 'Synthetic Bank',
  currency: 'RUB',
  startDate: '2026-07-01',
  endDate: '2026-12-01',
  payout: 'monthly',
  capitalized: false,
  dayBasis: 'actual-365',
  earlyClose: 'forfeits-interest',
  ratePercent: '15',
  status: 'active',
  closedOn: null,
  principal: '100000.00',
  accrued: '328.77',
  due: '0.00',
  balance: '100328.77',
  values: { USD: '1114.76', EUR: '1003.29', RUB: '100328.77' },
  nextPayout: null,
  atMaturity: null,
  lastCheck: null,
  asOf: '2026-10-11',
  rates: [{ effectiveFrom: '2026-07-01', ratePercent: '15' }],
  movements: [],
  periods: [],
  interestPosted: '0.00',
  interestPaidOut: '0.00',
  interestForfeited: '0.00',
  checks: [],
};

const httpError = (status: number, message?: string) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'refused',
    data: message === undefined ? {} : { message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const callbacks = () => ({ onClose: vi.fn(), onSaved: vi.fn() });

/** Each dialog of the deposit page, its title, its submit and the field it starts on. */
const dialogs: [string, string, string, (on: ReturnType<typeof callbacks>) => ReactElement][] = [
  ['Add bank deposit', 'Add deposit', 'Bank', (on) => <AddDepositDialog {...on} />],
  [
    'Record a movement',
    'Record',
    'What happened',
    (on) => <MovementDialog id={id} currency="RUB" {...on} />,
  ],
  [
    'Check against the bank',
    'Save check',
    'Date',
    (on) => <CheckDialog id={id} currency="RUB" capitalized={false} {...on} />,
  ],
  ['Change the rate', 'Change rate', 'From', (on) => <RateDialog id={id} {...on} />],
];

function openRate() {
  const on = callbacks();
  render(<RateDialog id={id} {...on} />);
  return { dialog: screen.getByRole('dialog', { name: 'Change the rate' }), ...on };
}

async function changeRate(dialog: HTMLElement) {
  const user = userEvent.setup();
  await user.type(within(dialog).getByLabelText('New rate, % a year'), '15');
  await user.click(within(dialog).getByRole('button', { name: 'Change rate' }));
  return user;
}

describe('DEP-TERMS: the frame every deposit dialog shares', () => {
  it.each(dialogs)(
    '%s has a quiet Cancel that closes it unsent and a primary %s, and starts on %s',
    async (title, submit, first, dialog) => {
      const on = callbacks();
      const sent = [
        vi.spyOn(depositsApi, 'create'),
        vi.spyOn(depositsApi, 'addMovement'),
        vi.spyOn(depositsApi, 'addCheck'),
        vi.spyOn(depositsApi, 'addRate'),
      ];
      render(dialog(on));
      const box = screen.getByRole('dialog', { name: title });
      expect(within(box).getByLabelText(first)).toHaveFocus();
      const cancel = within(box).getByRole('button', { name: 'Cancel' });
      const save = within(box).getByRole('button', { name: submit });
      expect(cancel).toHaveAttribute('type', 'button');
      expect(cancel).toHaveClass('ui-btn', 'ui-btn--ghost');
      expect(save).toHaveAttribute('type', 'submit');
      expect(save).toHaveClass('ui-btn', 'ui-btn--primary');
      expect(save.parentElement).toHaveClass('ui-modal__foot');
      expect(cancel.nextElementSibling).toBe(save);
      await userEvent.setup().click(cancel);
      expect(on.onClose).toHaveBeenCalledOnce();
      for (const call of sent) expect(call).not.toHaveBeenCalled();
    },
  );

  it('is wide for a new deposit and of the default width for the others', () => {
    for (const [title, , , dialog] of dialogs) {
      render(dialog(callbacks()));
      const box = screen.getByRole('dialog', { name: title });
      expect(box).toHaveClass('ui-modal');
      if (title === 'Add bank deposit') expect(box).toHaveClass('ui-modal--wide');
      else expect(box.className).toBe('ui-modal');
      cleanup();
    }
  });

  it('says no problem before the first try, then each one under its field with the keyboard on the first', async () => {
    const user = userEvent.setup();
    const on = callbacks();
    const addMovement = vi.spyOn(depositsApi, 'addMovement');
    render(<MovementDialog id={id} currency="RUB" {...on} />);
    const box = screen.getByRole('dialog', { name: 'Record a movement' });
    const amount = within(box).getByLabelText('Amount, RUB');
    expect(amount).not.toHaveAttribute('aria-invalid');
    await user.clear(within(box).getByLabelText('Date'));
    await user.click(within(box).getByRole('button', { name: 'Record' }));
    const date = within(box).getByLabelText('Date');
    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(date).toHaveAccessibleDescription('Pick a date');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveAccessibleDescription('Enter the amount');
    expect(date).toHaveFocus();
    expect(within(box).queryByRole('alert')).toBeNull();
    expect(within(box).getByRole('button', { name: 'Record' })).toBeEnabled();
    expect(addMovement).not.toHaveBeenCalled();
  });

  it('holds Cancel, the submit, the ✕ and Escape while it saves, and the submit says Saving…', async () => {
    let answer: (deposit: DepositDetail) => void = () => undefined;
    const addRate = vi
      .spyOn(depositsApi, 'addRate')
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { dialog, onClose, onSaved } = openRate();
    const user = await changeRate(dialog);
    expect(addRate).toHaveBeenCalledWith(id, {
      effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      ratePercent: '15',
    });
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer(saved));
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it.each([
    [
      'no answer',
      new AxiosError('Network Error', 'ERR_NETWORK'),
      'Could not reach the server. It may have been saved; saving it again is safe.',
    ],
    ['refused fields', httpError(400), 'Check the fields and try again.'],
    ['a removed deposit', httpError(404), 'This deposit no longer exists. Reload the page.'],
    [
      'a conflict the server explains',
      httpError(409, 'The deposit is closed'),
      'The deposit is closed',
    ],
    ['a conflict it does not explain', httpError(409), 'Could not save. Try again.'],
    [
      'terms the server explains',
      httpError(422, 'The rate starts before the deposit'),
      'The rate starts before the deposit',
    ],
    ['terms it does not explain', httpError(422), 'Could not save. Try again.'],
    ['a server error', httpError(500), 'Could not save. Try again.'],
  ])(
    'says what %s means in the dialog and frees its buttons for another try',
    async (_, error, text) => {
      vi.spyOn(depositsApi, 'addRate').mockRejectedValue(error);
      const { dialog, onSaved } = openRate();
      await changeRate(dialog);
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveClass('ui-banner--neg');
      expect(alert.parentElement).toHaveClass('ui-modal__body');
      expect(within(dialog).getByRole('button', { name: 'Change rate' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
      expect(onSaved).not.toHaveBeenCalled();
    },
  );
});
