import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ownerCount,
} from './admission-fixtures';
import {
  type CsvConfirm,
  type CsvReceipt,
  assertCommitted,
  csvFixture,
  csvRows,
  emptySummary,
  inspectAndMap,
  navigateToAccount,
  previewInBrowser,
  readCsvReceipt,
  retainedState,
  retryButton,
  uploadInBrowser,
} from './csv-import-fixtures';
import { providerRequests, rows } from './manual-opening-fixtures';
import {
  completeFactor,
  cookie,
  fingerprint,
  hashToken,
  owner,
  query,
  recoveryFactor,
  test,
} from './mfa-fixtures';
import { browserPost, trackBrowserRequests } from './usd-trades-fixtures';

test('CSV-006-B regression: a committed confirm with a lost response survives actual session expiry,401, real MFA and SPA return', async ({
  page,
}) => {
  const { api, account, instrument } = await csvFixture(page);
  const prior = retainedState(['owner_mfa_recovery']);
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  const batch = await uploadInBrowser(page, account.id);
  await inspectAndMap(page, account.id, batch, instrument.id);
  await previewInBrowser(page, account.id, batch, {
    ...emptySummary,
    grossBuysUsd: '100',
    remainingCostUsd: '100',
  });
  const path = `/api/accounting/accounts/${account.id}/csv-imports/${batch}/confirm`;
  const pattern = `**${path}`;
  const commands: CsvConfirm[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path)
      commands.push(request.postDataJSON() as CsvConfirm);
  });
  let committed: CsvReceipt | undefined;
  let lost = false;
  await page.route(
    pattern,
    async (route) => {
      // Send the unchanged request through real HTTPS/auth/PG, then lose only delivery.
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committed = readCsvReceipt(await response.json());
      expect(committed).toMatchObject({
        kind: 'confirm',
        rowCount: 1,
        firstJournalRevision: 1,
        lastJournalRevision: 1,
      });
      assertCommitted(committed);
      lost = true;
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
  try {
    await page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click();
    await expect.poll(() => lost).toBe(true);
    await expect(retryButton(page)).toBeEnabled();
    expect(commands).toHaveLength(1);
    expect(commands[0].expectedJournalRevision).toBe(0);
    const afterCommit = fingerprint(['auth_sessions', 'auth_request_limits']);
    const savedCsv = csvRows(account.id);
    const token = await cookie(page);
    const hash = hashToken(token);
    // Explicit isolated expiry fixture changes only the actual session being exercised.
    query(
      `UPDATE auth_sessions SET "lastSeenAt"=clock_timestamp()-interval '30 minutes' WHERE "tokenHash"='${hash}'`,
    );
    const denied = await browserPost(
      page,
      `/accounts/${account.id}/csv-imports/${batch}/confirm`,
      () => retryButton(page).click(),
    );
    expect(denied.status()).toBe(401);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(csvRows(account.id)).toEqual(savedCsv);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(afterCommit);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    // No page.goto/reload: authentication and return must retain this document's command.
    const beforeSecondLogin = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa_recovery',
    ]);
    const recoveryBefore = rows<{ codeHash: string; usedAt: string | null }>(
      'SELECT "codeHash","usedAt" FROM owner_mfa_recovery ORDER BY "codeHash"',
    );
    await page.getByLabel('Email', { exact: true }).fill(owner.email);
    await page.getByLabel('Пароль', { exact: true }).fill(owner.password);
    const loginResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/login' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Вход', exact: true }).click();
    expect((await loginResponse).status()).toBe(200);
    await expect(page.getByLabel('Код из приложения', { exact: true })).toBeVisible();
    await completeFactor(page, recoveryFactor());
    await navigateToAccount(page, account.id);
    await expect(
      retryButton(page),
      'A401 cannot resolve or discard the earlier committed CSV command',
    ).toBeEnabled();
    await expect(page.getByLabel('Файл CSV', { exact: true })).toBeDisabled();
    await expect(
      page.getByRole('combobox', { name: 'Сохранённая партия CSV', exact: true }),
    ).toHaveValue(batch);
    const replay = await browserPost(
      page,
      `/accounts/${account.id}/csv-imports/${batch}/confirm`,
      () => retryButton(page).click(),
    );
    expect(replay.status()).toBe(200);
    expect(readCsvReceipt(await replay.json())).toEqual(committed);
    expect(commands).toHaveLength(3);
    expect(
      commands[2],
      'Every field, settings, original key and revision survives reauthentication',
    ).toEqual(commands[0]);
    await expect(retryButton(page)).toHaveCount(0);
    expect(csvRows(account.id)).toEqual(savedCsv);
    expect(fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa_recovery'])).toBe(
      beforeSecondLogin,
    );
    const recoveryAfter = rows<{ codeHash: string; usedAt: string | null }>(
      'SELECT "codeHash","usedAt" FROM owner_mfa_recovery ORDER BY "codeHash"',
    );
    expect(recoveryAfter.map((row) => row.codeHash)).toEqual(
      recoveryBefore.map((row) => row.codeHash),
    );
    const consumed = recoveryAfter.filter(
      (row, index) => row.usedAt !== recoveryBefore[index].usedAt,
    );
    expect(consumed).toHaveLength(1);
    expect(recoveryBefore.find((row) => row.codeHash === consumed[0].codeHash)?.usedAt).toBeNull();
    expect(consumed[0].usedAt).not.toBeNull();
  } finally {
    await page.unroute(pattern);
    expect(providerRequests()).toEqual(providers);
    assertQuota();
  }
  // Authentication is independently accounted for; source and economic writes were checked above.
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
    { scope: 'login-ip', subject: await hostSubject(), hits: 1 },
    { scope: 'mfa-ip', subject: await hostSubject(), hits: 1 },
    ownerCount(1),
  ]);
  // Original existing financial/accounting rows are also retained; recovery is checked exactly above.
  expect(retainedState(['owner_mfa_recovery'])).toBe(prior);
});
