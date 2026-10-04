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
