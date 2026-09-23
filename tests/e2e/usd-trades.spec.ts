import { randomUUID } from 'node:crypto';
import { type Page, expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ledgerState,
} from './admission-fixtures';
import {
  accountRows,
  backendLogs,
  businessState,
  foreignOwner,
  openingInput,
  providerRequests,
  readOpening,
  rows,
  seedForeign,
} from './manual-opening-fixtures';
import { completeFactor, fingerprint, passwordStep, test } from './mfa-fixtures';
import {
  TradeApi,
  type TradeInput,
  type TradeReceipt,
  browserPost,
  coverageFrom,
  expectBlockedTradeWrites,
  installTradeCommitFailure,
  noStore,
  priorState,
  raceTradeReplicas,
  readReceipt,
  restartWithExactProviderWarmup,
  trackBrowserRequests,
  tradeApi,
  tradeInput,
  tradeRows,
  tradeTables,
  withAccountLocked,
} from './usd-trades-fixtures';

async function fillTrade(page: Page, input: TradeInput): Promise<void> {
  const form = page.getByRole('group', { name: 'Сделка в USD', exact: true });
  await page.waitForLoadState('networkidle');
  const instrument = form.getByLabel('Инструмент', { exact: true });
  for (
    let loaded = 0;
    (await instrument.locator(`option[value="${input.instrumentId}"]`).count()) === 0;
    loaded++
  ) {
    expect(loaded, 'Synthetic instrument discovery stays bounded').toBeLessThan(10);
    await page.getByRole('button', { name: 'Показать еще инструменты', exact: true }).click();
    await page.waitForLoadState('networkidle');
  }
  await instrument.selectOption(input.instrumentId);
  await form
    .getByLabel('Тип сделки', { exact: true })
    .selectOption({ label: input.side === 'buy' ? 'Покупка' : 'Продажа' });
  await form.getByLabel('Дата и время сделки (UTC)', { exact: true }).fill(input.occurredAt);
  await form
    .getByLabel('Порядок в этот момент', { exact: true })
    .fill(String(input.orderWithinTimestamp));
  await form.getByLabel('Количество', { exact: true }).fill(input.quantity);
  await form.getByLabel('Валовая сумма, USD', { exact: true }).fill(input.grossUsd);
  await form.getByLabel('Комиссия, USD', { exact: true }).fill(input.feeUsd);
}
async function summary(page: Page, realized: string, remaining: string): Promise<void> {
  const region = page.getByRole('region', { name: 'Итоги журнала', exact: true });
  await expect(
    region
      .getByText('Реализованный результат по журналу сделок', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText(realized);
  await expect(
    region
      .getByText('Остаточная учётная стоимость', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText(remaining);
}
async function rejectUnchanged(
  api: TradeApi,
  path: string,
  body: unknown,
  status = 400,
): Promise<void> {
  const before = businessState();
  const result = await api.send('POST', path, body);
  expect(result.status()).toBe(status);
  expect(
    businessState(),
    'Failed command reserves no key, version, head or revision and alters no prior row',
  ).toBe(before);
}
async function fixture(page: Page) {
  const api = await tradeApi(page);
  const account = await api.account();
  const instrument = await api.instrument(`Точный USD инструмент ${randomUUID()}`, 'SAME');
  const origin = await api.initialize(account.id);
  return { api, account, instrument, origin };
}
async function mandatory(api: TradeApi, account: string, instrument: string, fees = false) {
  const inputs = [
    tradeInput(instrument, 0, { feeUsd: fees ? '1' : '0' }),
    tradeInput(instrument, 1, { grossUsd: '200', feeUsd: fees ? '2' : '0' }),
    tradeInput(instrument, 2, {
      side: 'sell',
      quantity: '1.5',
      grossUsd: '450',
      feeUsd: fees ? '3' : '0',
    }),
  ];
  const receipts: TradeReceipt[] = [];
  for (const input of inputs) receipts.push(await api.create(account, input));
  return { inputs, receipts };
}

test('TRADE-003-A / TRADE-006-A: real Russian forms show FIFO250/100/0.5, lock in-flight edits, survive restart and retain corrected history', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const account = await api.account();
  const instrument = await api.instrument(`Реальная FIFO форма ${randomUUID()}`, 'USD');
  const before = priorState();
  const providersBefore = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  await expect(
    page.getByRole('heading', { name: 'Журнал сделок в USD', exact: true }),
  ).toBeVisible();
  const assertion = page.getByRole('checkbox', { name: 'Позиции были пустыми', exact: true });
  await expect(assertion).not.toBeChecked();
  await page.getByLabel('Дата начала журнала (UTC)', { exact: true }).fill(coverageFrom);
  await expect(page.getByRole('button', { name: 'Открыть журнал', exact: true })).toBeDisabled();
  await assertion.check();
  const initialized = await browserPost(page, `/accounts/${account.id}/trade-journal`, () =>
    page.getByRole('button', { name: 'Открыть журнал', exact: true }).click(),
  );
  expect(initialized.status()).toBe(201);
  const inputs = [
    tradeInput(instrument.id, 0),
    tradeInput(instrument.id, 1, { grossUsd: '200' }),
    tradeInput(instrument.id, 2, { side: 'sell', quantity: '1.5', grossUsd: '450' }),
  ];
  const receipts: TradeReceipt[] = [];
  for (const [index, input] of inputs.entries()) {
    await fillTrade(page, input);
    const send = () =>
      browserPost(page, `/accounts/${account.id}/trades`, () =>
        page.getByRole('button', { name: 'Сохранить сделку', exact: true }).click(),
      );
    const result =
      index === 0
        ? await withAccountLocked(account.id, async (release) => {
            const pending = send();
            void pending.catch(() => undefined);
            try {
              await expectBlockedTradeWrites(1);
              const form = page.getByRole('group', { name: 'Сделка в USD', exact: true });
              for (const label of [
                'Инструмент',
                'Тип сделки',
                'Дата и время сделки (UTC)',
                'Порядок в этот момент',
                'Количество',
                'Валовая сумма, USD',
                'Комиссия, USD',
              ]) {
                await expect(form.getByLabel(label, { exact: true })).toBeDisabled();
              }
              await release();
              return await pending;
            } finally {
              try {
                await release();
              } finally {
                await Promise.allSettled([pending]);
              }
            }
          })
        : await send();
    expect(result.status()).toBe(201);
    receipts.push(readReceipt(await result.json()));
    await page.waitForLoadState('networkidle');
  }
  await summary(page, '250', '100');
  const lot = page
    .getByRole('table', { name: 'Открытые лоты', exact: true })
    .getByRole('row')
    .filter({ hasText: receipts[1].trade.tradeId });
  await expect(lot.getByRole('cell', { name: '0.5', exact: true })).toBeVisible();
  await expect(lot.getByRole('cell', { name: '100', exact: true })).toBeVisible();
  const sale = page
    .getByRole('table', { name: 'Сделки журнала', exact: true })
    .getByRole('row')
    .filter({ hasText: receipts[2].trade.tradeId });
  await sale.getByRole('button', { name: 'Распределение FIFO', exact: true }).click();
  const matches = page.getByRole('table', { name: 'Распределение FIFO', exact: true });
  for (const receipt of receipts.slice(0, 2))
    await expect(matches.getByRole('row').filter({ hasText: receipt.trade.tradeId })).toContainText(
      '100',
    );
  const stored = tradeRows(account.id);
  const admissionsBeforeRestart = ledgerState();
  expect(providerRequests()).toEqual(providersBefore);
  const providersAfterRestart = await restartWithExactProviderWarmup();
  expect(ledgerState()).toBe(admissionsBeforeRestart);
  await page.reload();
  await summary(page, '250', '100');
  expect(tradeRows(account.id)).toEqual(stored);
  await expect(lot.getByRole('cell', { name: '0.5', exact: true })).toBeVisible();
  const first = page
    .getByRole('table', { name: 'Сделки журнала', exact: true })
    .getByRole('row')
    .filter({ hasText: receipts[0].trade.tradeId });
  await first.getByRole('button', { name: 'Исправить', exact: true }).click();
  await page
    .getByRole('group', { name: 'Сделка в USD', exact: true })
    .getByLabel('Валовая сумма, USD', { exact: true })
    .fill('120');
  const corrected = await browserPost(
    page,
    `/accounts/${account.id}/trades/${receipts[0].trade.tradeId}/corrections`,
    () => page.getByRole('button', { name: 'Сохранить сделку', exact: true }).click(),
  );
  expect(corrected.status()).toBe(201);
  const correction = readReceipt(await corrected.json());
  expect(correction.trade.version).toBe(2);
  await summary(page, '230', '100');
  await first.getByRole('button', { name: 'Версии', exact: true }).click();
  const versions = page.getByRole('table', { name: 'Версии сделки', exact: true });
  await expect(versions.getByRole('cell', { name: '100', exact: true })).toBeVisible();
  await expect(versions.getByRole('cell', { name: '120', exact: true })).toBeVisible();
  expect((await api.versions(account.id, receipts[0].trade.tradeId)).items).toEqual([
    correction.trade,
    receipts[0].trade,
  ]);
  expect((await api.state(account.id)).journal?.summary).toMatchObject({
    realizedUsd: '230',
    remainingCostUsd: '100',
  });
  expect(priorState()).toBe(before);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  expect(providerRequests()).toEqual(providersAfterRestart);
  assertQuota();
});

test('TRADE-003-A/B: real fee, residual and negative-net projections preserve exact buy/sell version provenance', async ({
  page,
}) => {
  const { api, account, instrument } = await fixture(page);
  const residualAccount = await api.account();
  await api.initialize(residualAccount.id);
  const lossAccount = await api.account();
  await api.initialize(lossAccount.id);
  const before = priorState();
  const providers = providerRequests();
  const admissions = ledgerState();
  const { receipts } = await mandatory(api, account.id, instrument.id, true);
  expect((await api.state(account.id)).journal?.summary).toEqual({
    grossBuysUsd: '300',
    buyFeesUsd: '3',
    grossSalesUsd: '450',
    sellFeesUsd: '3',
    netSalesUsd: '447',
    consumedCostUsd: '202',
    realizedUsd: '245',
    remainingCostUsd: '101',
  });
  expect((await api.matches(account.id, receipts[2].trade.tradeId)).items).toEqual([
    {
      sellTradeId: receipts[2].trade.tradeId,
      sellVersion: 1,
      buyTradeId: receipts[0].trade.tradeId,
      buyVersion: 1,
      quantity: '1',
      costUsd: '101',
    },
    {
      sellTradeId: receipts[2].trade.tradeId,
      sellVersion: 1,
      buyTradeId: receipts[1].trade.tradeId,
      buyVersion: 1,
      quantity: '0.5',
      costUsd: '101',
    },
  ]);
  expect((await api.lots(account.id)).items[0]).toMatchObject({
    buyTradeId: receipts[1].trade.tradeId,
    buyVersion: 1,
    remainingQuantity: '0.5',
    remainingCostUsd: '101',
  });
  await api.create(
    residualAccount.id,
    tradeInput(instrument.id, 0, { quantity: '3', grossUsd: '1' }),
  );
  const costs = [`0.${'3'.repeat(30)}`, `0.${'3'.repeat(30)}`, `0.${'3'.repeat(29)}4`];
  for (const [index, cost] of costs.entries()) {
    const sale = await api.create(
      residualAccount.id,
      tradeInput(instrument.id, index + 1, { side: 'sell', grossUsd: '1' }),
    );
    expect((await api.matches(residualAccount.id, sale.trade.tradeId)).items[0].costUsd).toBe(cost);
  }
  expect((await api.lots(residualAccount.id)).items).toEqual([]);
  expect((await api.state(residualAccount.id)).journal?.summary.consumedCostUsd).toBe('1');
  await api.create(lossAccount.id, tradeInput(instrument.id, 0, { grossUsd: '10', feeUsd: '2' }));
  await api.create(
    lossAccount.id,
    tradeInput(instrument.id, 1, { side: 'sell', grossUsd: '1', feeUsd: '3' }),
  );
  expect((await api.realizations(lossAccount.id)).items[0]).toMatchObject({
    netUsd: '-2',
    realizedUsd: '-14',
  });
  expect(priorState()).toBe(before);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
});

test('TRADE-002-A: reverse API arrival, exact large/fractional amounts and same-symbol identities survive both real backend restarts', async ({
  page,
}) => {
  const { api, account, instrument } = await fixture(page);
  const sameSymbol = await api.instrument('Other actual same-symbol instrument', 'SAME');
  const exactAccount = await api.account();
  await api.initialize(exactAccount.id);
  const before = priorState();
  const providers = providerRequests();
  const admissions = ledgerState();
  const later = await api.create(
    account.id,
    tradeInput(instrument.id, 0, { orderWithinTimestamp: 20, grossUsd: '200' }),
  );
  const earlier = await api.create(
    account.id,
    tradeInput(instrument.id, 1, {
      orderWithinTimestamp: 10,
      grossUsd: '100',
      occurredAt: '2025-01-02T02:00:00+02:00',
    }),
  );
  const sale = await api.create(
    account.id,
    tradeInput(instrument.id, 2, {
      orderWithinTimestamp: 30,
      side: 'sell',
      quantity: '1.5',
      grossUsd: '450',
    }),
  );
  expect((await api.trades(account.id)).items.map((row) => row.tradeId)).toEqual([
    earlier.trade.tradeId,
    later.trade.tradeId,
    sale.trade.tradeId,
  ]);
  expect(
    (await api.matches(account.id, sale.trade.tradeId)).items.map((row) => [
      row.buyTradeId,
      row.quantity,
      row.costUsd,
    ]),
  ).toEqual([
    [earlier.trade.tradeId, '1', '100'],
    [later.trade.tradeId, '0.5', '100'],
  ]);
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/trades`,
    tradeInput(sameSymbol.id, 3, { side: 'sell', orderWithinTimestamp: 40 }),
    409,
  );
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/trades`,
    tradeInput(instrument.id, 3, { orderWithinTimestamp: 10 }),
    409,
  );
  const large = '9007199254740993.000000000000000001';
  const quantum = '0.000000000000000000000000000001';
  const exact = await api.create(
    exactAccount.id,
    tradeInput(instrument.id, 0, { quantity: large, grossUsd: '123.450000000000000001' }),
  );
  const tiny = await api.create(
    exactAccount.id,
    tradeInput(sameSymbol.id, 1, { quantity: quantum, grossUsd: quantum }),
  );
  const stored = rows<{
    quantity: string;
    grossUsd: string;
  }>(`SELECT quantity::text,"grossUsd"::text FROM account_trade_versions
    WHERE "accountId"='${exactAccount.id}' ORDER BY "journalRevision"`);
  expect(stored).toEqual([
    { quantity: `${large}000000000000`, grossUsd: '123.450000000000000001000000000000' },
    { quantity: quantum, grossUsd: quantum },
  ]);
  const state = tradeRows(exactAccount.id);
  expect(providerRequests()).toEqual(providers);
  const afterRestart = await restartWithExactProviderWarmup();
  expect((await api.trades(exactAccount.id)).items).toEqual([exact.trade, tiny.trade]);
  expect(
    (await api.lots(exactAccount.id)).items.map((row) => [row.instrumentId, row.remainingQuantity]),
  ).toEqual([
    [instrument.id, large],
    [sameSymbol.id, quantum],
  ]);
  expect(tradeRows(exactAccount.id)).toEqual(state);
  expect(priorState()).toBe(before);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(afterRestart);
});

test('TRADE-002-B: real HTTP raw types, overflow and calendar errors are atomic and do not reserve a rejected key', async ({
  page,
}) => {
  const { api, account, instrument } = await fixture(page);
  const before = priorState();
  const providers = providerRequests();
  const admissions = ledgerState();
  const input = tradeInput(instrument.id, 0);
  for (const alteration of [
    { quantity: 1 },
    { grossUsd: { toString: '100' } },
    { feeUsd: [] },
    { quantity: 'NaN' },
    { quantity: '1e2' },
    { quantity: `1.${'0'.repeat(31)}` },
    { grossUsd: '0' },
    { feeUsd: '-1' },
    { instrumentId: { toString: instrument.id } },
    { side: ['buy'] },
    { occurredAt: { toString: coverageFrom } },
    { occurredAt: '2025-02-29T00:00:00Z' },
    { occurredAt: '2025-01-02T00:00:00' },
    { expectedJournalRevision: '0' },
    { expectedJournalRevision: true },
    { orderWithinTimestamp: '0' },
    { orderWithinTimestamp: 2147483648 },
    { ownerId: foreignOwner },
    { currency: 'EUR' },
    { grossUsd: `${'9'.repeat(48)}.${'9'.repeat(30)}`, feeUsd: `0.${'0'.repeat(29)}1` },
  ])
    await rejectUnchanged(api, `/accounts/${account.id}/trades`, { ...input, ...alteration });
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/trades`,
    { ...input, occurredAt: '2024-12-31T23:59:59.999Z' },
    409,
  );
  const saved = await api.create(account.id, {
    ...input,
    quantity: '0001.000',
    grossUsd: '00100.00',
    feeUsd: '000.000',
  });
  expect(saved.trade).toMatchObject({
    quantity: '1',
    grossUsd: '100',
    feeUsd: '0',
    requestId: input.requestId,
  });
  expect(await api.create(account.id, input, 200)).toEqual(saved);
  expect((await api.state(account.id)).journal?.versionCount).toBe(1);
  expect(priorState()).toBe(before);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
});

test('TRADE-006-B: anonymous, pending, Origin/CSRF and foreign trade boundaries preserve all protected rows', async ({
  page,
  request,
}) => {
  const foreign = seedForeign();
  const target = randomUUID();
  const base = `/accounts/${foreign.accountId}`;
  const input = tradeInput(foreign.instrumentId, 0);
  const endpoints = [
    { method: 'GET', path: `${base}/trade-journal` },
    { method: 'GET', path: `${base}/trades` },
    { method: 'GET', path: `${base}/trade-lots` },
    { method: 'GET', path: `${base}/trade-realizations` },
    { method: 'GET', path: `${base}/trades/${target}/matches` },
    { method: 'GET', path: `${base}/trades/${target}/versions` },
    {
      method: 'POST',
      path: `${base}/trade-journal`,
      data: { requestId: randomUUID(), coverageFrom, assertEmpty: true },
    },
    { method: 'POST', path: `${base}/trades`, data: input },
    { method: 'POST', path: `${base}/trades/${target}/corrections`, data: input },
    {
      method: 'POST',
      path: `${base}/trades/${target}/voids`,
      data: { requestId: randomUUID(), expectedJournalRevision: 0 },
    },
  ];
  for (const endpoint of endpoints) {
    const before = fingerprint([]);
    const result = await request.fetch(`/api/accounting${endpoint.path}`, endpoint);
    expect(result.status()).toBe(401);
    noStore(result);
    expect(fingerprint([])).toBe(before);
  }
  await passwordStep(page);
  for (const endpoint of endpoints) {
    const before = fingerprint([]);
    const result = await page.context().request.fetch(`/api/accounting${endpoint.path}`, endpoint);
    expect(result.status()).toBe(401);
    noStore(result);
    expect(fingerprint([])).toBe(before);
  }
  const { csrfToken } = await completeFactor(page);
  const api = new TradeApi(page.context().request, csrfToken);
  const account = await api.account();
  const instrument = await api.instrument();
  await api.initialize(account.id);
  const write = tradeInput(instrument.id, 0);
  const providers = providerRequests();
  const admissions = ledgerState();
  const forgedHeaders: Record<string, string>[] = [
    { Origin: 'https://foreign.example.invalid' },
    { 'X-CSRF-Token': 'synthetic-invalid-token' },
  ];
  for (const headers of forgedHeaders) {
    const before = fingerprint([]);
    const result = await api.send('POST', `/accounts/${account.id}/trades`, write, headers);
    expect(result.status()).toBe(403);
    expect(fingerprint([])).toBe(before);
  }
  const incompleteHeaders: Record<string, string>[] = [
    { Origin: 'https://127.0.0.1:8443' },
    { 'X-CSRF-Token': csrfToken },
  ];
  for (const headers of incompleteHeaders) {
    const before = fingerprint([]);
    const result = await page
      .context()
      .request.post(`/api/accounting/accounts/${account.id}/trades`, { data: write, headers });
    expect(result.status()).toBe(403);
    noStore(result);
    expect(fingerprint([])).toBe(before);
  }
  for (const suffix of [
    '/trade-journal',
    '/trades',
    '/trade-lots',
    '/trade-realizations',
    `/trades/${target}/versions`,
  ]) {
    const before = businessState();
    const denied = await api.send('GET', `/accounts/${foreign.accountId}${suffix}`);
    const missing = await api.send('GET', `/accounts/${randomUUID()}${suffix}`);
    expect(denied.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect((await denied.json()).message).toEqual((await missing.json()).message);
    expect(await denied.text()).not.toContain(foreignOwner);
    expect(await denied.text()).not.toContain('Synthetic foreign');
    expect(businessState()).toBe(before);
  }
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/trades`,
    { ...write, instrumentId: foreign.instrumentId },
    404,
  );
  await rejectUnchanged(api, `/accounts/${foreign.accountId}/trades`, write, 404);
  await rejectUnchanged(api, `/accounts/${account.id}/trades/${target}/corrections`, write, 404);
  await rejectUnchanged(api, `/accounts/${account.id}/trades`, { ...write, ownerId: foreignOwner });
  await rejectUnchanged(api, `/accounts/${account.id}/trades`, {
    ...write,
    instrumentName: 'Forged owned label',
  });
  const beforeDelete = businessState();
  for (const method of ['DELETE', 'PATCH'])
    expect(
      (await api.send(method, `/accounts/${account.id}/trades/${target}`, write)).status(),
    ).toBe(404);
  expect(businessState()).toBe(beforeDelete);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
});

test('TRADE-001-B / TRADE-004-B: actual upstream replicas serialize identical retries, competing sales and initialization versus an opening', async ({
  page,
}) => {
  const { api, account, instrument } = await fixture(page);
  const originAccount = await api.account();
  const before = priorState();
  const providers = providerRequests();
  const admissions = ledgerState();
  const initial = tradeInput(instrument.id, 0);
  const same = await raceTradeReplicas(
    account.id,
    () => api.send('POST', `/accounts/${account.id}/trades`, initial),
    () => api.send('POST', `/accounts/${account.id}/trades`, initial),
  );
  expect(same.map((response) => response.status()).sort()).toEqual([200, 201]);
  const bought = readReceipt(await same[0].json());
  expect(readReceipt(await same[1].json())).toEqual(bought);
  const candidates = ['150', '160'].map((grossUsd, index) =>
    tradeInput(instrument.id, 1, { side: 'sell', grossUsd, orderWithinTimestamp: index + 1 }),
  );
  const competing = await raceTradeReplicas(
    account.id,
    () => api.send('POST', `/accounts/${account.id}/trades`, candidates[0]),
    () => api.send('POST', `/accounts/${account.id}/trades`, candidates[1]),
  );
  expect(competing.map((response) => response.status()).sort()).toEqual([201, 409]);
  const winner = readReceipt(await competing.find((response) => response.status() === 201)!.json());
  const state = (await api.state(account.id)).journal;
  expect(state).toMatchObject({ journalRevision: 2, activeTradeCount: 2, versionCount: 2 });
  expect((await api.lots(account.id)).items).toEqual([]);
  expect((await api.matches(account.id, winner.trade.tradeId)).items).toEqual([
    {
      sellTradeId: winner.trade.tradeId,
      sellVersion: 1,
      buyTradeId: bought.trade.tradeId,
      buyVersion: 1,
      quantity: '1',
      costUsd: '100',
    },
  ]);
  const loser = candidates.find((candidate) => candidate.requestId !== winner.trade.requestId)!;
  expect(
    rows(
      `SELECT * FROM account_trade_versions WHERE "accountId"='${account.id}' AND "requestId"='${loser.requestId}'`,
    ),
  ).toEqual([]);
  const beforeReplay = businessState();
  expect(await api.create(account.id, initial, 200)).toEqual(bought);
  expect(businessState()).toBe(beforeReplay);
  expect((await api.state(account.id)).journal?.journalRevision).toBe(2);
  expect(priorState()).toBe(before);
  const untouchedAccount = accountRows(account.id);
  const excluded = [
    'auth_sessions',
    'auth_request_limits',
    ...tradeTables,
    'manual_accounts',
    'account_opening_snapshots',
    'account_opening_positions',
  ];
  const preservedOriginRace = fingerprint(excluded);
  const otherManualRows = () => [
    rows(
      `SELECT to_jsonb(t)::text AS row FROM manual_accounts t WHERE id<>'${originAccount.id}' ORDER BY id`,
    ),
    rows(
      `SELECT to_jsonb(t)::text AS row FROM account_opening_snapshots t WHERE "accountId"<>'${originAccount.id}' ORDER BY to_jsonb(t)::text`,
    ),
    rows(
      `SELECT to_jsonb(t)::text AS row FROM account_opening_positions t WHERE "accountId"<>'${originAccount.id}' ORDER BY to_jsonb(t)::text`,
    ),
  ];
  const previousManualRows = otherManualRows();
  const originInput = { requestId: randomUUID(), coverageFrom, assertEmpty: true };
  const opening = openingInput(instrument.id);
  const originRace = await raceTradeReplicas(
    originAccount.id,
    () => api.send('POST', `/accounts/${originAccount.id}/trade-journal`, originInput),
    () => api.send('POST', `/accounts/${originAccount.id}/openings`, opening),
  );
  expect(originRace.map((response) => response.status()).sort()).toEqual([201, 409]);
  const journalRows = rows(
    `SELECT * FROM account_trade_journals WHERE "accountId"='${originAccount.id}'`,
  );
  const openingRows = rows(
    `SELECT * FROM account_opening_snapshots WHERE "accountId"='${originAccount.id}'`,
  );
  expect(journalRows.length + openingRows.length).toBe(1);
  if (openingRows.length) {
    expect(readOpening(await originRace[1].json()).revision).toBe(1);
    expect((await api.state(originAccount.id)).ineligibilityReason).toBe('opening-history');
  } else expect((await api.state(originAccount.id)).journal?.journalRevision).toBe(0);
  // The independently raced opening is the only permitted predecessor-accounting delta.
  expect(fingerprint(excluded)).toBe(preservedOriginRace);
  expect(otherManualRows()).toEqual(previousManualRows);
  expect(accountRows(account.id)).toEqual(untouchedAccount);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
});

test('TRADE-004-A / TRADE-005-A: immutable receipts precede live CAS, pages reject revision drift and old-prefix failure preserves every row', async ({
  page,
}) => {
  const { api, account, instrument } = await fixture(page);
  const before = priorState();
  const providers = providerRequests();
  const admissions = ledgerState();
  const { inputs, receipts } = await mandatory(api, account.id, instrument.id);
  const firstPage = await api.trades(account.id, '?limit=1');
  expect(firstPage).toEqual({ journalRevision: 3, items: [receipts[0].trade], nextOffset: 1 });
  const firstRows = rows(
    `SELECT to_jsonb(t)::text AS row FROM account_trade_versions t WHERE "accountId"='${account.id}' ORDER BY "journalRevision"`,
  );
  const correctionInput = {
    ...inputs[0],
    requestId: randomUUID(),
    expectedJournalRevision: 3,
    grossUsd: '120',
  };
  const [duringCorrection, correction] = await Promise.all([
    api.realizations(account.id),
    api.correct(account.id, receipts[0].trade.tradeId, correctionInput),
  ]);
  expect([3, 4]).toContain(duringCorrection.journalRevision);
  expect(duringCorrection.items).toHaveLength(1);
  expect(duringCorrection.items[0]).toMatchObject(
    duringCorrection.journalRevision === 3
      ? { consumedCostUsd: '200', realizedUsd: '250', netUsd: '450' }
      : { consumedCostUsd: '220', realizedUsd: '230', netUsd: '450' },
  );
  expect(correction.trade.version).toBe(2);
  expect(correction.journalRevision).toBe(4);
  expect((await api.state(account.id)).journal?.summary).toMatchObject({
    realizedUsd: '230',
    remainingCostUsd: '100',
  });
  const stale = await api.send(
    'GET',
    `/accounts/${account.id}/trades?journalRevision=3&offset=1&limit=1`,
  );
  expect(stale.status()).toBe(409);
  expect(await stale.json()).not.toHaveProperty('items');
  const current = await api.trades(account.id, '?journalRevision=4&offset=1&limit=1');
  expect(current.items).toEqual([receipts[1].trade]);
  expect(current.nextOffset).toBe(2);
  const beforeReplay = businessState();
  expect(await api.create(account.id, inputs[0], 200)).toEqual(receipts[0]);
  expect(await api.correct(account.id, receipts[0].trade.tradeId, correctionInput, 200)).toEqual(
    correction,
  );
  expect(businessState()).toBe(beforeReplay);
  expect((await api.state(account.id)).journal?.journalRevision).toBe(4);
  expect((await api.versions(account.id, receipts[0].trade.tradeId, '?limit=1')).items).toEqual([
    correction.trade,
  ]);
  expect(
    (await api.versions(account.id, receipts[0].trade.tradeId, '?beforeVersion=2&limit=1')).items,
  ).toEqual([receipts[0].trade]);
  expect(
    rows(
      `SELECT to_jsonb(t)::text AS row FROM account_trade_versions t WHERE "accountId"='${account.id}' AND "journalRevision"<=3 ORDER BY "journalRevision"`,
    ),
  ).toEqual(firstRows);
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/trades/${receipts[0].trade.tradeId}/corrections`,
    {
      ...correctionInput,
      requestId: randomUUID(),
      expectedJournalRevision: 4,
      occurredAt: '2025-01-03T00:00:00Z',
    },
    409,
  );
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/trades/${receipts[0].trade.tradeId}/voids`,
    { requestId: randomUUID(), expectedJournalRevision: 4 },
    409,
  );
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/trades/${receipts[1].trade.tradeId}/corrections`,
    correctionInput,
    409,
  );
  const voidInput = { requestId: randomUUID(), expectedJournalRevision: 4 };
  const voided = await api.void(account.id, receipts[2].trade.tradeId, voidInput);
  expect(voided.trade).toMatchObject({
    kind: 'void',
    version: 2,
    quantity: '1.5',
    grossUsd: '450',
    side: 'sell',
  });
  expect(await api.void(account.id, receipts[2].trade.tradeId, voidInput, 200)).toEqual(voided);
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/trades/${receipts[2].trade.tradeId}/corrections`,
    { ...inputs[2], requestId: randomUUID(), expectedJournalRevision: 5 },
    409,
  );
  expect((await api.realizations(account.id)).items).toEqual([]);
  expect((await api.state(account.id)).journal?.summary).toMatchObject({
    realizedUsd: '0',
    remainingCostUsd: '320',
  });
  expect(priorState()).toBe(before);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
});

test('TRADE-004-C / TRADE-006-B: real deferred HTTP COMMIT failure is private, rolls back all writes and permits only explicit retry', async ({
  page,
}) => {
  const { api, account, instrument } = await fixture(page);
  const before = businessState();
  const providers = providerRequests();
  const admissions = ledgerState();
  const input = tradeInput(instrument.id, 0, {
    quantity: '987654321.123456789123456789',
    grossUsd: '876543210.987654321987654321',
  });
  const marker = `synthetic-private-trade-${randomUUID()}`;
  const fault = installTradeCommitFailure(account.id, input.requestId, marker);
  try {
    const failed = await api.send('POST', `/accounts/${account.id}/trades`, input);
    expect(failed.status()).toBe(500);
    noStore(failed);
    expect((await failed.json()).message).toBe('Internal server error');
    expect(fault.attempts()).toEqual([{ value: '1', isCalled: true }]);
    expect(businessState()).toBe(before);
    expect((await api.state(account.id)).journal).toMatchObject({
      journalRevision: 0,
      activeTradeCount: 0,
      versionCount: 0,
    });
    const output = `${await failed.text()}\n${backendLogs()}`;
    for (const privateValue of [
      marker,
      input.quantity,
      input.grossUsd,
      'canonicalPayload',
      'account_trade_versions',
    ]) {
      expect(output).not.toContain(privateValue);
    }
  } finally {
    fault.remove();
  }
  expect(businessState()).toBe(before);
  const retry = await api.create(account.id, input);
  expect(retry.journalRevision).toBe(1);
  expect(await api.create(account.id, input, 200)).toEqual(retry);
  expect((await api.trades(account.id)).items).toEqual([retry.trade]);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
});

test('TRADE-006-A/B: literal instrument labels and a real409 keep the draft until explicit current-journal review', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const account = await api.account();
  const instrument = await api.instrument(
    '<img data-trade-label="unsafe" src=x> Literal trade label',
    'SAME',
  );
  await api.initialize(account.id);
  const before = priorState();
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  const draft = tradeInput(instrument.id, 0, {
    quantity: '3',
    grossUsd: '300',
    orderWithinTimestamp: 5,
  });
  await fillTrade(page, draft);
  const external = await api.create(
    account.id,
    tradeInput(instrument.id, 0, { quantity: '2', grossUsd: '200' }),
  );
  const beforeConflict = fingerprint(['auth_sessions', 'auth_request_limits']);
  const writes: unknown[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/accounting/accounts/${account.id}/trades`
    )
      writes.push(request.postDataJSON());
  });
  const save = page.getByRole('button', { name: 'Сохранить сделку', exact: true });
  const failed = await browserPost(page, `/accounts/${account.id}/trades`, () => save.click());
  expect(failed.status()).toBe(409);
  await expect(page.getByRole('alert')).toContainText(/[А-Яа-я]/);
  await expect(page.getByRole('heading', { name: 'Журнал изменился', exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  const form = page.getByRole('group', { name: 'Сделка в USD', exact: true });
  await expect(form.getByLabel('Количество', { exact: true })).toHaveValue('3');
  await expect(form.getByLabel('Валовая сумма, USD', { exact: true })).toHaveValue('300');
  await page.waitForLoadState('networkidle');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ expectedJournalRevision: 0, quantity: '3', grossUsd: '300' });
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforeConflict);
  await expect(page.locator('[data-trade-label]')).toHaveCount(0);
  await page
    .getByRole('checkbox', {
      name: 'Я проверил актуальную версию журнала и хочу сохранить черновик.',
      exact: true,
    })
    .check();
  const saved = await browserPost(page, `/accounts/${account.id}/trades`, () => save.click());
  expect(saved.status()).toBe(201);
  const receipt = readReceipt(await saved.json());
  expect(receipt.journalRevision).toBe(2);
  expect(receipt.trade.quantity).toBe('3');
  expect(writes).toHaveLength(2);
  const bodies = writes as { requestId: string; expectedJournalRevision: number }[];
  expect(bodies[1].expectedJournalRevision).toBe(1);
  expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
  await summary(page, '0', '500');
  const tradeTable = page.getByRole('table', { name: 'Сделки журнала', exact: true });
  await expect(
    tradeTable.getByRole('row').filter({ hasText: receipt.trade.tradeId }),
  ).toContainText(instrument.name);
  await expect(page.locator('[data-trade-label]')).toHaveCount(0);
  expect((await api.trades(account.id)).items).toEqual([external.trade, receipt.trade]);
  expect(priorState()).toBe(before);
  expect(providerRequests()).toEqual(providers);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  assertQuota();
});

test('TRADE-004-B / TRADE-006-A: a real committed response lost in transport retries the identical command and reads current state after its old receipt', async ({
  page,
}) => {
  const { api, account, instrument } = await fixture(page);
  const before = priorState();
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  await fillTrade(page, tradeInput(instrument.id, 0));
  const path = `/api/accounting/accounts/${account.id}/trades`;
  const routePattern = `**${path}`;
  const browserCommands: TradeInput[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path)
      browserCommands.push(request.postDataJSON() as TradeInput);
  });
  let committed: TradeReceipt | undefined;
  let delivered = false;
  await page.route(
    routePattern,
    async (route) => {
      // Actual unchanged HTTPS request reaches auth/proxy/backend/PG. Only delivery
      // of its real successful response is lost; no response/body/auth is fabricated.
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committed = readReceipt(await response.json());
      expect(
        rows<{ journalRevision: number }>(`SELECT "journalRevision" FROM account_trade_versions
      WHERE "accountId"='${account.id}' AND "requestId"='${committed.trade.requestId}'`),
      ).toEqual([{ journalRevision: 1 }]);
      delivered = true;
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
  try {
    await page.getByRole('button', { name: 'Сохранить сделку', exact: true }).click();
    await expect.poll(() => delivered).toBe(true);
    await expect(page.getByRole('alert')).toContainText(/[А-Яа-я]/);
    await page.waitForLoadState('networkidle');
    expect(committed).toBeDefined();
    expect(browserCommands).toHaveLength(1);
    const original = committed!;
    const corrected = await api.correct(account.id, original.trade.tradeId, {
      ...browserCommands[0],
      requestId: randomUUID(),
      expectedJournalRevision: 1,
      grossUsd: '250',
    });
    expect(corrected.journalRevision).toBe(2);
    const currentRows = tradeRows(account.id);
    const beforeRetry = fingerprint(['auth_sessions', 'auth_request_limits']);
    const replay = await browserPost(page, `/accounts/${account.id}/trades`, () =>
      page.getByRole('button', { name: 'Сохранить сделку', exact: true }).click(),
    );
    expect(replay.status()).toBe(200);
    expect(readReceipt(await replay.json())).toEqual(original);
    expect(browserCommands).toHaveLength(2);
    expect(
      browserCommands[1],
      'An unchanged retry preserves the entire original command, including its old CAS and request key',
    ).toEqual(browserCommands[0]);
    await summary(page, '0', '250');
    const current = page
      .getByRole('table', { name: 'Сделки журнала', exact: true })
      .getByRole('row')
      .filter({ hasText: original.trade.tradeId });
    await expect(current.getByRole('cell', { name: '250', exact: true })).toBeVisible();
    expect((await api.state(account.id)).journal?.journalRevision).toBe(2);
    expect(tradeRows(account.id)).toEqual(currentRows);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforeRetry);
    expect((await api.versions(account.id, original.trade.tradeId)).items).toEqual([
      corrected.trade,
      original.trade,
    ]);
  } finally {
    await page.unroute(routePattern);
  }
  expect(priorState()).toBe(before);
  expect(providerRequests()).toEqual(providers);
  expectAdmissionDelta(admissions, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  assertQuota();
});
