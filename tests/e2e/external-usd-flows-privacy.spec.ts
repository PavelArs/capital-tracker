import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { test } from './external-usd-flows-fixtures';
import { foreignOwner, literal, noStore, providerRequests } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, query } from './mfa-fixtures';
import { coverageFrom, tradeApi } from './usd-trades-fixtures';

const journalPath = '/portfolio/cash-flow-journal';
const flowsPath = '/portfolio/cash-flows';
const from = encodeURIComponent(coverageFrom);
const to = encodeURIComponent('2025-01-05T00:00:00.000Z');
const periodQuery = `?from=${from}&to=${to}`;

function seedForeignFlow(): { flowId: string; marker: string } {
  const flowId = randomUUID();
  const originRequestId = randomUUID();
  const requestId = randomUUID();
  const marker = `private-foreign-flow-${randomUUID()}`;
  const payload = literal(JSON.stringify({ marker }));
  query(`INSERT INTO portfolio_flow_journals
      ("ownerId","requestId","canonicalPayload","coverageFrom","createdAt","currentRevision")
    VALUES (${literal(foreignOwner)},${literal(originRequestId)},${literal('{"coverageFrom":"2025-01-01T00:00:00.000Z"}')},
      ${literal(coverageFrom)},CURRENT_TIMESTAMP,1);
    INSERT INTO portfolio_flow_versions
      ("ownerId","flowId",version,"journalRevision","requestId","canonicalPayload",kind,direction,
       "occurredAt","amountUsd","createdAt","previousVersion")
    VALUES (${literal(foreignOwner)},${literal(flowId)},1,1,${literal(requestId)},${payload},'create','contribution',
      ${literal(coverageFrom)},1000,CURRENT_TIMESTAMP,NULL)`);
  return { flowId, marker };
}

test('FLOW-004-B: actual owner, MFA, origin and ownership guards protect every flow route family', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const initCommand = {
    requestId: randomUUID(),
    coverageFrom,
    assertReviewed: true,
  };
  const createCommand = {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    direction: 'contribution',
    occurredAt: '2025-01-02T00:00:00.000Z',
    amountUsd: '1000',
    assertExternal: true,
  };

  const absentBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
  expect(await api.result('GET', journalPath, 200)).toMatchObject({ journal: null });
  expect((await api.send('GET', `${flowsPath}${periodQuery}`)).status()).toBe(409);
  expect((await api.send('POST', flowsPath, createCommand)).status()).toBe(409);
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(absentBefore);

  await api.result('POST', journalPath, 201, initCommand);
  const created = (await api.result('POST', flowsPath, 201, createCommand)) as {
    flow: { flowId: string };
  };
  expect(created.flow.flowId).toMatch(/^[a-f0-9-]{36}$/);
  const ownerFlowId = created.flow.flowId;
  const foreign = seedForeignFlow();

  // Preserve every persisted row across auth transitions and denied requests.
  const financialBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
  const providersBefore = providerRequests();
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const deniedBefore = fingerprint([]);
    const admissionsBefore = ledgerState();
    const routes: {
      method: 'GET' | 'POST';
      path: string;
      body?: unknown;
    }[] = [
      { method: 'GET', path: journalPath },
      { method: 'POST', path: journalPath, body: { ...initCommand, requestId: randomUUID() } },
      { method: 'POST', path: flowsPath, body: { ...createCommand, requestId: randomUUID() } },
      { method: 'GET', path: `${flowsPath}${periodQuery}` },
      {
        method: 'POST',
        path: `${flowsPath}/${ownerFlowId}/corrections`,
        body: { ...createCommand, requestId: randomUUID(), expectedJournalRevision: 1 },
      },
      {
        method: 'POST',
        path: `${flowsPath}/${ownerFlowId}/voids`,
        body: { requestId: randomUUID(), expectedJournalRevision: 1 },
      },
      { method: 'GET', path: `${flowsPath}/${ownerFlowId}/versions` },
    ];

    for (const client of [
      { context: request, csrfToken: undefined },
      { context: pendingContext.request, csrfToken: pending.csrfToken },
    ]) {
      for (const route of routes) {
        api.calls++;
        const response = await client.context.fetch(`/api/accounting${route.path}`, {
          method: route.method,
          ...(route.body === undefined ? {} : { data: route.body }),
          headers: {
            Origin: origin,
            ...(client.csrfToken === undefined ? {} : { 'X-CSRF-Token': client.csrfToken }),
          },
        });
        expect(response.status()).toBe(401);
        noStore(response);
        const body = await response.json();
        expect(body).toMatchObject({
          statusCode: 401,
          message: 'Unauthorized',
          path: `/accounting${route.path.split('?')[0]}`,
        });
        expect(body).not.toHaveProperty('amountUsd');
        expect(JSON.stringify(body)).not.toContain(foreign.marker);
      }
    }
    expect(fingerprint([]), 'Anonymous and MFA-pending requests change no persisted state').toBe(
      deniedBefore,
    );
    expect(ledgerState()).toBe(admissionsBefore);

    const deniedOrigin = await api.send(
      'POST',
      flowsPath,
      {
        ...createCommand,
        requestId: randomUUID(),
        expectedJournalRevision: 1,
      },
      {
        Origin: 'https://foreign.example.invalid',
      },
    );
    expect(deniedOrigin.status()).toBe(403);
    noStore(deniedOrigin);
    const deniedCsrf = await api.send(
      'POST',
      `${flowsPath}/${ownerFlowId}/corrections`,
      { ...createCommand, requestId: randomUUID(), expectedJournalRevision: 1 },
      { 'X-CSRF-Token': 'invalid-synthetic-csrf' },
    );
    expect(deniedCsrf.status()).toBe(403);
    noStore(deniedCsrf);

    const malformedBody = await api.send('POST', flowsPath, {
      ...createCommand,
      requestId: randomUUID(),
      expectedJournalRevision: 1,
      amountUsd: 1000,
    });
    expect(malformedBody.status()).toBe(400);
    noStore(malformedBody);
    const forgedOwner = await api.send('POST', flowsPath, {
      ...createCommand,
      requestId: randomUUID(),
      expectedJournalRevision: 1,
      ownerId: foreignOwner,
    });
    expect(forgedOwner.status()).toBe(400);
    noStore(forgedOwner);
    const malformedQuery = await api.send(
      'GET',
      `${flowsPath}${periodQuery}&ownerId=${foreignOwner}`,
    );
    expect(malformedQuery.status()).toBe(400);
    noStore(malformedQuery);

    const missingFlowId = randomUUID();
    const foreignTargets = [
      {
        method: 'GET' as const,
        path: `${flowsPath}/${foreign.flowId}/versions`,
      },
      {
        method: 'POST' as const,
        path: `${flowsPath}/${foreign.flowId}/corrections`,
        body: { ...createCommand, requestId: randomUUID(), expectedJournalRevision: 1 },
      },
      {
        method: 'POST' as const,
        path: `${flowsPath}/${foreign.flowId}/voids`,
        body: { requestId: randomUUID(), expectedJournalRevision: 1 },
      },
    ];
    const missingTargets = [
      { method: 'GET' as const, path: `${flowsPath}/${missingFlowId}/versions` },
      {
        method: 'POST' as const,
        path: `${flowsPath}/${missingFlowId}/corrections`,
        body: { ...createCommand, requestId: randomUUID(), expectedJournalRevision: 1 },
      },
      {
        method: 'POST' as const,
        path: `${flowsPath}/${missingFlowId}/voids`,
        body: { requestId: randomUUID(), expectedJournalRevision: 1 },
      },
    ];
    for (let index = 0; index < foreignTargets.length; index++) {
      const foreignResponse = await api.send(
        foreignTargets[index].method,
        foreignTargets[index].path,
        foreignTargets[index].body,
      );
      const missingResponse = await api.send(
        missingTargets[index].method,
        missingTargets[index].path,
        missingTargets[index].body,
      );
      expect(foreignResponse.status()).toBe(404);
      expect(missingResponse.status()).toBe(404);
      noStore(foreignResponse);
      noStore(missingResponse);
      const foreignBody = await foreignResponse.json();
      const missingBody = await missingResponse.json();
      // The existing envelope reflects only the caller's own path and response time.
      // Protected fields and generic refusal are identical for foreign/missing IDs.
      const { path, timestamp, ...foreignError } = foreignBody;
      const { path: missingPath, timestamp: missingTime, ...missingError } = missingBody;
      expect(foreignError).toEqual(missingError);
      expect(foreignError).toMatchObject({ statusCode: 404, message: 'Not Found' });
      expect(path).toBe(`/accounting${foreignTargets[index].path}`);
      expect(missingPath).toBe(`/accounting${missingTargets[index].path}`);
      expect(Number.isFinite(Date.parse(timestamp))).toBe(true);
      expect(Number.isFinite(Date.parse(missingTime))).toBe(true);
      expect(JSON.stringify(foreignBody)).not.toContain(foreign.marker);
      expect(JSON.stringify(foreignBody)).not.toContain(foreignOwner);
      expect(foreignBody).not.toHaveProperty('amountUsd');
    }

    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Denied, malformed and foreign requests preserve every stored financial row',
    ).toBe(financialBefore);
    expect(ledgerState(), 'Guard and route refusals leave admission state unchanged').toBe(
      admissionsBefore,
    );
    expect(providerRequests(), 'Flow privacy checks make no provider calls').toEqual(
      providersBefore,
    );
    expect(api.calls).toBeLessThanOrEqual(80);
  } finally {
    await pendingContext.close();
  }
});
