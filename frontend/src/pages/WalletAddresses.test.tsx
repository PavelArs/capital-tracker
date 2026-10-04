import { accountingApi } from '@api/accounting.api';
import { tradesApi } from '@api/trades.api';
import {
  type SyncResult,
  type TransactionPage,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WalletAddresses from './WalletAddresses';

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const fresh: WalletAddress = {
  id: '00000000-0000-4000-8000-000000000001',
  network: 'bitcoin',
  address,
  createdAt: '2026-10-03T00:00:00.000Z',
  transactionCount: 0,
  sync: { state: 'never', completedAt: null },
};
const synced: WalletAddress = {
  ...fresh,
  transactionCount: 2,
  sync: { state: 'complete', completedAt: '2026-10-03T12:00:00.000Z' },
};
const transactions: TransactionPage = {
  total: 2,
  offset: 0,
  limit: 50,
  nextOffset: null,
  missingUsdValueCount: 2,
  items: [
    {
      txid: 'a'.repeat(64),
      blockHeight: 800059,
      blockTime: '2023-11-15T08:03:20.000Z',
      direction: 'in',
      receivedBtc: '3.12500059',
      sentBtc: '0.00000000',
      netBtc: '3.12500059',
      feeBtc: '0.00000000',
      usdValue: null,
      usdValueStatus: 'missing',
      trade: null,
    },
    {
      txid: 'b'.repeat(64),
      blockHeight: 800057,
      blockTime: '2023-11-15T07:43:20.000Z',
      direction: 'out',
      receivedBtc: '0.00005757',
      sentBtc: '0.00057057',
      netBtc: '-0.00051300',
      feeBtc: '0.00000300',
      usdValue: null,
      usdValueStatus: 'missing',
      trade: null,
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <WalletAddresses />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([]);
  vi.spyOn(walletAddressesApi, 'transactions').mockResolvedValue(transactions);
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(accountingApi, 'listInstruments').mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ADDR-UI wallet address page', () => {
  it('registers a trimmed address and shows it as not loaded without syncing', async () => {
    const register = vi.spyOn(walletAddressesApi, 'register').mockResolvedValue(fresh);
    const sync = vi.spyOn(walletAddressesApi, 'sync');
    renderPage();
    expect(await screen.findByText('Адресов пока нет.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Адрес Bitcoin'), {
      target: { value: `  ${address} ` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить адрес' }));
    const card = await screen.findByRole('region', { name: `Адрес ${address}` });
    expect(register).toHaveBeenCalledWith(address);
    expect(within(card).getByText('Не загружено')).toBeTruthy();
    expect(sync).not.toHaveBeenCalled();
  });

  it('shows imported transactions with exact BTC and the USD value as missing, never zero', async () => {
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([fresh]);
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue({
      outcome: 'complete',
      reason: null,
      imported: 2,
      address: synced,
    } satisfies SyncResult);
    renderPage();
    const card = await screen.findByRole('region', { name: `Адрес ${address}` });
    fireEvent.click(within(card).getByRole('button', { name: 'Загрузить транзакции' }));
    expect(await within(card).findByText('Загружено полностью')).toBeTruthy();
    expect(within(card).getByText('Транзакций: 2')).toBeTruthy();
    expect(await screen.findByText('Без стоимости в USD: 2 из 2')).toBeTruthy();
    const table = screen.getByRole('table', { name: `Транзакции ${address}` });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain('2023-11-15 08:03 UTC');
    expect(rows[1].textContent).toContain('Поступление');
    expect(rows[1].textContent).toContain('3.12500059');
    expect(rows[2].textContent).toContain('Списание');
    expect(rows[2].textContent).toContain('-0.00051300');
    expect(rows[2].textContent).toContain('0.00000300');
    for (const row of rows.slice(1)) {
      const cells = within(row).getAllByRole('cell');
      expect(cells[cells.length - 1].textContent).toBe('не указана');
    }
    expect(table.textContent).not.toMatch(/\$|USD 0|0 USD/);
  });

  it('reports a provider failure with the progress that was kept', async () => {
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([fresh]);
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 25,
      address: { ...synced, transactionCount: 25, sync: { state: 'partial', completedAt: null } },
    });
    renderPage();
    const card = await screen.findByRole('region', { name: `Адрес ${address}` });
    fireEvent.click(within(card).getByRole('button', { name: 'Загрузить транзакции' }));
    expect(
      await within(card).findByText(
        'Провайдер ограничил частоту запросов. Загружено новых: 25. Повторите позже, загрузка продолжится с того же места.',
      ),
    ).toBeTruthy();
    expect(within(card).getByText('Загружено частично')).toBeTruthy();
    await waitFor(() => expect(walletAddressesApi.transactions).toHaveBeenCalled());
  });
});

const accountId = '00000000-0000-4000-8000-0000000000a1';
const instrumentId = '00000000-0000-4000-8000-0000000000b1';
const tradeId = '00000000-0000-4000-8000-0000000000c1';
const completed: TransactionPage = {
  ...transactions,
  missingUsdValueCount: 1,
  items: [
    {
      ...transactions.items[0],
      usdValue: '1000',
      usdValueStatus: 'known',
      trade: { accountId, tradeId, status: 'active', grossUsd: '1000', feeUsd: '0' },
    },
    transactions.items[1],
  ],
};

describe('ADDRT-UI completing an imported transaction', () => {
  beforeEach(() => {
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([synced]);
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        {
          id: accountId,
          name: 'Trust Wallet',
          currentRevision: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    vi.spyOn(accountingApi, 'listInstruments').mockResolvedValue({
      items: [
        {
          id: instrumentId,
          name: 'Bitcoin',
          symbol: 'BTC',
          namespace: 'manual',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    vi.spyOn(tradesApi, 'state').mockResolvedValue({
      accountId,
      eligible: false,
      ineligibilityReason: 'already-initialized',
      journal: { journalRevision: 4 },
    } as unknown as Awaited<ReturnType<typeof tradesApi.state>>);
  });

  it('offers completion only for incoming rows and records a prefilled buy trade', async () => {
    const complete = vi.spyOn(walletAddressesApi, 'complete').mockResolvedValue({} as never);
    vi.spyOn(walletAddressesApi, 'transactions')
      .mockResolvedValueOnce(transactions)
      .mockResolvedValue(completed);
    renderPage();
    const table = await screen.findByRole('table', { name: `Транзакции ${address}` });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[2]).queryByRole('button', { name: 'Дополнить' })).toBeNull();
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Дополнить' }));

    const form = await screen.findByRole('group', { name: 'Сделка в USD' });
    fireEvent.change(await screen.findByLabelText('Счёт'), { target: { value: accountId } });
    await waitFor(() => expect(tradesApi.state).toHaveBeenCalledWith(accountId));
    fireEvent.change(within(form).getByLabelText('Инструмент'), {
      target: { value: instrumentId },
    });
    expect((within(form).getByLabelText('Количество') as HTMLInputElement).value).toBe(
      '3.12500059',
    );
    fireEvent.change(within(form).getByLabelText('Валовая сумма, USD'), {
      target: { value: '1000' },
    });
    fireEvent.click(
      within(form.closest('form') as HTMLElement).getByRole('button', { name: 'Сохранить сделку' }),
    );

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const [id, txid, body] = complete.mock.calls[0];
    expect(id).toBe(synced.id);
    expect(txid).toBe('a'.repeat(64));
    expect(body).toEqual({
      accountId,
      trade: {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        expectedJournalRevision: 4,
        instrumentId,
        side: 'buy',
        occurredAt: '2023-11-15T08:03:20.000Z',
        orderWithinTimestamp: 0,
        quantity: '3.12500059',
        grossUsd: '1000',
        feeUsd: '0',
      },
    });
    expect(await screen.findByText('Без стоимости в USD: 1 из 2')).toBeTruthy();
    const updated = within(
      screen.getByRole('table', { name: `Транзакции ${address}` }),
    ).getAllByRole('row');
    expect(updated[1].textContent).toContain('1000 USD');
    expect(
      within(updated[1]).getByRole('link', { name: 'Trust Wallet' }).getAttribute('href'),
    ).toBe(`/manual-accounts/${accountId}`);
    expect(within(updated[1]).queryByRole('button', { name: 'Дополнить' })).toBeNull();
  });

  it('shows a voided completion as cancelled, still missing and completable again', async () => {
    vi.spyOn(walletAddressesApi, 'transactions').mockResolvedValue({
      ...completed,
      missingUsdValueCount: 2,
      items: [
        {
          ...completed.items[0],
          usdValue: null,
          usdValueStatus: 'missing',
          trade: { accountId, tradeId, status: 'voided', grossUsd: '1000', feeUsd: '0' },
        },
        transactions.items[1],
      ],
    });
    renderPage();
    const table = await screen.findByRole('table', { name: `Транзакции ${address}` });
    const rows = within(table).getAllByRole('row');
    expect(rows[1].textContent).toContain('Сделка отменена');
    expect(rows[1].textContent).not.toContain('1000');
    const cells = within(rows[1]).getAllByRole('cell');
    expect(cells[cells.length - 1].textContent).toBe('не указана');
    expect(within(rows[1]).getByRole('link', { name: 'Trust Wallet' })).toBeTruthy();
    expect(within(rows[1]).getByRole('button', { name: 'Дополнить' })).toBeTruthy();
  });

  it('waits for the journal read before saving and keeps the request id on retry', async () => {
    let resolveState: (value: Awaited<ReturnType<typeof tradesApi.state>>) => void = () => {};
    vi.spyOn(tradesApi, 'state').mockReturnValue(
      new Promise((resolve) => {
        resolveState = resolve;
      }),
    );
    const complete = vi
      .spyOn(walletAddressesApi, 'complete')
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue({} as never);
    renderPage();
    const table = await screen.findByRole('table', { name: `Транзакции ${address}` });
    const row = within(table).getAllByRole('row')[1];
    fireEvent.click(within(row).getByRole('button', { name: 'Дополнить' }));
    const form = await screen.findByRole('group', { name: 'Сделка в USD' });
    await waitFor(() => expect(tradesApi.state).toHaveBeenCalledWith(accountId));
    fireEvent.change(within(form).getByLabelText('Валовая сумма, USD'), {
      target: { value: '1000' },
    });
    const save = within(form.closest('form') as HTMLElement).getByRole('button', {
      name: 'Сохранить сделку',
    });
    fireEvent.click(save);
    expect(complete).not.toHaveBeenCalled();
    resolveState({
      accountId,
      eligible: false,
      ineligibilityReason: 'already-initialized',
      journal: { journalRevision: 7 },
    } as unknown as Awaited<ReturnType<typeof tradesApi.state>>);
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
    const [first, second] = complete.mock.calls.map(([, , body]) => body.trade);
    expect(first.expectedJournalRevision).toBe(7);
    expect(first.instrumentId).toBe(instrumentId);
    expect(second.requestId).toBe(first.requestId);
  });
});
