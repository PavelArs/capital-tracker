import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ledgerState,
} from './admission-fixtures';
import { test } from './external-usd-flows-fixtures';
import { noStore, providerRequests } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep } from './mfa-fixtures';
import { browserPost, coverageFrom, tradeApi } from './usd-trades-fixtures';

const journalPath = '/portfolio/cash-flow-journal';
const flowsPath = '/portfolio/cash-flows';
const profitPath = '/portfolio/profit-preview';
const twrPath = '/portfolio/twr-preview';
const twrEndpoint = `/api/accounting${twrPath}`;
const from = coverageFrom;
const to = '2025-01-03T00:00:00.000Z';

function previewInput(overrides: Record<string, unknown> = {}) {
  return {
    from,
    to,
    openingValueUsd: '0',
    closingValueUsd: '1100',
    assertReviewed: true,
    ...overrides,
  };
}

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

function supportedResult(value: unknown, journalRevision: number) {
  expect(value).toMatchObject({
    from,
    to,
    coverageFrom: from,
    journalRevision,
    basis: 'manual-usd-valuations',
    flowBasis: 'owner-declared-usd-flows',
    completeness: 'unreconciled',
    openingValueUsd: '0',
    closingValueUsd: '1100',
    flows: {
      contributionsUsd: '1000',
      withdrawalsUsd: '0',
      netContributionsUsd: '1000',
      flowCount: 1,
    },
    profitUsd: '100',
    twr: {
      method: 'endpoint-ratio-UTC-ms',
      rateRoundingBound: '0.0000000000005',
      netFlowAtStartUsd: '1000',
      startingCapitalUsd: '1000',
      interiorNetFlowDateCount: 0,
      status: 'available',
      reason: null,
      periodRate: '0.1',
      periodPercent: '10',
    },
  });
}

test('TWR-API: exact endpoint return and private reviewed snapshot', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  await api.result('POST', journalPath, 201, {
    requestId: randomUUID(),
    coverageFrom: from,
    assertReviewed: true,
  });
  await api.result('POST', flowsPath, 201, flowCommand(0, 'contribution', from, '1000'));
  await api.result('POST', flowsPath, 201, flowCommand(1, 'withdrawal', to, '100'));

  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    let financialBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    const admissionsBefore = ledgerState();
    const providersBefore = providerRequests();

    const response = await api.send('POST', twrPath, previewInput());
    expect(response.status()).toBe(200);
    noStore(response);
    supportedResult(await response.json(), 2);
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
    ).toBe(financialBefore);

    await api.result(
      'POST',
      flowsPath,
      201,
      flowCommand(2, 'contribution', '2025-01-02T00:00:00.000Z', '100'),
    );
    financialBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    const interior = await api.send('POST', twrPath, previewInput());
    expect(interior.status()).toBe(200);
    noStore(interior);
    expect(await interior.json()).toMatchObject({
      journalRevision: 3,
      profitUsd: '0',
      flows: { contributionsUsd: '1100', withdrawalsUsd: '0', flowCount: 2 },
      twr: {
        status: 'unavailable',
        reason: 'missing-flow-boundary-valuations',
        periodRate: null,
        periodPercent: null,
        interiorNetFlowDateCount: 1,
      },
    });

    const uncovered = await api.send(
      'POST',
      twrPath,
      previewInput({ from: '2024-12-31T00:00:00.000Z' }),
    );
    expect(uncovered.status()).toBe(409);
    noStore(uncovered);
    const invalid = await api.send('POST', twrPath, previewInput({ assertReviewed: false }));
    expect(invalid.status()).toBe(400);
    noStore(invalid);
    const unknownField = await api.send('POST', twrPath, previewInput({ ownerId: randomUUID() }));
    expect(unknownField.status()).toBe(400);
    noStore(unknownField);

    const anonymous = await request.fetch(twrEndpoint, {
      method: 'POST',
      data: previewInput(),
      headers: { Origin: origin },
    });
    expect(anonymous.status()).toBe(401);
    noStore(anonymous);
    const pendingMfa = await pendingContext.request.fetch(twrEndpoint, {
      method: 'POST',
      data: previewInput(),
      headers: { Origin: origin, 'X-CSRF-Token': pending.csrfToken },
    });
    expect(pendingMfa.status()).toBe(401);
    noStore(pendingMfa);
    const foreignOrigin = await api.send('POST', twrPath, previewInput(), {
      Origin: 'https://foreign.example.invalid',
    });
    expect(foreignOrigin.status()).toBe(403);
    noStore(foreignOrigin);
    const missingCsrf = await page.request.fetch(twrEndpoint, {
      method: 'POST',
      data: previewInput(),
      headers: { Origin: origin },
    });
    expect(missingCsrf.status()).toBe(403);
    noStore(missingCsrf);
    const invalidCsrf = await api.send('POST', twrPath, previewInput(), {
      'X-CSRF-Token': 'invalid-synthetic-csrf',
    });
    expect(invalidCsrf.status()).toBe(403);
    noStore(invalidCsrf);

    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
      'TWR previews and denials preserve all financial rows',
    ).toBe(financialBefore);
    expect(ledgerState(), 'Read-only previews and denials do not consume admissions').toBe(
      admissionsBefore,
    );
    expect(providerRequests(), 'TWR preview makes no provider calls').toEqual(providersBefore);
  } finally {
    await pendingContext.close();
  }
});

test('TWR-UI: reviewed return, missing flow valuation and delayed result invalidation', async ({
  page,
}) => {
  const api = await tradeApi(page);
  await api.result('POST', journalPath, 201, {
    requestId: randomUUID(),
    coverageFrom: from,
    assertReviewed: true,
  });
  await api.result('POST', flowsPath, 201, flowCommand(0, 'contribution', from, '1000'));

  let financialBefore = fingerprint([
    'auth_sessions',
    'auth_request_limits',
    'owner_mfa',
    'owner_mfa_recovery',
  ]);
  const admissionsBefore = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const providersBefore = providerRequests();

  try {
    await page.goto('/period-profit');
    const twrButton = page.getByRole('button', { name: 'Рассчитать TWR', exact: true });
    await expect(twrButton).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Прибыль за период', exact: true }),
    ).toBeVisible();

    const fromInput = page.getByLabel('Начало периода (UTC)', { exact: true });
    const toInput = page.getByLabel('Конец периода (UTC)', { exact: true });
    const openingInput = page.getByLabel('Оценка в начале, USD', { exact: true });
    const closingInput = page.getByLabel('Оценка в конце, USD', { exact: true });
    const review = page.getByRole('checkbox', {
      name: 'Я проверил оценки и внешние потоки',
      exact: true,
    });
    const profitButton = page.getByRole('button', { name: 'Рассчитать прибыль', exact: true });
    const result = page.getByRole('region', { name: 'Результат расчёта', exact: true });
    const twrRegion = page.getByRole('region', { name: 'Доходность TWR', exact: true });
    const twrRate = () =>
      twrRegion
        .getByText('TWR, % за период', { exact: true })
        .locator('xpath=following-sibling::dd[1]');

    await fromInput.fill(from);
    await toInput.fill(to);
    await openingInput.fill('0');
    await closingInput.fill('1100');
    await review.check();
    const availableResponse = await browserPost(page, twrPath, () => twrButton.click());
    expect(availableResponse.status()).toBe(200);
    supportedResult(await availableResponse.json(), 1);
    await expect(result).toBeVisible();
    await expect(
      result.getByText('Прибыль, USD', { exact: true }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('100');
    await expect(twrRegion).toBeVisible();
    await expect(twrRate()).toHaveText('10');
    await expect(twrRegion).toContainText('Оценка вручную');
    await expect(twrRegion).toContainText('Потоки не сверены');

    await openingInput.fill('1');
    await expect(review).not.toBeChecked();
    await expect(result).toBeHidden();
    await expect(twrRegion).toBeHidden();
    await openingInput.fill('0');
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
    ).toBe(financialBefore);
    await api.result(
      'POST',
      flowsPath,
      201,
      flowCommand(1, 'contribution', '2025-01-02T00:00:00.000Z', '100'),
    );
    financialBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    await review.check();
    const unavailableResponse = await browserPost(page, twrPath, () => twrButton.click());
    expect(unavailableResponse.status()).toBe(200);
    expect(await unavailableResponse.json()).toMatchObject({
      profitUsd: '0',
      twr: {
        status: 'unavailable',
        reason: 'missing-flow-boundary-valuations',
        periodRate: null,
        periodPercent: null,
        interiorNetFlowDateCount: 1,
      },
    });
    await expect(twrRegion).toBeVisible();
    await expect(twrRegion).toContainText(
      'Для расчёта TWR нужны оценки в моменты промежуточных вводов и выводов.',
    );
    await expect(twrRate()).toBeHidden();

    let signalFetched: () => void = () => {};
    let releaseResponse: () => void = () => {};
    let handlerFinished: () => void = () => {};
    let handlerStarted = false;
    const fetched = new Promise<void>((resolve) => {
      signalFetched = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      handlerFinished = resolve;
    });
    await page.route(
      `**${twrEndpoint}`,
      async (route) => {
        handlerStarted = true;
        try {
          const response = await route.fetch();
          signalFetched();
          await released;
          await route.fulfill({ response });
        } finally {
          handlerFinished();
        }
      },
      { times: 1 },
    );
    const pendingTwrResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === twrEndpoint && response.request().method() === 'POST',
    );
    const pendingTwrClick = twrButton.click();
    try {
      await fetched;
      await closingInput.fill('1200');
      await expect(review).not.toBeChecked();
      await expect(result).toBeHidden();
      await expect(twrRegion).toBeHidden();
      await review.check();
      const newerProfit = await browserPost(page, profitPath, () => profitButton.click());
      expect(newerProfit.status()).toBe(200);
      expect(await newerProfit.json()).toMatchObject({
        closingValueUsd: '1200',
        profitUsd: '100',
      });
      await expect(result).toBeVisible();
      await expect(
        result.getByText('Прибыль, USD', { exact: true }).locator('xpath=following-sibling::dd[1]'),
      ).toHaveText('100');

      releaseResponse();
      expect((await pendingTwrResponse).status()).toBe(200);
      await pendingTwrClick;
      await expect(result).toBeVisible();
      await expect(
        result.getByText('Прибыль, USD', { exact: true }).locator('xpath=following-sibling::dd[1]'),
      ).toHaveText('100');
      await expect(twrRegion).toBeHidden();
    } finally {
      releaseResponse();
      if (handlerStarted) await finished;
      await page.unroute(`**${twrEndpoint}`);
    }
  } finally {
    await expectAdmissionDelta(admissionsBefore, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
    ]);
  }

  expect(
    fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
    'TWR and profit previews preserve all financial rows',
  ).toBe(financialBefore);
  expect(providerRequests(), 'TWR UI makes no provider calls').toEqual(providersBefore);
});
