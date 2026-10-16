import { brokersApi, type TBankAccountOption } from '@api/brokers.api';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectTBankDialog from './ConnectTBankDialog';

// Synthetic names, ids and a made-up token only.
const TOKEN = 'ts.SYNTHETIC-token_0123456789abcdef';
const option = (id: string, name: string, changes: Partial<TBankAccountOption> = {}) => ({
  id,
  name,
  investBox: false,
  connected: false,
  ...changes,
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
const onConnected = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  onClose.mockReset();
  onConnected.mockReset();
});
afterEach(cleanup);

const open = () => render(<ConnectTBankDialog onClose={onClose} onConnected={onConnected} />);
const paste = async (user: ReturnType<typeof userEvent.setup>, value = TOKEN) => {
  await user.type(screen.getByLabelText('T-Bank token'), value);
  await user.click(screen.getByRole('button', { name: 'Check token' }));
};

describe('BROKER-SETUP connecting T-Bank with one token', () => {
  it('does not send a token that is not shaped like one', async () => {
    const accounts = vi.spyOn(brokersApi, 'tbankAccounts');
    const user = userEvent.setup();
    open();
    await paste(user, 'short');
    expect(await screen.findByRole('alert')).toHaveTextContent('does not look like a T-Bank token');
    expect(accounts).not.toHaveBeenCalled();
  });

  it('lists the open accounts, connects the picked ones under their own names and drops the token', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([
      option('2000000001', 'Brokerage'),
      option('2000000002', 'IIS'),
      option('2000000003', 'Old account', { connected: true }),
    ]);
    const connect = vi.spyOn(brokersApi, 'connectTBank').mockResolvedValue([
      {
        accountId: '00000000-0000-4000-8000-000000000001',
        name: 'T-Bank Brokerage',
        brokerAccountId: '2000000001',
        created: true,
      },
    ]);
    const user = userEvent.setup();
    open();
    expect(screen.getByLabelText('T-Bank token')).toHaveAttribute('type', 'password');
    await paste(user);
    // The connected account is listed but cannot be picked again.
    expect(await screen.findByText(/already connected/)).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, true, false]);
    expect(boxes[2]).toBeDisabled();
    await user.click(boxes[1]);
    expect(screen.queryByLabelText('Name of IIS here')).toBeNull();
    const name = screen.getByLabelText('Name of Brokerage here');
    expect(name).toHaveValue('T-Bank Brokerage');
    await user.clear(name);
    await user.type(name, 'Main broker');
    await user.click(screen.getByRole('button', { name: 'Connect account' }));
    expect(connect).toHaveBeenCalledTimes(1);
    const [token, picks] = connect.mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(picks).toEqual([
      { brokerAccountId: '2000000001', requestId: expect.any(String), name: 'Main broker' },
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent('Connected 1 account.');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('retries a failed connect with the same request id, so no account is made twice', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([option('2000000001', 'Brokerage')]);
    const connect = vi
      .spyOn(brokersApi, 'connectTBank')
      .mockRejectedValueOnce(refused(503))
      .mockResolvedValueOnce([
        {
          accountId: '00000000-0000-4000-8000-000000000001',
          name: 'T-Bank Brokerage',
          brokerAccountId: '2000000001',
          created: false,
        },
      ]);
    const user = userEvent.setup();
    open();
    await paste(user);
    await user.click(await screen.findByRole('button', { name: 'Connect account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('T-Bank could not be reached');
    await user.click(screen.getByRole('button', { name: 'Connect account' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Connected 1 account.');
    expect(connect.mock.calls[1][1][0].requestId).toBe(connect.mock.calls[0][1][0].requestId);
  });

  it('says what the server said when T-Bank refuses the token', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockRejectedValue(
      refused(422, 'This token can trade. Make a read-only one.'),
    );
    const user = userEvent.setup();
    open();
    await paste(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This token can trade. Make a read-only one.',
    );
    // The token stays in the field so it can be fixed without pasting again.
    expect(screen.getByLabelText('T-Bank token')).toHaveValue(TOKEN);
  });

  it('selects at most 20 accounts, the most the server connects at once', async () => {
    const many = Array.from({ length: 22 }, (_, n) =>
      option(String(2000000100 + n), `Account ${n + 1}`),
    );
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue(many);
    const user = userEvent.setup();
    open();
    await paste(user);
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.filter((box) => (box as HTMLInputElement).checked)).toHaveLength(20);
    expect(boxes[20]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect 20 accounts' })).toBeEnabled();
    expect(screen.getByText(/20 accounts is the most to connect at once/)).toBeInTheDocument();
    // Unchecking one frees a place for another.
    await user.click(boxes[0]);
    expect(boxes[20]).toBeEnabled();
  });

  it('says so when every account is already connected and offers nothing to connect', async () => {
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([
      option('2000000003', 'Old account', { connected: true }),
    ]);
    const user = userEvent.setup();
    open();
    await paste(user);
    expect(await screen.findByText(/already connected\.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeDisabled();
  });
});
