import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { browserPost, tradeApi, tradeInput } from './usd-trades-fixtures';

const at = '2025-01-03T00:00:00.000Z';
const swapsPath = (id: string) => `/accounts/${id}/swaps`;
const businessRows = () => fingerprint(['auth_sessions', 'auth_request_limits']);

function swapCommand(revision: number, outgoing: string, incoming: string) {
  return {
    requestId: randomUUID(),
    expectedJournalRevision: revision,
    assertExecuted: true,
    outgoingInstrumentId: outgoing,
    incomingInstrumentId: incoming,
    occurredAt: at,
    orderWithinTimestamp: 0,
    outgoingQuantity: '1',
    incomingQuantity: '3',
    considerationUsd: '150' as string | null,
    feeSource: 'incoming' as 'incoming' | 'held' | null,
    feeInstrumentId: incoming as string | null,
    feeQuantity: '0.1',
  };
}

test('SWAP-API: atomic exchange preserves fee origin, unknown evidence and private immutable lifecycle', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const account = await api.account(`Swap API ${randomUUID()}`);
  const outgoing = await api.instrument(`Outgoing ${randomUUID()}`, 'SAME');
  const incoming = await api.instrument(`Incoming ${randomUUID()}`, 'SAME');
  await api.initialize(account.id);
  await api.create(account.id, tradeInput(outgoing.id, 0));
  await api.create(account.id, tradeInput(incoming.id, 1, { grossUsd: '1' }));
  const path = swapsPath(account.id);
  const command = swapCommand(2, outgoing.id, incoming.id);

  // The predecessor reaches a valid new operation and fails on its missing route.
  const response = await api.send('POST', path, command);
  expect(response.status()).toBe(201);
  noStore(response);
  const receipt = await response.json();
  expect(receipt).toMatchObject({
    accountId: account.id,
    journalRevision: 3,
    swap: {
      swapId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      version: 1,
      kind: 'create',
      requestId: command.requestId,
      considerationUsd: '150',
      outgoingInstrumentId: outgoing.id,
      incomingInstrumentId: incoming.id,
      incomingQuantity: '3',
      feeSource: 'incoming',
      feeQuantity: '0.1',
    },
  });
  const swapId = String(receipt.swap.swapId);
  expect(await api.result('POST', path, 200, command)).toEqual(receipt);

  const journal = (await api.result('GET', `/accounts/${account.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  expect(journal.journal).toMatchObject({
    journalRevision: 3,
    versionCount: 2,
    summary: { grossBuysUsd: '101', grossSalesUsd: '0', realizedUsd: '0', remainingCostUsd: '146' },
    swapSummary: {
      activeCount: 1,
      considerationUsd: '150',
      principalBasisUsd: '100',
      feeConsumedBasisUsd: '5',
      realizedUsd: '45',
    },
  });
  const lots = (await api.result('GET', `/accounts/${account.id}/trade-lots`, 200)) as {
    items: unknown[];
  };
  expect(lots.items).toHaveLength(2);
  expect(lots.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        instrumentId: incoming.id,
        remainingQuantity: '1',
        remainingCostUsd: '1',
      }),
      expect.objectContaining({
        sourceKind: 'swap',
        instrumentId: incoming.id,
        remainingQuantity: '2.9',
        remainingCostUsd: '145',
        intervalStart: '0.1',
        intervalEnd: '3',
        origin: expect.objectContaining({ swapId, originalQuantity: '3', originalCostUsd: '150' }),
      }),
    ]),
  );
  const allocation = await api.result('GET', `${path}/${swapId}/allocation`, 200);
  expect(allocation).toMatchObject({
    principalBasisUsd: '100',
    feeConsumedBasisUsd: '5',
    realizedUsd: '45',
    items: expect.arrayContaining([
      expect.objectContaining({
        kind: 'fee',
        costUsd: '5',
        intervalStart: '0',
        intervalEnd: '0.1',
        origin: expect.objectContaining({ kind: 'swap', swapId }),
      }),
    ]),
  });

  const foreign = seedForeign();
  const providers = providerRequests();
  const beforeDenials = businessRows();
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    await passwordStep(await pendingContext.newPage());
    const pending = await pendingContext.request.get(`/api/accounting${path}`);
    expect(pending.status()).toBe(401);
    noStore(pending);
  } finally {
    await pendingContext.close();
  }
  const anonymous = await request.get(`/api/accounting${path}`);
  expect(anonymous.status()).toBe(401);
  noStore(anonymous);
  for (const id of [foreign.accountId, randomUUID()]) {
    const denied = await api.send('GET', swapsPath(id));
    expect(denied.status()).toBe(404);
    noStore(denied);
    const body = await denied.json();
    expect(body).toEqual({
      statusCode: 404,
      message: 'Not Found',
      error: 'NotFoundException',
      path: `/accounting${swapsPath(id)}`,
      timestamp: expect.any(String),
    });
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  }
  const missingCsrf = await page
    .context()
    .request.post(`/api/accounting${path}`, { data: command, headers: { Origin: origin } });
  expect(missingCsrf.status()).toBe(403);
  noStore(missingCsrf);
  expect(
    (await api.send('POST', path, command, { Origin: 'https://foreign.example.invalid' })).status(),
  ).toBe(403);
  expect(
    (
      await api.send('POST', path, { ...command, requestId: randomUUID(), outgoingQuantity: 1 })
    ).status(),
  ).toBe(400);
  expect((await api.send('POST', path, { ...command, considerationUsd: '151' })).status()).toBe(
    409,
  );
  expect((await api.send('POST', path, { ...command, requestId: randomUUID() })).status()).toBe(
    409,
  );
  expect(businessRows()).toBe(beforeDenials);

  const correction = {
    ...command,
    requestId: randomUUID(),
    expectedJournalRevision: 3,
    expectedVersion: 1,
    considerationUsd: null,
  };
  const unknown = await api.result('POST', `${path}/${swapId}/correct`, 201, correction);
  expect(unknown).toMatchObject({
    journalRevision: 4,
    swap: { version: 2, considerationUsd: null },
  });
  expect(await api.result('GET', `${path}/${swapId}/allocation`, 200)).toMatchObject({
    considerationUsd: null,
    principalBasisUsd: '100',
    feeConsumedBasisUsd: null,
    realizedUsd: null,
    coverage: {
      consideration: { knownSubtotalUsd: '0', unknownCount: 1 },
      principal: { knownSubtotalUsd: '100', unknownCount: 0 },
      fee: { knownSubtotalUsd: '0', unknownCount: 1 },
      realized: { knownSubtotalUsd: '0', unknownCount: 1 },
    },
  });
  const zero = await api.result('POST', `${path}/${swapId}/correct`, 201, {
    ...correction,
    requestId: randomUUID(),
    expectedJournalRevision: 4,
    expectedVersion: 2,
    considerationUsd: '0',
  });
  expect(zero).toMatchObject({ journalRevision: 5, swap: { version: 3, considerationUsd: '0' } });
  expect(await api.result('GET', `${path}/${swapId}/allocation`, 200)).toMatchObject({
    considerationUsd: '0',
    principalBasisUsd: '100',
    feeConsumedBasisUsd: '0',
    realizedUsd: '-100',
  });
  await api.result('POST', `${path}/${swapId}/void`, 201, {
    requestId: randomUUID(),
    expectedJournalRevision: 5,
    expectedVersion: 3,
  });
  expect(await api.result('POST', path, 200, command)).toEqual(receipt);
  const end = (await api.result('GET', `/accounts/${account.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  expect(end.journal).toMatchObject({
    journalRevision: 6,
    versionCount: 2,
    summary: { grossBuysUsd: '101', grossSalesUsd: '0', remainingCostUsd: '101' },
    swapSummary: {
      activeCount: 0,
      considerationUsd: '0',
      principalBasisUsd: '0',
      feeConsumedBasisUsd: '0',
      realizedUsd: '0',
    },
  });
  const beforeReads = businessRows();
  expect(await api.result('GET', `${path}/${swapId}/versions`, 200)).toMatchObject({
    items: [
      expect.objectContaining({ version: 4, kind: 'void' }),
      expect.objectContaining({ version: 3 }),
      expect.objectContaining({ version: 2 }),
      receipt.swap,
    ],
  });
  expect(businessRows()).toBe(beforeReads);
  expect(providerRequests()).toEqual(providers);
});

test('SWAP-UI: owner reviews exact evidence and retries a committed exchange across SPA remount', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const account = await api.account(`Swap UI ${randomUUID()}`);
  const outgoing = await api.instrument(`UI outgoing ${randomUUID()}`, 'SAME');
  const incoming = await api.instrument(`UI incoming ${randomUUID()}`, 'SAME');
  await api.initialize(account.id);
  await api.create(account.id, tradeInput(outgoing.id, 0));
  await page.goto(`/manual-accounts/${account.id}`);
  const section = page.getByRole('region', { name: 'Обмены активов', exact: true });
  await expect(section).toBeVisible();
  const form = section.getByRole('form', { name: 'Редактор обмена', exact: true });
  await form.getByLabel('Отдаваемый актив', { exact: true }).selectOption(outgoing.id);
  await form.getByLabel('Получаемый актив', { exact: true }).selectOption(incoming.id);
  await form.getByLabel('Отдаваемое количество', { exact: true }).fill('1');
  await form.getByLabel('Получаемое количество до комиссии', { exact: true }).fill('3');
  await form.getByLabel('Момент обмена (ISO с часовым поясом)', { exact: true }).fill(at);
  await form.getByLabel('Порядок в моменте', { exact: true }).fill('0');
  await form
    .getByLabel('Оценка обмена в USD', { exact: true })
    .selectOption({ label: 'Неизвестна' });
  await form
    .getByLabel('Источник комиссии', { exact: true })
    .selectOption({ label: 'Без комиссии' });
  await form
    .getByRole('checkbox', {
      name: 'Подтверждаю: это уже выполненный обмен внутри этого счёта.',
      exact: true,
    })
    .check();
  await form.getByRole('button', { name: 'Проверить обмен', exact: true }).click();
  const review = section.getByRole('region', { name: 'Проверка обмена', exact: true });
  await expect(review).toContainText(outgoing.id);
  await expect(review).toContainText(incoming.id);
  await form.getByLabel('Получаемое количество до комиссии', { exact: true }).fill('4');
  await expect(review).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Записать обмен', exact: true })).toBeDisabled();
  await form.getByLabel('Получаемое количество до комиссии', { exact: true }).fill('3');
  await form.getByRole('button', { name: 'Проверить обмен', exact: true }).click();
  const submitted: unknown[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/accounting${swapsPath(account.id)}`
    )
      submitted.push(request.postDataJSON());
  });
  let receipt: { swap: { swapId: string } } | undefined;
  let dropped = false;
  const routePattern = `**/api/accounting${swapsPath(account.id)}`;
  await page.route(routePattern, async (route) => {
    if (route.request().method() !== 'POST' || dropped) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    receipt = await response.json();
    dropped = true;
    await route.abort('connectionreset');
  });
  try {
    await form.getByRole('button', { name: 'Записать обмен', exact: true }).click();
    await expect(
      form.getByRole('button', { name: 'Повторить тот же запрос', exact: true }),
    ).toBeEnabled();
    await page.getByRole('link', { name: '← Ручные счета', exact: true }).click();
    await page.locator(`a[href="/manual-accounts/${account.id}"]`).click();
    await expect(form.getByLabel('Получаемое количество до комиссии', { exact: true })).toHaveValue(
      '3',
    );
    await expect(
      form.getByRole('button', { name: 'Повторить тот же запрос', exact: true }),
    ).toBeEnabled();
    expect(submitted).toHaveLength(1);
    const retried = await browserPost(page, swapsPath(account.id), () =>
      form.getByRole('button', { name: 'Повторить тот же запрос', exact: true }).click(),
    );
    expect(retried.status()).toBe(200);
    expect(await retried.json()).toEqual(receipt);
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(submitted[0]).toMatchObject({
      expectedJournalRevision: 1,
      considerationUsd: null,
      feeSource: null,
      feeInstrumentId: null,
      feeQuantity: '0',
    });
  } finally {
    await page.unroute(routePattern);
  }
  const tradeDraft = page.getByRole('group', { name: 'Сделка в USD', exact: true });
  await tradeDraft.getByLabel('Количество', { exact: true }).fill('17');
  const article = section.getByRole('article', {
    name: `Обмен ${receipt?.swap.swapId}`,
    exact: true,
  });
  await expect(article).toContainText('Неизвестно');
  await article.getByRole('button', { name: 'Показать распределение обмена', exact: true }).click();
  const allocation = article.getByRole('region', { name: 'Распределение обмена', exact: true });
  await expect(allocation.getByText('Реализованный результат обменов, USD').locator('+ dd')).toContainText('Неизвестно');
  await expect(allocation.getByText('Себестоимость отданных активов, USD').locator('+ dd')).toHaveText('100');
  const lots = page.getByRole('table', { name: 'Открытые лоты', exact: true });
  await expect(lots).toContainText(`Обмен ${receipt?.swap.swapId}, версия 1`);
  await expect(lots).toContainText('Интервал исходного лота: 0–3');
  await article.getByRole('button', { name: 'Исправить обмен', exact: true }).click();
  await form.getByLabel('Оценка обмена в USD', { exact: true }).selectOption({ label: 'Известна' });
  await form.getByLabel('Сумма оценки, USD', { exact: true }).fill('0');
  await form
    .getByRole('checkbox', {
      name: 'Подтверждаю: это уже выполненный обмен внутри этого счёта.',
      exact: true,
    })
    .check();
  let releaseHistory: (() => void) | undefined;
  const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
  let historyHeld = false;
  let historyDelivered = false;
  const versionsRoute = `**/api/accounting${swapsPath(account.id)}/${receipt?.swap.swapId}/versions**`;
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
    // Real concurrent write advances the same journal pin while the old review is in flight.
    await api.create(account.id, tradeInput(outgoing.id, 2, { occurredAt: '2025-01-04T00:00:00.000Z' }));
    await section.getByRole('button', { name: 'Обновить обмены', exact: true }).click();
    await expect(section).toContainText('ревизия журнала: 3.');
    const response = page.waitForResponse((result) => new URL(result.url()).pathname.endsWith(`/${receipt?.swap.swapId}/versions`));
    releaseHistory?.();
    await (await response).finished();
    await expect.poll(() => historyDelivered).toBe(true);
    await page.waitForLoadState('networkidle');
    await expect(review).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Записать исправление', exact: true })).toBeDisabled();
    await expect(form.getByLabel('Сумма оценки, USD', { exact: true })).toHaveValue('0');
    await expect(tradeDraft.getByLabel('Количество', { exact: true })).toHaveValue('17');
  } finally {
    releaseHistory?.();
    await page.unroute(versionsRoute, delayActualHistory);
  }
  await form.getByRole('button', { name: 'Проверить исправление', exact: true }).click();
  const corrected = await browserPost(
    page,
    `${swapsPath(account.id)}/${receipt?.swap.swapId}/correct`,
    () => form.getByRole('button', { name: 'Записать исправление', exact: true }).click(),
  );
  expect(corrected.status()).toBe(201);
  expect(await corrected.json()).toMatchObject({ swap: { version: 2, considerationUsd: '0' } });
  await article.getByRole('button', { name: 'Отменить обмен', exact: true }).click();
  await form.getByRole('button', { name: 'Проверить отмену', exact: true }).click();
  const voided = await browserPost(
    page,
    `${swapsPath(account.id)}/${receipt?.swap.swapId}/void`,
    () => form.getByRole('button', { name: 'Отменить обмен', exact: true }).click(),
  );
  expect(voided.status()).toBe(201);
  expect(await voided.json()).toMatchObject({ swap: { version: 3, kind: 'void' } });
  await expect(article).toContainText('Отменено');
  await expect(tradeDraft.getByLabel('Количество', { exact: true })).toHaveValue('17');
});
