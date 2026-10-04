import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type Page, expect } from '@playwright/test';
import { loginWithMfa, restartBackend, test } from './mfa-fixtures';

// Characterize retained portfolio behavior through the real opaque-cookie authentication path.
// All credentials, addresses, database rows and browser artifacts here are synthetic test fixtures.
const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.invalid',
  password: 'Synthetic-password-42!',
};
const foreignOwnerId = '22222222-2222-4222-8222-222222222222';
const foreignWalletId = '33333333-3333-4333-8333-333333333333';
const foreignAddress = 'synthetic-foreign-bitcoin-address';
const bitcoinAddress = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const repositoryRoot = resolve(__dirname, '../..');
const composeFile = resolve(repositoryRoot, 'tests/e2e/compose.yml');

type WalletRow = {
  id: string;
  userId: string;
  type: string;
  address: string;
  balance: string;
  tokens: unknown;
  lastUpdated: string | null;
  createdAt: string;
  updatedAt: string;
};
type ProviderRequest = { method: string; url: string };

function compose(...args: string[]): string {
  return execFileSync(
    'docker',
    ['compose', '-p', 'capital-tracker-e2e', '-f', composeFile, ...args],
    { cwd: repositoryRoot, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 },
  ).trim();
}

function databaseRows(where: string): WalletRow[] {
  const sql = `SELECT COALESCE(json_agg(wallet), '[]'::json) FROM (
    SELECT id, "userId", type, address, balance::text AS balance, tokens,
      "lastUpdated", "createdAt", "updatedAt"
    FROM crypto_wallets WHERE ${where} ORDER BY id
  ) wallet`;
  return JSON.parse(
    compose(
      'exec',
      '-T',
      'postgres',
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'capital_e2e',
      '-d',
      'capital_tracker_e2e',
      '-At',
      '-c',
      sql,
    ),
  ) as WalletRow[];
}

function walletRows(id: string): WalletRow[] {
  // IDs returned by the real backend must not become arbitrary SQL in the test oracle.
  expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
  return databaseRows(`id = '${id}'::uuid`);
}

function providerControl(path: string, body?: Record<string, number>): unknown {
  const script = `
    const body = JSON.parse(process.argv[2]);
    fetch('http://127.0.0.1:8080' + process.argv[1], {
      method: body === null ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === null ? undefined : JSON.stringify(body),
    }).then(async response => {
      if (!response.ok) throw new Error('Fixture control failed: ' + response.status);
      process.stdout.write(await response.text());
    }).catch(error => { console.error(error.message); process.exit(1); });
  `;
  return JSON.parse(
    compose('exec', '-T', 'providers', 'node', '-e', script, path, JSON.stringify(body ?? null)),
  );
}

function walletProviderRequests(address: string): ProviderRequest[] {
  const requests = providerControl('/__control/requests') as ProviderRequest[];
  expect(Array.isArray(requests)).toBe(true);
  return requests.filter((request) => request.url.includes(address));
}

async function loginThroughBrowser(page: Page): Promise<string> {
  const result = await loginWithMfa(page);
  expect(result.user).toMatchObject({ id: owner.id, email: owner.email });
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
  return result.csrfToken;
}

async function openWallets(page: Page): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('link', { name: 'Криптокошельки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Криптокошельки', exact: true })).toBeVisible();
}

test('ISO-003-A: HTTPS login is public and direct private API requests are denied', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await expect(page).toHaveURL('https://127.0.0.1:8443/login');
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  const endpoints = [
    { method: 'GET', path: '/api/auth/me' },
    { method: 'GET', path: '/api/crypto' },
    { method: 'GET', path: `/api/crypto/${foreignWalletId}` },
    { method: 'POST', path: '/api/crypto', data: { type: 'bitcoin', address: bitcoinAddress } },
    { method: 'PATCH', path: `/api/crypto/${foreignWalletId}/update-balance` },
    { method: 'DELETE', path: `/api/crypto/${foreignWalletId}` },
    { method: 'GET', path: '/api/crypto/prices' },
    { method: 'POST', path: '/api/crypto/token-prices', data: { contractAddresses: [] } },
  ];
  const foreignBefore = walletRows(foreignWalletId);
  expect(foreignBefore).toHaveLength(1);
  for (const endpoint of endpoints) {
    await test.step(`${endpoint.method} ${endpoint.path}`, async () => {
      const response = await request.fetch(endpoint.path, {
        method: endpoint.method,
        data: endpoint.data,
      });
      expect(response.status()).toBe(401);
      const body = await response.text();
      expect(body).not.toContain(owner.email);
      expect(body).not.toContain(foreignAddress);
      expect(body).not.toContain('"balance"');
    });
  }
  expect(walletRows(foreignWalletId)).toEqual(foreignBefore);
});

test('ISO-003-B: the browser authenticates using the real seeded password', async ({ page }) => {
  await loginThroughBrowser(page);
  await openWallets(page);
  await expect(page.getByText(foreignAddress, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('navigation').getByText(owner.email, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Криптокошельки', exact: true })).toBeVisible();
});

test('ISO-004-A/ISO-004-B: BTC create, restart, refresh and delete persist through PostgreSQL', async ({
  page,
  request,
}) => {
  providerControl('/__control/reset', {});
  await loginThroughBrowser(page);
  await openWallets(page);
  expect(databaseRows(`"userId" = '${owner.id}'::uuid`)).toEqual([]);

  await test.step('Browser creates a wallet through the real outbound adapter', async () => {
    await page.getByRole('button', { name: 'Добавить кошелек', exact: true }).click();
    await page.getByLabel('Тип', { exact: true }).selectOption('bitcoin');
    await page.getByLabel('Адрес', { exact: true }).fill(bitcoinAddress);
    await page.getByRole('button', { name: 'Добавить кошелек', exact: true }).click();
    await expect(page.getByText(bitcoinAddress, { exact: true })).toBeVisible();
    await expect(page.getByText('1.25000000 BTC', { exact: true })).toBeVisible();
    expect(walletProviderRequests(bitcoinAddress).length).toBeGreaterThan(0);
  });

  const created = databaseRows(`"userId" = '${owner.id}'::uuid`);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    userId: owner.id,
    type: 'bitcoin',
    address: bitcoinAddress,
    balance: '1.250000000000000000',
  });
  expect(created[0].lastUpdated).not.toBeNull();
  const walletId = created[0].id;

  await test.step('Reload and backend restart preserve the same complete database row', async () => {
    await page.reload();
    await expect(page.getByText('1.25000000 BTC', { exact: true })).toBeVisible();
    expect(walletRows(walletId)).toEqual(created);
    await restartBackend(request);
    await page.reload();
    await expect(page.getByText(bitcoinAddress, { exact: true })).toBeVisible();
    await expect(page.getByText('1.25000000 BTC', { exact: true })).toBeVisible();
    expect(walletRows(walletId)).toEqual(created);
  });

  await test.step('Explicit refresh reads the new fixture and updates stored balance', async () => {
    providerControl('/__control/bitcoin', { funded: 225000000, spent: 25000000 });
    const before = walletProviderRequests(bitcoinAddress).length;
    await page.getByRole('button', { name: 'Обновить баланс', exact: true }).click();
    await expect(page.getByText('2.00000000 BTC', { exact: true })).toBeVisible();
    expect(walletRows(walletId)).toHaveLength(1);
    expect(walletRows(walletId)[0]).toMatchObject({
      id: walletId,
      userId: owner.id,
      address: bitcoinAddress,
      balance: '2.000000000000000000',
    });
    expect(walletProviderRequests(bitcoinAddress).length).toBeGreaterThan(before);
    await page.reload();
    await expect(page.getByText('2.00000000 BTC', { exact: true })).toBeVisible();
  });

  await test.step('Browser deletion removes the row without resurrection on reload', async () => {
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page.getByText(bitcoinAddress, { exact: true })).toHaveCount(0);
    expect(walletRows(walletId)).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Криптокошельки', exact: true })).toBeVisible();
    await expect(page.getByText(bitcoinAddress, { exact: true })).toHaveCount(0);
    expect(walletRows(walletId)).toEqual([]);
  });
});

test("ISO-004-C: another owner's wallet cannot be read, deleted or refreshed", async ({ page }) => {
  const csrfToken = await loginThroughBrowser(page);
  await openWallets(page);
  const before = walletRows(foreignWalletId);
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({ userId: foreignOwnerId, address: foreignAddress });
  await expect(page.getByText(foreignAddress, { exact: true })).toHaveCount(0);
  const providerBefore = walletProviderRequests(foreignAddress);

  for (const [method, path] of [
    ['GET', `/api/crypto/${foreignWalletId}`],
    ['DELETE', `/api/crypto/${foreignWalletId}`],
    ['PATCH', `/api/crypto/${foreignWalletId}/update-balance`],
  ]) {
    await test.step(`${method} rejects foreign ownership without mutation or provider access`, async () => {
      // Share the real browser cookie jar; never inject a cookie or token to establish access.
      const response = await page.context().request.fetch(path, {
        method,
        headers: { Origin: 'https://127.0.0.1:8443', 'X-CSRF-Token': csrfToken },
      });
      expect(response.status()).toBe(404);
      const body = await response.text();
      expect(body).not.toContain(foreignAddress);
      expect(body).not.toContain('"balance"');
      expect(walletRows(foreignWalletId)).toEqual(before);
      expect(walletProviderRequests(foreignAddress)).toEqual(providerBefore);
    });
  }
});
