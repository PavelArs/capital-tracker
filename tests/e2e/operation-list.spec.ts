import { createHash, randomUUID } from 'node:crypto';
import { expect, type Locator } from '@playwright/test';
import { compose, origin, test } from './mfa-fixtures';
import { tradeApi, tradeInput } from './usd-trades-fixtures';

// All names, amounts and the address are synthetic. The shared acceptance database holds
// other cases' operations too, so this case finds its own rows by account and wallet.
const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const walletLabel = 'Bitcoin wallet bc1qw5…f3t4';
// providers.cjs transaction 0: 100000 sats received at block time 1700000000.
const txid = createHash('sha256').update(`ct-e2e-tx:${address}:0`).digest('hex');

type ListedOperation = {
  type: string | null;
  quantity: string;
  valueUsd: string | null;
  status: string;
  source: string;
  account: { id: string } | null;
  wallet: { address: string } | null;
  chain: { txid: string } | null;
};

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
const cells = (row: Locator) => row.getByRole('cell');

test('OPS-UI: manual, CSV and blockchain operations in one Transactions list with filters and details', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  expect((await request.get('/api/accounting/operations')).status()).toBe(401);

  const api = await tradeApi(page);
  const suffix = randomUUID().slice(0, 8);
  const accountName = `OPS-UI account ${suffix}`;
  const account = await api.account(accountName);
  await api.initialize(account.id);
  const coin = (await api.result('POST', '/instruments', 201, {
    requestId: randomUUID(),
    name: `OPS-UI bitcoin ${suffix}`,
    symbol: 'BTC',
    assetType: 'crypto',
  })) as { id: string };
  // OPS-LIST: a manual buy ...
  await api.create(
    account.id,
    tradeInput(coin.id, 0, {
      occurredAt: '2025-06-13T00:00:00.000Z',
      quantity: '0.00918359',
      grossUsd: '1000',
    }),
  );
  // ... a CSV-imported buy ...
  const bytes = Buffer.from(
    'instrument,side,time,order,quantity,gross,fee\nOPSBTC,buy,2025-06-14T10:30:00Z,0,0.01,1050.5,1.25\n',
  );
  const headers = { Origin: origin, 'X-CSRF-Token': api.csrfToken };
  const uploaded = await api.request.post(`/api/accounting/accounts/${account.id}/csv-imports`, {
    headers,
    multipart: {
      file: { name: 'upload.csv', mimeType: 'application/octet-stream', buffer: bytes },
      displayNameBase64url: Buffer.from('ops-ui.csv').toString('base64url'),
    },
  });
  expect(uploaded.status()).toBe(201);
  const { batchId } = (await uploaded.json()) as { batchId: string };
  const settings = {
    format: { delimiter: ',', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: {
      columns: {
        instrument: 0,
        side: 1,
        occurredAt: 2,
        order: 3,
        quantity: 4,
        grossUsd: 5,
        feeUsd: 6,
      },
      instruments: [{ source: 'OPSBTC', instrumentId: coin.id }],
      sides: [{ source: 'buy', side: 'buy' }],
    },
    assertUsd: true,
  };
  const batch = `/accounts/${account.id}/csv-imports/${batchId}`;
  const preview = (await api.result('POST', `${batch}/preview`, 200, settings)) as {
    canConfirm: boolean;
    journalRevision: number;
    previewHash: string;
  };
  expect(preview.canConfirm).toBe(true);
  await api.result('POST', `${batch}/confirm`, 201, {
    requestId: randomUUID(),
    expectedJournalRevision: preview.journalRevision,
    parserVersion: 'usd-csv-v1',
    ...settings,
    previewHash: preview.previewHash,
  });
  // ... and a chain receipt from the Esplora fixture.
  bitcoinHistory({ address, count: 1 });
  const registered = await api.request.post('/api/wallet-addresses', {
    data: { address },
    headers,
  });
  expect([200, 201]).toContain(registered.status());
  const wallet = (await registered.json()) as { id: string };
  const synced = await api.request.post(`/api/wallet-addresses/${wallet.id}/sync`, { headers });
  expect(synced.status()).toBe(200);

  const listed = (await api.result('GET', '/operations', 200)) as {
    needsClassificationCount: number;
    operations: ListedOperation[];
  };
  const mine = listed.operations.filter(
    (operation) => operation.account?.id === account.id || operation.chain?.txid === txid,
  );
  expect(
    mine.map((operation) => [
      operation.type,
      operation.quantity,
      operation.valueUsd,
      operation.status,
      operation.source,
    ]),
  ).toEqual([
    ['buy', '0.01', '1050.5', 'recorded', 'csv'],
    ['buy', '0.00918359', '1000', 'recorded', 'manual'],
    [null, '0.001', null, 'needs-classification', 'chain'],
  ]);
  expect(listed.needsClassificationCount).toBeGreaterThanOrEqual(1);
  expect((await api.send('GET', '/operations?asset=BTC')).status()).toBe(400);

  await page.goto('/transactions');
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', { level: 1, name: 'Transactions', exact: true }),
  ).toBeVisible();
  await expect(main.getByText(/not built yet/i)).toHaveCount(0);
  const table = main.getByRole('table', { name: 'Transactions', exact: true });
  // Day headings are rows of their own; operations are the other rows.
  const rows = table.locator('tbody tr:not(.transactions-day)');
  await expect(table.getByRole('columnheader')).toHaveText([
    'Type',
    'Asset',
    'Amount',
    'Value',
    'Account',
    'Status',
    'Source',
  ]);

  const accountFilter = main.getByRole('combobox', { name: 'Account', exact: true });
  await accountFilter.selectOption({ label: accountName });
  await expect(rows).toHaveCount(2);
  await expect(table.getByRole('rowheader')).toHaveText(['Jun 14, 2025', 'Jun 13, 2025']);
  await expect(cells(rows.nth(0))).toHaveText([
    'Buy10:30',
    'BTC',
    '+0.01',
    '$1,050.50',
    accountName,
    'Recorded',
    'CSV',
  ]);
  await expect(cells(rows.nth(1))).toHaveText([
    'BuyNo time',
    'BTC',
    '+0.00918359',
    '$1,000.00',
    accountName,
    'Recorded',
    'Manual',
  ]);
  // OPS-CURRENCY: the list switches to RUB at Bank of Russia rates and keeps the filter.
  await main.getByRole('radio', { name: 'RUB', exact: true }).check();
  await expect(page).toHaveURL(/currency=RUB/);
  await expect(page).toHaveURL(/account=/);
  await expect(rows).toHaveCount(2);
  await expect(cells(rows.nth(0)).nth(3)).toHaveText(/^(₽[\d,]+\.\d{2}|—No rate)$/);
  await main.getByRole('radio', { name: 'USD', exact: true }).check();
  await expect(cells(rows.nth(0)).nth(3)).toHaveText('$1,050.50');
  // OPS-PHONE: at 390 px two-line rows replace the table and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  const phoneList = main.getByRole('list', { name: 'Transactions', exact: true });
  await expect(phoneList).toBeVisible();
  await expect(table).toHaveCount(0);
  await expect(phoneList.getByRole('heading', { level: 2 })).toHaveText([
    'Jun 14, 2025',
    'Jun 13, 2025',
  ]);
  const items = phoneList.getByRole('button');
  await expect(items).toHaveText([
    `Buy BTC${accountName} · 10:30+0.01$1,050.50`,
    `Buy BTC${accountName}+0.00918359$1,000.00`,
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('transactions-390-dark.png') });
  await items.nth(0).click();
  await expect(page.getByRole('dialog', { name: 'Buy · BTC' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(rows).toHaveCount(2);
  await accountFilter.selectOption({ label: walletLabel });
  await expect(rows).toHaveCount(1);
  const receipt = cells(rows.nth(0));
  await expect(table.getByRole('rowheader')).toHaveText(['Nov 14, 2023']);
  await expect(receipt.nth(0)).toHaveText('Incoming22:13');
  await expect(receipt.nth(1)).toHaveText('BTC');
  await expect(receipt.nth(2)).toHaveText('+0.001');
  // A raw chain row has no recorded value: an estimate at a stored price, or none at all.
  await expect(receipt.nth(3)).toHaveText(/^(≈ \$[\d,]+\.\d{2}|—)$/);
  await expect(receipt.nth(4)).toHaveText(walletLabel);
  await expect(receipt.nth(5)).toHaveText('Needs classification');
  await expect(receipt.nth(6)).toHaveText('Blockchain');
  await page.screenshot({ path: testInfo.outputPath('transactions-wallet-1440-dark.png') });

  // OPS-FILTER: asset BTC and status "Needs classification" leave only matching rows.
  await accountFilter.selectOption({ label: 'All accounts' });
  await main.getByRole('combobox', { name: 'Asset', exact: true }).selectOption({ label: 'BTC' });
  await main.getByRole('button', { name: /^Needs classification/ }).click();
  await expect(main.getByRole('button', { name: /^Needs classification/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).toHaveURL(/status=needs-classification/);
  await expect(rows.filter({ hasText: walletLabel })).toHaveCount(1);
  await expect(rows.filter({ hasText: accountName })).toHaveCount(0);
  const count = await rows.count();
  for (let index = 0; index < count; index++) {
    await expect(cells(rows.nth(index)).nth(1)).toHaveText(/^BTC/);
    await expect(cells(rows.nth(index)).nth(5)).toHaveText('Needs classification');
  }
  await page.screenshot({ path: testInfo.outputPath('transactions-filter-1440-dark.png') });

  await rows.filter({ hasText: walletLabel }).getByRole('button', { name: 'Incoming' }).click();
  const drawer = page.getByRole('dialog', { name: 'Incoming transaction · BTC' });
  await expect(drawer).toBeVisible();
  const details = drawer.getByRole('region', { name: 'Details' });
  for (const [label, value] of [
    ['Date', 'Nov 14, 2023, 22:13 UTC'],
    ['Network', 'Bitcoin'],
    ['Wallet', address],
    ['Transaction', txid],
    ['Network fee', 'Paid by sender'],
    ['Status', 'Needs classification'],
    ['Source', 'Blockchain'],
  ] as const) {
    await expect(
      details.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText(value);
  }
  await page.screenshot({ path: testInfo.outputPath('transactions-drawer-1440-dark.png') });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  await main.getByRole('button', { name: /^All/ }).click();
  await accountFilter.selectOption({ label: accountName });
  await rows.nth(0).getByRole('button', { name: 'Buy' }).click();
  const tradeDrawer = page.getByRole('dialog', { name: 'Buy · BTC' });
  await expect(
    tradeDrawer.getByText('Source', { exact: true }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('Imported from CSV');
  // Since M9 a buy or sell is edited and deleted right in the drawer.
  await expect(tradeDrawer.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(tradeDrawer.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await expect(tradeDrawer.getByRole('link')).toHaveCount(0);
  await tradeDrawer.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit transaction', exact: true });
  await expect(edit.getByLabel('Amount')).toHaveValue('0.01');
  await expect(edit.getByLabel('Total paid')).toHaveValue('1050.5');
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await expect(edit).toHaveCount(0);
  expect(errors).toEqual([]);
});
