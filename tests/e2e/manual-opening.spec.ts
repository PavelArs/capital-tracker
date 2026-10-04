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
  type Account,
  type Instrument,
  ManualApi,
  type Opening,
  accountRows,
  accountingTables,
  backendLogs,
  businessState,
  expectBlockedManualWrites,
  foreignOwner,
  installCommitFailure,
  legacyState,
  manualApi,
  noStore,
  openingInput,
  providerRequests,
  raceAcrossReplicas,
  readAccount,
  readInstrument,
  readOpening,
  readPage,
  rows,
  seedDiscovery,
  seedForeign,
  uuid,
  withManualWritesBlocked,
} from './manual-opening-fixtures';
import { completeFactor, fingerprint, owner, passwordStep, query, test } from './mfa-fixtures';
import { restartBackends } from './replicas';

async function rejectUnchanged(
  api: ManualApi,
  path: string,
  body: unknown,
  status = 400,
): Promise<void> {
  const before = businessState();
  const response = await api.send('POST', path, body);
  expect(response.status()).toBe(status);
  expect(
    businessState(),
    'A rejected request changes no accounting, financial, owner, factor or admission row',
  ).toBe(before);
}

async function browserPost(page: Page, path: string, action: () => Promise<void>) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/accounting${path}` &&
      response.request().method() === 'POST',
  );
  await action();
  return pending;
}

test('OPEN-001-A / OPEN-002-A: real Russian forms retain exact amounts, unknown and zero through restart and history', async ({
  page,
}) => {
  const api = await manualApi(page);
  const preserved = fingerprint(['auth_sessions', 'auth_request_limits', ...accountingTables]);
  const providersBefore = providerRequests();
  const admissionsBefore = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const name = `Точный ручной счет ${randomUUID()}`;
  await page.goto('/manual-accounts');
  await page.getByRole('button', { name: 'Новый счет', exact: true }).click();
  await page.getByLabel('Название счета', { exact: true }).fill(name);
  const created = await browserPost(page, '/accounts', () =>
    page.getByRole('button', { name: 'Создать счет', exact: true }).click(),
  );
  expect(created.status()).toBe(201);
  const account = readAccount(await created.json());
  await page.waitForLoadState('networkidle');
  await page.goto(`/manual-accounts/${account.id}`);
  await page.getByRole('button', { name: 'Начальные данные', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Начальные позиции', exact: true })).toBeVisible();

  const labels = ['Большая точная позиция', 'Неизвестная стоимость', 'Известная нулевая стоимость'];
  const instruments = [];
  for (const label of labels) {
    await page.getByLabel('Название инструмента', { exact: true }).fill(`${label} ${account.id}`);
    await page.getByLabel('Символ (необязательно)', { exact: true }).fill('USD');
    const response = await browserPost(page, '/instruments', () =>
      page.getByRole('button', { name: 'Создать инструмент', exact: true }).click(),
    );
    expect(response.status()).toBe(201);
    const instrument = readInstrument(await response.json());
    expect(instrument.namespace).toBe('manual');
    // AST-LEGACY: the legacy form's body is classified like the migration; USD is not crypto.
    expect([instrument.assetType, instrument.valuationCurrency, instrument.priceSource]).toEqual([
      'manual',
      'USD',
      'manual',
    ]);
    instruments.push(instrument);
  }
  const quantities = ['9007199254740993.000000000000000001', '0.000000000000000001', '1'];
  const costs = ['123.450000000000000001', null, '0'];
  for (let index = 0; index < instruments.length; index++) {
    if (index) await page.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
    const group = page.getByRole('group', { name: `Позиция ${index + 1}`, exact: true });
    await group.getByLabel('Инструмент', { exact: true }).selectOption(instruments[index].id);
    await group.getByLabel('Количество', { exact: true }).fill(quantities[index]);
    await group
      .getByLabel('Себестоимость', { exact: true })
      .selectOption({ label: costs[index] === null ? 'Неизвестна' : 'Известна' });
    if (costs[index] !== null)
      await group.getByLabel('Общая себестоимость, USD', { exact: true }).fill(costs[index]!);
  }
  await page
    .getByLabel('Дата и время начала учета (UTC)', { exact: true })
    .fill('2024-02-29T01:02:03.004Z');
  const saved = await withManualWritesBlocked(async (release) => {
    const pending = browserPost(page, `/accounts/${account.id}/openings`, () =>
      page.getByRole('button', { name: 'Сохранить начальные позиции', exact: true }).click(),
    );
    void pending.catch(() => undefined);
    try {
      await expectBlockedManualWrites(1);
      for (let index = 0; index < instruments.length; index++) {
        await expect(
          page
            .getByRole('group', { name: `Позиция ${index + 1}`, exact: true })
            .getByLabel('Количество', { exact: true }),
        ).toBeDisabled();
      }
      await expect(
        page.getByLabel('Дата и время начала учета (UTC)', { exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Сохранение…', exact: true })).toBeDisabled();
      await release();
      return await pending;
    } finally {
      try {
        await release();
      } finally {
        await Promise.allSettled([pending]);
      }
    }
  });
  expect(saved.status()).toBe(201);
  const original = readOpening(await saved.json());
  expect(original.revision).toBe(1);
  expect(original.asOf).toBe('2024-02-29T01:02:03.004Z');
  expect(original.positions).toEqual(
    instruments
      .map((instrument, index) => ({
        instrumentId: instrument.id,
        instrumentName: instrument.name,
        instrumentSymbol: 'USD',
        quantity: quantities[index],
        costStatus: costs[index] === null ? 'unknown' : 'known',
        totalCostUsd: costs[index],
      }))
      .sort((a, b) => a.instrumentId.localeCompare(b.instrumentId)),
  );
  const current = page.getByRole('table', { name: 'Сохраненные начальные позиции', exact: true });
  for (let index = 0; index < instruments.length; index++) {
    const row = current.getByRole('row').filter({
      has: page.getByRole('cell', { name: `${instruments[index].name} (USD)`, exact: true }),
    });
    await expect(row.getByRole('cell', { name: quantities[index], exact: true })).toBeVisible();
    await expect(
      row.getByRole('cell', { name: costs[index] ?? 'Неизвестна', exact: true }),
    ).toBeVisible();
  }
  await expect(
    current
      .getByRole('row')
      .filter({
        has: page.getByRole('cell', { name: `${instruments[2].name} (USD)`, exact: true }),
      })
      .getByRole('cell', { name: '0', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('История до этой даты не восстановлена')).toBeVisible();

  const stored = rows<{ instrumentId: string; quantity: string; totalCostUsd: string | null }>(`
    SELECT "instrumentId", quantity::text, "totalCostUsd"::text FROM account_opening_positions
    WHERE "accountId" = '${account.id}' AND revision = 1 ORDER BY "instrumentId"`);
  expect(stored).toEqual(
    [
      {
        instrumentId: instruments[0].id,
        quantity: '9007199254740993.000000000000000001000000000000',
        totalCostUsd: '123.450000000000000001000000000000',
      },
      {
        instrumentId: instruments[1].id,
        quantity: '0.000000000000000001000000000000',
        totalCostUsd: null,
      },
      {
        instrumentId: instruments[2].id,
        quantity: '1.000000000000000000000000000000',
        totalCostUsd: '0.000000000000000000000000000000',
      },
    ].sort((a, b) => a.instrumentId.localeCompare(b.instrumentId)),
  );
  expectAdmissionDelta(admissionsBefore, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  const admissionsAfterWrites = ledgerState();
  const beforeRestart = accountRows(account.id);
  expect(providerRequests(), 'Manual creation, saving and reads make no provider requests').toEqual(
    providersBefore,
  );
  await restartBackends();
  // The isolated manual profile disables all automatic startup provider collection.
  const providersAfterRestart = providersBefore;
  await expect.poll(() => providerRequests(), { timeout: 10_000 }).toEqual(providersAfterRestart);
  await page.reload();
  await page.getByRole('button', { name: 'Начальные данные', exact: true }).click();
  await expect(current.getByRole('cell', { name: quantities[0], exact: true })).toBeVisible();
  expect(await api.detail(account.id)).toEqual({
    ...account,
    currentRevision: 1,
    currentOpening: original,
  });
  expect(accountRows(account.id)).toEqual(beforeRestart);
  expect(ledgerState()).toBe(admissionsAfterWrites);

  // A later complete replacement preserves the first exact snapshot as history.
  const replaced = await api.save(
    account.id,
    openingInput(instruments[0].id, {
      expectedRevision: 1,
      positions: [
        { instrumentId: instruments[0].id, quantity: '2', costStatus: 'known', totalCostUsd: '0' },
      ],
    }),
  );
  expect(replaced.revision).toBe(2);
  await page.reload();
  await page.getByRole('button', { name: 'Начальные данные', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'История исправлений', exact: true }),
  ).toBeVisible();
  const historical = page.getByRole('table', { name: 'Позиции ревизии 1', exact: true });
  await expect(historical.getByRole('cell', { name: quantities[0], exact: true })).toBeVisible();
  await expect(historical.getByRole('cell', { name: costs[0]!, exact: true })).toBeVisible();
  await expect(historical.getByRole('cell', { name: quantities[1], exact: true })).toBeVisible();
  await expect(current.getByRole('cell', { name: quantities[1], exact: true })).toHaveCount(0);
  expect((await api.history(account.id)).items).toEqual([replaced, original]);
  expect((await api.detail(account.id)).currentOpening?.positions).toEqual(replaced.positions);
  expect(fingerprint(['auth_sessions', 'auth_request_limits', ...accountingTables])).toBe(
    preserved,
  );
  expect(ledgerState()).toBe(admissionsAfterWrites);
  expect(providerRequests(), 'Reload, replacement and history make no provider requests').toEqual(
    providersAfterRestart,
  );
});

test('OPEN-003-A / OPEN-004-A: literal labels and a real stale form require explicit Russian conflict review', async ({
  page,
}) => {
  const api = await manualApi(page);
  const labelId = randomUUID();
  const account = await api.account(`<b data-manual-label="account-${labelId}">Ручной счет</b>`);
  const instrument = await api.instrument(
    `<b data-manual-label="instrument-${labelId}">Инструмент</b>`,
  );
  const first = await api.save(account.id, openingInput(instrument.id));
  await page.goto(`/manual-accounts/${account.id}`);
  await page.getByRole('button', { name: 'Начальные данные', exact: true }).click();
  await expect(page.getByRole('heading', { name: account.name, exact: true })).toBeVisible();
  await expect(page.locator('[data-manual-label]')).toHaveCount(0);
  const group = page.getByRole('group', { name: 'Позиция 1', exact: true });
  await expect(group.getByLabel('Количество', { exact: true })).toHaveValue('1');
  await group.getByLabel('Количество', { exact: true }).fill('3');
  const second = await api.save(
    account.id,
    openingInput(instrument.id, {
      expectedRevision: 1,
      positions: [
        { instrumentId: instrument.id, quantity: '2', costStatus: 'unknown', totalCostUsd: null },
      ],
    }),
  );
  expect(second.revision).toBe(2);
  const beforeConflict = fingerprint(['auth_sessions', 'auth_request_limits']);
  const admissionsBefore = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const browserWrites: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/accounting/accounts/${account.id}/openings`
    ) {
      browserWrites.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  const save = page.getByRole('button', { name: 'Сохранить начальные позиции', exact: true });
  const rejected = await browserPost(page, `/accounts/${account.id}/openings`, () => save.click());
  expect(rejected.status()).toBe(409);
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText(/[А-Яа-я]/);
  await expect(page.getByRole('alert')).not.toContainText(
    'Accounting request conflicts with saved state',
  );
  await expect(page.getByText('Счет изменился', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await page.waitForLoadState('networkidle');
  expect(browserWrites).toHaveLength(1);
  expect(browserWrites[0].expectedRevision).toBe(1);
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforeConflict);
  expectAdmissionDelta(admissionsBefore, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
  const admissionsAfterConflict = ledgerState();
  expect((await api.detail(account.id)).currentOpening).toEqual(second);
  await expect(group.getByLabel('Количество', { exact: true })).toHaveValue('3');

  await page
    .getByRole('checkbox', {
      name: 'Я проверил актуальную версию и хочу заменить ее сохраненным черновиком.',
      exact: true,
    })
    .check();
  const accepted = await browserPost(page, `/accounts/${account.id}/openings`, () => save.click());
  expect(accepted.status()).toBe(201);
  const third = readOpening(await accepted.json());
  expect(third.revision).toBe(3);
  expect(third.positions[0].quantity).toBe('3');
  expect(browserWrites).toHaveLength(2);
  expect(browserWrites[1].expectedRevision).toBe(2);
  expect(browserWrites[1].requestId).not.toBe(browserWrites[0].requestId);
  expect((await api.history(account.id)).items).toEqual([third, second, first]);
  const table = page.getByRole('table', { name: 'Сохраненные начальные позиции', exact: true });
  await expect(table.getByRole('cell', { name: instrument.name, exact: true })).toBeVisible();
  await expect(page.locator('[data-manual-label]')).toHaveCount(0);
  expect(ledgerState()).toBe(admissionsAfterConflict);
});

test('OPEN-002-B: raw decimal and cost-pairing failures never round, coerce or consume a request key', async ({
  page,
}) => {
  const api = await manualApi(page);
  const account = await api.account();
  const instrument = await api.instrument();
  const preserved = legacyState();
  const providersBefore = providerRequests();
  const input = openingInput(instrument.id);
  const position = input.positions[0];
  const quantities: unknown[] = [
    1,
    [],
    { toString: '1' },
    'NaN',
    'Infinity',
    '1e2',
    ' 1',
    '1,2',
    '0',
    '9'.repeat(49),
    `1.${'0'.repeat(31)}`,
  ];
  for (const quantity of quantities)
    await rejectUnchanged(api, `/accounts/${account.id}/openings`, {
      ...input,
      positions: [{ ...position, quantity }],
    });
  const knownCosts: unknown[] = [0, { toString: '0' }, 'NaN', '-1', null, `0.${'1'.repeat(31)}`];
  for (const totalCostUsd of knownCosts)
    await rejectUnchanged(api, `/accounts/${account.id}/openings`, {
      ...input,
      positions: [{ ...position, costStatus: 'known', totalCostUsd }],
    });
  for (const altered of [
    { ...position, totalCostUsd: '0' },
    { ...position, costStatus: null },
    { instrumentId: instrument.id, quantity: '1', costStatus: 'unknown' },
  ])
    await rejectUnchanged(api, `/accounts/${account.id}/openings`, {
      ...input,
      positions: [altered],
    });
  const saved = await api.save(account.id, {
    ...input,
    positions: [
      {
        ...position,
        quantity: `000${'9'.repeat(48)}.${'9'.repeat(30)}`,
        costStatus: 'known',
        totalCostUsd: '000.000',
      },
    ],
  });
  expect(saved.positions[0]).toMatchObject({
    quantity: `${'9'.repeat(48)}.${'9'.repeat(30)}`,
    costStatus: 'known',
    totalCostUsd: '0',
  });
  expect(saved.requestId).toBe(input.requestId);
  expect((await api.history(account.id)).items).toEqual([saved]);
  expect(legacyState()).toBe(preserved);
  expect(providerRequests()).toEqual(providersBefore);
});

test('OPEN-002-B / OPEN-003-A: the real DTO boundary rejects malicious strings, revisions and calendar rollover', async ({
  page,
}) => {
  const api = await manualApi(page);
  const account = await api.account();
  const instrument = await api.instrument();
  const input = openingInput(instrument.id);
  const position = input.positions[0];
  const badObject = { toString: 'Synthetic non-callable method' };
  for (const name of [123, [], badObject])
    await rejectUnchanged(api, '/accounts', { requestId: randomUUID(), name });
  for (const body of [
    { requestId: badObject, name: 'Synthetic' },
    { requestId: randomUUID(), name: badObject },
    { requestId: randomUUID(), name: 'Synthetic', symbol: 123 },
    { requestId: randomUUID(), name: 'Synthetic', symbol: null },
  ])
    await rejectUnchanged(api, '/instruments', body);
  for (const expectedRevision of ['0', true, [0], badObject])
    await rejectUnchanged(api, `/accounts/${account.id}/openings`, { ...input, expectedRevision });
  for (const body of [
    { ...input, requestId: badObject },
    { ...input, asOf: badObject },
    { ...input, positions: [{ ...position, instrumentId: badObject }] },
    { ...input, positions: [{ ...position, costStatus: badObject }] },
    { ...input, positions: [position, { ...position, instrumentId: instrument.id.toUpperCase() }] },
  ])
    await rejectUnchanged(api, `/accounts/${account.id}/openings`, body);
  for (const asOf of [
    '2024-02-30T00:00:00Z',
    '2100-02-29T00:00:00Z',
    '2024-01-01T24:00:00Z',
    '2024-01-01T00:00:60Z',
    '2024-01-01T00:00:00+14:01',
    '2024-01-01T00:00:00',
    '2024-01-01T00:00:00.0000Z',
    '1970-01-01T00:00:00+00:01',
    '9999-12-31T23:59:59-00:01',
  ])
    await rejectUnchanged(api, `/accounts/${account.id}/openings`, { ...input, asOf });
  const saved = await api.save(account.id, { ...input, asOf: '2024-03-01T01:30:00.1+01:30' });
  expect(saved.asOf).toBe('2024-03-01T00:00:00.100Z');
  expect(saved.requestId).toBe(input.requestId);
  expect((await api.detail(account.id)).currentOpening).toEqual(saved);
});

test('OPEN-004-A: anonymous, pending, forged writes and foreign identities leave all business rows untouched', async ({
  page,
  request,
}) => {
  const foreign = seedForeign();
  const endpoints = [
    { method: 'GET', path: '/accounts' },
    { method: 'GET', path: '/instruments' },
    { method: 'GET', path: `/accounts/${foreign.accountId}` },
    { method: 'GET', path: `/accounts/${foreign.accountId}/openings` },
    {
      method: 'POST',
      path: '/accounts',
      data: { requestId: randomUUID(), name: 'Synthetic denied' },
    },
    {
      method: 'POST',
      path: '/instruments',
      data: { requestId: randomUUID(), name: 'Synthetic denied' },
    },
    {
      method: 'POST',
      path: `/accounts/${foreign.accountId}/openings`,
      data: openingInput(foreign.instrumentId),
    },
  ];
  for (const endpoint of endpoints) {
    const before = fingerprint([]);
    const response = await request.fetch(`/api/accounting${endpoint.path}`, endpoint);
    expect(response.status()).toBe(401);
    noStore(response);
    expect(fingerprint([])).toBe(before);
  }
  await passwordStep(page);
  for (const endpoint of endpoints) {
    const before = fingerprint([]);
    const response = await page
      .context()
      .request.fetch(`/api/accounting${endpoint.path}`, endpoint);
    expect(response.status()).toBe(401);
    noStore(response);
    expect(fingerprint([])).toBe(before);
  }
  const { csrfToken } = await completeFactor(page);
  const api = new ManualApi(page.context().request, csrfToken);
  const account = await api.account();
  const instrument = await api.instrument();
  const input = openingInput(instrument.id);
  const forgedHeaders: Record<string, string>[] = [
    { Origin: 'https://foreign.example.invalid' },
    { 'X-CSRF-Token': 'synthetic-invalid-csrf' },
  ];
  for (const headers of forgedHeaders) {
    const before = fingerprint([]);
    const response = await api.send('POST', `/accounts/${account.id}/openings`, input, headers);
    expect(response.status()).toBe(403);
    expect(
      fingerprint([]),
      'Rejected CSRF/Origin cannot even touch the authenticated session',
    ).toBe(before);
  }
  for (const suffix of ['', '/openings']) {
    const before = businessState();
    const foreignResponse = await api.send('GET', `/accounts/${foreign.accountId}${suffix}`);
    const missingResponse = await api.send('GET', `/accounts/${randomUUID()}${suffix}`);
    expect(foreignResponse.status()).toBe(404);
    expect(missingResponse.status()).toBe(404);
    expect((await foreignResponse.json()).message).toEqual((await missingResponse.json()).message);
    expect(await foreignResponse.text()).not.toContain('Synthetic foreign');
    expect(await foreignResponse.text()).not.toContain(foreignOwner);
    expect(businessState()).toBe(before);
  }
  await rejectUnchanged(api, `/accounts/${foreign.accountId}/openings`, input, 404);
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/openings`,
    openingInput(foreign.instrumentId),
    404,
  );
  for (const body of [
    { requestId: randomUUID(), name: 'Synthetic denied', ownerId: foreignOwner },
    { requestId: randomUUID(), name: 'Synthetic denied', currentRevision: 1 },
    { requestId: randomUUID(), name: 'Synthetic denied', createdAt: '2024-01-01T00:00:00Z' },
    { requestId: randomUUID(), name: 'Synthetic denied', canonicalPayload: '{}' },
  ])
    await rejectUnchanged(api, '/accounts', body);
  await rejectUnchanged(api, `/accounts/${account.id}/openings`, {
    ...input,
    positions: [{ ...input.positions[0], instrumentName: 'Forged label' }],
  });
  const beforeDelete = businessState();
  expect((await api.send('DELETE', `/accounts/${account.id}`)).status()).toBe(404);
  expect(businessState()).toBe(beforeDelete);
});

test('OPEN-001-B: duplicate symbols, bounded discovery and labels beyond the first page preserve explicit identity', async ({
  page,
}) => {
  const api = await manualApi(page);
  const foreign = seedForeign();
  seedDiscovery(52);
  const instruments = [
    await api.instrument('Synthetic USD asset', 'USD'),
    await api.instrument('Synthetic USD asset', 'USD'),
  ];
  expect(instruments[0].id).not.toBe(instruments[1].id);
  expect(instruments.map((value) => value.namespace)).toEqual(['manual', 'manual']);
  const account = await api.account();
  const secondAccount = await api.account();
  const preserved = legacyState();
  const providersBefore = providerRequests();
  const expectedInstruments = rows<{ id: string }>(
    `SELECT id FROM accounting_instruments WHERE "ownerId" = '${owner.id}' ORDER BY id`,
  ).map((row) => row.id);
  const expectedAccounts = rows<{ id: string }>(
    `SELECT id FROM manual_accounts WHERE "ownerId" = '${owner.id}' ORDER BY id`,
  ).map((row) => row.id);
  for (const [resource, ids, read] of [
    ['/accounts', expectedAccounts, readAccount],
    ['/instruments', expectedInstruments, readInstrument],
  ] as const) {
    const first = readPage<Account | Instrument, string>(
      await api.result('GET', resource, 200),
      read,
      uuid,
    );
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, 50));
    expect(first.nextCursor).toBe(ids[49]);
    const remaining = readPage<Account | Instrument, string>(
      await api.result(
        'GET',
        `${resource}?cursor=${first.nextCursor?.toUpperCase()}&limit=100`,
        200,
      ),
      read,
      uuid,
    );
    expect(remaining.items.map((item) => item.id)).toEqual(ids.slice(50, 150));
    expect(remaining.nextCursor).toBe(ids.length > 150 ? ids[149] : null);
    expect([...first.items, ...remaining.items].map((item) => item.id)).not.toContain(
      resource === '/accounts' ? foreign.accountId : foreign.instrumentId,
    );
    const one = readPage<Account | Instrument, string>(
      await api.result('GET', `${resource}?limit=1`, 200),
      read,
      uuid,
    );
    expect(one.items.map((item) => item.id)).toEqual(ids.slice(0, 1));
    expect(one.nextCursor).toBe(ids[0]);
    for (const limit of ['0', '101', '1.0', '1e1']) {
      const before = businessState();
      expect((await api.send('GET', `${resource}?limit=${limit}`)).status()).toBe(400);
      expect(businessState()).toBe(before);
    }
  }
  const beyond = rows<{ id: string; name: string; symbol: string | null }>(
    `SELECT id, name, symbol FROM accounting_instruments WHERE "ownerId" = '${owner.id}'
      AND id NOT IN ('${instruments[0].id}', '${instruments[1].id}') ORDER BY id DESC LIMIT 1`,
  )[0];
  expect(expectedInstruments.indexOf(beyond.id)).toBeGreaterThanOrEqual(50);
  const initial = await api.save(
    account.id,
    openingInput(instruments[0].id, {
      positions: [
        ...instruments.map((instrument, index) => ({
          instrumentId: instrument.id,
          quantity: String(index + 1),
          costStatus: 'unknown' as const,
          totalCostUsd: null,
        })),
        { instrumentId: beyond.id, quantity: '3', costStatus: 'known', totalCostUsd: '0' },
      ],
    }),
  );
  expect(initial.positions.find((position) => position.instrumentId === beyond.id)).toMatchObject({
    instrumentName: beyond.name,
    instrumentSymbol: beyond.symbol,
  });
  const other = await api.save(
    secondAccount.id,
    openingInput(instruments[0].id, {
      positions: [
        {
          instrumentId: instruments[0].id,
          quantity: '99',
          costStatus: 'unknown',
          totalCostUsd: null,
        },
      ],
    }),
  );
  expect((await api.detail(account.id)).currentOpening).toEqual(initial);
  expect((await api.detail(secondAccount.id)).currentOpening).toEqual(other);
  expect((await api.history(account.id)).items).toEqual([initial]);
  expect(legacyState()).toBe(preserved);
  expect(providerRequests()).toEqual(providersBefore);
});

test('OPEN-003-A: two real replicas serialize retries and CAS without rewinding an old opening', async ({
  page,
}) => {
  const api = await manualApi(page);
  const preserved = legacyState();
  const providersBefore = providerRequests();
  const creation = { requestId: randomUUID(), name: `Гонка ${randomUUID()}` };
  const accountResponses = await Promise.all([
    api.send('POST', '/accounts', creation),
    api.send('POST', '/accounts', creation),
  ]);
  expect(accountResponses.map((response) => response.status()).sort()).toEqual([200, 201]);
  const account = readAccount(await accountResponses[0].json());
  expect(readAccount(await accountResponses[1].json())).toEqual(account);
  const instrumentCreation = {
    requestId: randomUUID(),
    name: 'Synthetic raced instrument',
    symbol: 'USD',
  };
  const instrumentResponses = await Promise.all([
    api.send('POST', '/instruments', instrumentCreation),
    api.send('POST', '/instruments', instrumentCreation),
  ]);
  expect(instrumentResponses.map((response) => response.status()).sort()).toEqual([200, 201]);
  const firstInstrument = readInstrument(await instrumentResponses[0].json());
  expect(readInstrument(await instrumentResponses[1].json())).toEqual(firstInstrument);
  const secondInstrument = await api.instrument('Synthetic second raced instrument', 'USD');
  const input = openingInput(firstInstrument.id, {
    positions: [
      { instrumentId: firstInstrument.id, quantity: '1', costStatus: 'known', totalCostUsd: '0' },
      {
        instrumentId: secondInstrument.id,
        quantity: '2',
        costStatus: 'unknown',
        totalCostUsd: null,
      },
    ],
  });
  const identical = await raceAcrossReplicas(
    () => api.send('POST', `/accounts/${account.id}/openings`, input),
    () => api.send('POST', `/accounts/${account.id}/openings`, input),
  );
  expect(identical.map((response) => response.status()).sort()).toEqual([200, 201]);
  const original = readOpening(await identical[0].json());
  expect(readOpening(await identical[1].json())).toEqual(original);
  const originalRows = rows(
    `SELECT * FROM account_opening_snapshots WHERE "accountId" = '${account.id}' AND revision = 1`,
  );
  const candidates = ['7', '8'].map((quantity) =>
    openingInput(firstInstrument.id, {
      expectedRevision: 1,
      positions: [
        { instrumentId: firstInstrument.id, quantity, costStatus: 'unknown', totalCostUsd: null },
      ],
    }),
  );
  const competitors = await raceAcrossReplicas(
    () => api.send('POST', `/accounts/${account.id}/openings`, candidates[0]),
    () => api.send('POST', `/accounts/${account.id}/openings`, candidates[1]),
  );
  expect(competitors.map((response) => response.status()).sort()).toEqual([201, 409]);
  const winner = readOpening(
    await competitors.find((response) => response.status() === 201)!.json(),
  );
  expect(winner.revision).toBe(2);
  const beforeReplay = businessState();
  const replay = await api.save(
    account.id.toUpperCase(),
    {
      ...input,
      requestId: input.requestId.toUpperCase(),
      asOf: '2024-02-29T02:02:03.004+01:00',
      positions: [...input.positions].reverse().map((position) => ({
        ...position,
        instrumentId: position.instrumentId.toUpperCase(),
        quantity: `000${position.quantity}.000`,
        totalCostUsd: position.totalCostUsd === null ? null : '000.000',
      })),
    },
    200,
  );
  expect(replay).toEqual(original);
  expect(businessState()).toBe(beforeReplay);
  expect((await api.detail(account.id)).currentOpening).toEqual(winner);
  const recreated = readAccount(await api.result('POST', '/accounts', 200, creation));
  expect(recreated).toEqual({ ...account, currentRevision: 2 });
  expect((await api.history(account.id)).items).toEqual([winner, original]);
  expect(
    rows(
      `SELECT * FROM account_opening_snapshots WHERE "accountId" = '${account.id}' AND revision = 1`,
    ),
  ).toEqual(originalRows);
  await rejectUnchanged(api, '/accounts', { ...creation, name: 'Changed canonical name' }, 409);
  await rejectUnchanged(api, '/instruments', { ...instrumentCreation, symbol: 'USDC' }, 409);
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/openings`,
    { ...input, positions: [input.positions[0]] },
    409,
  );
  await rejectUnchanged(
    api,
    `/accounts/${account.id}/openings`,
    { ...candidates[0], requestId: randomUUID() },
    409,
  );
  const secondAccount = await api.account();
  const sameKeyElsewhere = await api.save(secondAccount.id, input);
  expect(sameKeyElsewhere.revision).toBe(1);
  expect(sameKeyElsewhere.requestId).toBe(original.requestId);
  expect((await api.detail(account.id)).currentOpening).toEqual(winner);
  expect(legacyState()).toBe(preserved);
  expect(providerRequests()).toEqual(providersBefore);
});

test('OPEN-003-B: whole replacements preserve immutable bounded history with exclusive revision cursors', async ({
  page,
}) => {
  const api = await manualApi(page);
  const account = await api.account();
  const instruments = [await api.instrument(), await api.instrument()];
  const preserved = legacyState();
  const expected: Opening[] = [];
  for (let revision = 1; revision <= 21; revision++) {
    const positions = [
      {
        instrumentId: instruments[0].id,
        quantity: String(revision),
        costStatus: 'known' as const,
        totalCostUsd: '0',
      },
    ];
    if (revision % 2 === 1)
      positions.push({
        instrumentId: instruments[1].id,
        quantity: '5',
        costStatus: 'known',
        totalCostUsd: '0',
      });
    const saved = await api.save(
      account.id,
      openingInput(instruments[0].id, { expectedRevision: revision - 1, positions }),
    );
    expect(saved.revision).toBe(revision);
    expect(saved.positions).toHaveLength(revision % 2 === 1 ? 2 : 1);
    expected.unshift(saved);
  }
  expect(await api.history(account.id)).toEqual({ items: expected.slice(0, 10), nextCursor: 12 });
  expect(await api.history(account.id, '?beforeRevision=12')).toEqual({
    items: expected.slice(10, 20),
    nextCursor: 2,
  });
  expect(await api.history(account.id, '?beforeRevision=2')).toEqual({
    items: expected.slice(20),
    nextCursor: null,
  });
  expect(await api.history(account.id, '?limit=20')).toEqual({
    items: expected.slice(0, 20),
    nextCursor: 2,
  });
  expect(await api.history(account.id, '?beforeRevision=1')).toEqual({
    items: [],
    nextCursor: null,
  });
  expect((await api.detail(account.id)).currentOpening).toEqual(expected[0]);
  for (const suffix of [
    '?limit=0',
    '?limit=21',
    '?limit=1.0',
    '?beforeRevision=0',
    '?beforeRevision=1e1',
  ]) {
    const before = businessState();
    expect((await api.send('GET', `/accounts/${account.id}/openings${suffix}`)).status()).toBe(400);
    expect(businessState()).toBe(before);
  }
  expect(
    query(`SELECT count(*) FROM account_opening_snapshots WHERE "accountId" = '${account.id}'`),
  ).toBe('21');
  expect(legacyState()).toBe(preserved);
});

test('OPEN-003-A / OPEN-004-A: a real deferred commit fault returns safe HTTPS 500 and rolls back every write', async ({
  page,
}) => {
  const api = await manualApi(page);
  const account = await api.account(`Скрытый счет ${randomUUID()}`);
  const instrument = await api.instrument(`Скрытый инструмент ${randomUUID()}`);
  const original = await api.save(account.id, openingInput(instrument.id));
  const marker = `synthetic-private-commit-${randomUUID()}`;
  const input = openingInput(instrument.id, {
    expectedRevision: 1,
    positions: [
      {
        instrumentId: instrument.id,
        quantity: '876543210987654321.123456789012345678',
        costStatus: 'known',
        totalCostUsd: '123456789876543210.987654321098765432',
      },
    ],
  });
  const before = businessState();
  const providersBefore = providerRequests();
  const removeFault = installCommitFailure(account.id, marker);
  try {
    const response = await api.send('POST', `/accounts/${account.id}/openings`, input);
    expect(response.status()).toBe(500);
    const body = await response.json();
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
    const output = JSON.stringify(body);
    const logs = backendLogs();
    for (const privateValue of [
      marker,
      account.name,
      instrument.name,
      input.positions[0].quantity,
      input.positions[0].totalCostUsd!,
    ]) {
      expect(output).not.toContain(privateValue);
      expect(logs).not.toContain(privateValue);
    }
    expect(
      businessState(),
      'Deferred failure rolls back snapshot, positions, pointer and request identity',
    ).toBe(before);
    expect((await api.detail(account.id)).currentOpening).toEqual(original);
  } finally {
    removeFault();
  }
  const retried = await api.save(account.id, input);
  expect(retried.revision).toBe(2);
  expect(retried.requestId).toBe(input.requestId);
  expect((await api.history(account.id)).items).toEqual([retried, original]);
  expect(providerRequests()).toEqual(providersBefore);
});
