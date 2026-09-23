import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ledgerState,
} from './admission-fixtures';
import { providerRequests, uuid } from './manual-opening-fixtures';
import { fingerprint, test } from './mfa-fixtures';
import {
  browserPost,
  restartWithExactProviderWarmup,
  trackBrowserRequests,
  tradeInput,
} from './usd-trades-fixtures';

import {
  type CarryInOrigin,
  type Fixture,
  type InitialLot,
  type InitialLots,
  coverageFrom,
  fillLot,
  fixture,
  initialSummary,
  retainedRows,
  reviewLabel,
  soldSummary,
} from './carry-in-fixtures';

function readOrigin(value: unknown, fixture: Fixture, requestId: string): CarryInOrigin {
  expect(value).toEqual({
    accountId: fixture.account.id,
    requestId,
    originKind: 'known-cost-carry-in',
    coverageFrom,
    openingRevision: 1,
    lotCount: 2,
    carryInCostUsd: '300',
    createdAt: expect.any(String),
  });
  const receipt = value as CarryInOrigin;
  uuid(receipt.requestId);
  expect(receipt.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(new Date(receipt.createdAt).toISOString()).toBe(receipt.createdAt);
  return receipt;
}

function expectedEvidence(fixture: Fixture, index: number) {
  const lot = fixture.lots[index];
  return {
    ordinal: index + 1,
    instrumentId: lot.instrumentId,
    instrumentName: fixture.instrument.name,
    instrumentSymbol: fixture.instrument.symbol,
    acquiredAt: lot.acquiredAt,
    orderWithinTimestamp: lot.orderWithinTimestamp,
    originalQuantity: lot.originalQuantity,
    originalCostUsd: lot.originalCostUsd,
    carriedQuantity: lot.remainingQuantity,
    priorDisposedQuantity: '0',
    priorAllocatedCostUsd: '0',
    carriedCostUsd: lot.originalCostUsd,
  };
}

async function baseline(fixture: Fixture): Promise<InitialLots> {
  const value = await fixture.api.result('GET', `${fixture.path}/lots`, 200);
  expect(value).toEqual({
    accountId: fixture.account.id,
    openingRevision: 1,
    items: [0, 1].map((index) => ({
      lotId: expect.any(String),
      ...expectedEvidence(fixture, index),
    })),
    nextAfterOrdinal: null,
  });
  const result = value as InitialLots;
  for (const lot of result.items) uuid(lot.lotId);
  expect(new Set(result.items.map((lot) => lot.lotId)).size).toBe(2);
  return result;
}

function expectedCurrentLot(fixture: Fixture, lot: InitialLot, quantity: string, cost: string) {
  return {
    sourceKind: 'carry-in',
    lotId: lot.lotId,
    openingRevision: 1,
    ordinal: lot.ordinal,
    instrumentId: fixture.instrument.id,
    instrumentName: fixture.instrument.name,
    instrumentSymbol: fixture.instrument.symbol,
    acquiredAt: lot.acquiredAt,
    orderWithinTimestamp: lot.orderWithinTimestamp,
    originalQuantity: lot.originalQuantity,
    originalCostUsd: lot.originalCostUsd,
    carriedQuantity: lot.carriedQuantity,
    carriedCostUsd: lot.carriedCostUsd,
    remainingQuantity: quantity,
    remainingCostUsd: cost,
  };
}

async function expectState(fixture: Fixture, receipt: CarryInOrigin, sold: boolean) {
  expect(
    await fixture.api.result('GET', `/accounts/${fixture.account.id}/trade-journal`, 200),
  ).toEqual({
    accountId: fixture.account.id,
    eligible: false,
    ineligibilityReason: 'already-initialized',
    journal: {
      ...receipt,
      journalRevision: sold ? 1 : 0,
      activeTradeCount: sold ? 1 : 0,
      versionCount: sold ? 1 : 0,
      limits: { activeTrades: 1000, versions: 10000 },
      summary: sold ? soldSummary : initialSummary,
    },
  });
  expect(await fixture.api.result('GET', fixture.path, 200)).toEqual({
    accountId: fixture.account.id,
    eligible: false,
    ineligibilityReason: 'already-initialized',
    opening: fixture.opening,
    origin: receipt,
  });
  expect((await fixture.api.detail(fixture.account.id)).currentOpening).toEqual(fixture.opening);
  expect(await fixture.api.history(fixture.account.id)).toEqual({
    items: [fixture.opening],
    nextCursor: null,
  });
}

test('CARRY-001-A: real owner initializes original 100/200 lots, sells 1.5 for 450 and retains exact provenance after restart', async ({
  page,
}) => {
  const data = await fixture(page);
  const { api, account, path, lots } = data;
  const before = retainedRows(account.id);
  const admissions = ledgerState();
  let providers = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);
  const command = {
    requestId: randomUUID(),
    expectedOpeningRevision: 1,
    lots,
    assertReviewed: true,
  };

  try {
    const initialized = await api.send('POST', path, command);
    expect(
      initialized.status(),
      'A real owner can explicitly initialize reviewed opening lots',
    ).toBe(201);
    const receipt = readOrigin(await initialized.json(), data, command.requestId);
    await expectState(data, receipt, false);
    expect(await api.trades(account.id)).toEqual({
      journalRevision: 0,
      items: [],
      nextOffset: null,
    });
    expect(await api.realizations(account.id)).toEqual({
      journalRevision: 0,
      items: [],
      nextOffset: null,
    });
    const originalLots = await baseline(data);
    expect(await api.result('GET', `/accounts/${account.id}/trade-lots`, 200)).toEqual({
      journalRevision: 0,
      items: originalLots.items.map((lot) =>
        expectedCurrentLot(data, lot, '1', lot.originalCostUsd),
      ),
      nextOffset: null,
    });

    const sale = await api.create(
      account.id,
      tradeInput(data.instrument.id, 0, {
        side: 'sell',
        quantity: '1.5',
        grossUsd: '450',
        feeUsd: '0',
      }),
    );
    await expectState(data, receipt, true);
    expect(await api.trades(account.id)).toEqual({
      journalRevision: 1,
      items: [sale.trade],
      nextOffset: null,
    });
    const expectedLots = {
      journalRevision: 1,
      items: [expectedCurrentLot(data, originalLots.items[1], '0.5', '100')],
      nextOffset: null,
    };
    const expectedMatches = {
      journalRevision: 1,
      items: originalLots.items.map((lot, index) => ({
        sourceKind: 'carry-in',
        sellTradeId: sale.trade.tradeId,
        sellVersion: 1,
        lotId: lot.lotId,
        openingRevision: 1,
        ordinal: index + 1,
        quantity: index === 0 ? '1' : '0.5',
        costUsd: '100',
      })),
      nextOffset: null,
    };
    expect(await api.result('GET', `/accounts/${account.id}/trade-lots`, 200)).toEqual(
      expectedLots,
    );
    expect(
      await api.result('GET', `/accounts/${account.id}/trades/${sale.trade.tradeId}/matches`, 200),
    ).toEqual(expectedMatches);
    expect(await baseline(data)).toEqual(originalLots);
    expect(providerRequests(), 'Accounting never requests provider data').toEqual(providers);

    // Preserve the known two replica-constructor warmups as a separate exact oracle.
    providers = await restartWithExactProviderWarmup();
    expect(await api.result('POST', path, 200, command)).toEqual(receipt);
    await expectState(data, receipt, true);
    expect(await baseline(data)).toEqual(originalLots);
    expect(await api.result('GET', `/accounts/${account.id}/trade-lots`, 200)).toEqual(
      expectedLots,
    );
    expect(
      await api.result('GET', `/accounts/${account.id}/trades/${sale.trade.tradeId}/matches`, 200),
    ).toEqual(expectedMatches);
  } finally {
    expect(
      retainedRows(account.id),
      'Initialization/sale preserve prior openings, imports and other accounts',
    ).toEqual(before);
    expect(ledgerState(), 'Accounting and restart do not change authentication admissions').toBe(
      admissions,
    );
    expect(providerRequests()).toEqual(providers);
    assertQuota();
  }
});

test('CARRY-001-A / CARRY-005-A: real Russian lot preview requires a separate unchecked immutable-baseline review', async ({
  page,
}) => {
  const data = await fixture(page);
  const { api, account, path, lots } = data;
  const before = retainedRows(account.id);
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);

  try {
    await page.goto(`/manual-accounts/${account.id}`);
    await expect(
      page.getByRole('heading', { name: 'Начальные лоты FIFO', exact: true }),
    ).toBeVisible();
    await fillLot(page, 0, lots[0]);
    await page.getByRole('button', { name: 'Добавить лот', exact: true }).click();
    await fillLot(page, 1, lots[1]);
    const initialize = page.getByRole('button', {
      name: 'Начать журнал с начальными лотами',
      exact: true,
    });
    await expect(initialize).toBeDisabled();
    const beforePreview = fingerprint(['auth_sessions', 'auth_request_limits']);
    const preview = await browserPost(page, `${path}/preview`, () =>
      page.getByRole('button', { name: 'Проверить начальные лоты', exact: true }).click(),
    );
    expect(preview.status()).toBe(200);
    expect(preview.request().postDataJSON()).toEqual({ expectedOpeningRevision: 1, lots });
    expect(await preview.json()).toEqual({
      accountId: account.id,
      openingRevision: 1,
      coverageFrom,
      canInitialize: true,
      issues: [],
      lots: lots.map((lot, index) => ({
        ...lot,
        ordinal: index + 1,
        instrumentName: data.instrument.name,
        instrumentSymbol: data.instrument.symbol,
        priorDisposedQuantity: '0',
        priorAllocatedCostUsd: '0',
        carriedCostUsd: lot.originalCostUsd,
      })),
      reconciliation: [
        {
          instrumentId: data.instrument.id,
          instrumentName: data.instrument.name,
          instrumentSymbol: data.instrument.symbol,
          openingQuantity: '2',
          openingCostUsd: '300',
          carriedQuantity: '2',
          carriedCostUsd: '300',
        },
      ],
      carryInCostUsd: '300',
    });
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Preview stores no origin, lot or key',
    ).toBe(beforePreview);
    const review = page.getByRole('checkbox', { name: reviewLabel, exact: true });
    await expect(review).toBeVisible();
    await expect(review).not.toBeChecked();
    await expect(initialize).toBeDisabled();
    await review.check();
    await expect(initialize).toBeEnabled();
    const initialized = await browserPost(page, path, () => initialize.click());
    expect(initialized.status()).toBe(201);
    const command = initialized.request().postDataJSON() as Record<string, unknown>;
    expect(command).toEqual({
      requestId: expect.any(String),
      expectedOpeningRevision: 1,
      lots,
      assertReviewed: true,
    });
    const receipt = readOrigin(await initialized.json(), data, uuid(command.requestId));
    await expectState(data, receipt, false);
    expect(await api.trades(account.id)).toEqual({
      journalRevision: 0,
      items: [],
      nextOffset: null,
    });
    await baseline(data);
  } finally {
    expect(
      retainedRows(account.id),
      'Reviewed initialization preserves the original opening and private prior state',
    ).toEqual(before);
    expect(providerRequests()).toEqual(providers);
    expectAdmissionDelta(admissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
    ]);
    assertQuota();
  }
});
