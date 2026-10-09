import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { expect } from '@playwright/test';
import { cookie, hashToken, owner, test } from './mfa-fixtures';
import { tradeApi, tradeInput } from './usd-trades-fixtures';

// M19 over the real frontend, proxy, backend and PostgreSQL. Names and amounts are synthetic;
// the shared acceptance database holds other cases' records too, so this case finds its own.

/** Every file of a ZIP archive by name, read through its central directory. */
function unzip(archive: Buffer): Map<string, string> {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const files = new Map<string, string>();
  let at = archive.readUInt32LE(end + 16);
  for (let index = 0; index < archive.readUInt16LE(end + 10); index++) {
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    files.set(name, inflateRawSync(archive.subarray(start, start + size)).toString('utf8'));
    at += 46 + nameLength;
  }
  return files;
}

test('EXP-UI / EXP-CSV / EXP-JSON: Settings → Data downloads the CSV archive and a JSON backup without secrets', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const path of ['/api/export/csv', '/api/export/backup']) {
    const anonymous = await request.get(path);
    expect(anonymous.status()).toBe(401);
  }

  const api = await tradeApi(page);
  const suffix = randomUUID().slice(0, 8);
  const accountName = `EXP-UI account ${suffix}`;
  const account = await api.account(accountName);
  await api.initialize(account.id);
  const coin = (await api.result('POST', '/instruments', 201, {
    requestId: randomUUID(),
    name: `EXP-UI bitcoin ${suffix}`,
    symbol: 'BTC',
    assetType: 'crypto',
  })) as { id: string };
  await api.create(
    account.id,
    tradeInput(coin.id, 0, {
      occurredAt: '2025-06-13T00:00:00.000Z',
      quantity: '0.00918359',
      grossUsd: '1000',
    }),
  );
  const session = await cookie(page);

  await page.goto('/preferences');
  const data = page.getByRole('region', { name: 'Data', exact: true });
  await expect(data.getByText('one CSV file each in a ZIP archive', { exact: false })).toBeVisible();

  // EXP-CSV: one archive, one CSV per entity, the account's buy among the operations.
  const archiveDownload = page.waitForEvent('download');
  const archiveResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/export/csv',
  );
  await data.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csvResponse = await archiveResponse;
  expect(csvResponse.status()).toBe(200);
  expect(csvResponse.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
  const archive = await archiveDownload;
  expect(archive.suggestedFilename()).toMatch(/^capital-tracker-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzip(await readFile(await archive.path()));
  expect([...files.keys()]).toEqual([
    'assets.csv',
    'accounts.csv',
    'wallets.csv',
    'operations.csv',
    'chain-transactions.csv',
  ]);
  expect(files.get('accounts.csv')).toContain(`${account.id},${accountName},`);
  const operations = (files.get('operations.csv') ?? '').split('\r\n');
  expect(operations[0]).toMatch(/^﻿id,kind,type,direction,status,source,occurred_at,/);
  const bought = operations.find((line) => line.includes(`,${accountName},`));
  expect(bought).toMatch(
    new RegExp(
      `^trade:[0-9a-f-]{36},trade,buy,in,active,manual,2025-06-13T00:00:00\\.000Z,0,${account.id},${accountName},,,BTC,EXP-UI bitcoin ${suffix},,0\\.00918359,,,,1000,`,
    ),
  );
  await expect(data.getByText(`Downloaded ${archive.suggestedFilename()}.`)).toBeVisible();

  // EXP-JSON: the same records with a format version, and no password, TOTP or session.
  const backupDownload = page.waitForEvent('download');
  await data.getByRole('button', { name: 'Export backup', exact: true }).click();
  const backup = await backupDownload;
  expect(backup.suggestedFilename()).toMatch(/^capital-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await readFile(await backup.path(), 'utf8');
  const parsed = JSON.parse(text) as {
    format: string;
    formatVersion: number;
    tables: Record<string, Record<string, unknown>[]>;
  };
  expect([parsed.format, parsed.formatVersion]).toEqual(['capital-tracker-backup', 1]);
  expect(parsed.tables.manual_accounts.some((row) => row.id === account.id)).toBe(true);
  expect(
    parsed.tables.account_trade_versions.some(
      (row) => row.instrumentId === coin.id && row.quantity === '0.00918359',
    ),
  ).toBe(true);
  for (const secret of ['users', 'owner_auth', 'owner_mfa', 'owner_mfa_recovery', 'auth_sessions'])
    expect(parsed.tables).not.toHaveProperty(secret);
  for (const marker of [owner.email, owner.password, session, hashToken(session), api.csrfToken])
    expect(text).not.toContain(marker);
  await expect(data.getByText(`Downloaded ${backup.suggestedFilename()}.`)).toBeVisible();

  // At phone width the card fits without a horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
