import { type Goal, goalsApi } from '@api/goals.api';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalDialog } from './GoalDialogs';

beforeEach(() => {
  // The plan under the fields is not what these tests are about.
  vi.spyOn(goalsApi, 'preview').mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A synthetic goal only.
const goal: Goal = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Down payment A',
  currency: 'RUB',
  targetAmount: '22000000.00',
  deadline: '2099-12-01',
  expectedReturnPercent: '14.0000',
  monthlyContribution: '150000.00',
  createdAt: '2026-10-01T00:00:00.000Z',
  asOf: '2026-10-13',
  progress: {
    current: '5500000.00',
    complete: true,
    percent: '25.00',
    remaining: '16500000.00',
    stalePrices: 0,
  },
  status: 'behind',
  scenarios: [],
};

const httpError = (status: number, message?: string) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'refused',
    data: message === undefined ? {} : { message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

function open(changed?: Goal) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<GoalDialog goal={changed} defaultCurrency="RUB" onClose={onClose} onSaved={onSaved} />);
  const title = changed ? 'Edit goal' : 'Add goal';
  return { dialog: screen.getByRole('dialog', { name: title }), onClose, onSaved };
}

async function add(dialog: HTMLElement) {
  const user = userEvent.setup();
  await user.type(within(dialog).getByLabelText('Name'), 'Goal');
  await user.type(within(dialog).getByLabelText('Sum to reach'), '100');
  await user.click(within(dialog).getByRole('button', { name: 'Add goal' }));
}

async function saveEdit(dialog: HTMLElement) {
  const user = userEvent.setup();
  await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
  return user;
}

describe('GOAL-TERMS: the frame of the goal dialog', () => {
  it.each([
    [undefined, 'Add goal'],
    [goal, 'Save goal'],
  ])(
    'is wide, starts on the name and has a quiet Cancel that closes it unsent and a secondary submit (%#)',
    async (changed, submit) => {
      const create = vi.spyOn(goalsApi, 'create');
      const update = vi.spyOn(goalsApi, 'update');
      const { dialog, onClose } = open(changed);
      expect(dialog).toHaveClass('ui-modal', 'ui-modal--wide');
      expect(within(dialog).getByLabelText('Name')).toHaveFocus();
      const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
      const save = within(dialog).getByRole('button', { name: submit });
      expect(cancel).toHaveAttribute('type', 'button');
      expect(cancel).toHaveClass('ui-btn', 'ui-btn--ghost');
      expect(save).toHaveAttribute('type', 'submit');
      expect(save.className).toBe('ui-btn ui-btn--secondary');
      expect(save.parentElement).toHaveClass('ui-modal__foot');
      expect(cancel.nextElementSibling).toBe(save);
      await userEvent.setup().click(cancel);
      expect(onClose).toHaveBeenCalledOnce();
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('holds Cancel, the submit, the ✕ and Escape while it saves, and the submit says Saving…', async () => {
    let answer: (saved: Goal) => void = () => undefined;
    const update = vi
      .spyOn(goalsApi, 'update')
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { dialog, onClose, onSaved } = open(goal);
    const user = await saveEdit(dialog);
    expect(update).toHaveBeenCalledWith(goal.id, {
      name: 'Down payment A',
      currency: 'RUB',
      targetAmount: '22000000',
      deadline: '2099-12-01',
      expectedReturnPercent: '14',
      monthlyContribution: '150000',
    });
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer(goal));
    expect(onSaved).toHaveBeenCalledWith(goal);
  });

  it('says a new goal that got no answer may have been added', async () => {
    vi.spyOn(goalsApi, 'create').mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
    const { dialog } = open();
    await add(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not reach the server. The goal may have been added; adding it again does not add it twice.',
    );
    expect(within(dialog).getByRole('button', { name: 'Add goal' })).toBeEnabled();
  });

  it.each([
    [
      'no answer',
      new AxiosError('Network Error', 'ERR_NETWORK'),
      'Could not reach the server. The change may have been saved; saving it again is safe.',
    ],
    ['refused fields', httpError(400), 'Check the fields and try again.'],
    ['a removed goal', httpError(404), 'This goal no longer exists. Reload the page.'],
    [
      'a conflict the server explains',
      httpError(409, 'The goal changed meanwhile'),
      'The goal changed meanwhile',
    ],
    ['a conflict it does not explain', httpError(409), 'Could not save. Try again.'],
    [
      'terms the server explains',
      httpError(422, 'At most 20 goals can be kept'),
      'At most 20 goals can be kept',
    ],
    ['terms it does not explain', httpError(422), 'Could not save. Try again.'],
    ['a server error', httpError(500), 'Could not save. Try again.'],
  ])(
    'says what %s means for a changed goal and frees its buttons for another try',
    async (_, error, text) => {
      vi.spyOn(goalsApi, 'update').mockRejectedValue(error);
      const { dialog, onSaved } = open(goal);
      await saveEdit(dialog);
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveClass('ui-banner--neg');
      expect(alert.parentElement).toHaveClass('ui-modal__body');
      expect(within(dialog).getByRole('button', { name: 'Save goal' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
      expect(onSaved).not.toHaveBeenCalled();
    },
  );
});
