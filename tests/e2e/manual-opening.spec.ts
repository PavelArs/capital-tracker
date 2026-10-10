import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import {
  type Account,
  type Instrument,
  ManualApi,
  type Opening,
  backendLogs,
  businessState,
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
} from './manual-opening-fixtures';
import { completeFactor, fingerprint, owner, passwordStep, query, test } from './mfa-fixtures';

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
