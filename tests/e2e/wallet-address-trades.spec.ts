import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { readTradeVersion, tradeApi } from './usd-trades-fixtures';
import { compose, origin, query, test } from './mfa-fixtures';

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const ownerId = '11111111-1111-4111-8111-111111111111';

function bitcoinHistory(body: Record<string, unknown>): void {
  compose([
    'exec',
    '-T',
    'providers',
    'node',
    '-e',
    `fetch('http://127.0.0.1:8080/__control/bitcoin-history', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })
      .then((response) => { if (!response.ok) process.exitCode = 1; }).catch(() => { process.exitCode = 1; });`,
  ]);
}

const isolated = test.extend<{ isolatedWalletTrades: undefined }>({
  isolatedWalletTrades: [
    async ({ mfa }, use) => {
      expect(mfa).toBeDefined();
      query(`DO $$ BEGIN
        IF current_database() <> 'capital_tracker_e2e' OR current_user <> 'capital_e2e' THEN
          RAISE EXCEPTION 'Refuse wallet-address fixture outside synthetic acceptance';
        END IF;
        TRUNCATE wallet_address_trade_links, wallet_address_transactions, wallet_addresses;
      END $$`);
      await use(undefined);
    },
    { auto: true },
  ],
});

isolated(
  'ADDRT-UI / ADDRT-PRIVATE: owner completes a received transaction as a buy trade',
  async ({ page, playwright }) => {
    const api = await tradeApi(page);
    const accountName = `Trust Wallet ${randomUUID().slice(0, 8)}`;
    const account = await api.account(accountName);
    const instrument = await api.instrument(`Bitcoin ${randomUUID().slice(0, 8)}`, 'BTC');
    await api.result('POST', `/accounts/${account.id}/trade-journal`, 201, {
      requestId: randomUUID(),
      coverageFrom: '2023-01-01T00:00:00.000Z',
      assertEmpty: true,
    });

    // Synthetic history, newest first: coinbase in (3.12500003), self, out, in (0.00100000).
    bitcoinHistory({ address, count: 4 });
    await page.goto('/wallet-addresses');
    await page.getByLabel('Адрес Bitcoin', { exact: true }).fill(address);
    await page.getByRole('button', { name: 'Добавить адрес', exact: true }).click();
    const card = page.getByRole('region', { name: `Адрес ${address}`, exact: true });
    await card.getByRole('button', { name: 'Загрузить транзакции', exact: true }).click();
    await expect(card.getByText('Загружено полностью', { exact: true })).toBeVisible();
    await expect(page.getByText('Без стоимости в USD: 4 из 4', { exact: true })).toBeVisible();

    const addressId = query(`SELECT id FROM wallet_addresses WHERE "ownerId" = '${ownerId}'`);
    const txid = query(
      `SELECT txid FROM wallet_address_transactions WHERE "addressId" = '${addressId}' ORDER BY "blockHeight" DESC LIMIT 1`,
    );
    const completePath = `/api/wallet-addresses/${addressId}/transactions/${txid}/trade`;
    const anonymous = await playwright.request.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      expect(
        (await anonymous.post(completePath, { data: {}, headers: { Origin: origin } })).status(),
      ).toBe(401);
    } finally {
      await anonymous.dispose();
    }
    const missingCsrf = await page.context().request.post(completePath, {
      data: {
        accountId: account.id,
        trade: {
          requestId: randomUUID(),
          expectedJournalRevision: 0,
          instrumentId: instrument.id,
          side: 'buy',
          occurredAt: '2023-11-14T22:43:20.000Z',
          orderWithinTimestamp: 0,
          quantity: '3.12500003',
          grossUsd: '1',
          feeUsd: '0',
        },
      },
      headers: { Origin: origin },
    });
    expect(missingCsrf.status()).toBe(403);
    expect(query('SELECT count(*) FROM wallet_address_trade_links')).toBe('0');

    const table = page.getByRole('table', { name: `Транзакции ${address}`, exact: true });
    const rows = table.getByRole('row');
    await expect(rows).toHaveCount(5);
    const complete = { name: 'Дополнить', exact: true } as const;
    await expect(rows.nth(1).getByRole('button', complete)).toBeVisible();
    await expect(rows.nth(2).getByRole('button', complete)).toHaveCount(0);
    await expect(rows.nth(3).getByRole('button', complete)).toHaveCount(0);
    await expect(rows.nth(4).getByRole('button', complete)).toBeVisible();

    await rows.nth(1).getByRole('button', complete).click();
    await page.getByLabel('Счёт', { exact: true }).selectOption({ label: accountName });
    const form = page.getByRole('group', { name: 'Сделка в USD', exact: true });
    await form
      .getByLabel('Инструмент', { exact: true })
      .selectOption({ label: `${instrument.name} (BTC)` });
    await expect(form.getByLabel('Количество', { exact: true })).toHaveValue('3.12500003');
    await form.getByLabel('Валовая сумма, USD', { exact: true }).fill('1000');
    await form.getByRole('button', { name: 'Сохранить сделку', exact: true }).click();

    await expect(page.getByText('Без стоимости в USD: 3 из 4', { exact: true })).toBeVisible();
    await expect(rows.nth(1)).toContainText('1000 USD');
    await expect(rows.nth(1).getByRole('link', { name: accountName, exact: true })).toHaveAttribute(
      'href',
      `/manual-accounts/${account.id}`,
    );
    await expect(rows.nth(1).getByRole('button', complete)).toHaveCount(0);

    expect(query('SELECT count(*) FROM wallet_address_trade_links')).toBe('1');
    const state = await api.state(account.id);
    expect(state.journal?.journalRevision).toBe(1);
    const trades = await api.trades(account.id, '?journalRevision=1&offset=0&limit=50');
    expect(trades.items).toHaveLength(1);
    const [trade] = trades.items.map((item) => readTradeVersion(item));
    expect(trade).toMatchObject({
      instrumentId: instrument.id,
      side: 'buy',
      occurredAt: '2023-11-14T22:43:20.000Z',
      quantity: '3.12500003',
      grossUsd: '1000',
      feeUsd: '0',
    });
    expect(
      query(
        `SELECT "tradeId" FROM wallet_address_trade_links WHERE "addressId" = '${addressId}' AND txid = '${txid}'`,
      ),
    ).toBe(trade.tradeId);

    await page.reload();
    await expect(page.getByText('Без стоимости в USD: 3 из 4', { exact: true })).toBeVisible();
    await expect(rows.nth(1)).toContainText('1000 USD');

    await page.goto(`/manual-accounts/${account.id}`);
    const journal = page
      .getByRole('table', { name: 'Сделки журнала', exact: true })
      .getByRole('row')
      .filter({ hasText: trade.tradeId });
    await expect(journal).toContainText('3.12500003');
    await expect(journal).toContainText('1000');
  },
);
