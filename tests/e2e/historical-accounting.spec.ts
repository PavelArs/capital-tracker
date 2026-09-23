import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ledgerState,
} from './admission-fixtures';
import {
  command as carryInCommand,
  fixture as carryInFixture,
  coverageFrom,
} from './carry-in-fixtures';
import { providerRequests } from './manual-opening-fixtures';
import { fingerprint, test } from './mfa-fixtures';
import { trackBrowserRequests, tradeApi, tradeInput } from './usd-trades-fixtures';

const emptySummary = {
  grossBuysUsd: '0',
  buyFeesUsd: '0',
  grossSalesUsd: '0',
  sellFeesUsd: '0',
  netSalesUsd: '0',
  consumedCostUsd: '0',
  realizedUsd: '0',
  remainingCostUsd: '0',
};

function expectedSnapshot(input: {
  accountId: string;
  at: string;
  coverageFrom: string;
  journalRevision: number;
  originKind: 'declared-empty' | 'known-cost-carry-in';
  openingRevision: number | null;
  initialCostUsd: string;
  summary: typeof emptySummary;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  quantity: string;
  costUsd: string;
}) {
  const { instrumentId, instrumentName, instrumentSymbol, quantity, costUsd, ...snapshot } = input;
  return {
    ...snapshot,
    basis: 'current-effective-history',
    items: [{ instrumentId, instrumentName, instrumentSymbol, quantity, costUsd }],
    nextOffset: null,
  };
}

test('HIST-001-A / HIST-002-A: exact history timeline and carry-in boundary', async ({ page }) => {
  const carry = await carryInFixture(page);
  const api = carry.api;
  const account = await api.account(`Historical timeline ${randomUUID()}`);
  const instrument = await api.instrument(`Historical TOKEN ${randomUUID()}`, 'HIST');
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
  await api.create(
    account.id,
    tradeInput(instrument.id, 2, {
      occurredAt: '2025-01-04T00:00:00.000Z',
      orderWithinTimestamp: 0,
      side: 'sell',
      quantity: '1.5',
      grossUsd: '450',
    }),
  );
  await api.correct(
    account.id,
    first.trade.tradeId,
    tradeInput(instrument.id, 3, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
      grossUsd: '120',
    }),
  );

  const carryInitialized = await api.send('POST', carry.path, carryInCommand(carry));
  expect(carryInitialized.status()).toBe(201);
  await api.create(
    carry.account.id,
    tradeInput(carry.instrument.id, 0, {
      occurredAt: coverageFrom,
      orderWithinTimestamp: 0,
      side: 'sell',
      quantity: '1.5',
      grossUsd: '450',
    }),
  );

  const retained = fingerprint(['auth_sessions', 'auth_request_limits']);
  const admissions = ledgerState();
  const providers = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);
  const history = async (accountId: string, at: string) => {
    const response = await api.send(
      'GET',
      `/accounts/${accountId}/trade-journal/history?at=${encodeURIComponent(at)}`,
    );
    expect(response.status(), 'A real authenticated history request returns its snapshot').toBe(
      200,
    );
    return response.json();
  };

  try {
    const beforeJan3 = '2025-01-02T23:59:59.999Z';
    const jan3 = '2025-01-03T00:00:00.000Z';
    const jan4 = '2025-01-04T00:00:00.000Z';
    const historyPrefix = {
      accountId: account.id,
      coverageFrom,
      originKind: 'declared-empty' as const,
      openingRevision: null,
      instrumentId: instrument.id,
      instrumentName: instrument.name,
      instrumentSymbol: instrument.symbol,
    };

    expect(await history(account.id, beforeJan3)).toEqual(
      expectedSnapshot({
        ...historyPrefix,
        at: beforeJan3,
        journalRevision: 4,
        initialCostUsd: '0',
        summary: {
          ...emptySummary,
          grossBuysUsd: '120',
          remainingCostUsd: '120',
        },
        quantity: '1',
        costUsd: '120',
      }),
    );
    expect(await history(account.id, jan3)).toEqual(
      expectedSnapshot({
        ...historyPrefix,
        at: jan3,
        journalRevision: 4,
        initialCostUsd: '0',
        summary: {
          ...emptySummary,
          grossBuysUsd: '320',
          remainingCostUsd: '320',
        },
        quantity: '2',
        costUsd: '320',
      }),
    );
    expect(await history(account.id, jan4)).toEqual(
      expectedSnapshot({
        ...historyPrefix,
        at: jan4,
        journalRevision: 4,
        initialCostUsd: '0',
        summary: {
          ...emptySummary,
          grossBuysUsd: '320',
          grossSalesUsd: '450',
          netSalesUsd: '450',
          consumedCostUsd: '220',
          realizedUsd: '230',
          remainingCostUsd: '100',
        },
        quantity: '0.5',
        costUsd: '100',
      }),
    );

    expect(await history(carry.account.id, coverageFrom)).toEqual(
      expectedSnapshot({
        accountId: carry.account.id,
        at: coverageFrom,
        coverageFrom,
        journalRevision: 1,
        originKind: 'known-cost-carry-in',
        openingRevision: 1,
        initialCostUsd: '300',
        summary: {
          ...emptySummary,
          grossSalesUsd: '450',
          netSalesUsd: '450',
          consumedCostUsd: '200',
          realizedUsd: '250',
          remainingCostUsd: '100',
        },
        instrumentId: carry.instrument.id,
        instrumentName: carry.instrument.name,
        instrumentSymbol: carry.instrument.symbol,
        quantity: '0.5',
        costUsd: '100',
      }),
    );
  } finally {
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(retained);
    expect(ledgerState(), 'Read-only accounting adds no auth-admission hits').toBe(admissions);
    expect(providerRequests(), 'Accounting history makes no provider calls').toEqual(providers);
    assertQuota();
  }
});

test('HIST-004-A: UI snapshot shows exact quantity and cost', async ({ page }) => {
  const api = await tradeApi(page);
  const account = await api.account(`Historical UI ${randomUUID()}`);
  const instrument = await api.instrument(
    `<img src=x onerror="window.historyLabelExecuted=true"> ${randomUUID()}`,
    'HIST',
  );
  await api.initialize(account.id);
  await api.create(
    account.id,
    tradeInput(instrument.id, 0, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
    }),
  );

  const retained = fingerprint(['auth_sessions', 'auth_request_limits']);
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const providers = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);

  try {
    await page.goto(`/manual-accounts/${account.id}`);
    await expect(
      page.getByRole('heading', { name: 'Учётный срез на дату', exact: true }),
    ).toBeVisible();
    const instant = page.getByLabel('Момент времени (ISO, с часовым поясом)', {
      exact: true,
    });
    await instant.fill('2025-01-02T00:00:00Z');
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/accounting/accounts/${account.id}/trade-journal/history` &&
        response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Показать учётный срез', exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    expect(await response.json()).toMatchObject({
      accountId: account.id,
      at: '2025-01-02T00:00:00.000Z',
      coverageFrom,
      journalRevision: 1,
      basis: 'current-effective-history',
      items: [
        {
          instrumentId: instrument.id,
          instrumentName: instrument.name,
          quantity: '1',
          costUsd: '100',
        },
      ],
    });
    const section = page.getByRole('region', {
      name: 'Учётный срез на дату',
      exact: true,
    });
    await expect(section.getByRole('table')).toBeVisible();
    const position = section.getByRole('row').filter({ hasText: instrument.name });
    await expect(position.getByRole('cell', { name: '1', exact: true })).toBeVisible();
    await expect(position.getByRole('cell', { name: '100', exact: true })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, 'historyLabelExecuted'))).toBeUndefined();
  } finally {
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(retained);
    expectAdmissionDelta(admissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
    ]);
    expect(providerRequests(), 'Historical UI makes no provider calls').toEqual(providers);
    assertQuota();
  }
});
