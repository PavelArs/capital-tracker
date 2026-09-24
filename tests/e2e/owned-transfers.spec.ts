import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { foreignOwner, noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { type TradeApi, browserPost, tradeApi, tradeInput } from './usd-trades-fixtures';

const transfersPath = '/transfers';
const businessRows = () => fingerprint(['auth_sessions', 'auth_request_limits']);

function movement(
  fromAccountId: string,
  toAccountId: string,
  instrumentId: string,
  expectedFromJournalRevision: number,
  expectedToJournalRevision: number,
  changes: Record<string, unknown> = {},
) {
  return {
    requestId: randomUUID(),
    fromAccountId,
    toAccountId,
    expectedFromJournalRevision,
    expectedToJournalRevision,
    assertInternal: true,
    instrumentId,
    occurredAt: '2025-01-03T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '1.5',
    feeInstrumentId: instrumentId,
    feeQuantity: '0.1',
    ...changes,
  };
}

async function ownedFixture(api: TradeApi, suffix: string) {
  const from = await api.account(`Transfer source ${suffix} ${randomUUID()}`);
  const to = await api.account(`Transfer recipient ${suffix} ${randomUUID()}`);
  const instrument = await api.instrument(`Transfer asset ${suffix} ${randomUUID()}`, 'MOVE');
  await api.initialize(from.id);
  await api.initialize(to.id);
  const first = await api.create(
    from.id,
    tradeInput(instrument.id, 0, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '1',
      grossUsd: '100',
    }),
  );
  await api.create(
    from.id,
    tradeInput(instrument.id, 1, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 1,
      quantity: '1',
      grossUsd: '200',
    }),
  );
  return { from, to, instrument, first };
}

test('TRANSFER-API: original lot basis, connected restatement, replay and private boundaries', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const { from, to, instrument, first } = await ownedFixture(api, 'API');
  const command = movement(from.id, to.id, instrument.id, 2, 0);

  // This valid new command is deliberately the first assertion against the new route.
  const receipt = (await api.result('POST', transfersPath, 201, command)) as {
    journalRevision: number;
    transfer: Record<string, unknown>;
  };
  const transferId = String(receipt.transfer.transferId);
  expect(receipt).toMatchObject({
    journalRevision: expect.any(Number),
    transfer: {
      transferId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      version: 1,
      requestId: command.requestId,
      kind: 'create',
      fromAccountId: from.id,
      toAccountId: to.id,
      fromJournalRevision: 3,
      toJournalRevision: 1,
      instrumentId: instrument.id,
      quantity: '1.5',
      feeInstrumentId: instrument.id,
      feeQuantity: '0.1',
    },
  });

  const allocation = (await api.result(
    'GET',
    `${transfersPath}/${transferId}/allocation`,
    200,
  )) as {
    principalBasisUsd: string;
    feeConsumedBasisUsd: string;
    items: { kind: string; quantity: string; costUsd: string; origin: { tradeId: string } }[];
  };
  expect(allocation.principalBasisUsd).toBe('200');
  expect(allocation.feeConsumedBasisUsd).toBe('20');
  expect(allocation.items.map(({ kind, quantity, costUsd }) => [kind, quantity, costUsd])).toEqual([
    ['principal', '1', '100'],
    ['principal', '0.5', '100'],
    ['fee', '0.1', '20'],
  ]);
  expect(allocation.items[0].origin.tradeId).toBe(first.trade.tradeId);

  let source = (await api.result('GET', `/accounts/${from.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  let recipient = (await api.result('GET', `/accounts/${to.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  expect(source.journal).toMatchObject({
    journalRevision: 3,
    versionCount: 2,
    summary: { remainingCostUsd: '80', realizedUsd: '0' },
    transferSummary: { sentBasisUsd: '200', feeConsumedBasisUsd: '20' },
    revisionBudget: { used: 3, limit: 10000 },
  });
  expect(recipient.journal).toMatchObject({
    journalRevision: 1,
    versionCount: 0,
    summary: { remainingCostUsd: '200', realizedUsd: '0' },
    transferSummary: { receivedBasisUsd: '200' },
    revisionBudget: { used: 1, limit: 10000 },
  });

  const sale = await api.create(
    to.id,
    tradeInput(instrument.id, 1, {
      side: 'sell',
      occurredAt: '2025-01-04T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '1.2',
      grossUsd: '360',
    }),
  );
  expect(sale.trade.kind).toBe('create');
  recipient = (await api.result('GET', `/accounts/${to.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  expect(recipient.journal).toMatchObject({
    journalRevision: 2,
    versionCount: 1,
    summary: { consumedCostUsd: '140', realizedUsd: '220', remainingCostUsd: '60' },
  });

  const corrected = await api.correct(
    from.id,
    first.trade.tradeId,
    tradeInput(instrument.id, 4, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
      grossUsd: '120',
    }),
  );
  expect(corrected.trade.version).toBe(2);
  source = (await api.result('GET', `/accounts/${from.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  recipient = (await api.result('GET', `/accounts/${to.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  expect(source.journal).toMatchObject({
    journalRevision: 5,
    versionCount: 3,
    summary: { remainingCostUsd: '80' },
    revisionBudget: { used: 5, limit: 10000 },
  });
  expect(recipient.journal).toMatchObject({
    journalRevision: 3,
    versionCount: 1,
    summary: { consumedCostUsd: '160', realizedUsd: '200', remainingCostUsd: '60' },
    revisionBudget: { used: 3, limit: 10000 },
  });

  const rowsBeforeReplay = businessRows();
  expect(await api.result('POST', transfersPath, 200, command)).toEqual(receipt);
  expect(businessRows()).toBe(rowsBeforeReplay);
  const versions = (await api.result(
    'GET',
    `${transfersPath}/${transferId}/versions?limit=10`,
    200,
  )) as { items: Record<string, unknown>[] };
  expect(versions.items).toEqual([receipt.transfer]);

  const rowsBeforeRefusals = businessRows();
  const { fromAccountId: _from, toAccountId: _to, ...correctionFields } = command;
  const stale = await api.send('POST', `${transfersPath}/${transferId}/corrections`, {
    ...correctionFields,
    requestId: randomUUID(),
    expectedVersion: 1,
    expectedFromJournalRevision: 3,
    expectedToJournalRevision: 1,
  });
  expect(stale.status()).toBe(409);
  expect(businessRows()).toBe(rowsBeforeRefusals);

  const foreign = seedForeign();
  const foreignCommand = movement(foreign.accountId, to.id, instrument.id, 0, 3);
  const beforeForeign = businessRows();
  const deniedForeign = await api.send('POST', transfersPath, foreignCommand);
  expect(deniedForeign.status()).toBe(404);
  expect(await deniedForeign.text()).not.toContain(foreignOwner);
  expect(await deniedForeign.text()).not.toContain('Synthetic foreign');
  expect(businessRows()).toBe(beforeForeign);
  const absentForeign = await api.send('POST', transfersPath, {
    ...foreignCommand,
    fromAccountId: randomUUID(),
  });
  expect(absentForeign.status()).toBe(404);
  const { timestamp: foreignTime, ...foreignError } = await deniedForeign.json();
  const { timestamp: absentTime, ...absentError } = await absentForeign.json();
  // The existing error envelope includes a per-response timestamp. Privacy is
  // equality of all stable fields, never equality of two different request times.
  for (const timestamp of [foreignTime, absentTime]) {
    expect(typeof timestamp).toBe('string');
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  }
  expect(absentError).toEqual(foreignError);
  expect(foreignError).toEqual({ statusCode: 404, message: 'Not Found',
    error: 'NotFoundException', path: '/accounting/transfers' });
  expect(await deniedForeign.text()).not.toContain(foreign.accountId);

  const malformedBefore = businessRows();
  const malformed = await api.send('POST', transfersPath, {
    ...movement(from.id, to.id, instrument.id, 5, 3),
    quantity: 1.5,
  });
  expect(malformed.status()).toBe(400);
  expect(businessRows()).toBe(malformedBefore);

  const providersBefore = providerRequests();
  const anonymousBefore = businessRows();
  const anonymous = await request.get(`/api/accounting${transfersPath}`);
  expect(anonymous.status()).toBe(401);
  noStore(anonymous);
  expect(businessRows()).toBe(anonymousBefore);

  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const pendingPage = await pendingContext.newPage();
  try {
    await passwordStep(pendingPage);
    const pendingBefore = businessRows();
    const pending = await pendingContext.request.get(`/api/accounting${transfersPath}`);
    expect(pending.status()).toBe(401);
    noStore(pending);
    expect(businessRows()).toBe(pendingBefore);
  } finally {
    await pendingContext.close();
  }

  const deniedOriginBefore = businessRows();
  const deniedOrigin = await api.send(
    'POST',
    transfersPath,
    {
      ...movement(from.id, to.id, instrument.id, 5, 3),
    },
    { Origin: 'https://foreign.example.invalid' },
  );
  expect(deniedOrigin.status()).toBe(403);
  expect(businessRows()).toBe(deniedOriginBefore);
  const missingCsrfBefore = businessRows();
  const missingCsrf = await page.context().request.post(`/api/accounting${transfersPath}`, {
    data: movement(from.id, to.id, instrument.id, 5, 3),
    headers: { Origin: origin },
  });
  expect(missingCsrf.status()).toBe(403);
  noStore(missingCsrf);
  expect(businessRows()).toBe(missingCsrfBefore);
  expect(providerRequests()).toEqual(providersBefore);
});

test('TRANSFER-UI: review, exact create retry, correction and terminal void use real receipts', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const { from, to, instrument } = await ownedFixture(api, 'UI');
  const priorRows = businessRows();
  const providersBefore = providerRequests();

  await page.goto('/owned-transfers');
  await expect(
    page.getByRole('heading', { name: 'Переводы между своими счетами', exact: true }),
  ).toBeVisible();
  expect(businessRows()).toBe(priorRows);
  expect(providerRequests()).toEqual(providersBefore);

  await page.getByLabel('Со счёта', { exact: true }).selectOption(from.id);
  await page.getByLabel('На счёт', { exact: true }).selectOption(to.id);
  await page.getByLabel('Актив перевода', { exact: true }).selectOption(instrument.id);
  await page.getByLabel('Количество получателю', { exact: true }).fill('1.5');
  await page.getByLabel('Время перевода (UTC)', { exact: true }).fill('2025-01-03T00:00:00.000Z');
  await page.getByLabel('Порядок в эту миллисекунду', { exact: true }).fill('0');
  await page.getByLabel('Актив комиссии', { exact: true }).selectOption(instrument.id);
  await page.getByLabel('Количество комиссии', { exact: true }).fill('0.1');
  await page.getByRole('button', { name: 'Проверить счета', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Это перевод между моими счетами' }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'Это перевод между моими счетами' }).check();

  const submitted: unknown[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/accounting${transfersPath}`
    )
      submitted.push(request.postDataJSON());
  });
  let lostReceipt: Record<string, unknown> | undefined;
  let dropped = false;
  const dropFirstCommittedCreate = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'POST' || dropped) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    lostReceipt = (await response.json()) as Record<string, unknown>;
    dropped = true;
    await route.abort('connectionreset');
  };
  await page.route(`**/api/accounting${transfersPath}**`, dropFirstCommittedCreate);
  try {
    await page.getByRole('button', { name: 'Записать перевод', exact: true }).click();
    await expect.poll(() => dropped).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Повторить тот же запрос', exact: true }),
    ).toBeEnabled();
    expect(submitted).toHaveLength(1);
    const retry = await browserPost(page, transfersPath, () =>
      page.getByRole('button', { name: 'Повторить тот же запрос', exact: true }).click(),
    );
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual(lostReceipt);
    await expect.poll(() => submitted.length).toBe(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(lostReceipt).toMatchObject({
      transfer: { kind: 'create', quantity: '1.5', feeQuantity: '0.1' },
    });
  } finally {
    await page.unroute(`**/api/accounting${transfersPath}**`, dropFirstCommittedCreate);
  }

  const transferId = String(
    (lostReceipt?.transfer as Record<string, unknown> | undefined)?.transferId,
  );
  expect(transferId).toMatch(/^[a-f0-9-]{36}$/);
  const articleName = `Перевод ${transferId}`;
  const transferArticle = page.getByRole('article', { name: articleName, exact: true });
  await expect(transferArticle).toBeVisible();
  await transferArticle.getByRole('button', { name: 'Показать разбор лотов', exact: true }).click();
  await expect(transferArticle.getByText('Текущий разбор лотов', { exact: true })).toBeVisible();
  await expect(
    transferArticle.getByText('Списанная себестоимость комиссии, USD', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('20');

  await transferArticle.getByRole('button', { name: 'Исправить', exact: true }).click();
  await page.getByLabel('Количество получателю', { exact: true }).fill('1.4');
  await page.getByRole('button', { name: 'Проверить счета', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Это перевод между моими счетами' }).check();
  const correction = browserPost(page, `${transfersPath}/${transferId}/corrections`, () =>
    page.getByRole('button', { name: 'Сохранить исправление', exact: true }).click(),
  );
  expect((await correction).status()).toBe(201);
  await expect(transferArticle).toContainText('1.4');

  await transferArticle.getByRole('button', { name: 'Отменить перевод', exact: true }).click();
  const voidResponse = browserPost(page, `${transfersPath}/${transferId}/voids`, () =>
    page.getByRole('button', { name: 'Подтвердить отмену', exact: true }).click(),
  );
  expect((await voidResponse).status()).toBe(201);
  await expect(transferArticle).toContainText('Отменён');

  const source = (await api.result('GET', `/accounts/${from.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  const recipient = (await api.result('GET', `/accounts/${to.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  expect(source.journal).toMatchObject({ summary: { remainingCostUsd: '300' } });
  expect(recipient.journal).toMatchObject({ summary: { remainingCostUsd: '0' } });
  expect(providerRequests()).toEqual(providersBefore);
});
