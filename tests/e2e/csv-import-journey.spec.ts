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
  type CsvRollback,
  assertCommitted,
  buy,
  csvFixture,
  csvRows,
  csvSource,
  emptySummary,
  example,
  expectCsvSummary,
  expectJournalSummary,
  hasVisibleLiteral,
  inspectAndMap,
  navigateToAccount,
  previewInBrowser,
  provenanceInBrowser,
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
import {
  browserPost,
  restartWithExactProviderWarmup,
  trackBrowserRequests,
  tradeInput,
} from './usd-trades-fixtures';

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
  await page.getByLabel('Файл CSV', { exact: true }).setInputFiles({
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

test('CSV-006-A: full Russian sale-first import retains250/100/0.5, source provenance and exact replay across restart, then rolls back the complete batch', async ({
  page,
}) => {
  const { api, account, instrument } = await csvFixture(page);
  const prior = retainedState();
  let providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  const csvRegion = page.getByRole('region', { name: 'Импорт CSV', exact: true });
  await expect(csvRegion).toContainText('Не импортируйте одну историю повторно в изменённом виде');
  await expect(csvRegion).toContainText('1000 активных сделок и 10000 версий');
  const batch = await uploadInBrowser(page, account.id, example);
  const beforePreview = fingerprint(['auth_sessions', 'auth_request_limits']);
  await inspectAndMap(page, account.id, batch, instrument.id, example);
  const expected = {
    grossBuysUsd: '300',
    buyFeesUsd: '0',
    grossSalesUsd: '450',
    sellFeesUsd: '0',
    netSalesUsd: '450',
    consumedCostUsd: '200',
    realizedUsd: '250',
    remainingCostUsd: '100',
  };
  await previewInBrowser(page, account.id, batch, expected);
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforePreview);
  expect((await api.state(account.id)).journal).toMatchObject({
    journalRevision: 0,
    activeTradeCount: 0,
    versionCount: 0,
  });
  const response = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/confirm`,
    () => page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
  );
  expect(response.status()).toBe(201);
  const receipt = readCsvReceipt(await response.json());
  expect(receipt).toMatchObject({ rowCount: 3, firstJournalRevision: 1, lastJournalRevision: 3 });
  assertCommitted(receipt);
  await expectJournalSummary(page, expected);
  expect((await api.state(account.id)).journal).toMatchObject({
    journalRevision: 3,
    activeTradeCount: 3,
    versionCount: 3,
    summary: expected,
  });
  const lots = await api.lots(account.id);
  expect(lots.items).toHaveLength(1);
  expect(lots.items[0]).toMatchObject({ remainingQuantity: '0.5', remainingCostUsd: '100' });
  await expect(
    page.getByRole('table', { name: 'Открытые лоты', exact: true }).locator('tbody tr'),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole('table', { name: 'Открытые лоты', exact: true })
      .getByRole('cell', { name: '0.5', exact: true }),
  ).toBeVisible();
  const beforeRestart = fingerprint(['auth_sessions', 'auth_request_limits']);
  const links = await provenanceInBrowser(page, account.id, batch);
  expect(links).toHaveLength(3);
  for (const [index, link] of links.entries()) {
    expect(link).toMatchObject({
      ordinal: index + 1,
      startLine: index + 2,
      rollbackVersion: null,
      createVersion: {
        version: 1,
        journalRevision: index + 1,
        instrumentId: instrument.id,
        side: example[index].side,
        quantity: example[index].quantity,
        grossUsd: example[index].gross,
        feeUsd: example[index].fee,
      },
    });
  }
  expect(providerRequests()).toEqual(providers);
  providers = await restartWithExactProviderWarmup();
  await page.reload();
  await expectJournalSummary(page, expected);
  await page
    .getByRole('combobox', { name: 'Сохранённая партия CSV', exact: true })
    .selectOption(batch);
  expect(await provenanceInBrowser(page, account.id, batch)).toEqual(links);
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforeRestart);
  await page.getByLabel('Файл CSV', { exact: true }).setInputFiles({
    name: 'Переименованный источник.csv',
    mimeType: 'text/csv',
    buffer: csvSource(example),
  });
  const repeated = await browserPost(page, `/accounts/${account.id}/csv-imports`, () =>
    page.getByRole('button', { name: 'Загрузить CSV', exact: true }).click(),
  );
  expect(repeated.status()).toBe(200);
  expect((await repeated.json()).batchId).toBe(batch);
  await expect(page.getByRole('region', { name: 'Партия CSV', exact: true })).toContainText(
    'Сделки 📒.csv',
  );
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforeRestart);
  const confirm = page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true });
  await expect
    .poll(async () => (await confirm.count()) === 0 || (await confirm.isDisabled()))
    .toBe(true);
  await expectCsvSummary(page, 'После отката', emptySummary);
  await page
    .getByRole('checkbox', { name: 'Я проверил последствия отката всей партии', exact: true })
    .check();
  const rolled = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/rollback`,
    () => page.getByRole('button', { name: 'Откатить партию CSV', exact: true }).click(),
  );
  expect(rolled.status()).toBe(201);
  const rollback = readCsvReceipt(await rolled.json());
  expect(rollback).toMatchObject({
    kind: 'rollback',
    rowCount: 3,
    firstJournalRevision: 4,
    lastJournalRevision: 6,
  });
  assertCommitted(rollback);
  await expectJournalSummary(page, emptySummary);
  const afterRows = await provenanceInBrowser(page, account.id, batch);
  expect(afterRows.map((row) => row.createVersion)).toEqual(links.map((row) => row.createVersion));
  expect(afterRows.map((row) => row.rollbackVersion?.version)).toEqual([2, 2, 2]);
  expect((await api.state(account.id)).journal).toMatchObject({
    journalRevision: 6,
    activeTradeCount: 0,
    versionCount: 6,
    summary: emptySummary,
  });
  expect(
    rows(
      `SELECT encode("originalBytes",'hex') AS bytes,filename,state FROM account_csv_imports WHERE id='${batch}'`,
    ),
  ).toEqual([
    { bytes: csvSource(example).toString('hex'), filename: 'Сделки 📒.csv', state: 'rolled-back' },
  ]);
  expect(retainedState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  assertQuota();
});

for (const kind of ['confirm', 'rollback'] as const) {
  test(`CSV-006-B: lost committed ${kind}, real403 and SPA remount retain the original command and replay exactly once`, async ({
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
    if (kind === 'rollback') {
      const first = await browserPost(
        page,
        `/accounts/${account.id}/csv-imports/${batch}/confirm`,
        () => page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
      );
      expect(first.status()).toBe(201);
      assertCommitted(readCsvReceipt(await first.json()));
      await page
        .getByRole('checkbox', { name: 'Я проверил последствия отката всей партии', exact: true })
        .check();
    }
    const path = `/api/accounting/accounts/${account.id}/csv-imports/${batch}/${kind}`;
    const pattern = `**${path}`;
    const commands: Array<CsvConfirm | CsvRollback> = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === path)
        commands.push(request.postDataJSON() as CsvConfirm | CsvRollback);
    });
    let receipt: CsvReceipt | undefined;
    let lost = false;
    await page.route(
      pattern,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        receipt = readCsvReceipt(await response.json());
        expect(receipt).toMatchObject({
          kind,
          rowCount: 1,
          firstJournalRevision: kind === 'confirm' ? 1 : 2,
          lastJournalRevision: kind === 'confirm' ? 1 : 2,
        });
        assertCommitted(receipt);
        lost = true;
        await route.abort('connectionreset');
      },
      { times: 1 },
    );
    try {
      await page
        .getByRole('button', {
          name: kind === 'confirm' ? 'Подтвердить импорт CSV' : 'Откатить партию CSV',
          exact: true,
        })
        .click();
      await expect.poll(() => lost).toBe(true);
      await expect(retryButton(page)).toBeEnabled();
      expect(commands).toHaveLength(1);
      const committed = fingerprint(['auth_sessions', 'auth_request_limits']);
      await page.route(
        pattern,
        async (route) => {
          const headers = Object.fromEntries(
            Object.entries(route.request().headers()).filter(
              ([name]) => name.toLowerCase() !== 'x-csrf-token',
            ),
          );
          await route.continue({ headers });
        },
        { times: 1 },
      );
      const denied = await browserPost(
        page,
        `/accounts/${account.id}/csv-imports/${batch}/${kind}`,
        () => retryButton(page).click(),
      );
      expect(denied.status()).toBe(403);
      await expect(retryButton(page)).toBeEnabled();
      await expect(page.getByLabel('Файл CSV', { exact: true })).toBeDisabled();
      await expect(
        page.getByRole('combobox', { name: 'Сохранённая партия CSV', exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole('combobox', { name: 'Разделитель', exact: true })).toBeDisabled();
      expect(commands).toHaveLength(2);
      expect(commands[1]).toEqual(commands[0]);
      expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(committed);
      const detailRead = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/accounting/accounts/${account.id}/csv-imports/${batch}` &&
          response.request().method() === 'GET',
      );
      await page.getByRole('button', { name: 'Обновить состояние CSV', exact: true }).click();
      expect((await detailRead).status()).toBe(200);
      await expect(retryButton(page)).toBeEnabled();
      await navigateToAccount(page, account.id);
      await expect(retryButton(page)).toBeEnabled();
      await expect(page.getByLabel('Файл CSV', { exact: true })).toBeDisabled();
      expect(commands).toHaveLength(2);
      expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(committed);
      const replay = await browserPost(
        page,
        `/accounts/${account.id}/csv-imports/${batch}/${kind}`,
        () => retryButton(page).click(),
      );
      expect(replay.status()).toBe(200);
      expect(readCsvReceipt(await replay.json())).toEqual(receipt);
      expect(commands).toHaveLength(3);
      expect(commands[2]).toEqual(commands[0]);
      await expect(retryButton(page)).toHaveCount(0);
      await expectJournalSummary(
        page,
        kind === 'confirm'
          ? { ...emptySummary, grossBuysUsd: '100', remainingCostUsd: '100' }
          : emptySummary,
      );
      expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(committed);
    } finally {
      await page.unroute(pattern);
      expect(providerRequests()).toEqual(providers);
      assertQuota();
    }
    expect(retainedState()).toBe(prior);
    expectAdmissionDelta(admissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
    ]);
  });
}

test('CSV-006-B: late real preview and inspection responses cannot revive an edited mapping or a different selected file', async ({
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
  const before = fingerprint(['auth_sessions', 'auth_request_limits']);
  for (const stage of ['preview', 'inspect'] as const) {
    const path = `/api/accounting/accounts/${account.id}/csv-imports/${batch}/${stage}`;
    const pattern = `**${path}`;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    await page.route(
      pattern,
      async (route) => {
        held = true;
        // Delay only scheduling. The unchanged request and actual backend response remain real.
        await gate;
        await route.continue();
      },
      { times: 1 },
    );
    const pending = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'POST',
      { timeout: 15_000 },
    );
    pending.catch(() => {});
    try {
      await page
        .getByRole('button', {
          name: stage === 'preview' ? 'Проверить импорт' : 'Просмотреть исходные строки',
          exact: true,
        })
        .click();
      await expect.poll(() => held).toBe(true);
      if (stage === 'preview') {
        await page
          .getByRole('combobox', { name: 'Десятичный разделитель', exact: true })
          .selectOption(',');
      } else {
        await page.getByLabel('Файл CSV', { exact: true }).setInputFiles({
          name: 'Еще не загружен.csv',
          mimeType: 'text/csv',
          buffer: csvSource([{ ...buy, gross: '200' }]),
        });
      }
      release();
      const response = await pending;
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(stage === 'preview' ? body.canConfirm : body.valid).toBe(true);
      // Let the delivered real response finish its browser promise and render work.
      // Animation frames are a paint boundary, not a timing sleep or synthetic response.
      await response.finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(
        page.getByRole('region', { name: 'Предпросмотр импорта', exact: true }),
      ).toHaveCount(0);
      const confirm = page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true });
      await expect
        .poll(async () => (await confirm.count()) === 0 || (await confirm.isDisabled()))
        .toBe(true);
      if (stage === 'preview') {
        await expect(
          page.getByRole('combobox', { name: 'Десятичный разделитель', exact: true }),
        ).toHaveValue(',');
      } else {
        await expect(
          page.getByRole('group', { name: 'Сопоставление колонок и значений', exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole('table', { name: 'Исходные строки', exact: true })).toHaveCount(
          0,
        );
        await expect(
          page.getByText('Выбранный файл: Еще не загружен.csv', { exact: true }),
        ).toBeVisible();
      }
      expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(before);
    } finally {
      release();
      await pending.catch(() => {});
      await page.unroute(pattern);
    }
  }
  expect(retainedState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  assertQuota();
});

test('CSV-006-B / TRADE-006-C: CSV refresh preserves a selected manual correction or void until the changed target is explicitly reviewed', async ({
  page,
}) => {
  const { api, account, instrument } = await csvFixture(page);
  const bought = await api.create(account.id, tradeInput(instrument.id, 0));
  const prior = retainedState();
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  const imported = [{ ...buy, time: '2025-01-05T00:00:00Z', gross: '50' }];
  const batch = await uploadInBrowser(page, account.id, imported);
  await inspectAndMap(page, account.id, batch, instrument.id, imported);
  await previewInBrowser(
    page,
    account.id,
    batch,
    { ...emptySummary, grossBuysUsd: '150', remainingCostUsd: '150' },
    1,
  );
  const accepted = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/confirm`,
    () => page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
  );
  expect(accepted.status()).toBe(201);
  assertCommitted(readCsvReceipt(await accepted.json()));
  const savedCsv = csvRows(account.id);
  const table = page.getByRole('table', { name: 'Сделки журнала', exact: true });
  const bodyWrites: unknown[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.startsWith(
        `/api/accounting/accounts/${account.id}/trades/${bought.trade.tradeId}/`,
      )
    )
      bodyWrites.push(request.postDataJSON());
  });
  for (const [index, kind] of (['correct', 'void'] as const).entries()) {
    await table
      .getByRole('row')
      .filter({ hasText: bought.trade.tradeId })
      .getByRole('button', { name: kind === 'correct' ? 'Исправить' : 'Аннулировать', exact: true })
      .click();
    const form = page.getByRole('group', { name: 'Сделка в USD', exact: true });
    if (kind === 'correct')
      await form.getByLabel('Валовая сумма, USD', { exact: true }).fill('120');
    const external = await api.correct(
      account.id,
      bought.trade.tradeId,
      tradeInput(instrument.id, index === 0 ? 2 : 4, {
        orderWithinTimestamp: 0,
        grossUsd: index === 0 ? '200' : '300',
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
    expect((await refreshed).status()).toBe(200);
    const review = page.getByRole('region', { name: 'Журнал изменился', exact: true });
    await expect(review).toBeVisible();
    for (const text of [
      `Текущая версия выбранной сделки: ${external.trade.version}`,
      instrument.id,
      `количество ${external.trade.quantity}`,
      `валовая сумма ${external.trade.grossUsd} USD`,
      `комиссия ${external.trade.feeUsd} USD`,
      external.trade.occurredAt,
      'порядок 0',
    ])
      await expect(review).toContainText(text);
    const action = page.getByRole('button', {
      name: kind === 'correct' ? 'Сохранить сделку' : 'Подтвердить аннулирование',
      exact: true,
    });
    await expect(action).toBeDisabled();
    if (kind === 'correct')
      await expect(form.getByLabel('Валовая сумма, USD', { exact: true })).toHaveValue('120');
    else
      await expect(
        page.getByText(`Аннулировать сделку ${bought.trade.tradeId}, версия 3?`, { exact: false }),
      ).toBeVisible();
    expect(bodyWrites).toHaveLength(index);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforeRefresh);
    await review
      .getByRole('checkbox', {
        name: 'Я проверил актуальную версию журнала и хочу сохранить черновик.',
        exact: true,
      })
      .check();
    const result = await browserPost(
      page,
      `/accounts/${account.id}/trades/${bought.trade.tradeId}/${kind === 'correct' ? 'corrections' : 'voids'}`,
      () => action.click(),
    );
    expect(result.status()).toBe(201);
    expect(bodyWrites).toHaveLength(index + 1);
    expect(bodyWrites[index]).toMatchObject({
      expectedJournalRevision: index === 0 ? 3 : 5,
      ...(kind === 'correct' ? { grossUsd: '120' } : {}),
    });
    expect(csvRows(account.id)).toEqual(savedCsv);
  }
  expect(
    (await api.versions(account.id, bought.trade.tradeId)).items.map((row) => [
      row.version,
      row.kind,
      row.grossUsd,
    ]),
  ).toEqual([
    [5, 'void', '300'],
    [4, 'correct', '300'],
    [3, 'correct', '120'],
    [2, 'correct', '200'],
    [1, 'create', '100'],
  ]);
  expect((await api.state(account.id)).journal).toMatchObject({
    journalRevision: 6,
    activeTradeCount: 1,
    versionCount: 6,
    summary: { grossBuysUsd: '50', remainingCostUsd: '50' },
  });
  expect(retainedState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  assertQuota();
});

test('CSV-002-A / CSV-006-A regression: exact source keys with leading spaces stay visibly distinct while mapping and reviewing saved settings', async ({
  page,
}) => {
  const { api, account, instrument } = await csvFixture(page);
  const second = await api.instrument();
  const prior = retainedState();
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  const source = [buy, { ...buy, source: ' TOKEN', gross: '200' }];
  const batch = await uploadInBrowser(page, account.id, source);
  const inspection = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/inspect`,
    () => page.getByRole('button', { name: 'Просмотреть исходные строки', exact: true }).click(),
  );
  expect(inspection.status()).toBe(200);
  expect((await inspection.json()).rows.map((row: { cells: string[] }) => row.cells[0])).toEqual([
    'TOKEN',
    ' TOKEN',
  ]);
  const mapping = page.getByRole('group', {
    name: 'Сопоставление колонок и значений',
    exact: true,
  });
  for (const [index, field] of [
    'Инструмент',
    'Тип сделки',
    'Дата сделки',
    'Порядок в одну дату',
    'Количество',
    'Валовая сумма USD',
    'Комиссия USD',
  ].entries()) {
    await mapping
      .getByRole('combobox', { name: `Колонка: ${field}`, exact: true })
      .selectOption(String(index));
  }
  const instrumentLabels = mapping.locator('label').filter({ hasText: 'Инструмент для' });
  await expect(instrumentLabels).toHaveCount(2);
  // Whitespace is meaningful source identity, not decorative label formatting.
  // Either visible quoting or preserved whitespace must distinguish this second key.
  expect(
    await hasVisibleLiteral(instrumentLabels.nth(1), ' TOKEN', 'Инструмент для  TOKEN'),
    'A leading-space source must not collapse into the same visible TOKEN label',
  ).toBe(true);
  for (const [index, id] of [instrument.id, second.id].entries()) {
    const select = instrumentLabels.nth(index).getByRole('combobox');
    const option = select.locator(`option[value="${id}"]`);
    const more = mapping.getByRole('button', {
      name: 'Загрузить ещё инструменты для CSV',
      exact: true,
    });
    for (let loaded = 0; ; loaded++) {
      await expect
        .poll(
          async () =>
            (await option.count()) > 0 || ((await more.isVisible()) && (await more.isEnabled())),
        )
        .toBe(true);
      if (await option.count()) break;
      expect(loaded).toBeLessThan(10);
      const count = await select.locator('option').count();
      await more.click();
      await expect
        .poll(
          async () =>
            (await option.count()) > 0 || (await select.locator('option').count()) > count,
        )
        .toBe(true);
    }
    await select.selectOption(id);
  }
  await mapping
    .getByRole('combobox', { name: 'Тип сделки для buy', exact: true })
    .selectOption('buy');
  await mapping
    .getByRole('checkbox', { name: 'Валовые суммы и комиссии выражены в USD', exact: true })
    .check();
  await previewInBrowser(page, account.id, batch, {
    ...emptySummary,
    grossBuysUsd: '300',
    remainingCostUsd: '300',
  });
  const accepted = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/confirm`,
    () => page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
  );
  expect(accepted.status()).toBe(201);
  assertCommitted(readCsvReceipt(await accepted.json()));
  const batchRegion = page.getByRole('region', { name: 'Партия CSV', exact: true });
  await batchRegion.getByText('Сохранённое сопоставление', { exact: true }).click();
  const savedKey = batchRegion.locator('li').filter({ hasText: second.id });
  await expect(savedKey).toHaveCount(1);
  expect(await hasVisibleLiteral(savedKey, ' TOKEN', ` TOKEN → ${second.id}`)).toBe(true);
  expect(
    rows<{ value: unknown }>(
      `SELECT "acceptedSettings"->'mapping'->'instruments' AS value FROM account_csv_imports WHERE id='${batch}'`,
    )[0].value,
  ).toEqual([
    { source: ' TOKEN', instrumentId: second.id },
    { source: 'TOKEN', instrumentId: instrument.id },
  ]);
  expect(
    (await api.lots(account.id)).items
      .map((row) => [row.instrumentId, row.remainingQuantity, row.remainingCostUsd])
      .sort(),
  ).toEqual(
    [
      [instrument.id, '1', '100'],
      [second.id, '1', '200'],
    ].sort(),
  );
  expect(retainedState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  assertQuota();
});

test('CSV-006-B: a delayed real preview for another account cannot replace the currently selected account', async ({
  page,
}) => {
  const { api, account, instrument } = await csvFixture(page);
  const otherAccount = await api.account();
  await api.initialize(otherAccount.id);
  const prior = retainedState();
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  const batch = await uploadInBrowser(page, account.id);
  await inspectAndMap(page, account.id, batch, instrument.id);
  const before = fingerprint(['auth_sessions', 'auth_request_limits']);
  const path = `/api/accounting/accounts/${account.id}/csv-imports/${batch}/preview`;
  const pattern = `**${path}`;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(
    pattern,
    async (route) => {
      held = true;
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path && response.request().method() === 'POST',
    { timeout: 15_000 },
  );
  pending.catch(() => {});
  try {
    await page.getByRole('button', { name: 'Проверить импорт', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await navigateToAccount(page, otherAccount.id);
    await expect(page).toHaveURL(new RegExp(`/manual-accounts/${otherAccount.id}$`));
    release();
    const response = await pending;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ batchId: batch, canConfirm: true });
    await response.finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByRole('region', { name: 'Предпросмотр импорта', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('combobox', { name: 'Сохранённая партия CSV', exact: true }),
    ).toHaveValue('');
    await expect(page.getByRole('region', { name: 'Партия CSV', exact: true })).toHaveCount(0);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(before);
  } finally {
    release();
    await pending.catch(() => {});
    await page.unroute(pattern);
  }
  expect(retainedState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  assertQuota();
});

test('CSV-006-B: a real pinned read409 cannot resolve an earlier committed CSV command whose response was lost', async ({
  page,
}) => {
  const { api, account, instrument } = await csvFixture(page);
  await api.create(account.id, tradeInput(instrument.id, 0));
  const sale = await api.create(
    account.id,
    tradeInput(instrument.id, 1, { side: 'sell', quantity: '0.5', grossUsd: '100' }),
  );
  const prior = retainedState();
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  const imported = [{ ...buy, time: '2025-01-05T00:00:00Z' }];
  const batch = await uploadInBrowser(page, account.id, imported);
  await inspectAndMap(page, account.id, batch, instrument.id, imported);
  await previewInBrowser(
    page,
    account.id,
    batch,
    {
      grossBuysUsd: '200',
      buyFeesUsd: '0',
      grossSalesUsd: '100',
      sellFeesUsd: '0',
      netSalesUsd: '100',
      consumedCostUsd: '50',
      realizedUsd: '50',
      remainingCostUsd: '150',
    },
    2,
  );
  const readPath = `/api/accounting/accounts/${account.id}/trades/${sale.trade.tradeId}/matches`;
  const writePath = `/api/accounting/accounts/${account.id}/csv-imports/${batch}/confirm`;
  const readPattern = `**${readPath}?*`;
  const writePattern = `**${writePath}`;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let lost = false;
  let receipt: CsvReceipt | undefined;
  const commands: CsvConfirm[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === writePath)
      commands.push(request.postDataJSON() as CsvConfirm);
  });
  await page.route(
    readPattern,
    async (route) => {
      expect(new URL(route.request().url()).searchParams.get('journalRevision')).toBe('2');
      held = true;
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  await page.route(
    writePattern,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      receipt = readCsvReceipt(await response.json());
      assertCommitted(receipt);
      lost = true;
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
  const staleRead = page.waitForResponse(
    (response) => new URL(response.url()).pathname === readPath,
    { timeout: 15_000 },
  );
  staleRead.catch(() => {});
  try {
    await page
      .getByRole('table', { name: 'Сделки журнала', exact: true })
      .getByRole('row')
      .filter({ hasText: sale.trade.tradeId })
      .getByRole('button', { name: 'Распределение FIFO', exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    await page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click();
    await expect.poll(() => lost).toBe(true);
    await expect(retryButton(page)).toBeEnabled();
    const committed = fingerprint(['auth_sessions', 'auth_request_limits']);
    release();
    expect((await staleRead).status()).toBe(409);
    await expect(page.getByRole('region', { name: 'Журнал изменился', exact: true })).toBeVisible();
    await expect(retryButton(page)).toBeEnabled();
    await expect(page.getByLabel('Файл CSV', { exact: true })).toBeDisabled();
    expect(commands).toHaveLength(1);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(committed);
    const replay = await browserPost(
      page,
      `/accounts/${account.id}/csv-imports/${batch}/confirm`,
      () => retryButton(page).click(),
    );
    expect(replay.status()).toBe(200);
    expect(readCsvReceipt(await replay.json())).toEqual(receipt);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    await expect(retryButton(page)).toHaveCount(0);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(committed);
  } finally {
    release();
    await staleRead.catch(() => {});
    await page.unroute(readPattern);
    await page.unroute(writePattern);
    expect(providerRequests()).toEqual(providers);
    assertQuota();
  }
  expect(retainedState()).toBe(prior);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
});

test('CSV-006-B: an accepted CSV receipt followed by a lost parent read blocks new writes until successful current-state review', async ({
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
  const readPath = `/api/accounting/accounts/${account.id}/trade-journal`;
  const pattern = `**${readPath}`;
  const writePath = `/api/accounting/accounts/${account.id}/csv-imports/${batch}/confirm`;
  let writes = 0;
  let lostRead = false;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === writePath) writes++;
  });
  await page.route(
    pattern,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect((await response.json()).journal.journalRevision).toBe(1);
      lostRead = true;
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
  try {
    const accepted = await browserPost(
      page,
      `/accounts/${account.id}/csv-imports/${batch}/confirm`,
      () => page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
    );
    expect(accepted.status()).toBe(201);
    const receipt = readCsvReceipt(await accepted.json());
    assertCommitted(receipt);
    await expect.poll(() => lostRead).toBe(true);
    const csvRegion = page.getByRole('region', { name: 'Импорт CSV', exact: true });
    await expect(csvRegion.getByRole('alert')).toContainText('Запрос принят');
    await expect(
      csvRegion.getByRole('status').filter({ hasText: receipt.requestId }),
    ).toBeVisible();
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.getByLabel('Файл CSV', { exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Сохранить сделку', exact: true }),
    ).toBeDisabled();
    expect(writes).toBe(1);
    const committed = fingerprint(['auth_sessions', 'auth_request_limits']);
    const refresh = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === readPath && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Обновить состояние CSV', exact: true }).click();
    const refreshed = await refresh;
    expect(refreshed.status()).toBe(200);
    expect((await refreshed.json()).journal.journalRevision).toBe(1);
    await expectJournalSummary(page, {
      ...emptySummary,
      grossBuysUsd: '100',
      remainingCostUsd: '100',
    });
    const review = page.getByRole('checkbox', {
      name: 'Я проверил актуальную версию журнала и хочу сохранить черновик.',
      exact: true,
    });
    await expect(review).toBeEnabled();
    await review.check();
    await expect(page.getByLabel('Файл CSV', { exact: true })).toBeEnabled();
    expect(writes).toBe(1);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(committed);
  } finally {
    await page.unroute(pattern);
    expect(providerRequests()).toEqual(providers);
    assertQuota();
  }
  expect(retainedState()).toBe(prior);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
});
