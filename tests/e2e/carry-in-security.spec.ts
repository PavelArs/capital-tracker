import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { command, fixture } from './carry-in-fixtures';
import {
  backendLogs,
  literal,
  noStore,
  providerRequests,
  rows,
  seedForeign,
} from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, query, test } from './mfa-fixtures';

test('CARRY-006-A: every carry-in route denies anonymous/pending sessions and real CSRF/Origin violations without private state changes', async ({
  page,
  browser,
  request,
}) => {
  const data = await fixture(page);
  const input = command(data);
  await data.api.result('POST', data.path, 201, input);
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const endpoints = [
      { method: 'GET', path: data.path },
      { method: 'GET', path: `${data.path}/lots` },
      { method: 'POST', path: data.path, body: input },
      {
        method: 'POST',
        path: `${data.path}/preview`,
        body: { expectedOpeningRevision: 1, lots: data.lots },
      },
    ];
    const before = fingerprint([]);
    const admissions = ledgerState();
    const providers = providerRequests();
    for (const client of [
      { request, csrf: '' },
      { request: pendingContext.request, csrf: pending.csrfToken },
    ]) {
      for (const endpoint of endpoints) {
        data.api.calls++;
        const response = await client.request.fetch(`/api/accounting${endpoint.path}`, {
          method: endpoint.method,
          data: endpoint.body,
          headers: { Origin: origin, 'X-CSRF-Token': client.csrf },
        });
        expect(response.status()).toBe(401);
        noStore(response);
        expect(await response.text()).not.toContain(data.instrument.name);
      }
    }
    const deniedHeaders: Record<string, string>[] = [
      { Origin: origin },
      { Origin: origin, 'X-CSRF-Token': 'invalid-synthetic-csrf' },
      { Origin: 'https://foreign.example.invalid', 'X-CSRF-Token': data.api.csrfToken },
    ];
    for (const endpoint of endpoints.filter((value) => value.method === 'POST')) {
      for (const headers of deniedHeaders) {
        data.api.calls++;
        const response = await data.api.request.post(`/api/accounting${endpoint.path}`, {
          data: endpoint.body,
          headers,
        });
        expect(response.status()).toBe(403);
        noStore(response);
        expect(await response.text()).not.toContain(data.instrument.name);
      }
    }
    expect(fingerprint([]), 'Denied guards preserve even last-seen/session bookkeeping').toBe(
      before,
    );
    expect(ledgerState()).toBe(admissions);
    expect(providerRequests()).toEqual(providers);
    expect(data.api.calls).toBeLessThanOrEqual(80);
  } finally {
    await pendingContext.close();
  }
});

test('CARRY-001-B / CARRY-006-A: actual raw envelopes, foreign identities and bounded pages refuse without reserving keys or leaking labels', async ({
  page,
}) => {
  const data = await fixture(page);
  const foreign = seedForeign();
  const input = command(data);
  const canary = `private-carry-${randomUUID()}`;
  const before = fingerprint(['auth_sessions']);
  const admissions = ledgerState();
  const providers = providerRequests();
  const preview = { expectedOpeningRevision: 1, lots: data.lots };
  const invalids = [
    { ...input, ownerId: foreign.accountId },
    { ...input, expectedOpeningRevision: '1' },
    { ...input, assertReviewed: 'true' },
    { ...input, assertReviewed: false },
    { ...input, lots: [] },
    { ...input, lots: Array.from({ length: 101 }, () => data.lots[0]) },
    { ...input, lots: [{ ...data.lots[0], originalCostUsd: { valueOf: canary } }] },
    { ...input, lots: [{ ...data.lots[0], lotId: foreign.accountId }, data.lots[1]] },
    { ...input, lots: [{ ...data.lots[0], originalQuantity: 1 }, data.lots[1]] },
  ];
  for (const body of invalids) {
    const response = await data.api.send('POST', data.path, body);
    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain(canary);
  }
  const foreignPath = `/accounts/${foreign.accountId}/trade-journal/carry-in`;
  for (const [method, path, body] of [
    ['GET', foreignPath, undefined],
    ['GET', `${foreignPath}/lots`, undefined],
    ['POST', foreignPath, input],
    ['POST', `${foreignPath}/preview`, preview],
    [
      'POST',
      `${data.path}/preview`,
      { ...preview, lots: [{ ...data.lots[0], instrumentId: foreign.instrumentId }] },
    ],
    [
      'POST',
      data.path,
      { ...input, lots: [{ ...data.lots[0], instrumentId: foreign.instrumentId }] },
    ],
  ] as const) {
    const response = await data.api.send(method, path, body);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('Synthetic foreign');
  }
  const boundary = await data.api.send(
    'POST',
    `${data.path}/preview`,
    JSON.stringify(preview).padEnd(100 * 1024, ' '),
    { 'Content-Type': 'application/json' },
  );
  expect(boundary.status()).toBe(200);
  expect(await boundary.json()).toMatchObject({ canInitialize: true, carryInCostUsd: '300' });
  const oversized = await data.api.send(
    'POST',
    data.path,
    JSON.stringify(input).padEnd(100 * 1024 + 1, ' '),
    { 'Content-Type': 'application/json' },
  );
  expect(oversized.status()).toBe(413);
  expect(fingerprint(['auth_sessions'])).toBe(before);
  // Rejected variants reserve no origin key: the exact original becomes valid once.
  const receipt = await data.api.result('POST', data.path, 201, input);
  const initialized = fingerprint(['auth_sessions']);
  for (const query of [
    '?afterOrdinal=101',
    '?limit=101',
    '?limit=0',
    '?afterOrdinal=-1',
    `?lotId=${foreign.accountId}`,
    '?limit=1&limit=2',
  ])
    await data.api.result('GET', `${data.path}/lots${query}`, 400);
  expect(await data.api.result('POST', data.path, 200, input)).toEqual(receipt);
  expect(fingerprint(['auth_sessions'])).toBe(initialized);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
  expect(backendLogs()).not.toContain(canary);
});

test('CARRY-003-B / CARRY-006-A: real deferred HTTP COMMIT failure hides private detail, rolls back every lot and permits original-key retry once', async ({
  page,
}) => {
  const data = await fixture(page);
  const input = command(data);
  const before = fingerprint(['auth_sessions']);
  const admissions = ledgerState();
  const providers = providerRequests();
  const marker = `private-carry-commit-${randomUUID()}`;
  const name = `acceptance_carry_${randomUUID().replaceAll('-', '')}`;
  try {
    query(`CREATE SEQUENCE ${name} START 1;
      CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN IF NEW."accountId"='${data.account.id}'::uuid AND NEW."requestId"='${input.requestId}'::uuid THEN
        IF NEW."originKind"<>'known-cost-carry-in' OR NEW."openingRevision"<>1 OR NEW."currentRevision"<>0
          OR (SELECT count(*) FROM account_carry_in_lots WHERE "ownerId"=NEW."ownerId" AND "accountId"=NEW."accountId" AND "openingRevision"=1)<>2
          OR (SELECT sum("remainingQuantity") FROM account_carry_in_lots WHERE "accountId"=NEW."accountId")<>2
          OR (SELECT sum("originalCostUsd") FROM account_carry_in_lots WHERE "accountId"=NEW."accountId")<>300
          OR NOT EXISTS(SELECT 1 FROM account_opening_snapshots WHERE "ownerId"=NEW."ownerId" AND "accountId"=NEW."accountId" AND revision=1)
          OR NOT EXISTS(SELECT 1 FROM manual_accounts WHERE id=NEW."accountId" AND "currentRevision"=1)
          OR EXISTS(SELECT 1 FROM account_trades WHERE "accountId"=NEW."accountId")
          OR EXISTS(SELECT 1 FROM account_trade_versions WHERE "accountId"=NEW."accountId")
        THEN RAISE EXCEPTION 'Synthetic baseline writes incomplete'; END IF;
        PERFORM nextval('${name}'); RAISE EXCEPTION '%', ${literal(marker)} USING DETAIL=NEW."canonicalPayload";
      END IF; RETURN NULL; END $body$;
      CREATE CONSTRAINT TRIGGER ${name} AFTER INSERT ON account_trade_journals
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    const failed = await data.api.send('POST', data.path, input);
    expect(failed.status()).toBe(500);
    expect((await failed.json()).message).toBe('Internal server error');
    expect(rows(`SELECT last_value::text AS value,is_called AS "isCalled" FROM ${name}`)).toEqual([
      { value: '1', isCalled: true },
    ]);
    expect(fingerprint(['auth_sessions'])).toBe(before);
    expect(await data.api.result('GET', data.path, 200)).toMatchObject({
      eligible: true,
      origin: null,
      opening: data.opening,
    });
    const output = `${await failed.text()}\n${backendLogs()}`;
    for (const privateValue of [
      marker,
      data.instrument.name,
      'canonicalPayload',
      'account_carry_in_lots',
    ])
      expect(output).not.toContain(privateValue);
  } finally {
    query(
      `DROP TRIGGER IF EXISTS ${name} ON account_trade_journals; DROP FUNCTION IF EXISTS ${name}(); DROP SEQUENCE IF EXISTS ${name}`,
    );
  }
  expect(fingerprint(['auth_sessions'])).toBe(before);
  const accepted = await data.api.result('POST', data.path, 201, input);
  const committed = fingerprint(['auth_sessions']);
  expect(await data.api.result('POST', data.path, 200, input)).toEqual(accepted);
  expect(fingerprint(['auth_sessions'])).toBe(committed);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
});
