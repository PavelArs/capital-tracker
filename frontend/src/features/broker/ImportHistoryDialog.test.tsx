import { brokersApi, type TBankImportPreview } from '@api/brokers.api';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportHistoryDialog from './ImportHistoryDialog';
import LoadHistory from './LoadHistory';

// Synthetic ids, tickers and dates only.
const account = '00000000-0000-4000-8000-000000000001';
const preview = (changes: Partial<TBankImportPreview> = {}): TBankImportPreview => ({
  grouping: 'operation',
  entries: [
    { record: 'trade', occurredAt: '2024-03-02T10:00:00.000Z' },
    { record: 'trade', occurredAt: '2025-07-01T21:30:00.000Z' },
    { record: 'reward', occurredAt: '2025-01-15T09:00:00.000Z' },
  ],
  skipped: [],
  trades: 2,
  rewards: 1,
  fitsTradeLimit: true,
  fitsRewardLimit: true,
  accountHasEntries: false,
  problems: [],
  canImport: true,
  previewHash: 'a'.repeat(64),
  ...changes,
});
const refused = (status: number) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'refused',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const onClose = vi.fn();
const onImported = vi.fn();
beforeEach(() => {
  vi.restoreAllMocks();
  onClose.mockReset();
  onImported.mockReset();
});
afterEach(cleanup);

const open = () =>
  render(
    <ImportHistoryDialog
      accountId={account}
      accountName="T-Bank Synthetic"
      onClose={onClose}
      onImported={onImported}
    />,
  );

describe('BROKER-HISTORY loading a T-Bank history into an empty account', () => {
  it('says what the history becomes, by Moscow date, and loads exactly what was checked', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(preview());
    const load = vi
      .spyOn(brokersApi, 'importHistory')
      .mockResolvedValue({ importId: 'i1', trades: 2, rewards: 1 });
    const user = userEvent.setup();
    open();
    // 21:30 UTC on Jul 1 is already Jul 2 in Moscow.
    expect(await screen.findByText(/becomes 2 trades and 1 dividend or coupon/)).toHaveTextContent(
      'from 2024-03-02 to 2025-07-02',
    );
    await user.click(screen.getByRole('button', { name: 'Load history' }));
    expect(load).toHaveBeenCalledWith(account, {
      requestId: expect.any(String),
      previewHash: 'a'.repeat(64),
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Loaded 2 trades and 1 reward into T-Bank Synthetic.',
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('retries a failed load with the same request id', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(preview());
    const load = vi
      .spyOn(brokersApi, 'importHistory')
      .mockRejectedValueOnce(refused(503))
      .mockResolvedValueOnce({ importId: 'i1', trades: 2, rewards: 1 });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Load history' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('T-Bank could not be reached');
    await user.click(screen.getByRole('button', { name: 'Load history' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(load.mock.calls[1][1].requestId).toBe(load.mock.calls[0][1].requestId);
  });

  it('asks to check again when the history changed, and uses a new request for the new check', async () => {
    const check = vi
      .spyOn(brokersApi, 'importPreview')
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(preview({ previewHash: 'b'.repeat(64) }));
    const load = vi
      .spyOn(brokersApi, 'importHistory')
      .mockRejectedValueOnce(refused(409))
      .mockResolvedValueOnce({ importId: 'i1', trades: 2, rewards: 1 });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Load history' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed since the check');
    // The old check is dropped: only a new one can be loaded, under a new request id.
    expect(screen.queryByRole('button', { name: 'Load history' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await user.click(await screen.findByRole('button', { name: 'Load history' }));
    expect(check).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][1].previewHash).toBe('b'.repeat(64));
    expect(load.mock.calls[1][1].requestId).not.toBe(load.mock.calls[0][1].requestId);
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('lists what stands in the way and offers no load', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(
      preview({
        canImport: false,
        accountHasEntries: true,
        problems: [
          { reason: 'not-recordable', occurredAt: null, ticker: '', operationIds: ['1'] },
          { reason: 'not-held', occurredAt: null, ticker: 'SYNTH', operationIds: ['2'] },
        ],
      }),
    );
    open();
    expect(await screen.findByText(/already holds records/)).toBeInTheDocument();
    expect(screen.getByText(/cannot record yet/)).toBeInTheDocument();
    expect(
      screen.getByText(/spends more than the account held at that time\. \(SYNTH\)/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load history' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
  });

  it('says when T-Bank has nothing to load', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(
      preview({ canImport: false, entries: [], trades: 0, rewards: 0 }),
    );
    open();
    expect(await screen.findByText(/no operations to load/)).toBeInTheDocument();
  });

  it('says why the history could not be read and lets the owner try again', async () => {
    const check = vi
      .spyOn(brokersApi, 'importPreview')
      .mockRejectedValueOnce(refused(422))
      .mockResolvedValueOnce(preview());
    const user = userEvent.setup();
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Connect the account again');
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('button', { name: 'Load history' })).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('notes when trades are combined to fit the limit', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(preview({ grouping: 'day' }));
    open();
    expect(await screen.findByText(/on one day are combined into one entry/)).toBeInTheDocument();
  });
});

describe('BROKER-HISTORY the offer on an empty broker account', () => {
  it('is offered only to a connected account', async () => {
    const connection = vi.spyOn(brokersApi, 'connection');
    connection.mockResolvedValueOnce({ connected: false });
    const first = render(<LoadHistory accountId={account} accountName="A" onImported={vi.fn()} />);
    await vi.waitFor(() => expect(connection).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Load T-Bank history' })).toBeNull();
    first.unmount();
    connection.mockResolvedValueOnce({ connected: true, tokenHint: '0001' });
    render(<LoadHistory accountId={account} accountName="A" onImported={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Load T-Bank history' })).toBeInTheDocument();
  });

  it('opens the dialog and tells the page when the history is loaded', async () => {
    vi.spyOn(brokersApi, 'connection').mockResolvedValue({ connected: true, tokenHint: '0001' });
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(preview());
    vi.spyOn(brokersApi, 'importHistory').mockResolvedValue({
      importId: 'i1',
      trades: 2,
      rewards: 1,
    });
    const imported = vi.fn();
    const user = userEvent.setup();
    render(<LoadHistory accountId={account} accountName="A" onImported={imported} />);
    await user.click(await screen.findByRole('button', { name: 'Load T-Bank history' }));
    await user.click(await screen.findByRole('button', { name: 'Load history' }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    expect(imported).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers nothing when the connection cannot be read', async () => {
    const connection = vi.spyOn(brokersApi, 'connection').mockRejectedValue(refused(500));
    render(<LoadHistory accountId={account} accountName="A" onImported={vi.fn()} />);
    await vi.waitFor(() => expect(connection).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
  });
});
