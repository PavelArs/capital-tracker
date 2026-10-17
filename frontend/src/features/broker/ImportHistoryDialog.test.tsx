import { brokersApi, type TBankImportPreview, type TBankPlanEntry } from '@api/brokers.api';
import ToastViewport from '@components/Toast';
import { ToastProvider } from '@contexts/ToastContext';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportHistoryDialog from './ImportHistoryDialog';

// Synthetic ids, tickers and amounts only.
const ACCOUNT = '00000000-0000-4000-8000-000000000022';
const HASH = 'a'.repeat(64);
const entry = (action: TBankPlanEntry['action'], n: number): TBankPlanEntry => ({
  record: action === 'income' ? 'reward' : 'trade',
  action,
  occurredAt: '2026-03-02T10:00:00.000Z',
  ticker: action === 'deposit' ? '' : 'SMPL',
  quantity: '1',
  amount: '100.5',
  fee: '0',
  currency: 'rub',
  operationIds: [`op-${n}`],
});
const preview = (changes: Partial<TBankImportPreview> = {}): TBankImportPreview => ({
  grouping: 'operation',
  entries: [entry('deposit', 1), entry('buy', 2), entry('buy', 3), entry('income', 4)],
  skipped: [{ operationId: 'op-5', type: 'OPERATION_TYPE_SAMPLE', reason: 'no-amount' }],
  trades: 3,
  rewards: 1,
  fitsTradeLimit: true,
  fitsRewardLimit: true,
  accountHasEntries: false,
  problems: [],
  canImport: true,
  previewHash: HASH,
  ...changes,
});
const receipt = {
  importId: '00000000-0000-4000-8000-000000000099',
  accountId: ACCOUNT,
  requestId: 'ignored',
  trades: 3,
  rewards: 1,
  createdAt: '2026-10-17T10:00:00.000Z',
};
const refused = (status: number, message?: string) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'refused',
    data: message ? { message } : {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
const unreachable = () => new AxiosError('Network Error', 'ERR_NETWORK');

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
    <ToastProvider>
      <ImportHistoryDialog
        accountId={ACCOUNT}
        name="T-Bank Brokerage"
        onClose={onClose}
        onImported={onImported}
      />
      <ToastViewport />
    </ToastProvider>,
  );
const dialog = () => screen.getByRole('dialog', { name: 'Import history' });

describe('BROKER-IMPORT-UI the Import history dialog', () => {
  it('BROKER-IMPORT-UI shows what the history would become, and what it leaves out, before writing anything', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(preview());
    const write = vi.spyOn(brokersApi, 'importHistory');
    open();
    const entries = await within(dialog()).findByLabelText('Entries to record');
    expect(entries).toHaveTextContent(/^Buys2Money paid in1Dividends and coupons1$/);
    expect(dialog()).toHaveTextContent('T-Bank Brokerage');
    expect(dialog()).toHaveTextContent('3 trades and 1 reward');
    // An operation that moved no money is left out without stopping the import.
    expect(within(dialog()).getByLabelText('Left out')).toHaveTextContent(/^Moved no money1$/);
    expect(write).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole('button', { name: 'Import 4 entries' })).toBeEnabled();
  });

  it('BROKER-IMPORT-UI posts the import once, and a retry sends the same request id', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(preview());
    const write = vi
      .spyOn(brokersApi, 'importHistory')
      .mockRejectedValueOnce(unreachable())
      .mockResolvedValueOnce(receipt);
    const user = userEvent.setup();
    open();
    const confirm = await within(dialog()).findByRole('button', { name: 'Import 4 entries' });
    await user.click(confirm);
    expect(await within(dialog()).findByText(/Could not reach the server/)).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
    await user.click(within(dialog()).getByRole('button', { name: 'Import 4 entries' }));
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledTimes(2);
    const [first, second] = write.mock.calls;
    expect(first[0]).toBe(ACCOUNT);
    expect(first[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toEqual(first);
    expect(first[2]).toBe(HASH);
    expect(await screen.findByText('T-Bank Brokerage history imported')).toBeInTheDocument();
    expect(screen.getByText('3 trades and 1 reward recorded.')).toBeInTheDocument();
  });

  it('BROKER-IMPORT-UI keeps a refused import in the dialog', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(preview());
    vi.spyOn(brokersApi, 'importHistory').mockRejectedValue(
      refused(409, 'Broker import conflicts with saved state'),
    );
    const user = userEvent.setup();
    open();
    await user.click(await within(dialog()).findByRole('button', { name: 'Import 4 entries' }));
    expect(
      await within(dialog()).findByText(
        'The history or the account changed since this preview. Close this window and open it again.',
      ),
    ).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('BROKER-IMPORT-UI keeps a preview that cannot be read in the dialog', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockRejectedValue(
      refused(422, 'T-Bank did not accept the saved token.'),
    );
    open();
    expect(
      await within(dialog()).findByText('T-Bank did not accept the saved token.'),
    ).toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: /^Import/ })).toBeNull();
  });

  it('BROKER-IMPORT-UI says what stands in the way and offers no import', async () => {
    vi.spyOn(brokersApi, 'importPreview').mockResolvedValue(
      preview({
        canImport: false,
        skipped: [{ operationId: 'op-5', type: 'OPERATION_TYPE_SAMPLE', reason: 'unsupported' }],
        problems: [
          {
            reason: 'not-recordable',
            occurredAt: null,
            ticker: '',
            operationIds: ['op-5'],
          },
          {
            reason: 'no-rate',
            // 22:30 UTC is already the next Moscow day, the day the rate is looked up for.
            occurredAt: '2026-03-02T22:30:00.000Z',
            ticker: 'SMPL',
            operationIds: ['op-2'],
          },
        ],
      }),
    );
    const write = vi.spyOn(brokersApi, 'importHistory');
    open();
    const blocked = await within(dialog()).findByRole('list', { name: 'Cannot import yet' });
    expect(
      within(blocked)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'Operations left out moved money or shares (1)',
      'No Bank of Russia rate for that day · SMPL · Mar 3, 2026',
    ]);
    expect(within(dialog()).getByLabelText('Left out')).toHaveTextContent(
      /^Operation types the app does not record yet1$/,
    );
    expect(within(dialog()).getByRole('button', { name: 'Import 4 entries' })).toBeDisabled();
    expect(write).not.toHaveBeenCalled();
  });
});
