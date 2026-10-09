import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ownerCount,
} from './admission-fixtures';
import {
  command,
  coverageFrom,
  fillAndPreview,
  fixture,
  initializeButton,
  retainedRows,
  retryButton,
  reviewLabel,
} from './carry-in-fixtures';
import { navigateToAccount } from './csv-import-fixtures';
import { openingInput, providerRequests, rows } from './manual-opening-fixtures';
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

test('CARRY-005-A: original accepted command survives lost delivery, real401, MFA and SPA return without a second baseline', async ({
  page,
}) => {
  const data = await fixture(page);
  const { api, account, path } = data;
  const prior = retainedRows(account.id, ['owner_mfa_recovery']);
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const providers = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  await fillAndPreview(page, data);
  const endpoint = `/api/accounting${path}`;
  const commands: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === endpoint)
      commands.push(request.postDataJSON());
  });
  let receipt: unknown;
  let lost = false;
  await page.route(
    `**${endpoint}`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      receipt = await response.json();
      expect(receipt).toMatchObject({
        originKind: 'known-cost-carry-in',
        openingRevision: 1,
        carryInCostUsd: '300',
        lotCount: 2,
      });
      lost = true;
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
  try {
    await initializeButton(page).click();
    await expect.poll(() => lost).toBe(true);
    await expect(retryButton(page)).toBeEnabled();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ ...command(data), requestId: expect.any(String) });
    const afterCommit = fingerprint(['auth_sessions', 'auth_request_limits']);
    // Expire only this real synthetic session; backend must actually reject the retry.
    const tokenHash = hashToken(await cookie(page));
    query(
      `UPDATE auth_sessions SET "expiresAt"=clock_timestamp() WHERE "tokenHash"='${tokenHash}'`,
    );
    const denied = await browserPost(page, path, () => retryButton(page).click());
    expect(denied.status()).toBe(401);
    expect(commands).toEqual([commands[0], commands[0]]);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(afterCommit);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    const beforeLogin = fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa_recovery']);
    const recoveryBefore = rows<{ codeHash: string; usedAt: string | null }>(
      'SELECT "codeHash","usedAt" FROM owner_mfa_recovery ORDER BY "codeHash"',
    );
    await page.getByLabel('Email', { exact: true }).fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    const login = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/login' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await login).status()).toBe(200);
    await expect(page.getByLabel('Code from your authenticator app', { exact: true })).toBeVisible();
    await completeFactor(page, recoveryFactor());
    await navigateToAccount(page, account.id);
    await page.getByRole('button', { name: 'Начальные данные', exact: true }).click();
    await expect(retryButton(page)).toBeEnabled();
    expect(commands).toHaveLength(2);
    const replay = await browserPost(page, path, () => retryButton(page).click());
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(receipt);
    expect(commands).toEqual([commands[0], commands[0], commands[0]]);
    await expect(retryButton(page)).toHaveCount(0);
    expect(fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa_recovery'])).toBe(
      beforeLogin,
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
    expectAdmissionDelta(admissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
      { scope: 'login-ip', subject: await hostSubject(), hits: 1 },
      { scope: 'mfa-ip', subject: await hostSubject(), hits: 1 },
      ownerCount(1),
    ]);
    expect(retainedRows(account.id, ['owner_mfa_recovery'])).toEqual(prior);
  } finally {
    await page.unroute(`**${endpoint}`);
    expect(providerRequests()).toEqual(providers);
    assertQuota();
  }
});

test('CARRY-001-B / CARRY-005-A: literal labels, edited consent, delayed preview and stale opening cannot initialize; unknown cost remains unsupported', async ({
  page,
}) => {
  const label = '<img src=x onerror="window.carryInjected=true">';
  const data = await fixture(page, label);
  const { api, account, path } = data;
  const providers = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  await page.goto(`/manual-accounts/${account.id}`);
  await fillAndPreview(page, data);
  const section = page.getByRole('region', { name: 'Начальные лоты FIFO', exact: true });
  await expect(section.getByText(label, { exact: false }).first()).toBeVisible();
  await expect(section.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => 'carryInjected' in window)).toBe(false);
  const cost = page
    .getByRole('group', { name: 'Лот 1', exact: true })
    .getByLabel('Исходная стоимость, USD', { exact: true });
  await cost.fill('101');
  await expect(initializeButton(page)).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: reviewLabel, exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: reviewLabel, exact: true })).toBeDisabled();
  await cost.fill('100');
  let previewReached = false;
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previewPattern = `**/api/accounting${path}/preview`;
  await page.route(
    previewPattern,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      previewReached = true;
      await barrier;
      await route.fulfill({ response }); // Deliver the actual server response unchanged.
    },
    { times: 1 },
  );
  try {
    const beforePreview = fingerprint(['auth_sessions', 'auth_request_limits']);
    const late = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/accounting${path}/preview`,
    );
    await page.getByRole('button', { name: 'Проверить начальные лоты', exact: true }).click();
    await expect.poll(() => previewReached).toBe(true);
    await cost.fill('101');
    release();
    expect((await late).status()).toBe(200);
    await expect(initializeButton(page)).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: reviewLabel, exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: reviewLabel, exact: true })).toBeDisabled();
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforePreview);
    await cost.fill('100');
    const reviewed = await browserPost(page, `${path}/preview`, () =>
      page.getByRole('button', { name: 'Проверить начальные лоты', exact: true }).click(),
    );
    expect(reviewed.status()).toBe(200);
    await page.getByRole('checkbox', { name: reviewLabel, exact: true }).check();
    const replacement = await api.save(
      account.id,
      openingInput(data.instrument.id, {
        expectedRevision: 1,
        asOf: coverageFrom,
        positions: data.opening.positions.map(
          ({ instrumentId, quantity, costStatus, totalCostUsd }) => ({
            instrumentId,
            quantity,
            costStatus,
            totalCostUsd,
          }),
        ),
      }),
    );
    expect(replacement.revision).toBe(2);
    const staleState = fingerprint(['auth_sessions', 'auth_request_limits']);
    const stale = await browserPost(page, path, () => initializeButton(page).click());
    expect(stale.status()).toBe(409);
    expect(stale.request().postDataJSON().expectedOpeningRevision).toBe(1);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(staleState);
    await expect(initializeButton(page)).toBeDisabled();
    await expect(cost).toHaveValue('100');
    await api.save(
      account.id,
      openingInput(data.instrument.id, {
        expectedRevision: 2,
        asOf: coverageFrom,
        positions: [
          {
            instrumentId: data.instrument.id,
            quantity: '2',
            costStatus: 'unknown',
            totalCostUsd: null,
          },
        ],
      }),
    );
    const unknown = fingerprint(['auth_sessions', 'auth_request_limits']);
    await page.getByRole('button', { name: 'Обновить начальные лоты', exact: true }).click();
    await expect(
      section.getByRole('note').filter({ hasText: 'Неизвестная стоимость не считается нулевой' }),
    ).toBeVisible();
    await expect(
      section.getByRole('alert').filter({ hasText: 'Неизвестная стоимость не считается нулевой' }),
    ).toHaveCount(0);
    await expect(initializeButton(page)).toHaveCount(0);
    expect(await api.result('GET', path, 200)).toMatchObject({
      eligible: false,
      ineligibilityReason: 'unknown-cost',
      origin: null,
    });
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(unknown);
  } finally {
    release();
    await page.unroute(previewPattern);
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

test('CARRY-005-A: accepted receipt survives lost current reads and blocks writes until explicit successful refresh', async ({
  page,
}) => {
  const data = await fixture(page);
  const { api, account, path } = data;
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  await fillAndPreview(page, data);
  const endpoint = `/api/accounting${path}`;
  const commands: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === endpoint)
      commands.push(request.postDataJSON());
  });
  let lostReads = 0;
  const pattern = `**${endpoint}/lots*`;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    lostReads++;
    await route.abort('connectionreset');
  });
  try {
    const initialized = await browserPost(page, path, () => initializeButton(page).click());
    expect(initialized.status()).toBe(201);
    const receipt = await initialized.json();
    await expect.poll(() => lostReads).toBeGreaterThan(0);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: `Сохранена квитанция инициализации ${receipt.requestId}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'До успешного обновления' }),
    ).toBeVisible();
    await expect(retryButton(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Операции', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Сохранить сделку', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Начальные данные', exact: true }).click();
    const accepted = fingerprint(['auth_sessions', 'auth_request_limits']);
    await page.unroute(pattern);
    await page.getByRole('button', { name: 'Обновить начальные лоты', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'До успешного обновления' }),
    ).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: receipt.requestId })).toBeVisible();
    expect(commands).toHaveLength(1);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(accepted);
  } finally {
    await page.unroute(pattern);
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
