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
import { literal, noStore, providerRequests } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, query } from './mfa-fixtures';
import {
  capturePeriodWorkbench,
  inspectPeriodMethods,
  openPeriodEvidence,
  withoutWorkbenchRequests,
} from './period-workbench-fixtures';
import { browserPost, coverageFrom, tradeApi } from './usd-trades-fixtures';

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

test('PROFIT-UI / PROFIT-LATE: reviewed Russian preview resets on edits, errors and late responses', async ({
  page,
}, testInfo) => {
  const api = await tradeApi(page);
  await api.result('POST', journalPath, 201, {
    requestId: randomUUID(),
    coverageFrom,
    assertReviewed: true,
  });
  await api.result('POST', flowsPath, 201, flowCommand(0, 'contribution', from, '1000'));

  const financialBefore = fingerprint([
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

    await inspectPeriodMethods(page);

    const fromInput = page.getByLabel('Начало периода', { exact: true });
    const toInput = page.getByLabel('Конец периода', { exact: true });
    const openingInput = page.getByLabel('Оценка в начале, USD', { exact: true });
    const closingInput = page.getByLabel('Оценка в конце, USD', { exact: true });
    const review = page.getByRole('checkbox', {
      name: 'Я проверил оценки и внешние потоки',
      exact: true,
    });
    const calculate = page.getByRole('button', { name: 'Рассчитать прибыль', exact: true });
    const result = page.getByRole('region', { name: 'Результат расчёта', exact: true });

    await fromInput.fill('2024-12-31');
    await toInput.fill(to.slice(0, 10));
    await openingInput.fill('1000');
    await closingInput.fill('2000');
    await review.check();
    const uncovered = await browserPost(page, previewPath, () => calculate.click());
    expect(uncovered.status()).toBe(409);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(result).toBeHidden();

    await fromInput.fill(from.slice(0, 10));
    await expect(review).not.toBeChecked();
    await expect(calculate).toBeDisabled();
    await review.check();
    const validResponse = await browserPost(page, previewPath, () => calculate.click());
    expect(validResponse.status()).toBe(200);
    expect(await validResponse.json()).toMatchObject({
      openingValueUsd: '1000',
      closingValueUsd: '2000',
      flows: { contributionsUsd: '1000', withdrawalsUsd: '0' },
      profitUsd: '0',
    });
    await expect(result).toBeVisible();
    const definitionValue = (label: string) =>
      result.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]');
    await expect(definitionValue('Прибыль, USD')).toHaveText('0');
    await expect(definitionValue('Прибыль, USD')).toBeVisible();
    await expect(result.getByText('Ревизия журнала: 1', { exact: true })).toBeHidden();
    const evidence = await openPeriodEvidence(page, result);
    await expect(definitionValue('Вводы, USD')).toHaveText('1000');
    await expect(definitionValue('Выводы, USD')).toHaveText('0');
    await expect(definitionValue('Оценка в начале, USD')).toHaveText('1000');
    await expect(definitionValue('Оценка в конце, USD')).toHaveText('2000');
    await expect(result).toContainText(from);
    await expect(result).toContainText(to);
    await expect(result).toContainText('Ревизия журнала: 1');
    await expect(result).toContainText('Оценка вручную');
    await expect(result).toContainText('Потоки не сверены');
    await expect(result.getByText('Ревизия журнала: 1', { exact: true })).toBeVisible();
    await expect(evidence).toContainText(coverageFrom);
    await withoutWorkbenchRequests(page, async () => {
      const summary = result.getByText('Основание расчёта', { exact: true });
      await summary.focus();
      await page.keyboard.press('Space');
      await expect(evidence).not.toHaveAttribute('open', '');
      await expect(definitionValue('Прибыль, USD')).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(evidence).toHaveAttribute('open', '');
      await expect(openingInput).toHaveValue('1000');
      await expect(closingInput).toHaveValue('2000');
      await expect(review).toBeChecked();
      await expect(definitionValue('Прибыль, USD')).toHaveText('0');
    });
    await capturePeriodWorkbench(page, testInfo, 'profit-review', [
      page.locator('.profit-header'),
      page.getByRole('region', { name: 'Ручные оценки и период', exact: true }),
      result,
    ]);

    // A delivery failure after a genuine backend calculation must hide the old result.
    let finishFailed: () => void = () => {};
    const failedFinished = new Promise<void>((resolve) => {
      finishFailed = resolve;
    });
    await page.route(
      `**${previewEndpoint}`,
      async (route) => {
        try {
          const actual = await route.fetch();
          expect(actual.status()).toBe(200);
          await route.abort('failed');
        } finally {
          finishFailed();
        }
      },
      { times: 1 },
    );
    try {
      await calculate.click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(result).toBeHidden();
    } finally {
      await failedFinished;
      await page.unroute(`**${previewEndpoint}`);
    }

    await closingInput.fill('2100');
    await expect(result).toBeHidden();
    await expect(review).not.toBeChecked();
    await expect(calculate).toBeDisabled();

    await review.check();
    let signalFetched: () => void = () => {};
    let releaseResponse: () => void = () => {};
    const fetched = new Promise<void>((resolve) => {
      signalFetched = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let handlerFinished: () => void = () => {};
    let handlerStarted = false;
    const finished = new Promise<void>((resolve) => {
      handlerFinished = resolve;
    });
    await page.route(
      `**${previewEndpoint}`,
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
    const lateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === previewEndpoint &&
        response.request().method() === 'POST',
    );
    const pendingClick = calculate.click();
    try {
      await fetched;
      await expect(openingInput).toBeEnabled();
      await openingInput.fill('1200');
      await expect(review).not.toBeChecked();
      await expect(result).toBeHidden();
      releaseResponse();
      expect((await lateResponse).status()).toBe(200);
      await pendingClick;
      await expect(result).toBeHidden();
    } finally {
      releaseResponse();
      if (handlerStarted) await finished;
      await page.unroute(`**${previewEndpoint}`);
    }

    await review.check();
    const recalculated = await browserPost(page, previewPath, () => calculate.click());
    expect(recalculated.status()).toBe(200);
    expect(await recalculated.json()).toMatchObject({
      openingValueUsd: '1200',
      closingValueUsd: '2100',
      profitUsd: '-100',
    });
    await expect(result).toBeVisible();
    await expect(definitionValue('Прибыль, USD')).toHaveText('-100');
    await expect(definitionValue('Прибыль, USD')).toBeVisible();
    await openPeriodEvidence(page, result);
    await expect(result).toContainText('Ревизия журнала: 1');
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
    'The read-only UI preview preserves all financial rows',
  ).toBe(financialBefore);
  expect(providerRequests(), 'The manual preview UI makes no provider calls').toEqual(
    providersBefore,
  );
  expect(api.calls).toBeLessThanOrEqual(80);
});
