import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { browserPost, tradeApi } from './usd-trades-fixtures';

const rewardsPath = (accountId: string) => `/accounts/${accountId}/rewards`;
const valuationPath = (accountId: string, at: string) =>
  `/accounts/${accountId}/valuation?at=${encodeURIComponent(at)}`;
const pricePath = (instrumentId: string) => `/instruments/${instrumentId}/usd-prices`;
const at = '2025-01-02T00:00:00.000Z';
const businessRows = () => fingerprint(['auth_sessions', 'auth_request_limits']);

function rewardCommand(
  expectedJournalRevision: number,
  instrumentId: string,
  values: Partial<Record<string, unknown>> = {},
) {
  return {
    requestId: randomUUID(),
    expectedJournalRevision,
    assertReward: true,
    instrumentId,
    category: 'staking',
    occurredAt: at,
    orderWithinTimestamp: 0,
    quantity: '2',
    acquisitionBasisUsd: null,
    incomeValueUsd: '40',
    ...values,
  };
}

async function setPrice(
  api: Awaited<ReturnType<typeof tradeApi>>,
  instrumentId: string,
  priceUsd: string,
) {
  return api.send('POST', pricePath(instrumentId), {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: at,
    priceUsd,
    assertReviewed: true,
  });
}

test('REWARD-API: null basis, zero, income and manual value stay distinct across private lifecycle', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const account = await api.account(`Reward API ${randomUUID()}`);
  const unknownAsset = await api.instrument(`Unknown basis reward ${randomUUID()}`, 'RWD');
  const zeroAsset = await api.instrument(`Known zero reward ${randomUUID()}`, 'RWD');
  await api.initialize(account.id);
  const path = rewardsPath(account.id);

  // First new-feature assertion is a valid create, so the predecessor fails on route absence.
  const firstCommand = rewardCommand(0, unknownAsset.id);
  const firstResponse = await api.send('POST', path, firstCommand);
  expect(firstResponse.status()).toBe(201);
  const firstReceipt = await firstResponse.json();
  expect(firstReceipt).toMatchObject({
    accountId: account.id,
    journalRevision: 1,
    reward: {
      rewardId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      version: 1,
      kind: 'create',
      requestId: firstCommand.requestId,
      journalRevision: 1,
      instrumentId: unknownAsset.id,
      category: 'staking',
      quantity: '2',
      acquisitionBasisUsd: null,
      incomeValueUsd: '40',
    },
  });
  const firstId = String(firstReceipt.reward.rewardId);

  const secondCommand = rewardCommand(1, zeroAsset.id, {
    category: 'unclassified',
    orderWithinTimestamp: 1,
    quantity: '1',
    acquisitionBasisUsd: '0',
    incomeValueUsd: '0',
  });
  const secondReceipt = (await api.result('POST', path, 201, secondCommand)) as {
    journalRevision: number;
    reward: { rewardId: string; version: number; category: string; acquisitionBasisUsd: string };
  };
  expect(secondReceipt).toMatchObject({
    journalRevision: 2,
    reward: { version: 1, category: 'unclassified', acquisitionBasisUsd: '0', incomeValueUsd: '0' },
  });
  const secondId = secondReceipt.reward.rewardId;

  expect((await setPrice(api, unknownAsset.id, '5')).status()).toBe(201);
  expect((await setPrice(api, zeroAsset.id, '7')).status()).toBe(201);
  const foreign = seedForeign();
  const providers = providerRequests();
  const rowsBeforeDenials = businessRows();
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const pendingPage = await pendingContext.newPage();
  try {
    await passwordStep(pendingPage);
    const pending = await pendingContext.request.get(`/api/accounting${path}`);
    expect(pending.status()).toBe(401);
    noStore(pending);
  } finally {
    await pendingContext.close();
  }
  const anonymous = await request.get(`/api/accounting${path}`);
  expect(anonymous.status()).toBe(401);
  noStore(anonymous);
  const foreignRead = await api.send('GET', rewardsPath(foreign.accountId));
  expect(foreignRead.status()).toBe(404);
  const absentPath = rewardsPath(randomUUID());
  const absentRead = await api.send('GET', absentPath);
  expect(absentRead.status()).toBe(404);
  const foreignError = await foreignRead.json();
  const absentError = await absentRead.json();
  expect(foreignError).toMatchObject({
    statusCode: 404,
    message: 'Not Found',
    error: 'NotFoundException',
    path: `/api/accounting${rewardsPath(foreign.accountId)}`,
  });
  expect(absentError).toMatchObject({
    statusCode: 404,
    message: 'Not Found',
    error: 'NotFoundException',
    path: `/api/accounting${absentPath}`,
  });
  expect(foreignError.timestamp).toEqual(expect.any(String));
  expect(new Date(foreignError.timestamp).toISOString()).toBe(foreignError.timestamp);
  expect(absentError.timestamp).toEqual(expect.any(String));
  expect(new Date(absentError.timestamp).toISOString()).toBe(absentError.timestamp);
  const stableEnvelope = (value: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'timestamp' && key !== 'path'),
    );
  expect(stableEnvelope(foreignError)).toEqual(stableEnvelope(absentError));
  expect(await foreignRead.text()).not.toContain('Synthetic foreign');

  const malformedBody = {
    requestId: randomUUID(),
    expectedJournalRevision: 2,
    assertReward: true,
    instrumentId: unknownAsset.id,
    category: 'staking',
    occurredAt: at,
    orderWithinTimestamp: 0,
    quantity: '2',
    acquisitionBasisUsd: null,
  };
  const malformedBefore = businessRows();
  const malformed = await api.send('POST', path, malformedBody);
  expect(malformed.status()).toBe(400);
  expect(businessRows()).toBe(malformedBefore);

  const originBefore = businessRows();
  const hostileOrigin = await api.send('POST', path, rewardCommand(2, unknownAsset.id), {
    Origin: 'https://foreign.example.invalid',
  });
  expect(hostileOrigin.status()).toBe(403);
  expect(businessRows()).toBe(originBefore);
  const csrfBefore = businessRows();
  const missingCsrf = await page.context().request.post(`/api/accounting${path}`, {
    data: rewardCommand(2, unknownAsset.id),
    headers: { Origin: origin },
  });
  expect(missingCsrf.status()).toBe(403);
  noStore(missingCsrf);
  expect(businessRows()).toBe(csrfBefore);
  expect(businessRows()).toBe(rowsBeforeDenials);
  expect(providerRequests()).toEqual(providers);

  const oldRowsBeforeReads = businessRows();
  const providersBeforeReads = providerRequests();
  const journalResponse = await api.send('GET', `/accounts/${account.id}/trade-journal`);
  expect(journalResponse.status()).toBe(200);
  const journal = (await journalResponse.json()).journal;
  expect(journal).toMatchObject({
    journalRevision: 2,
    versionCount: 0,
    summary: {
      grossBuysUsd: '0',
      realizedUsd: '0',
      remainingCostUsd: null,
    },
    rewardSummary: {
      activeCount: 2,
      declaredBasisUsd: null,
      declaredIncomeUsd: null,
      knownBasisSubtotalUsd: '0',
      knownIncomeSubtotalUsd: '40',
      unknownBasisCount: 1,
      unknownIncomeCount: 0,
      unclassifiedCount: 1,
    },
  });

  const valuationResponse = await api.send('GET', valuationPath(account.id, at));
  expect(valuationResponse.status()).toBe(200);
  const valuation = await valuationResponse.json();
  expect(valuation).toMatchObject({
    journalRevision: 2,
    priceSource: 'manual',
    completeness: 'complete',
    pricedSubtotalUsd: '17',
    totalValueUsd: '17',
    items: expect.arrayContaining([
      expect.objectContaining({
        instrumentId: unknownAsset.id,
        quantity: '2',
        costUsd: null,
        knownCostSubtotalUsd: '0',
        unknownCostQuantity: '2',
        price: { priceUsd: '5', observedAt: at, revision: 1 },
        valueUsd: '10',
      }),
      expect.objectContaining({
        instrumentId: zeroAsset.id,
        quantity: '1',
        costUsd: '0',
        price: { priceUsd: '7', observedAt: at, revision: 1 },
        valueUsd: '7',
      }),
    ]),
  });
  expect(businessRows()).toBe(oldRowsBeforeReads);
  expect(providerRequests()).toEqual(providersBeforeReads);
  expect(providersBeforeReads).toEqual(providers);

  const firstCorrection = {
    ...firstCommand,
    expectedJournalRevision: 2,
    expectedVersion: 1,
    requestId: randomUUID(),
    acquisitionBasisUsd: '0',
  };
  const corrected = (await api.result(
    'POST',
    `${path}/${firstId}/correct`,
    201,
    firstCorrection,
  )) as {
    journalRevision: number;
    reward: Record<string, unknown>;
  };
  expect(corrected).toMatchObject({
    journalRevision: 3,
    reward: { version: 2, acquisitionBasisUsd: '0', incomeValueUsd: '40' },
  });
  const firstVersions = (await api.result('GET', `${path}/${firstId}/versions?limit=10`, 200)) as {
    items: Record<string, unknown>[];
  };
  expect(firstVersions.items).toHaveLength(2);
  expect(firstVersions.items.find((item) => item.version === 1)).toMatchObject({
    version: 1,
    acquisitionBasisUsd: null,
    incomeValueUsd: '40',
  });

  const voided = (await api.result('POST', `${path}/${secondId}/void`, 201, {
    requestId: randomUUID(),
    expectedJournalRevision: 3,
    expectedVersion: 1,
  })) as { journalRevision: number; reward: Record<string, unknown> };
  expect(voided).toMatchObject({
    journalRevision: 4,
    reward: { rewardId: secondId, version: 2, kind: 'void' },
  });
  const rowsBeforeReplay = businessRows();
  expect(await api.result('POST', path, 200, firstCommand)).toEqual(firstReceipt);
  expect(businessRows()).toBe(rowsBeforeReplay);

  const listed = (await api.result('GET', `${path}?journalRevision=4&offset=0&limit=50`, 200)) as {
    journalRevision: number;
    activeCount: number;
    versionCount: number;
    items: Record<string, unknown>[];
  };
  expect(listed).toMatchObject({ journalRevision: 4, activeCount: 1, versionCount: 4 });
  expect(listed.items.map((item) => item.rewardId)).toContain(secondId);
  expect(listed.items.find((item) => item.rewardId === secondId)).toMatchObject({ kind: 'void' });

  const rowsBeforeReads = businessRows();
  const providersAfterWrites = providerRequests();
  const history = await api.send(
    'GET',
    `/accounts/${account.id}/trade-journal/history?at=${encodeURIComponent(at)}`,
  );
  expect(history.status()).toBe(200);
  expect(await history.json()).toMatchObject({
    journalRevision: 4,
    summary: { grossBuysUsd: '0', remainingCostUsd: '0', realizedUsd: '0' },
    rewardSummary: {
      activeCount: 1,
      declaredBasisUsd: '0',
      declaredIncomeUsd: '40',
      knownBasisSubtotalUsd: '0',
      knownIncomeSubtotalUsd: '40',
      unknownBasisCount: 0,
      unknownIncomeCount: 0,
      unclassifiedCount: 0,
    },
    items: [
      expect.objectContaining({
        instrumentId: unknownAsset.id,
        quantity: '2',
        costUsd: '0',
      }),
    ],
  });
  const after = await api.send('GET', valuationPath(account.id, at));
  expect(after.status()).toBe(200);
  expect((await after.json()).totalValueUsd).toBe('10');
  expect(businessRows()).toBe(rowsBeforeReads);
  expect(providerRequests()).toEqual(providersAfterWrites);
  expect(providersAfterWrites).toEqual(providers);
  expect(firstId).not.toBe(secondId);
});

test('REWARD-UI: reviewed receipt keeps unknown, zero, category and exact retry intent', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const account = await api.account(`Reward UI ${randomUUID()}`);
  const instrument = await api.instrument(`Reward UI asset ${randomUUID()}`, 'RWD');
  await api.initialize(account.id);

  await page.goto(`/manual-accounts/${account.id}`);
  const section = page.getByRole('region', { name: 'Вознаграждения', exact: true });
  await expect(section).toBeVisible();
  const tradeDraft = page.getByRole('group', { name: 'Сделка в USD', exact: true });
  await tradeDraft.getByLabel('Количество', { exact: true }).fill('17');
  await tradeDraft.getByLabel('Валовая сумма, USD', { exact: true }).fill('777');
  await tradeDraft.getByLabel('Комиссия, USD', { exact: true }).fill('3');
  const form = section.getByRole('form', { name: 'Редактор вознаграждения', exact: true });
  await form.getByLabel('Актив вознаграждения', { exact: true }).selectOption(instrument.id);
  await form.getByLabel('Категория вознаграждения', { exact: true }).selectOption('unclassified');
  await form.getByLabel('Момент получения (ISO с часовым поясом)', { exact: true }).fill(at);
  await form.getByLabel('Порядок в моменте', { exact: true }).fill('0');
  await form.getByLabel('Полученное количество', { exact: true }).fill('2');
  await form
    .getByLabel('Себестоимость вознаграждения', { exact: true })
    .selectOption({ label: 'Неизвестна' });
  await form
    .getByLabel('Доход от вознаграждения', { exact: true })
    .selectOption({ label: 'Известен' });
  await form.getByLabel('Сумма дохода, USD', { exact: true }).fill('40');
  await form
    .getByRole('checkbox', {
      name: 'Подтверждаю: это уже полученное вознаграждение, а не покупка, перевод или взнос.',
      exact: true,
    })
    .check();
  await form.getByRole('button', { name: 'Проверить вознаграждение', exact: true }).click();
  const review = section.getByRole('region', { name: 'Проверка вознаграждения', exact: true });
  await expect(review).toBeVisible();
  await expect(
    form.getByRole('button', { name: 'Записать вознаграждение', exact: true }),
  ).toBeEnabled();

  const submitted: unknown[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/accounting${rewardsPath(account.id)}`
    )
      submitted.push(request.postDataJSON());
  });
  let lostReceipt: Record<string, unknown> | undefined;
  let dropped = false;
  const dropCommittedCreate = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'POST' || dropped) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    lostReceipt = (await response.json()) as Record<string, unknown>;
    dropped = true;
    await route.abort('connectionreset');
  };
  await page.route(`**/api/accounting${rewardsPath(account.id)}**`, dropCommittedCreate);
  try {
    await form.getByRole('button', { name: 'Записать вознаграждение', exact: true }).click();
    await expect.poll(() => dropped).toBe(true);
    await expect(
      form.getByRole('button', { name: 'Повторить тот же запрос', exact: true }),
    ).toBeEnabled();
    expect(submitted).toHaveLength(1);
    const retry = await browserPost(page, rewardsPath(account.id), () =>
      form.getByRole('button', { name: 'Повторить тот же запрос', exact: true }).click(),
    );
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual(lostReceipt);
    await expect.poll(() => submitted.length).toBe(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(submitted[0]).toMatchObject({
      expectedJournalRevision: 0,
      assertReward: true,
      category: 'unclassified',
      acquisitionBasisUsd: null,
      incomeValueUsd: '40',
    });
  } finally {
    await page.unroute(`**/api/accounting${rewardsPath(account.id)}**`, dropCommittedCreate);
  }

  const rewardId = String(
    lostReceipt?.reward && (lostReceipt.reward as Record<string, unknown>).rewardId,
  );
  expect(rewardId).toMatch(/^[a-f0-9-]{36}$/);
  const article = section.getByRole('article', { name: `Вознаграждение ${rewardId}`, exact: true });
  await expect(article).toBeVisible();
  await expect(article.getByTestId('reward-basis')).toHaveText('Неизвестна');
  await expect(article.getByTestId('reward-income')).toHaveText('40');
  await expect(article.getByTestId('reward-category')).toHaveText('Вид вознаграждения не уточнён');

  await article.getByRole('button', { name: 'Исправить вознаграждение', exact: true }).click();
  await form
    .getByLabel('Себестоимость вознаграждения', { exact: true })
    .selectOption({ label: 'Известна' });
  await form.getByLabel('Сумма себестоимости, USD', { exact: true }).fill('0');
  await form
    .getByRole('checkbox', {
      name: 'Подтверждаю: это уже полученное вознаграждение, а не покупка, перевод или взнос.',
      exact: true,
    })
    .check();
  let releaseHistory: (() => void) | undefined;
  const historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  let historyHeld = false;
  let historyDelivered = false;
  const versionsRoute = `**/api/accounting${rewardsPath(account.id)}/${rewardId}/versions**`;
  const delayActualHistory = async (route: import('@playwright/test').Route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect((await response.json()).items[0].version).toBe(1);
    historyHeld = true;
    await historyGate;
    await route.fulfill({ response });
    historyDelivered = true;
  };
  await page.route(versionsRoute, delayActualHistory);
  try {
    await form.getByRole('button', { name: 'Проверить исправление', exact: true }).click();
    await expect.poll(() => historyHeld).toBe(true);
    await api.result('POST', `${rewardsPath(account.id)}/${rewardId}/correct`, 201, {
      ...(submitted[0] as Record<string, unknown>),
      requestId: randomUUID(),
      expectedJournalRevision: 1,
      expectedVersion: 1,
    });
    await section.getByRole('button', { name: 'Обновить вознаграждения', exact: true }).click();
    await expect(article).toContainText('2 · Активно');
    const historyResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(`/${rewardId}/versions`),
    );
    releaseHistory?.();
    await (await historyResponse).finished();
    await expect.poll(() => historyDelivered).toBe(true);
    await page.waitForLoadState('networkidle');
    await expect(review).toHaveCount(0);
    await expect(
      form.getByRole('button', { name: 'Записать исправление', exact: true }),
    ).toBeDisabled();
    await expect(form.getByLabel('Сумма себестоимости, USD', { exact: true })).toHaveValue('0');
  } finally {
    releaseHistory?.();
    await page.unroute(versionsRoute, delayActualHistory);
  }
  // Explicitly select the newer immutable version and review it again.
  await article.getByRole('button', { name: 'Исправить вознаграждение', exact: true }).click();
  await form
    .getByLabel('Себестоимость вознаграждения', { exact: true })
    .selectOption({ label: 'Известна' });
  await form.getByLabel('Сумма себестоимости, USD', { exact: true }).fill('0');
  await form
    .getByRole('checkbox', {
      name: 'Подтверждаю: это уже полученное вознаграждение, а не покупка, перевод или взнос.',
      exact: true,
    })
    .check();
  await form.getByRole('button', { name: 'Проверить исправление', exact: true }).click();
  await form.getByRole('button', { name: 'Записать исправление', exact: true }).click();
  await expect(article.getByTestId('reward-basis')).toHaveText('0');
  await expect(article.getByTestId('reward-income')).toHaveText('40');

  await article.getByRole('button', { name: 'Отменить вознаграждение', exact: true }).click();
  await form.getByRole('button', { name: 'Проверить отмену', exact: true }).click();
  await form.getByRole('button', { name: 'Отменить вознаграждение', exact: true }).click();
  await expect(article).toContainText('Отменено');
  await expect(tradeDraft.getByLabel('Количество', { exact: true })).toHaveValue('17');
  await expect(tradeDraft.getByLabel('Валовая сумма, USD', { exact: true })).toHaveValue('777');
  await expect(tradeDraft.getByLabel('Комиссия, USD', { exact: true })).toHaveValue('3');

  const journal = (await api.result('GET', `/accounts/${account.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  expect(journal.journal).toMatchObject({
    versionCount: 0,
    rewardSummary: {
      activeCount: 0,
      declaredBasisUsd: '0',
      declaredIncomeUsd: '0',
      knownBasisSubtotalUsd: '0',
      knownIncomeSubtotalUsd: '0',
      unknownBasisCount: 0,
      unknownIncomeCount: 0,
      unclassifiedCount: 0,
    },
  });
});
