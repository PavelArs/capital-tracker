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
  buy,
  csvFixture,
  csvRows,
  csvSource,
  emptySummary,
  expectCsvSummary,
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
import { browserPost, trackBrowserRequests, tradeInput } from './usd-trades-fixtures';

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

test('CSV-004-A / CSV-006-A regression: explicit CSV refresh reviews the new journal revision and safely reallocates200 to100', async ({
  page,
}) => {
  const { api, account, instrument } = await csvFixture(page);
  const prior = retainedState();
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
  const acceptedResponse = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/confirm`,
    () => page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
  );
  expect(acceptedResponse.status()).toBe(201);
  const accepted = readCsvReceipt(await acceptedResponse.json());
  assertCommitted(accepted);
  const reviewCheck = page.getByRole('checkbox', {
    name: 'Я проверил последствия отката всей партии',
    exact: true,
  });
  await expect(reviewCheck).toBeEnabled();
  // The outside writes are real authenticated API requests, with distinct chronology.
  await api.create(
    account.id,
    tradeInput(instrument.id, 1, { occurredAt: '2025-01-03T00:00:00.000Z', grossUsd: '200' }),
  );
  await api.create(
    account.id,
    tradeInput(instrument.id, 2, {
      side: 'sell',
      occurredAt: '2025-01-04T00:00:00.000Z',
      grossUsd: '300',
    }),
  );
  const beforeRefresh = fingerprint(['auth_sessions', 'auth_request_limits']);
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/accounting/accounts/${account.id}/csv-imports/${batch}` &&
      response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Обновить состояние CSV', exact: true }).click();
  const response = await refreshed;
  expect(response.status()).toBe(200);
  expect((await response.json()).rollbackReview).toMatchObject({
    journalRevision: 3,
    eligible: true,
    reason: null,
  });
  await expectCsvSummary(page, 'До отката', {
    grossBuysUsd: '300',
    buyFeesUsd: '0',
    grossSalesUsd: '300',
    sellFeesUsd: '0',
    netSalesUsd: '300',
    consumedCostUsd: '100',
    realizedUsd: '200',
    remainingCostUsd: '200',
  });
  await expectCsvSummary(page, 'После отката', {
    grossBuysUsd: '200',
    buyFeesUsd: '0',
    grossSalesUsd: '300',
    sellFeesUsd: '0',
    netSalesUsd: '300',
    consumedCostUsd: '200',
    realizedUsd: '100',
    remainingCostUsd: '0',
  });
  await expect(
    reviewCheck,
    'CSV refresh must reconcile the parent journal revision before explicit rollback review',
  ).toBeEnabled();
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforeRefresh);
  const rollback = page.getByRole('button', { name: 'Откатить партию CSV', exact: true });
  await expect(rollback).toBeDisabled();
  await reviewCheck.check();
  const result = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/rollback`,
    () => rollback.click(),
  );
  expect(result.status()).toBe(201);
  const receipt = readCsvReceipt(await result.json());
  expect(receipt).toMatchObject({
    kind: 'rollback',
    rowCount: 1,
    firstJournalRevision: 4,
    lastJournalRevision: 4,
  });
  assertCommitted(receipt);
  expect((await api.state(account.id)).journal).toMatchObject({
    journalRevision: 4,
    activeTradeCount: 2,
    versionCount: 4,
    summary: { realizedUsd: '100', remainingCostUsd: '0' },
  });
  expect((await api.lots(account.id)).items).toEqual([]);
  const evidence = (await api.result(
    'GET',
    `/accounts/${account.id}/csv-imports/${batch}/rows`,
    200,
  )) as { items: { createVersion: { version: number }; rollbackVersion: { version: number } }[] };
  expect(evidence.items).toHaveLength(1);
  expect(evidence.items[0]).toMatchObject({
    createVersion: { version: 1 },
    rollbackVersion: { version: 2 },
  });
  expect(retainedState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  assertQuota();
});

test('CSV-006-B regression: choosing a new unuploaded file cannot confirm the previously inspected batch under the new filename', async ({
  page,
}) => {
  const { api, account, instrument } = await csvFixture(page);
  const prior = retainedState();
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  const first = await uploadInBrowser(page, account.id, [buy], 'Первая партия.csv');
  await inspectAndMap(page, account.id, first, instrument.id);
  await previewInBrowser(page, account.id, first, {
    ...emptySummary,
    grossBuysUsd: '100',
    remainingCostUsd: '100',
  });
  const firstState = fingerprint(['auth_sessions', 'auth_request_limits']);
  const replacement = [{ ...buy, gross: '200' }];
  await page
    .getByLabel('Файл CSV', { exact: true })
    .setInputFiles({
      name: 'Новая партия.csv',
      mimeType: 'text/csv',
      buffer: csvSource(replacement),
    });
  await expect(page.getByText('Выбранный файл: Новая партия.csv', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Предпросмотр импорта', exact: true })).toHaveCount(
    0,
  );
  for (const label of ['Проверить импорт', 'Подтвердить импорт CSV']) {
    const action = page.getByRole('button', { name: label, exact: true });
    await expect
      .poll(async () => (await action.count()) === 0 || (await action.isDisabled()), {
        message: 'The new displayed file must not retain an actionable old batch mapping/preview',
      })
      .toBe(true);
  }
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(firstState);
  const second = await uploadInBrowser(page, account.id, replacement, 'Новая партия.csv');
  expect(second).not.toBe(first);
  await inspectAndMap(page, account.id, second, instrument.id, replacement);
  await previewInBrowser(page, account.id, second, {
    ...emptySummary,
    grossBuysUsd: '200',
    remainingCostUsd: '200',
  });
  const response = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${second}/confirm`,
    () => page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
  );
  expect(response.status()).toBe(201);
  const accepted = readCsvReceipt(await response.json());
  expect(accepted.batchId).toBe(second);
  assertCommitted(accepted);
  expect(
    rows(`SELECT id,state FROM account_csv_imports WHERE "accountId"='${account.id}' ORDER BY id`),
  ).toEqual(
    [
      { id: first, state: 'draft' },
      { id: second, state: 'committed' },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  );
  expect((await api.state(account.id)).journal).toMatchObject({
    journalRevision: 1,
    activeTradeCount: 1,
    summary: { grossBuysUsd: '200', remainingCostUsd: '200' },
  });
  expect(retainedState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  assertQuota();
});
