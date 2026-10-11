import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { test } from './external-usd-flows-fixtures';
import { literal, noStore, providerRequests } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, query } from './mfa-fixtures';
import { coverageFrom, tradeApi } from './usd-trades-fixtures';

const journalPath = '/portfolio/cash-flow-journal';
const flowsPath = '/portfolio/cash-flows';
const previewPath = '/portfolio/profit-preview';
const previewEndpoint = `/api/accounting${previewPath}`;
const from = coverageFrom;
const to = '2025-01-03T00:00:00.000Z';

function flowCommand(
  expectedJournalRevision: number,
  direction: 'contribution' | 'withdrawal',
  occurredAt: string,
  amountUsd: string,
) {
  return {
    requestId: randomUUID(),
    expectedJournalRevision,
    direction,
    occurredAt,
    amountUsd,
    assertExternal: true,
  };
}

function seedForeignFlow(): { flowId: string; ownerId: string } {
  const flowId = randomUUID();
  const ownerId = '22222222-2222-4222-8222-222222222222';
  const originRequestId = randomUUID();
  const requestId = randomUUID();
  const originPayload = JSON.stringify(['external-usd-origin-v1', from, true]);
  const commandPayload = JSON.stringify([
    'external-usd-command-v1',
    'create',
    null,
    0,
    'contribution',
    '2025-01-02T00:00:00.000Z',
    '900000',
    true,
  ]);
  query(`INSERT INTO portfolio_flow_journals
      ("ownerId","requestId","canonicalPayload","coverageFrom","createdAt","currentRevision")
    VALUES (${literal(ownerId)},${literal(originRequestId)},${literal(originPayload)},${literal(from)},CURRENT_TIMESTAMP,1);
    INSERT INTO portfolio_flow_versions
      ("ownerId","flowId",version,"journalRevision","requestId","canonicalPayload",kind,direction,
       "occurredAt","amountUsd","createdAt","previousVersion")
      VALUES (${literal(ownerId)},${literal(flowId)},1,1,${literal(requestId)},${literal(commandPayload)},'create','contribution',
      '2025-01-02T00:00:00.000Z',900000,CURRENT_TIMESTAMP,NULL)`);
  return { flowId, ownerId };
}

function previewInput(overrides: Record<string, unknown> = {}) {
  return {
    from,
    to,
    openingValueUsd: '1000',
    closingValueUsd: '1200',
    assertReviewed: true,
    ...overrides,
  };
}

test('PROFIT-CAPITAL / PROFIT-PERIOD / PROFIT-COVERAGE / PROFIT-PRIVATE: exact authenticated owner snapshot', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  await api.result('POST', journalPath, 201, {
    requestId: randomUUID(),
    coverageFrom,
    assertReviewed: true,
  });
  await api.result('POST', flowsPath, 201, flowCommand(0, 'contribution', from, '1000'));
  await api.result(
    'POST',
    flowsPath,
    201,
    flowCommand(1, 'withdrawal', '2025-01-02T12:00:00.000Z', '100'),
  );
  await api.result('POST', flowsPath, 201, flowCommand(2, 'contribution', to, '900'));
  const foreign = seedForeignFlow();

  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const financialBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    const admissionsBefore = ledgerState();
    const providersBefore = providerRequests();

    const preview = await api.send('POST', previewPath, previewInput());
    expect(preview.status()).toBe(200);
    noStore(preview);
    const body = await preview.json();
    expect(body).toEqual({
      from,
      to,
      coverageFrom,
      journalRevision: 3,
      basis: 'manual-usd-valuations',
      flowBasis: 'owner-declared-usd-flows',
      completeness: 'unreconciled',
      openingValueUsd: '1000',
      closingValueUsd: '1200',
      flows: {
        contributionsUsd: '1000',
        withdrawalsUsd: '100',
        netContributionsUsd: '900',
        flowCount: 2,
      },
      profitUsd: '-700',
    });
    expect(JSON.stringify(body)).not.toContain(foreign.ownerId);
    expect(JSON.stringify(body)).not.toContain(foreign.flowId);

    const beforeCoverage = await api.send(
      'POST',
      previewPath,
      previewInput({ from: '2024-12-31T00:00:00.000Z' }),
    );
    expect(beforeCoverage.status()).toBe(409);
    noStore(beforeCoverage);

    for (const invalid of [
      previewInput({ assertReviewed: false }),
      previewInput({ ownerId: foreign.ownerId }),
      previewInput({ openingValueUsd: 1000 }),
    ]) {
      const rejected = await api.send('POST', previewPath, invalid);
      expect(rejected.status()).toBe(400);
      noStore(rejected);
    }

    const anonymous = await request.fetch(previewEndpoint, {
      method: 'POST',
      data: previewInput(),
      headers: { Origin: origin },
    });
    expect(anonymous.status()).toBe(401);
    noStore(anonymous);
    const pendingMfa = await pendingContext.request.fetch(previewEndpoint, {
      method: 'POST',
      data: previewInput(),
      headers: { Origin: origin, 'X-CSRF-Token': pending.csrfToken },
    });
    expect(pendingMfa.status()).toBe(401);
    noStore(pendingMfa);

    const foreignOrigin = await api.send('POST', previewPath, previewInput(), {
      Origin: 'https://foreign.example.invalid',
    });
    expect(foreignOrigin.status()).toBe(403);
    noStore(foreignOrigin);
    const invalidCsrf = await api.send('POST', previewPath, previewInput(), {
      'X-CSRF-Token': 'invalid-synthetic-csrf',
    });
    expect(invalidCsrf.status()).toBe(403);
    noStore(invalidCsrf);

    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
      'Preview, coverage refusals and auth denials do not change financial rows',
    ).toBe(financialBefore);
    expect(ledgerState(), 'The preview and protected refusals do not consume auth admission').toBe(
      admissionsBefore,
    );
    expect(providerRequests(), 'Manual valuation preview makes no provider calls').toEqual(
      providersBefore,
    );
    expect(api.calls).toBeLessThanOrEqual(80);
  } finally {
    await pendingContext.close();
  }
});
