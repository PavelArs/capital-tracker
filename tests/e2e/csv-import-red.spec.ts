import { createHash } from 'node:crypto';
import { type Page, expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ledgerState,
} from './admission-fixtures';
import { providerRequests } from './manual-opening-fixtures';
import { fingerprint, origin, test } from './mfa-fixtures';
import {
  type TradeApi,
  browserPost,
  noStore,
  restartWithExactProviderWarmup,
  trackBrowserRequests,
  tradeApi,
} from './usd-trades-fixtures';

// Maintained predecessor-image acceptance: all setup uses the verified USD journal.
// No future CSV production module, table query, authentication mock or injected token.
const csvTables = ['account_csv_imports', 'account_csv_import_commands', 'account_csv_import_rows'];
const filename = 'Сделки 📒.csv';
const literalMarkup = '<img data-csv-canary="unsafe" src="invalid">';
const headers = ['instrument', 'side', 'time', 'order', 'quantity', 'gross', 'fee', 'note'];
const source = Buffer.from(
  '\uFEFFinstrument,side,time,order,quantity,gross,fee,note\r\n' +
    'TOKEN,sell,2025-01-03T00:00:00Z,0,1.5,450,0,"Первое примечание\r\nВторая строка"\r\n' +
    'TOKEN,buy,2025-01-01T00:00:00Z,0,1,100,0,"<img data-csv-canary=""unsafe"" src=""invalid"">"\r\n' +
    'TOKEN,buy,2025-01-02T00:00:00Z,0,1,200,0,=1+1\r\n',
  'utf8',
);
const inspectedRows = [
  {
    ordinal: 1,
    startLine: 2,
    cells: [
      'TOKEN',
      'sell',
      '2025-01-03T00:00:00Z',
      '0',
      '1.5',
      '450',
      '0',
      'Первое примечание\r\nВторая строка',
    ],
  },
  {
    ordinal: 2,
    startLine: 4,
    cells: ['TOKEN', 'buy', '2025-01-01T00:00:00Z', '0', '1', '100', '0', literalMarkup],
  },
  {
    ordinal: 3,
    startLine: 5,
    cells: ['TOKEN', 'buy', '2025-01-02T00:00:00Z', '0', '1', '200', '0', '=1+1'],
  },
];
const emptySummary = {
  grossBuysUsd: '0',
  buyFeesUsd: '0',
  grossSalesUsd: '0',
  sellFeesUsd: '0',
  netSalesUsd: '0',
  consumedCostUsd: '0',
  realizedUsd: '0',
  remainingCostUsd: '0',
};

type UploadIdentity = { batchId: string; sha256: string; byteLength: number; createdAt: string };

function readIdentity(value: unknown): UploadIdentity {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  const row = value as Record<string, unknown>;
  expect(Object.keys(row).sort()).toEqual(['batchId', 'byteLength', 'createdAt', 'sha256']);
  expect(row.batchId).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  expect(row.sha256).toBe(createHash('sha256').update(source).digest('hex'));
  expect(row.byteLength).toBe(source.length);
  expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(new Date(row.createdAt as string).toISOString()).toBe(row.createdAt);
  return row as UploadIdentity;
}

function retainedRows(): string {
  // The helper discovers tables on both images. Upload may add only CSV source state;
  // preserve all old journal/opening/financial/owner/MFA rows. Check admission separately.
  return fingerprint(['auth_sessions', 'auth_request_limits', ...csvTables]);
}

async function fixture(page: Page) {
  const api = await tradeApi(page);
  const account = await api.account();
  await api.initialize(account.id);
  expect((await api.state(account.id)).journal).toMatchObject({
    journalRevision: 0,
    activeTradeCount: 0,
    versionCount: 0,
    summary: emptySummary,
  });
  return { api, account };
}

async function upload(api: TradeApi, account: string, displayName: string, status: number) {
  api.calls++;
  expect(api.calls).toBeLessThanOrEqual(80);
  const response = await api.request.post(`/api/accounting/accounts/${account}/csv-imports`, {
    headers: { Origin: origin, 'X-CSRF-Token': api.csrfToken },
    multipart: {
      file: { name: 'upload.csv', mimeType: 'application/octet-stream', buffer: source },
      displayNameBase64url: Buffer.from(displayName, 'utf8').toString('base64url'),
    },
  });
  expect(
    response.status(),
    'A fully authenticated owner can retain an exact private CSV original',
  ).toBe(status);
  noStore(response);
  return readIdentity(await response.json());
}

async function expectDraft(api: TradeApi, account: string, identity: UploadIdentity) {
  expect(
    await api.result('GET', `/accounts/${account}/csv-imports/${identity.batchId}`, 200),
  ).toEqual({
    batch: { ...identity, accountId: account, filename, state: 'draft' },
    acceptedSettings: null,
    confirmReceipt: null,
    rollbackReceipt: null,
    rollbackReview: {
      journalRevision: 0,
      eligible: false,
      reason: 'not-committed',
      removedTradeCount: 0,
      additionalVersionCount: 0,
      summaryBefore: emptySummary,
      summaryAfter: null,
    },
  });
  expect(await api.trades(account)).toEqual({ journalRevision: 0, items: [], nextOffset: null });
}

test('CSV-001-A: real owner upload preserves BOM/CRLF identity and first Cyrillic filename across repetition and restart', async ({
  page,
}) => {
  const { api, account } = await fixture(page);
  const before = retainedRows();
  const admissions = ledgerState();
  let expectedProviders = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);

  try {
    const identity = await upload(api, account.id, filename, 201);
    expect(await upload(api, account.id, 'Другое имя.csv', 200)).toEqual(identity);
    await expectDraft(api, account.id, identity);
    expect(retainedRows()).toBe(before);
    expect(providerRequests(), 'Upload and private reads make no provider requests').toEqual(
      expectedProviders,
    );

    // Account for the two retained constructor warmups separately from CSV behavior.
    expectedProviders = await restartWithExactProviderWarmup();
    expect(await upload(api, account.id, 'После перезапуска.csv', 200)).toEqual(identity);
    await expectDraft(api, account.id, identity);
    expect(await api.result('GET', `/accounts/${account.id}/csv-imports`, 200)).toEqual({
      items: [{ ...identity, accountId: account.id, filename, state: 'draft' }],
      nextCursor: null,
    });
  } finally {
    expect(retainedRows(), 'CSV upload never changes existing accounting or owner rows').toBe(
      before,
    );
    expect(ledgerState(), 'Upload/restart do not reserve or reset authentication admissions').toBe(
      admissions,
    );
    expect(providerRequests()).toEqual(expectedProviders);
    assertQuota();
  }
});

test('CSV-006-A: real Russian upload and inspection show the retained filename, every literal row and physical start line', async ({
  page,
}) => {
  const { api, account } = await fixture(page);
  const before = retainedRows();
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);

  try {
    await page.goto(`/manual-accounts/${account.id}`);
    await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('imports');
    await expect(page.getByRole('heading', { name: 'Импорт CSV', exact: true })).toBeVisible();
    await page.getByLabel('Файл CSV', { exact: true }).setInputFiles({
      name: filename,
      mimeType: 'text/csv',
      buffer: source,
    });
    const uploaded = await browserPost(page, `/accounts/${account.id}/csv-imports`, () =>
      page.getByRole('button', { name: 'Загрузить CSV', exact: true }).click(),
    );
    expect(uploaded.status()).toBe(201);
    const identity = readIdentity(await uploaded.json());
    await expect(page.getByText(filename, { exact: true }).first()).toBeVisible();
    await expectDraft(api, account.id, identity);
    const afterUpload = fingerprint(['auth_sessions', 'auth_request_limits']);

    await page
      .getByRole('combobox', { name: 'Разделитель', exact: true })
      .selectOption({ label: 'Запятая (,)' });
    const inspected = await browserPost(
      page,
      `/accounts/${account.id}/csv-imports/${identity.batchId}/inspect`,
      () => page.getByRole('button', { name: 'Просмотреть исходные строки', exact: true }).click(),
    );
    expect(inspected.status()).toBe(200);
    expect(await inspected.json()).toEqual({
      batchId: identity.batchId,
      valid: true,
      headers,
      rows: inspectedRows,
      error: null,
    });
    const table = page.getByRole('table', { name: 'Исходные строки', exact: true });
    await expect(table).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(4);
    for (const header of headers) {
      await expect(table.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }
    for (const row of inspectedRows) {
      const rendered = table.getByRole('row').filter({ hasText: row.cells[2] });
      await expect(rendered).toHaveCount(1);
      await expect(rendered.getByRole('cell')).toContainText(row.cells);
      await expect(
        rendered.getByRole('cell', { name: String(row.startLine), exact: true }),
      ).toBeVisible();
    }
    await expect(table.getByRole('cell', { name: literalMarkup, exact: true })).toBeVisible();
    await expect(page.locator('[data-csv-canary]')).toHaveCount(0);
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Inspection preserves the entire uploaded source and all accounting state',
    ).toBe(afterUpload);
  } finally {
    expect(retainedRows(), 'Upload and inspection create no implicit trade or opening').toBe(
      before,
    );
    expect(providerRequests()).toEqual(providers);
    expectAdmissionDelta(admissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
    ]);
    assertQuota();
  }
});
