import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { test } from './external-usd-flows-fixtures';
import { providerRequests } from './manual-opening-fixtures';
import { fingerprint } from './mfa-fixtures';
import { coverageFrom, trackBrowserRequests, tradeApi, tradeInput } from './usd-trades-fixtures';

const flowTables = ['portfolio_flow_journals', 'portfolio_flow_versions'];
const dateFrom = '2025-01-01T00:00:00.000Z';
const dateTo = '2025-01-05T00:00:00.000Z';
const amountAtom = '0.000000000000000000000000000001';
const totalWithAtom = '1000.000000000000000000000000000001';

type Flow = {
  flowId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  kind: 'create' | 'correct' | 'void';
  direction: 'contribution' | 'withdrawal';
  occurredAt: string;
  amountUsd: string;
  createdAt: string;
};
type FlowReceipt = { journalRevision: number; flow: Flow };

function readReceipt(value: unknown): FlowReceipt {
  expect(value).toEqual({
    journalRevision: expect.any(Number),
    flow: {
      flowId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      version: expect.any(Number),
      journalRevision: expect.any(Number),
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      kind: expect.any(String),
      direction: expect.any(String),
      occurredAt: expect.any(String),
      amountUsd: expect.any(String),
      createdAt: expect.any(String),
    },
  });
  return value as FlowReceipt;
}

function flowCommand(
  expectedJournalRevision: number,
  direction: Flow['direction'],
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

function oldFinancialFingerprint(): string {
  return fingerprint(['auth_sessions', 'auth_request_limits', ...flowTables]);
}

test('FLOW-001-A / FLOW-002-A: exact external USD flows, correction, void and history stay separate from trades', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const account = await api.account(`External-flow trade ${randomUUID()}`);
  const instrument = await api.instrument(`External-flow token ${randomUUID()}`, 'FLOW');
  await api.initialize(account.id);
  const trade = await api.create(
    account.id,
    tradeInput(instrument.id, 0, {
      occurredAt: '2025-01-02T12:00:00.000Z',
      quantity: '1',
      grossUsd: '100',
    }),
  );
  expect(trade.trade.kind).toBe('create');

  const priorFinancialRows = oldFinancialFingerprint();
  const priorAdmissions = ledgerState();
  const priorProviders = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);
  const originPath = '/portfolio/cash-flow-journal';
  const flowsPath = '/portfolio/cash-flows';
  const initialization = {
    requestId: randomUUID(),
    coverageFrom,
    assertReviewed: true,
  };

  try {
    const origin = await api.result('POST', originPath, 201, initialization);
    expect(origin).toMatchObject({
      requestId: initialization.requestId,
      coverageFrom,
      createdAt: expect.any(String),
    });

    const contribution = flowCommand(0, 'contribution', '2025-01-02T00:00:00.000Z', '1000');
    const withdrawal = flowCommand(1, 'withdrawal', '2025-01-03T00:00:00.000Z', '250');
    const atomContribution = flowCommand(2, 'contribution', '2025-01-04T00:00:00.000Z', amountAtom);

    const firstReceipt = readReceipt(await api.result('POST', flowsPath, 201, contribution));
    expect(firstReceipt).toMatchObject({
      journalRevision: 1,
      flow: {
        version: 1,
        journalRevision: 1,
        requestId: contribution.requestId,
        kind: 'create',
        direction: 'contribution',
        occurredAt: '2025-01-02T00:00:00.000Z',
        amountUsd: '1000',
      },
    });
    const withdrawalReceipt = readReceipt(await api.result('POST', flowsPath, 201, withdrawal));
    expect(withdrawalReceipt).toMatchObject({
      journalRevision: 2,
      flow: {
        version: 1,
        journalRevision: 2,
        requestId: withdrawal.requestId,
        kind: 'create',
        direction: 'withdrawal',
        amountUsd: '250',
      },
    });
    const atomReceipt = readReceipt(await api.result('POST', flowsPath, 201, atomContribution));
    expect(atomReceipt).toMatchObject({
      journalRevision: 3,
      flow: {
        version: 1,
        journalRevision: 3,
        requestId: atomContribution.requestId,
        kind: 'create',
        direction: 'contribution',
        amountUsd: amountAtom,
      },
    });

    const query = `?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`;
    const initialPeriod = await api.result('GET', `${flowsPath}${query}`, 200);
    expect(initialPeriod).toMatchObject({
      from: dateFrom,
      to: dateTo,
      coverageFrom,
      journalRevision: 3,
      basis: 'owner-declared-usd-flows',
      completeness: 'unreconciled',
      summary: {
        contributionsUsd: totalWithAtom,
        withdrawalsUsd: '250',
        netContributionsUsd: '750.000000000000000000000000000001',
        flowCount: 3,
      },
      nextOffset: null,
    });
    expect((initialPeriod as { items: Flow[] }).items.map((item) => item.flowId)).toEqual([
      firstReceipt.flow.flowId,
      withdrawalReceipt.flow.flowId,
      atomReceipt.flow.flowId,
    ]);
    expect(initialPeriod).not.toHaveProperty('portfolioValueUsd');
    expect(initialPeriod).not.toHaveProperty('investmentProfitUsd');

    const correctedCommand = flowCommand(3, 'contribution', '2025-01-02T00:00:00.000Z', '1200');
    const corrected = readReceipt(
      await api.result(
        'POST',
        `${flowsPath}/${firstReceipt.flow.flowId}/corrections`,
        201,
        correctedCommand,
      ),
    );
    expect(corrected).toMatchObject({
      journalRevision: 4,
      flow: {
        flowId: firstReceipt.flow.flowId,
        version: 2,
        journalRevision: 4,
        requestId: correctedCommand.requestId,
        kind: 'correct',
        amountUsd: '1200',
      },
    });

    const voidCommand = { requestId: randomUUID(), expectedJournalRevision: 4 };
    const voided = readReceipt(
      await api.result(
        'POST',
        `${flowsPath}/${withdrawalReceipt.flow.flowId}/voids`,
        201,
        voidCommand,
      ),
    );
    expect(voided).toMatchObject({
      journalRevision: 5,
      flow: {
        flowId: withdrawalReceipt.flow.flowId,
        version: 2,
        journalRevision: 5,
        requestId: voidCommand.requestId,
        kind: 'void',
        direction: 'withdrawal',
        amountUsd: '250',
      },
    });

    expect(await api.result('POST', flowsPath, 200, contribution)).toEqual(firstReceipt);
    const finalPeriod = await api.result('GET', `${flowsPath}${query}`, 200);
    expect(finalPeriod).toMatchObject({
      journalRevision: 5,
      basis: 'owner-declared-usd-flows',
      completeness: 'unreconciled',
      summary: {
        contributionsUsd: '1200.000000000000000000000000000001',
        withdrawalsUsd: '0',
        netContributionsUsd: '1200.000000000000000000000000000001',
        flowCount: 2,
      },
    });
    expect((finalPeriod as { items: Flow[] }).items.map((item) => item.flowId)).toEqual([
      firstReceipt.flow.flowId,
      atomReceipt.flow.flowId,
    ]);

    const contributionVersions = await api.result(
      'GET',
      `${flowsPath}/${firstReceipt.flow.flowId}/versions`,
      200,
    );
    expect(contributionVersions).toMatchObject({
      flowId: firstReceipt.flow.flowId,
      nextBeforeVersion: null,
      items: [
        { version: 2, journalRevision: 4, kind: 'correct', amountUsd: '1200' },
        { version: 1, journalRevision: 1, kind: 'create', amountUsd: '1000' },
      ],
    });
    const withdrawalVersions = await api.result(
      'GET',
      `${flowsPath}/${withdrawalReceipt.flow.flowId}/versions`,
      200,
    );
    expect(withdrawalVersions).toMatchObject({
      flowId: withdrawalReceipt.flow.flowId,
      items: [
        { version: 2, journalRevision: 5, kind: 'void' },
        { version: 1, journalRevision: 2, kind: 'create' },
      ],
    });
    expect(await api.result('GET', '/portfolio/cash-flow-journal', 200)).toMatchObject({
      journal: { journalRevision: 5, activeFlowCount: 2, versionCount: 5 },
      basis: 'owner-declared-usd-flows',
      completeness: 'unreconciled',
    });
    expect(trade.trade.tradeId).toBeTruthy();
    expect(await api.trades(account.id)).toMatchObject({
      journalRevision: 1,
      items: [{ tradeId: trade.trade.tradeId, grossUsd: '100' }],
    });
  } finally {
    expect(
      oldFinancialFingerprint(),
      'Flow commands do not mutate any existing financial rows',
    ).toBe(priorFinancialRows);
    expect(ledgerState(), 'Valid API flow operations do not alter auth admission state').toBe(
      priorAdmissions,
    );
    expect(providerRequests(), 'Declared USD flows make no provider requests').toEqual(
      priorProviders,
    );
    assertQuota();
  }
});
