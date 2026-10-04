import { createHash, randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { providerRequests } from './manual-opening-fixtures';
import { compose, loginWithMfa, origin, query, test } from './mfa-fixtures';

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const foreignAddressId = '44444444-4444-4444-8444-444444444444';
const txid = (i: number) => createHash('sha256').update(`ct-e2e-tx:${address}:${i}`).digest('hex');
// The shared stub keeps requests from earlier acceptance steps, so count only this test's requests.
let requestBaseline = 0;
const chainRequests = () =>
  providerRequests()
    .slice(requestBaseline)
    .filter(({ url }) => url.startsWith('https://blockstream.info/api/address/'));

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

const isolated = test.extend<{ isolatedWalletAddresses: undefined }>({
  isolatedWalletAddresses: [
    async ({ mfa }, use) => {
      expect(mfa).toBeDefined();
      query(`DO $$ BEGIN
        IF current_database() <> 'capital_tracker_e2e' OR current_user <> 'capital_e2e' THEN
          RAISE EXCEPTION 'Refuse wallet-address fixture outside synthetic acceptance';
        END IF;
        TRUNCATE wallet_address_transactions, wallet_addresses;
        INSERT INTO wallet_addresses(id, "ownerId", network, address)
          VALUES ('${foreignAddressId}', '22222222-2222-4222-8222-222222222222', 'bitcoin', '${address}');
      END $$`);
      requestBaseline = providerRequests().length;
      await use(undefined);
    },
    { auto: true },
  ],
});

isolated(
  'ADDR-UI / ADDR-PRIVATE: owner imports Bitcoin history and sees every USD value as missing',
  async ({ page, playwright }) => {
    const anonymous = await playwright.request.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      expect((await anonymous.get('/api/wallet-addresses')).status()).toBe(401);
      expect(
        (
          await anonymous.post('/api/wallet-addresses', {
            data: { address },
            headers: { Origin: origin },
          })
        ).status(),
      ).toBe(401);
    } finally {
      await anonymous.dispose();
    }

    const { csrfToken } = await loginWithMfa(page);
    const api = page.context().request;
    const missingCsrf = await api.post('/api/wallet-addresses', {
      data: { address },
      headers: { Origin: origin },
    });
    expect(missingCsrf.status()).toBe(403);
    const foreign = await api.post(`/api/wallet-addresses/${foreignAddressId}/sync`, {
      headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
    });
    expect(foreign.status()).toBe(404);
    expect((await api.get(`/api/wallet-addresses/${foreignAddressId}/transactions`)).status()).toBe(404);
    expect((await api.get(`/api/wallet-addresses/${randomUUID()}/transactions`)).status()).toBe(404);
    expect(query('SELECT count(*) FROM wallet_addresses')).toBe('1');
    expect(chainRequests()).toEqual([]);

    bitcoinHistory({ address, count: 60 });
    await page.goto('/wallet-addresses');
    await expect(page.getByRole('heading', { name: 'Адреса кошельков', exact: true })).toBeVisible();
    await expect(page.getByText('Адресов пока нет.', { exact: true })).toBeVisible();

    await page.getByLabel('Адрес Bitcoin', { exact: true }).fill(address.toUpperCase());
    await page.getByRole('button', { name: 'Добавить адрес', exact: true }).click();
    const card = page.getByRole('region', { name: `Адрес ${address}`, exact: true });
    await expect(card.getByText('Не загружено', { exact: true })).toBeVisible();
    expect(chainRequests()).toEqual([]);

    await card.getByRole('button', { name: 'Загрузить транзакции', exact: true }).click();
    await expect(card.getByText('Загружено полностью', { exact: true })).toBeVisible();
    await expect(card.getByText('Транзакций: 60', { exact: true })).toBeVisible();
    expect(chainRequests().map(({ url }) => url)).toEqual([
      `https://blockstream.info/api/address/${address}/txs/chain`,
      `https://blockstream.info/api/address/${address}/txs/chain/${txid(35)}`,
      `https://blockstream.info/api/address/${address}/txs/chain/${txid(10)}`,
    ]);

    const table = page.getByRole('table', { name: `Транзакции ${address}`, exact: true });
    const assertHistory = async () => {
      await expect(page.getByText('Без стоимости в USD: 60 из 60', { exact: true })).toBeVisible();
      const rows = table.getByRole('row');
      await expect(rows).toHaveCount(51);
      await expect(rows.nth(1)).toContainText('3.12500059');
      await expect(rows.nth(1)).toContainText('Поступление');
      await expect(rows.nth(1)).toContainText('2023-11-15');
      await expect(rows.nth(2)).toContainText('-0.00000200');
      await expect(rows.nth(2)).toContainText('Перевод себе');
      await expect(rows.nth(3)).toContainText('-0.00051300');
      await expect(rows.nth(3)).toContainText('Списание');
      await expect(rows.nth(4)).toContainText('0.00156000');
      for (let index = 1; index <= 4; index++) {
        await expect(rows.nth(index).getByRole('cell').last()).toHaveText('не указана');
      }
      await expect(table.getByRole('cell', { name: '0', exact: true })).toHaveCount(0);
      await expect(table.getByText('$0', { exact: false })).toHaveCount(0);
    };
    await assertHistory();
    await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(61);
    await expect(page.getByRole('button', { name: 'Показать ещё', exact: true })).toHaveCount(0);

    const before = chainRequests().length;
    await page.reload();
    await expect(card.getByText('Загружено полностью', { exact: true })).toBeVisible();
    await assertHistory();
    expect(chainRequests()).toHaveLength(before);
    expect(
      query(`SELECT count(*) FROM wallet_address_transactions t JOIN wallet_addresses a ON a.id = t."addressId"
        WHERE a."ownerId" = '11111111-1111-4111-8111-111111111111'`),
    ).toBe('60');
    expect(
      query(`SELECT count(*) FROM wallet_address_transactions WHERE "addressId" = '${foreignAddressId}'`),
    ).toBe('0');
  },
);
