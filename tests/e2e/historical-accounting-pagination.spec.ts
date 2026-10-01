import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
} from './admission-fixtures';
import { selectAnalysis } from './analytics-workbench-fixtures';
import { navigateToAccount } from './csv-import-fixtures';
import {
  type Instrument,
  literal,
  openingInput,
  providerRequests,
  readInstrument,
} from './manual-opening-fixtures';
import { fingerprint, owner, query, test } from './mfa-fixtures';
import { coverageFrom, trackBrowserRequests, tradeApi, tradeInput } from './usd-trades-fixtures';

// Bulk catalogue discovery setup follows seedDiscovery's sanctioned real PostgreSQL pattern.
// Financial opening/carry-in/trade commands below still use the actual authenticated API.
function seedPinnedInstruments(): Instrument[] {
  const values = Array.from({ length: 51 }, (_, index) => {
    const name = `Pinned history ${index + 1} ${randomUUID()}`;
    return `('${randomUUID()}', '${owner.id}', '${randomUUID()}', ${literal(JSON.stringify({ name, symbol: 'SAME' }))}, ${literal(name)}, 'SAME')`;
  });
  // One statement is atomic; read back actual database identities/defaults through RETURNING.
  const seeded = JSON.parse(
    query(`WITH seeded AS (
    INSERT INTO accounting_instruments (id, "ownerId", "requestId", "canonicalPayload", name, symbol)
    VALUES ${values.join(',')}
    RETURNING id, name, symbol, namespace,
      to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
  ) SELECT jsonb_agg(to_jsonb(seeded) ORDER BY id)::text FROM seeded`),
  ) as unknown[];
  expect(seeded).toHaveLength(51);
  return seeded.map(readInstrument);
}

const historyPath = (accountId: string) =>
  `/api/accounting/accounts/${accountId}/trade-journal/history`;
function noStore(headers: Record<string, string>): void {
  expect(headers['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
}

test('HIST-004-A: switching accounts invalidates a pending historical snapshot', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const instrument = await api.instrument(`Account switch TOKEN ${randomUUID()}`, 'HIST');
  const previous = await api.account(`Prior history account ${randomUUID()}`);
  const selected = await api.account(`Selected history account ${randomUUID()}`);
  await api.initialize(previous.id);
  await api.initialize(selected.id);
  await api.create(
    previous.id,
    tradeInput(instrument.id, 0, {
      occurredAt: coverageFrom,
      orderWithinTimestamp: 0,
      grossUsd: '100',
    }),
  );
  await api.create(
    selected.id,
    tradeInput(instrument.id, 0, {
      occurredAt: coverageFrom,
      orderWithinTimestamp: 0,
      grossUsd: '200',
    }),
  );

  const retained = fingerprint(['auth_sessions', 'auth_request_limits']);
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const providers = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);
  const endpoint = historyPath(previous.id);
  const pattern = `**${endpoint}?*`;
  const historyRequests: string[] = [];
  const accountingPosts: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      new URL(request.url()).pathname.endsWith('/trade-journal/history')
    )
      historyRequests.push(request.url());
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.startsWith('/api/accounting/')
    ) {
      accountingPosts.push(request.url());
    }
  });
  let release = () => {};
  let held = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
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
    await page.goto(`/manual-accounts/${previous.id}`);
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
    await selectAnalysis(page, 'accounting');
    await expect(
      page.getByRole('heading', { name: 'Учётный срез на дату', exact: true }),
    ).toBeVisible();
    const instant = page.getByLabel('Момент времени (ISO, с часовым поясом)', {
      exact: true,
    });
    await instant.fill(coverageFrom);
    expect(accountingPosts).toEqual([]);
    expect(historyRequests).toHaveLength(0);
    const delayed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint && response.request().method() === 'GET',
      { timeout: 15_000 },
    );
    delayed.catch(() => {});
    await page.getByRole('button', { name: 'Показать учётный срез', exact: true }).click();
    await expect.poll(() => held).toBe(true);

    await navigateToAccount(page, selected.id);
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Задача анализа', exact: true })).toHaveValue(
      'valuation',
    );
    await expect(
      page.getByRole('table', {
        name: 'Позиции на выбранный момент',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await selectAnalysis(page, 'accounting');
    await expect(page).toHaveURL(new RegExp(`/manual-accounts/${selected.id}$`));
    await expect(page.getByRole('heading', { name: selected.name, exact: true })).toBeVisible();
    release();
    const late = await delayed;
    expect(late.status()).toBe(200);
    noStore(late.headers());
    expect(await late.json()).toMatchObject({
      accountId: previous.id,
      at: coverageFrom,
      journalRevision: 1,
      items: [{ instrumentId: instrument.id, quantity: '1', costUsd: '100' }],
    });
    await late.finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );

    const section = page.getByRole('region', {
      name: 'Учётный срез на дату',
      exact: true,
    });
    await expect(section.getByRole('table')).toHaveCount(0);
    await expect(section.getByText(instrument.name, { exact: true })).toHaveCount(0);
    expect(historyRequests).toHaveLength(1);
    expect(new URL(historyRequests[0]).pathname).toBe(endpoint);
    await instant.fill(coverageFrom);
    const current = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === historyPath(selected.id) &&
        response.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Показать учётный срез', exact: true }).click();
    const currentResponse = await current;
    expect(currentResponse.status()).toBe(200);
    noStore(currentResponse.headers());
    expect(await currentResponse.json()).toMatchObject({
      accountId: selected.id,
      at: coverageFrom,
      journalRevision: 1,
      items: [
        {
          instrumentId: instrument.id,
          instrumentName: instrument.name,
          quantity: '1',
          costUsd: '200',
        },
      ],
    });
    const currentSection = page.getByRole('region', {
      name: 'Учётный срез на дату',
      exact: true,
    });
    const row = currentSection
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: instrument.name });
    await expect(row.getByRole('cell', { name: '200', exact: true })).toBeVisible();
    expect(historyRequests).toHaveLength(2);
    expect(new URL(historyRequests[1]).pathname).toBe(historyPath(selected.id));
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(retained);
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

test('HIST-003-A / HIST-004-A: a real concurrent write invalidates pinned browser pages', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const account = await api.account(`Pinned history pages ${randomUUID()}`);
  const instruments = seedPinnedInstruments();
  const sortedInstruments = [...instruments].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const positions = instruments.map((instrument) => ({
    instrumentId: instrument.id,
    quantity: '1',
    costStatus: 'known' as const,
    totalCostUsd: '100',
  }));
  const opening = await api.save(
    account.id,
    openingInput(instruments[0].id, { asOf: coverageFrom, positions }),
  );
  expect(opening.revision).toBe(1);

  const lots = instruments.map((instrument, index) => ({
    instrumentId: instrument.id,
    acquiredAt: '2024-12-31T00:00:00.000Z',
    orderWithinTimestamp: index,
    originalQuantity: '1',
    originalCostUsd: '100',
    remainingQuantity: '1',
  }));
  const carryPath = `/accounts/${account.id}/trade-journal/carry-in`;
  const carryLots = {
    expectedOpeningRevision: 1,
    lots,
  };
  const carryCommand = {
    requestId: randomUUID(),
    expectedOpeningRevision: 1,
    lots,
    assertReviewed: true,
  };
  const preview = await api.send('POST', `${carryPath}/preview`, carryLots);
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toMatchObject({
    canInitialize: true,
    carryInCostUsd: '5100',
  });
  const initialized = await api.send('POST', carryPath, carryCommand);
  expect(initialized.status()).toBe(201);
  const first = await api.create(
    account.id,
    tradeInput(sortedInstruments[0].id, 0, {
      occurredAt: coverageFrom,
      orderWithinTimestamp: 0,
      grossUsd: '10',
    }),
  );
  expect(first.journalRevision).toBe(1);

  const retained = fingerprint(['auth_sessions', 'auth_request_limits']);
  const providers = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);
  const accountingRowsBeforeReads = retained;
  const historyRequests: string[] = [];
  const accountingPosts: string[] = [];
  const endpoint = historyPath(account.id);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === endpoint && request.method() === 'GET') historyRequests.push(url.href);
    if (url.pathname.startsWith('/api/accounting/') && request.method() === 'POST')
      accountingPosts.push(url.href);
  });
  const uiAdmissions = ledger();
  const uiCsrfBefore = browserCsrfAdmissions();

  try {
    await page.goto(`/manual-accounts/${account.id}`);
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
    await selectAnalysis(page, 'accounting');
    await expect(
      page.getByRole('heading', { name: 'Учётный срез на дату', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Операции', exact: true }).click();
    const tradeTable = page.getByRole('table', {
      name: 'Сделки журнала',
      exact: true,
    });
    const selected = tradeTable.getByRole('row').filter({ hasText: first.trade.tradeId });
    await selected.getByRole('button', { name: 'Исправить', exact: true }).click();
    const form = page.getByRole('group', {
      name: 'Сделка в USD',
      exact: true,
      includeHidden: true,
    });
    const gross = form.getByLabel('Валовая сумма, USD', { exact: true });
    await gross.fill('12');
    await expect(gross).toHaveValue('12');
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();

    const section = page.getByRole('region', {
      name: 'Учётный срез на дату',
      exact: true,
    });
    const instant = page.getByLabel('Момент времени (ISO, с часовым поясом)', {
      exact: true,
    });
    await instant.fill(coverageFrom);
    expect(historyRequests).toHaveLength(0);
    const firstPage = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint && response.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Показать учётный срез', exact: true }).click();
    const firstPageResponse = await firstPage;
    expect(firstPageResponse.status()).toBe(200);
    const firstPageBody = await firstPageResponse.json();
    expect(firstPageBody).toMatchObject({
      accountId: account.id,
      at: coverageFrom,
      journalRevision: 1,
      initialCostUsd: '5100',
      summary: { grossBuysUsd: '10', remainingCostUsd: '5110' },
      nextOffset: 50,
    });
    expect(firstPageBody.items).toHaveLength(50);
    expect(firstPageBody.items.map((item: { instrumentId: string }) => item.instrumentId)).toEqual(
      sortedInstruments.slice(0, 50).map(({ id }) => id),
    );
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(accountingRowsBeforeReads);
    expectAdmissionDelta(uiAdmissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - uiCsrfBefore,
      },
    ]);
    await expect(section.getByRole('table')).toBeVisible();
    const firstPosition = section
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: sortedInstruments[0].name });
    await expect(firstPosition.getByRole('cell', { name: '2', exact: true })).toBeVisible();
    await expect(firstPosition.getByRole('cell', { name: '110', exact: true })).toBeVisible();
    expect(historyRequests).toHaveLength(1);

    const writer = await api.create(
      account.id,
      tradeInput(sortedInstruments[1].id, 1, {
        occurredAt: coverageFrom,
        orderWithinTimestamp: 1,
        grossUsd: '20',
      }),
    );
    expect(writer.journalRevision).toBe(2);
    const afterWriter = fingerprint(['auth_sessions', 'auth_request_limits']);
    const continuationAdmissions = ledger();
    const continuationCsrfBefore = browserCsrfAdmissions();

    const continuation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint && response.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    const stale = await continuation;
    expect(stale.status()).toBe(409);
    noStore(stale.headers());
    const staleUrl = new URL(stale.url());
    expect(staleUrl.searchParams.get('at')).toBe(coverageFrom);
    expect(staleUrl.searchParams.get('offset')).toBe('50');
    expect(staleUrl.searchParams.get('limit')).toBe('50');
    expect(staleUrl.searchParams.get('journalRevision')).toBe('1');
    expect(historyRequests).toHaveLength(2);
    await expect(
      section.getByRole('table').getByRole('row').filter({
        hasText: sortedInstruments[0].name,
      }),
    ).toHaveCount(0);
    await expect(gross).toHaveValue('12');
    await page.getByRole('button', { name: 'Операции', exact: true }).click();
    await expect(selected).toBeVisible();
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(afterWriter);

    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint && response.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Показать учётный срез', exact: true }).click();
    const current = await refreshed;
    expect(current.status()).toBe(200);
    noStore(current.headers());
    const currentBody = await current.json();
    expect(currentBody).toMatchObject({
      accountId: account.id,
      at: coverageFrom,
      journalRevision: 2,
      initialCostUsd: '5100',
      summary: { grossBuysUsd: '30', remainingCostUsd: '5130' },
      nextOffset: 50,
    });
    expect(currentBody.items).toHaveLength(50);
    expect(currentBody.items.map((item: { instrumentId: string }) => item.instrumentId)).toEqual(
      sortedInstruments.slice(0, 50).map(({ id }) => id),
    );
    const refreshedFirstPosition = section
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: sortedInstruments[0].name });
    const refreshedSecondPosition = section
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: sortedInstruments[1].name });
    await expect(
      refreshedFirstPosition.getByRole('cell', { name: '2', exact: true }),
    ).toBeVisible();
    await expect(
      refreshedFirstPosition.getByRole('cell', { name: '110', exact: true }),
    ).toBeVisible();
    await expect(
      refreshedSecondPosition.getByRole('cell', { name: '2', exact: true }),
    ).toBeVisible();
    await expect(
      refreshedSecondPosition.getByRole('cell', { name: '120', exact: true }),
    ).toBeVisible();
    await expect(gross).toHaveValue('12');

    const nextPage = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint && response.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    const lastPage = await nextPage;
    expect(lastPage.status()).toBe(200);
    noStore(lastPage.headers());
    const lastBody = await lastPage.json();
    expect(lastBody).toMatchObject({
      accountId: account.id,
      at: coverageFrom,
      journalRevision: 2,
      initialCostUsd: '5100',
      summary: { grossBuysUsd: '30', remainingCostUsd: '5130' },
      nextOffset: null,
    });
    expect(lastBody.items).toHaveLength(1);
    expect(lastBody.items[0]).toMatchObject({
      instrumentId: sortedInstruments[50].id,
      instrumentName: sortedInstruments[50].name,
      quantity: '1',
      costUsd: '100',
    });
    const pagedIds = [
      ...currentBody.items.map((item: { instrumentId: string }) => item.instrumentId),
      ...lastBody.items.map((item: { instrumentId: string }) => item.instrumentId),
    ];
    expect(pagedIds).toEqual(sortedInstruments.map(({ id }) => id));
    expect(new Set(pagedIds).size).toBe(51);
    const finalPosition = section
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: sortedInstruments[50].name });
    await expect(finalPosition.getByRole('cell', { name: '1', exact: true })).toBeVisible();
    await expect(finalPosition.getByRole('cell', { name: '100', exact: true })).toBeVisible();

    const parentJournal = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/accounting/accounts/${account.id}/trade-journal` &&
        response.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Обновить журнал', exact: true }).click();
    const parentJournalResponse = await parentJournal;
    expect(parentJournalResponse.status()).toBe(200);
    expect(await parentJournalResponse.json()).toMatchObject({
      journal: { journalRevision: 2 },
    });
    await expect(section.getByRole('table')).toHaveCount(0);
    await expect(gross).toHaveValue('12');
    await page.getByRole('button', { name: 'Операции', exact: true }).click();
    await expect(selected).toBeVisible();
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();

    expect(historyRequests).toHaveLength(4);
    expect(accountingPosts).toEqual([]);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(afterWriter);
    expectAdmissionDelta(continuationAdmissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - continuationCsrfBefore,
      },
    ]);
  } finally {
    expect(providerRequests()).toEqual(providers);
    assertQuota();
  }
});
