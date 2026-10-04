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
const xirrPath = '/portfolio/xirr-preview';
const xirrEndpoint = `/api/accounting${xirrPath}`;
const from = coverageFrom;
const to = '2026-01-01T00:00:00.000Z';

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

function contribution() {
  return {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    direction: 'contribution',
    occurredAt: from,
    amountUsd: '1000',
    assertExternal: true,
  };
}

function xirrResult(value: unknown) {
  expect(value).toMatchObject({
    from,
    to,
    coverageFrom,
    journalRevision: 1,
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
    xirr: {
      status: 'available',
      reason: null,
      convention: 'ACT/365F-UTC-ms',
      rateTolerance: '0.0000000001',
      cashFlowDateCount: 2,
      shortPeriod: false,
    },
  });
  const xirr = (value as { xirr: { annualRate: string; annualPercent: string } }).xirr;
  expect(typeof xirr.annualRate).toBe('string');
  expect(typeof xirr.annualPercent).toBe('string');
  expect(Math.abs(Number(xirr.annualRate) - 0.1)).toBeLessThanOrEqual(1e-10);
  expect(Math.abs(Number(xirr.annualPercent) - 10)).toBeLessThanOrEqual(1e-8);
}

test('XIRR-YEAR / XIRR-PRIVATE: actual authenticated dated cash flows and protected snapshot', async ({
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
  await api.result('POST', flowsPath, 201, contribution());

  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const accountingBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    const admissionsBefore = ledgerState();
    const providersBefore = providerRequests();

    const profit = await api.send('POST', profitPath, previewInput());
    expect(profit.status()).toBe(200);
    noStore(profit);
    const existingProfit = await profit.json();
    expect(existingProfit).toMatchObject({
      journalRevision: 1,
      profitUsd: '100',
      flows: { contributionsUsd: '1000', withdrawalsUsd: '0', flowCount: 1 },
    });
    expect(existingProfit).not.toHaveProperty('xirr');

    const response = await api.send('POST', xirrPath, previewInput());
    expect(response.status()).toBe(200);
    noStore(response);
    const result = await response.json();
    xirrResult(result);
    expect(result).toMatchObject(existingProfit);

    const uncovered = await api.send(
      'POST',
      xirrPath,
      previewInput({ from: '2024-12-31T00:00:00.000Z' }),
    );
    expect(uncovered.status()).toBe(409);
    noStore(uncovered);
    const invalid = await api.send('POST', xirrPath, previewInput({ assertReviewed: false }));
    expect(invalid.status()).toBe(400);
    noStore(invalid);

    const anonymous = await request.fetch(xirrEndpoint, {
      method: 'POST',
      data: previewInput(),
      headers: { Origin: origin },
    });
    expect(anonymous.status()).toBe(401);
    noStore(anonymous);
    const pendingMfa = await pendingContext.request.fetch(xirrEndpoint, {
      method: 'POST',
      data: previewInput(),
      headers: { Origin: origin, 'X-CSRF-Token': pending.csrfToken },
    });
    expect(pendingMfa.status()).toBe(401);
    noStore(pendingMfa);
    const foreignOrigin = await api.send('POST', xirrPath, previewInput(), {
      Origin: 'https://foreign.example.invalid',
    });
    expect(foreignOrigin.status()).toBe(403);
    noStore(foreignOrigin);
    const invalidCsrf = await api.send('POST', xirrPath, previewInput(), {
      'X-CSRF-Token': 'invalid-synthetic-csrf',
    });
    expect(invalidCsrf.status()).toBe(403);
    noStore(invalidCsrf);

    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
      'Profit and XIRR previews preserve all financial rows',
    ).toBe(accountingBefore);
    expect(ledgerState(), 'Read-only XIRR requests do not consume admissions').toBe(
      admissionsBefore,
    );
    expect(providerRequests(), 'XIRR preview makes no provider calls').toEqual(providersBefore);
    expect(api.calls).toBeLessThanOrEqual(80);
  } finally {
    await pendingContext.close();
  }
});

test('XIRR-UI / XIRR-LATE: available and unavailable rates stay bound to reviewed inputs', async ({
  page,
}) => {
  const api = await tradeApi(page);
  await api.result('POST', journalPath, 201, {
    requestId: randomUUID(),
    coverageFrom,
    assertReviewed: true,
  });
  await api.result('POST', flowsPath, 201, contribution());

  const accountingBefore = fingerprint([
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
    await expect(
      page.getByRole('heading', { name: 'Прибыль за период', exact: true }),
    ).toBeVisible();
    const fromInput = page.getByLabel('Начало периода', { exact: true });
    const toInput = page.getByLabel('Конец периода', { exact: true });
    const openingInput = page.getByLabel('Оценка в начале, USD', { exact: true });
    const closingInput = page.getByLabel('Оценка в конце, USD', { exact: true });
    const review = page.getByRole('checkbox', {
      name: 'Я проверил оценки и внешние потоки',
      exact: true,
    });
    const profitButton = page.getByRole('button', { name: 'Рассчитать прибыль', exact: true });
    const xirrButton = page.getByRole('button', { name: 'Рассчитать XIRR', exact: true });
    await expect(xirrButton).toBeVisible();
    const profitRegion = page.getByRole('region', { name: 'Результат расчёта', exact: true });
    const xirrRegion = page.getByRole('region', { name: 'Доходность XIRR', exact: true });
    const xirrRate = (region: typeof xirrRegion) =>
      region
        .getByText('XIRR, % годовых', { exact: true })
        .locator('xpath=following-sibling::dd[1]');

    await fromInput.fill(from.slice(0, 10));
    await toInput.fill(to.slice(0, 10));
    await openingInput.fill('0');
    await closingInput.fill('1100');
    await review.check();
    const availableResponse = await browserPost(page, xirrPath, () => xirrButton.click());
    expect(availableResponse.status()).toBe(200);
    const available = await availableResponse.json();
    xirrResult(available);
    await expect(profitRegion).toBeVisible();
    await expect(
      profitRegion
        .getByText('Прибыль, USD', { exact: true })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('100');
    await expect(xirrRegion).toBeVisible();
    await expect(xirrRate(xirrRegion)).toHaveText(/^10(?:\.0+)?$/);
    await expect(xirrRegion).toContainText('ACT/365F');
    await expect(xirrRegion).toContainText('Оценка вручную');
    await expect(xirrRegion).toContainText('Потоки не сверены');
    await expect(xirrRegion).toContainText('64');

    await fromInput.fill('2025-01-02');
    await toInput.fill('2025-01-03');
    await openingInput.fill('1000');
    await closingInput.fill('1100');
    await expect(profitRegion).toBeHidden();
    await expect(xirrRegion).toBeHidden();
    await expect(review).not.toBeChecked();
    await review.check();
    const unavailableResponse = await browserPost(page, xirrPath, () => xirrButton.click());
    expect(unavailableResponse.status()).toBe(200);
    const unavailable = await unavailableResponse.json();
    expect(unavailable).toMatchObject({
      profitUsd: '100',
      xirr: {
        status: 'unavailable',
        annualRate: null,
        annualPercent: null,
        reason: 'outside-supported-range',
        shortPeriod: true,
      },
    });
    await expect(xirrRegion).toBeVisible();
    await expect(xirrRegion).toContainText('Ставка за пределами поддерживаемого диапазона.');
    await expect(xirrRegion).toContainText(
      'Короткий период: годовая ставка не является прогнозом.',
    );
    await expect(xirrRate(xirrRegion)).toBeHidden();
    await expect(
      profitRegion
        .getByText('Прибыль, USD', { exact: true })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('100');

    // Hold an actual XIRR response, then calculate a newer profit from edited inputs.
    await closingInput.fill('1200');
    await expect(profitRegion).toBeHidden();
    await expect(xirrRegion).toBeHidden();
    await expect(review).not.toBeChecked();
    await fromInput.fill(from.slice(0, 10));
    await toInput.fill(to.slice(0, 10));
    await openingInput.fill('0');
    await closingInput.fill('1100');
    await review.check();
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
      `**${xirrEndpoint}`,
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
    const pendingXirrResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === xirrEndpoint && response.request().method() === 'POST',
    );
    const pendingXirrClick = xirrButton.click();
    try {
      await fetched;
      await closingInput.fill('1200');
      await expect(review).not.toBeChecked();
      await expect(profitRegion).toBeHidden();
      await expect(xirrRegion).toBeHidden();
      await review.check();
      const newProfit = await browserPost(page, profitPath, () => profitButton.click());
      expect(newProfit.status()).toBe(200);
      expect(await newProfit.json()).toMatchObject({ profitUsd: '200', closingValueUsd: '1200' });
      await expect(profitRegion).toBeVisible();
      await expect(
        profitRegion
          .getByText('Прибыль, USD', { exact: true })
          .locator('xpath=following-sibling::dd[1]'),
      ).toHaveText('200');
      releaseResponse();
      expect((await pendingXirrResponse).status()).toBe(200);
      await pendingXirrClick;
      await expect(profitRegion).toBeVisible();
      await expect(
        profitRegion
          .getByText('Прибыль, USD', { exact: true })
          .locator('xpath=following-sibling::dd[1]'),
      ).toHaveText('200');
      await expect(xirrRegion).toBeHidden();
    } finally {
      releaseResponse();
      if (handlerStarted) await finished;
      await page.unroute(`**${xirrEndpoint}`);
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
    'XIRR and profit UI reads preserve all financial rows',
  ).toBe(accountingBefore);
  expect(providerRequests(), 'XIRR UI makes no provider calls').toEqual(providersBefore);
  expect(api.calls).toBeLessThanOrEqual(80);
});
