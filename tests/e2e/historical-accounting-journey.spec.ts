import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
} from './admission-fixtures';
import { inspectAnalysis, selectAnalysis } from './analytics-workbench-fixtures';
import { providerRequests } from './manual-opening-fixtures';
import { fingerprint, test } from './mfa-fixtures';
import { trackBrowserRequests, tradeApi, tradeInput } from './usd-trades-fixtures';

test('HIST-004-A: a late history response cannot replace edited intent or the unsaved correction', async ({
  page,
}, testInfo) => {
  const api = await tradeApi(page);
  const account = await api.account(`Historical late response ${randomUUID()}`);
  const instrument = await api.instrument(`Historical late TOKEN ${randomUUID()}`, 'HIST');
  await api.initialize(account.id);
  const first = await api.create(
    account.id,
    tradeInput(instrument.id, 0, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
    }),
  );
  await api.create(
    account.id,
    tradeInput(instrument.id, 1, {
      occurredAt: '2025-01-03T00:00:00.000Z',
      orderWithinTimestamp: 0,
      grossUsd: '200',
    }),
  );

  const retained = fingerprint(['auth_sessions', 'auth_request_limits']);
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const providers = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);
  const historyPath = `/api/accounting/accounts/${account.id}/trade-journal/history`;
  const historyRequests: string[] = [];
  const accountingPosts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.startsWith('/api/accounting/'))
      accountingPosts.push(url.href);
    if (url.pathname !== historyPath) return;
    if (request.method() === 'GET') historyRequests.push(url.href);
  });
  const pattern = `**${historyPath}?*`;
  let release = () => {};
  let held = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    await page.goto(`/manual-accounts/${account.id}`);
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
    await selectAnalysis(page, 'accounting');
    await expect(
      page.getByRole('heading', { name: 'Учётный срез на дату', exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Операции', exact: true }).click();
    const tradeTable = page.getByRole('table', { name: 'Сделки журнала', exact: true });
    const selected = tradeTable.getByRole('row').filter({ hasText: first.trade.tradeId });
    await selected.getByRole('button', { name: 'Исправить', exact: true }).click();
    const tradeForm = page.getByRole('group', { name: 'Сделка в USD', exact: true });
    const gross = tradeForm.getByLabel('Сумма сделки, USD', { exact: true });
    await gross.fill('120');
    await expect(gross).toHaveValue('120');

    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
    const section = page.getByRole('region', {
      name: 'Учётный срез на дату',
      exact: true,
    });
    const instant = page.getByLabel('Дата среза', { exact: true });
    await instant.fill('2025-01-03');
    await page.route(
      pattern,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        held = true;
        await gate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    const delayed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === historyPath && response.request().method() === 'GET',
      { timeout: 15_000 },
    );
    delayed.catch(() => {});
    await page.getByRole('button', { name: 'Показать учётный срез', exact: true }).click();
    await expect.poll(() => held).toBe(true);

    await instant.fill('2025-01-02');
    release();
    const lateResponse = await delayed;
    expect(lateResponse.status()).toBe(200);
    expect(await lateResponse.json()).toMatchObject({
      accountId: account.id,
      at: '2025-01-03T00:00:00.000Z',
      journalRevision: 2,
      items: [{ instrumentId: instrument.id, quantity: '2', costUsd: '300' }],
    });
    await lateResponse.finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(section.getByText('2025-01-03T00:00:00.000Z', { exact: true })).toHaveCount(0);
    await expect(section.getByRole('table')).toHaveCount(0);
    expect(historyRequests).toHaveLength(1);

    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === historyPath && response.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Показать учётный срез', exact: true }).click();
    const response = await refreshed;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      accountId: account.id,
      at: '2025-01-02T00:00:00.000Z',
      journalRevision: 2,
      items: [
        {
          instrumentId: instrument.id,
          instrumentName: instrument.name,
          quantity: '1',
          costUsd: '100',
        },
      ],
    });
    const position = section
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: instrument.name });
    await expect(position.getByRole('cell', { name: '1', exact: true })).toBeVisible();
    await expect(position.getByRole('cell', { name: '100', exact: true })).toBeVisible();
    await expect(section.getByText('2025-01-02T00:00:00.000Z', { exact: true })).toBeVisible();
    await inspectAnalysis(page, testInfo, section, 'accounting');

    await page.getByRole('button', { name: 'Операции', exact: true }).click();
    await expect(gross).toHaveValue('120');
    await expect(page.getByRole('button', { name: 'Сохранить сделку', exact: true })).toBeEnabled();
    await expect(selected).toBeVisible();
    expect(historyRequests).toHaveLength(2);
    expect(accountingPosts).toEqual([]);
  } finally {
    release();
    await page.unroute(pattern);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(retained);
    expectAdmissionDelta(admissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
    ]);
    expect(providerRequests()).toEqual(providers);
    assertQuota();
  }
});
