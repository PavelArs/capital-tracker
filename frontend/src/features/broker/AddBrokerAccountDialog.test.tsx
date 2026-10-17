import { brokersApi, type TBankAccountOption, type TBankConnection } from '@api/brokers.api';
import ToastViewport from '@components/Toast';
import { ToastProvider } from '@contexts/ToastContext';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddBrokerAccountDialog from './AddBrokerAccountDialog';

// Synthetic names, ids and a made-up token only.
const TOKEN = 'ts.SYNTHETIC-token_0123456789abcdef';
const madeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const option = (id: string, name: string, changes: Partial<TBankAccountOption> = {}) => ({
  id,
  name,
  investBox: false,
  connected: false,
  ...changes,
});
const made = (n: number, name: string, brokerAccountId: string): TBankConnection => ({
  accountId: madeId(n),
  name,
  brokerAccountId,
  created: true,
});
const refused = (status: number, message?: string) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'refused',
    data: message ? { message } : {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const onClose = vi.fn();
const onAdded = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  onClose.mockReset();
  onAdded.mockReset();
});
afterEach(cleanup);

const open = () =>
  render(
    <ToastProvider>
      <AddBrokerAccountDialog onClose={onClose} onAdded={onAdded} />
      <ToastViewport />
    </ToastProvider>,
  );
const dialog = () => screen.getByRole('dialog', { name: 'Add broker account' });
type User = ReturnType<typeof userEvent.setup>;
const choose = async (user: User, broker: RegExp) => {
  await user.click(within(dialog()).getByRole('button', { name: broker }));
  await user.click(within(dialog()).getByRole('button', { name: 'Continue' }));
};
const paste = async (user: User, value = TOKEN) => {
  await choose(user, /^T-Bank/);
  await user.type(within(dialog()).getByLabelText('T-Bank token'), value);
  await user.click(within(dialog()).getByRole('button', { name: 'Continue' }));
};

describe('BROKER-ADD-FLOW one Add broker account dialog: choose the broker first', () => {
  it('BROKER-ADD-FLOW offers T-Bank first, then another broker, and continues once one is chosen', async () => {
    const user = userEvent.setup();
    open();
    expect(within(dialog()).getByText('Step 1 of 3')).toBeInTheDocument();
    const tiles = within(within(dialog()).getByRole('group', { name: 'Broker' })).getAllByRole(
      'button',
    );
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      'T-Bank Connects with a read-only token',
      'Another broker Enter positions by hand',
    ]);
    const next = within(dialog()).getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();
    await user.click(tiles[1]);
    expect(within(dialog()).getByText('Step 1 of 2')).toBeInTheDocument();
    expect(next).toBeEnabled();
    // Nothing is typed yet: Cancel closes at once.
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('BROKER-ADD-FLOW "Another broker" opens the positions editor, and Back keeps what was typed', async () => {
    const user = userEvent.setup();
    open();
    await choose(user, /^Another broker/);
    expect(within(dialog()).getByText('Step 2 of 2')).toBeInTheDocument();
    await user.type(within(dialog()).getByLabelText('Broker'), 'Sample Broker');
    await user.click(within(dialog()).getByRole('button', { name: 'Back' }));
    expect(within(dialog()).getByText('Step 1 of 2')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: /^Another broker/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(dialog()).getByRole('button', { name: 'Continue' }));
    expect(within(dialog()).getByLabelText('Broker')).toHaveValue('Sample Broker');
  });

  it('BROKER-ADD-FLOW asks before discarding positions typed before going back to the choice', async () => {
    const user = userEvent.setup();
    open();
    await choose(user, /^Another broker/);
    await user.type(within(dialog()).getByLabelText('Broker'), 'Sample Broker');
    await user.click(within(dialog()).getByRole('button', { name: 'Back' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog', { name: 'Discard this broker account?' });
    await user.click(within(confirm).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('BROKER-ADD-FLOW asks before discarding a half-filled positions editor', async () => {
    const user = userEvent.setup();
    open();
    await choose(user, /^Another broker/);
    await user.type(within(dialog()).getByLabelText('Broker'), 'Sample Broker');
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Discard this broker account?' });
    await user.click(within(confirm).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BROKER-SETUP connecting T-Bank with one token, inside Add broker account', () => {
  it('BROKER-SETUP does not send a token that is not shaped like one', async () => {
    const accounts = vi.spyOn(brokersApi, 'tbankAccounts');
    const user = userEvent.setup();
    open();
    await paste(user, 'short');
    expect(within(dialog()).getByLabelText('T-Bank token')).toHaveAccessibleDescription(
      /does not look like a T-Bank token/,
    );
    expect(accounts).not.toHaveBeenCalled();
    expect(within(dialog()).getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('BROKER-SETUP lists the accounts, connects the picked ones under their own names and says so', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([
      option('2000000001', 'Brokerage'),
      option('2000000002', 'IIS'),
      option('2000000003', 'Old account', { connected: true }),
    ]);
    const connect = vi
      .spyOn(brokersApi, 'connectTBank')
      .mockResolvedValue([
        made(1, 'Main broker', '2000000001'),
        made(2, 'T-Bank IIS', '2000000002'),
      ]);
    const user = userEvent.setup();
    open();
    expect(screen.queryByLabelText('T-Bank token')).toBeNull();
    await choose(user, /^T-Bank/);
    expect(within(dialog()).getByLabelText('T-Bank token')).toHaveAttribute('type', 'password');
    await user.type(within(dialog()).getByLabelText('T-Bank token'), TOKEN);
    await user.click(within(dialog()).getByRole('button', { name: 'Continue' }));
    expect(await within(dialog()).findByText('Step 3 of 3')).toBeInTheDocument();
    // An account already read here is listed but cannot be picked again.
    const boxes = within(dialog()).getAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, true, false]);
    expect(boxes[2]).toBeDisabled();
    expect(boxes[2]).toHaveAccessibleName(/Old account.*already connected/i);
    const name = within(dialog()).getByLabelText('Name for Brokerage');
    expect(name).toHaveValue('T-Bank Brokerage');
    await user.clear(name);
    await user.type(name, 'Main broker');
    await user.click(within(dialog()).getByRole('button', { name: 'Connect 2 accounts' }));
    expect(connect).toHaveBeenCalledTimes(1);
    const [token, picks] = connect.mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(picks).toEqual([
      { brokerAccountId: '2000000001', requestId: expect.any(String), name: 'Main broker' },
      { brokerAccountId: '2000000002', requestId: expect.any(String), name: 'T-Bank IIS' },
    ]);
    expect(picks[0].requestId).not.toBe(picks[1].requestId);
    expect(onAdded).toHaveBeenCalledWith(madeId(1));
    expect(await screen.findByRole('status')).toHaveTextContent('2 T-Bank accounts connected');
  });

  it('BROKER-SETUP names the one account connected in the toast', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([option('2000000001', 'Brokerage')]);
    vi.spyOn(brokersApi, 'connectTBank').mockResolvedValue([
      made(1, 'T-Bank Brokerage', '2000000001'),
    ]);
    const user = userEvent.setup();
    open();
    await paste(user);
    await user.click(await within(dialog()).findByRole('button', { name: 'Connect 1 account' }));
    expect(await screen.findByRole('status')).toHaveTextContent('T-Bank Brokerage added');
  });

  it('BROKER-IMPORT-UI offers to import the history of the one account just connected', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([option('2000000001', 'Brokerage')]);
    vi.spyOn(brokersApi, 'connectTBank').mockResolvedValue([
      made(1, 'T-Bank Brokerage', '2000000001'),
    ]);
    const onImport = vi.fn();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <AddBrokerAccountDialog onClose={onClose} onAdded={onAdded} onImport={onImport} />
        <ToastViewport />
      </ToastProvider>,
    );
    await paste(user);
    await user.click(await within(dialog()).findByRole('button', { name: 'Connect 1 account' }));
    await user.click(await screen.findByRole('button', { name: 'Import history now' }));
    expect(onImport).toHaveBeenCalledWith({ accountId: madeId(1), name: 'T-Bank Brokerage' });
  });

  it('BROKER-SETUP retries a failed connect with the same request id, and Back keeps the error and the token', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([option('2000000001', 'Brokerage')]);
    const connect = vi
      .spyOn(brokersApi, 'connectTBank')
      .mockRejectedValueOnce(refused(503))
      .mockRejectedValueOnce(refused(503))
      .mockResolvedValueOnce([{ ...made(1, 'T-Bank Brokerage', '2000000001'), created: false }]);
    const user = userEvent.setup();
    open();
    await paste(user);
    await user.click(await within(dialog()).findByRole('button', { name: 'Connect 1 account' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'T-Bank could not be reached',
    );
    await user.click(within(dialog()).getByRole('button', { name: 'Connect 1 account' }));
    expect(connect).toHaveBeenCalledTimes(2);
    // Back goes to the token step, which still says what went wrong.
    await user.click(within(dialog()).getByRole('button', { name: 'Back' }));
    expect(within(dialog()).getByText('Step 2 of 3')).toBeInTheDocument();
    expect(within(dialog()).getByLabelText('T-Bank token')).toHaveValue(TOKEN);
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('T-Bank could not be reached');
    await user.click(within(dialog()).getByRole('button', { name: 'Continue' }));
    await user.click(await within(dialog()).findByRole('button', { name: 'Connect 1 account' }));
    expect(onAdded).toHaveBeenCalledWith(madeId(1));
    expect(connect.mock.calls[1][1][0].requestId).toBe(connect.mock.calls[0][1][0].requestId);
    expect(connect.mock.calls[2][1][0].requestId).toBe(connect.mock.calls[0][1][0].requestId);
  });

  it('BROKER-SETUP drops an old connect error once the token is checked again', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([option('2000000001', 'Brokerage')]);
    vi.spyOn(brokersApi, 'connectTBank').mockRejectedValueOnce(refused(503));
    const user = userEvent.setup();
    open();
    await paste(user);
    await user.click(await within(dialog()).findByRole('button', { name: 'Connect 1 account' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'T-Bank could not be reached',
    );
    await user.click(within(dialog()).getByRole('button', { name: 'Back' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Continue' }));
    expect(await within(dialog()).findByText('Step 3 of 3')).toBeInTheDocument();
    expect(within(dialog()).queryByRole('alert')).toBeNull();
  });

  it('BROKER-SETUP says what the server said when T-Bank refuses the token, and keeps it', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockRejectedValue(
      refused(422, 'This token can trade. Make a read-only one.'),
    );
    const user = userEvent.setup();
    open();
    await paste(user);
    const field = within(dialog()).getByLabelText('T-Bank token');
    await vi.waitFor(() =>
      expect(field).toHaveAccessibleDescription('This token can trade. Make a read-only one.'),
    );
    expect(field).toHaveValue(TOKEN);
    expect(within(dialog()).getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('BROKER-SETUP selects at most 20 accounts, the most the server connects at once', async () => {
    const many = Array.from({ length: 22 }, (_, n) =>
      option(String(2000000100 + n), `Account ${n + 1}`),
    );
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue(many);
    const user = userEvent.setup();
    open();
    await paste(user);
    const boxes = await within(dialog()).findAllByRole('checkbox');
    expect(boxes.filter((box) => (box as HTMLInputElement).checked)).toHaveLength(20);
    expect(boxes[20]).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'Connect 20 accounts' })).toBeEnabled();
    expect(
      within(dialog()).getByText(/20 accounts is the most to connect at once/),
    ).toBeInTheDocument();
    await user.click(boxes[0]);
    expect(boxes[20]).toBeEnabled();
  });

  it('BROKER-SETUP says so when every account is already connected and offers nothing to connect', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([
      option('2000000003', 'Old account', { connected: true }),
    ]);
    const user = userEvent.setup();
    open();
    await paste(user);
    expect(
      await within(dialog()).findByText(
        'Every open account this token reaches is already connected.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('BROKER-ADD-FLOW asks before discarding a pasted token, and Escape asks too', async () => {
    const user = userEvent.setup();
    open();
    await choose(user, /^T-Bank/);
    await user.type(within(dialog()).getByLabelText('T-Bank token'), TOKEN);
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }));
    let confirm = screen.getByRole('alertdialog', { name: 'Discard this broker account?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog()).getByLabelText('T-Bank token')).toHaveValue(TOKEN);
    within(dialog()).getByLabelText('T-Bank token').focus();
    await user.keyboard('{Escape}');
    confirm = screen.getByRole('alertdialog', { name: 'Discard this broker account?' });
    await user.click(within(confirm).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('BROKER-ADD-FLOW Back from the token step returns to the broker choice', async () => {
    const user = userEvent.setup();
    open();
    await choose(user, /^T-Bank/);
    await user.click(within(dialog()).getByRole('button', { name: 'Back' }));
    expect(within(dialog()).getByText('Step 1 of 3')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: /^T-Bank/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
