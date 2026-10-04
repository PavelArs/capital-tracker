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
import {
  capturePeriodWorkbench,
  expectNativeDisclosure,
  inspectPeriodMethods,
  openPeriodEvidence,
  withoutWorkbenchRequests,
} from './period-workbench-fixtures';
import { browserPost, coverageFrom, tradeApi } from './usd-trades-fixtures';

const journalPath = '/portfolio/cash-flow-journal';
const flowsPath = '/portfolio/cash-flows';
const boundaryPath = '/portfolio/twr-boundaries';
const linkedPath = '/portfolio/linked-twr-preview';
const boundaryEndpoint = `/api/accounting${boundaryPath}`;
const linkedEndpoint = `/api/accounting${linkedPath}`;
const from = coverageFrom;
const to = '2025-01-03T00:00:00.000Z';
const boundaryAt = '2025-01-02T00:00:00.000Z';

function periodQuery(start = from, end = to) {
  return `?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`;
}

function previewInput(
  expectedJournalRevision: number,
  boundaryValuations: { at: string; valueBeforeUsd: string }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    from,
    to,
    openingValueUsd: '1000',
    closingValueUsd: '2310',
    assertReviewed: true,
    expectedJournalRevision,
    boundaryValuations,
    ...overrides,
  };
}

function flowCommand(expectedJournalRevision: number, amountUsd: string, occurredAt = boundaryAt) {
  return {
    requestId: randomUUID(),
    expectedJournalRevision,
    direction: 'contribution',
    occurredAt,
    amountUsd,
    assertExternal: true,
  };
}

function assertLinked(value: unknown, journalRevision: number) {
  expect(value).toMatchObject({
    from,
    to,
    coverageFrom: from,
    journalRevision,
    basis: 'manual-usd-valuations',
    flowBasis: 'owner-declared-usd-flows',
    completeness: 'unreconciled',
    openingValueUsd: '1000',
    closingValueUsd: '2310',
    flows: {
      contributionsUsd: '1000',
      withdrawalsUsd: '0',
      netContributionsUsd: '1000',
      flowCount: 1,
    },
    profitUsd: '310',
    linkedTwr: {
      method: 'geometrically-linked-UTC-ms',
      rateRoundingBound: '0.0000000000005',
      boundaryLimit: 32,
      netFlowAtStartUsd: '0',
      startingCapitalUsd: '1000',
      interiorNetFlowDateCount: 1,
      status: 'available',
      reason: null,
      periodRate: '0.21',
      periodPercent: '21',
      boundaries: [
        {
          at: boundaryAt,
          netFlowUsd: '1000',
          valueBeforeUsd: '1100',
          valueAfterUsd: '2100',
        },
      ],
    },
  });
}

test('LTWR-API: actual revision-pinned boundary plan and linked preview remain private', async ({
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
  const created = (await api.result('POST', flowsPath, 201, flowCommand(0, '1000'))) as {
    flow: { flowId: string };
  };

  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const plan = await api.send('GET', `${boundaryPath}${periodQuery()}`);
    expect(plan.status()).toBe(200);
    const planBody = await plan.json();
    expect(planBody).toMatchObject({
      from,
      to,
      coverageFrom: from,
      journalRevision: 1,
      basis: 'owner-declared-usd-flows',
      completeness: 'unreconciled',
      boundaryLimit: 32,
      netFlowAtStartUsd: '0',
      interiorNetFlowDateCount: 1,
      status: 'ready',
      reason: null,
      boundaries: [{ at: boundaryAt, netFlowUsd: '1000' }],
    });

    let financialBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    let admissionsBefore = ledgerState();
    let providersBefore = providerRequests();
    const missing = await api.send('POST', linkedPath, previewInput(1, []));
    expect(missing.status()).toBe(200);
    expect(await missing.json()).toMatchObject({
      journalRevision: 1,
      profitUsd: '310',
      linkedTwr: {
        status: 'unavailable',
        reason: 'missing-flow-boundary-valuations',
        periodRate: null,
        periodPercent: null,
        boundaries: [
          {
            at: boundaryAt,
            netFlowUsd: '1000',
            valueBeforeUsd: null,
            valueAfterUsd: null,
          },
        ],
      },
    });

    const response = await api.send(
      'POST',
      linkedPath,
      previewInput(1, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
    );
    expect(response.status()).toBe(200);
    assertLinked(await response.json(), 1);
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
    ).toBe(financialBefore);
    expect(ledgerState()).toBe(admissionsBefore);
    expect(providerRequests()).toEqual(providersBefore);

    const correction = await api.result(
      'POST',
      `${flowsPath}/${created.flow.flowId}/corrections`,
      201,
      flowCommand(1, '1200'),
    );
    expect(correction).toMatchObject({ journalRevision: 2 });
    financialBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    admissionsBefore = ledgerState();
    providersBefore = providerRequests();
    const stale = await api.send(
      'POST',
      linkedPath,
      previewInput(1, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
    );
    expect(stale.status()).toBe(409);

    const refreshed = await api.send('GET', `${boundaryPath}${periodQuery()}`);
    expect(refreshed.status()).toBe(200);
    expect(await refreshed.json()).toMatchObject({
      journalRevision: 2,
      boundaries: [{ at: boundaryAt, netFlowUsd: '1200' }],
    });

    const invalid = await api.send(
      'POST',
      linkedPath,
      previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }], { ownerId: randomUUID() }),
    );
    expect(invalid.status()).toBe(400);
    const badPlan = await api.send(
      'GET',
      `${boundaryPath}${periodQuery()}&ownerId=${encodeURIComponent(randomUUID())}`,
    );
    expect(badPlan.status()).toBe(400);

    const pendingPlan = await pendingContext.request.fetch(
      `/api/accounting${boundaryPath}${periodQuery()}`,
      { headers: { Origin: origin } },
    );
    expect(pendingPlan.status()).toBe(401);
    noStore(pendingPlan);
    const pendingPreview = await pendingContext.request.fetch(`/api/accounting${linkedPath}`, {
      method: 'POST',
      data: previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
      headers: { Origin: origin, 'X-CSRF-Token': pending.csrfToken },
    });
    expect(pendingPreview.status()).toBe(401);
    noStore(pendingPreview);
    const anonymousPlan = await request.fetch(`/api/accounting${boundaryPath}${periodQuery()}`, {
      headers: { Origin: origin },
    });
    expect(anonymousPlan.status()).toBe(401);
    noStore(anonymousPlan);
    const anonymousPreview = await request.fetch(`/api/accounting${linkedPath}`, {
      method: 'POST',
      data: previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
      headers: { Origin: origin },
    });
    expect(anonymousPreview.status()).toBe(401);
    noStore(anonymousPreview);
    const hostileOrigin = await api.send(
      'POST',
      linkedPath,
      previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
      { Origin: 'https://foreign.example.invalid' },
    );
    expect(hostileOrigin.status()).toBe(403);
    const missingCsrf = await page.request.fetch(`/api/accounting${linkedPath}`, {
      method: 'POST',
      data: previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
      headers: { Origin: origin },
    });
    expect(missingCsrf.status()).toBe(403);
    noStore(missingCsrf);

    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
      'Boundary plans and previews preserve all financial rows',
    ).toBe(financialBefore);
    expect(ledgerState(), 'Read-only plans, previews and denials do not consume admissions').toBe(
      admissionsBefore,
    );
    expect(providerRequests()).toEqual(providersBefore);
  } finally {
    await pendingContext.close();
  }
});

test('LTWR-UI: linked boundary review resets on edits and refuses stale plans and replies', async ({
  page,
}, testInfo) => {
  const api = await tradeApi(page);
  await api.result('POST', journalPath, 201, {
    requestId: randomUUID(),
    coverageFrom: from,
    assertReviewed: true,
  });
  const created = (await api.result('POST', flowsPath, 201, flowCommand(0, '1000'))) as {
    flow: { flowId: string };
  };

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
    await inspectPeriodMethods(page);
    const linkedSummary = page
      .locator('summary')
      .filter({ hasText: /^TWR с промежуточными оценками$/ });
    const linkedDisclosure = await expectNativeDisclosure(linkedSummary);
    await expect(linkedDisclosure).not.toHaveAttribute('open', '');
    await withoutWorkbenchRequests(page, async () => {
      await linkedSummary.focus();
      await page.keyboard.press('Enter');
      await expect(linkedDisclosure).toHaveAttribute('open', '');
    });
    await expect(
      page.getByRole('heading', { name: 'TWR с промежуточными оценками', exact: true }),
    ).toBeVisible();
    const section = page.getByRole('region', {
      name: 'TWR с промежуточными оценками',
      exact: true,
    });
    await expect(section).toBeVisible();
    const loadPlan = section.getByRole('button', {
      name: 'Загрузить моменты потоков',
      exact: true,
    });
    await expect(loadPlan).toBeVisible();

    const fromInput = page.getByLabel('Начало периода', { exact: true });
    const toInput = page.getByLabel('Конец периода', { exact: true });
    const openingInput = page.getByLabel('Оценка в начале, USD', { exact: true });
    const closingInput = page.getByLabel('Оценка в конце, USD', { exact: true });
    const review = section.getByRole('checkbox', {
      name: 'Я проверил промежуточные оценки и потоки',
      exact: true,
    });
    const calculate = section.getByRole('button', {
      name: 'Рассчитать связанный TWR',
      exact: true,
    });
    const result = page.getByRole('region', { name: 'Результат связанного TWR', exact: true });
    const rate = result
      .getByText('TWR, % за период', { exact: true })
      .locator('xpath=following-sibling::dd[1]');

    await fromInput.fill(from.slice(0, 10));
    await toInput.fill(to.slice(0, 10));
    await openingInput.fill('1000');
    await closingInput.fill('2310');

    const firstPlanResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === boundaryEndpoint &&
        response.request().method() === 'GET',
    );
    await loadPlan.click();
    const firstPlan = await firstPlanResponse;
    expect(firstPlan.status()).toBe(200);
    expect((await firstPlan.allHeaders())['cache-control']).toMatch(
      /(?:^|[,\s])no-store(?:$|[,\s])/,
    );
    const firstPlanBody = await firstPlan.json();
    expect(firstPlanBody).toMatchObject({ journalRevision: 1, interiorNetFlowDateCount: 1 });
    const at = firstPlanBody.boundaries[0].at as string;
    const valuation = section.getByLabel(`Оценка перед потоком ${at}, USD`, { exact: true });
    await expect(valuation).toBeVisible();

    let planFetchedResolve: () => void = () => {};
    let planRelease: () => void = () => {};
    let planHandlerFinished: () => void = () => {};
    let planHandlerStarted = false;
    const planFetched = new Promise<void>((resolve) => {
      planFetchedResolve = resolve;
    });
    const planReleased = new Promise<void>((resolve) => {
      planRelease = resolve;
    });
    const planFinished = new Promise<void>((resolve) => {
      planHandlerFinished = resolve;
    });
    await page.route(
      `**${boundaryEndpoint}**`,
      async (route) => {
        planHandlerStarted = true;
        try {
          const response = await route.fetch();
          planFetchedResolve();
          await planReleased;
          await route.fulfill({ response });
        } finally {
          planHandlerFinished();
        }
      },
      { times: 1 },
    );
    const latePlanResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === boundaryEndpoint &&
        response.request().method() === 'GET',
    );
    const pendingPlanClick = loadPlan.click();
    try {
      await planFetched;
      await withoutWorkbenchRequests(page, async () => {
        await linkedSummary.click();
      });
      await expect(linkedDisclosure).not.toHaveAttribute('open', '');
      await toInput.fill('2025-01-04');
      await expect(valuation).toHaveCount(0);
      planRelease();
      expect((await latePlanResponse).status()).toBe(200);
      await pendingPlanClick;
      await expect(valuation).toHaveCount(0);
      await withoutWorkbenchRequests(page, async () => {
        await linkedSummary.click();
      });
      await expect(linkedDisclosure).toHaveAttribute('open', '');
      await expect(valuation).toHaveCount(0);
    } finally {
      planRelease();
      if (planHandlerStarted) await planFinished;
      await page.unroute(`**${boundaryEndpoint}**`);
    }

    await toInput.fill(to.slice(0, 10));
    const refreshedPlanResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === boundaryEndpoint &&
        response.request().method() === 'GET',
    );
    await loadPlan.click();
    expect((await refreshedPlanResponse).status()).toBe(200);
    await valuation.fill('1100');
    await review.check();
    await withoutWorkbenchRequests(page, async () => {
      await linkedSummary.click();
      await expect(linkedDisclosure).not.toHaveAttribute('open', '');
      await linkedSummary.click();
      await expect(linkedDisclosure).toHaveAttribute('open', '');
      await expect(valuation).toHaveValue('1100');
      await expect(review).toBeChecked();
      await expect(section).toContainText('Ревизия журнала: 1');
      await expect(calculate).toBeEnabled();
    });
    const availableResponse = await browserPost(page, linkedPath, () => calculate.click());
    expect(availableResponse.status()).toBe(200);
    assertLinked(await availableResponse.json(), 1);
    await expect(result).toBeVisible();
    await expect(rate).toHaveText('21');
    await expect(rate).toBeVisible();
    await expect(result.getByText('Ревизия журнала: 1', { exact: true })).toBeHidden();
    const evidence = await openPeriodEvidence(page, result);
    await expect(evidence).toContainText(coverageFrom);
    await expect(result.getByText('Ревизия журнала: 1', { exact: true })).toBeVisible();
    await expect(
      result.getByText('Прибыль, USD', { exact: true }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('310');
    await expect(result).toContainText('Ревизия журнала: 1');

    await withoutWorkbenchRequests(page, async () => {
      await linkedSummary.click();
      await expect(linkedDisclosure).not.toHaveAttribute('open', '');
      await linkedSummary.click();
      await expect(linkedDisclosure).toHaveAttribute('open', '');
      await expect(valuation).toHaveValue('1100');
      await expect(review).toBeChecked();
      await expect(result).toBeVisible();
      await expect(rate).toHaveText('21');
      await expect(evidence).toHaveAttribute('open', '');
    });
    await capturePeriodWorkbench(
      page,
      testInfo,
      'linked-review',
      [page.getByRole('region', { name: 'Ручные оценки и период', exact: true }), section, result],
      result.getByRole('region', { name: 'Таблица промежуточных оценок', exact: true }),
    );

    await withoutWorkbenchRequests(page, async () => {
      await linkedSummary.click();
    });
    await expect(linkedDisclosure).not.toHaveAttribute('open', '');
    await closingInput.fill('2311');
    await withoutWorkbenchRequests(page, async () => {
      await linkedSummary.click();
    });
    await expect(linkedDisclosure).toHaveAttribute('open', '');
    await expect(result).toBeHidden();
    await expect(review).not.toBeChecked();
    await expect(valuation).toHaveValue('1100');
    await expect(section).toContainText('Ревизия журнала: 1');
    await closingInput.fill('2310');
    await review.check();

    let postFetchedResolve: () => void = () => {};
    let postRelease: () => void = () => {};
    let postHandlerFinished: () => void = () => {};
    let postHandlerStarted = false;
    const postFetched = new Promise<void>((resolve) => {
      postFetchedResolve = resolve;
    });
    const postReleased = new Promise<void>((resolve) => {
      postRelease = resolve;
    });
    const postFinished = new Promise<void>((resolve) => {
      postHandlerFinished = resolve;
    });
    await page.route(
      `**${linkedEndpoint}`,
      async (route) => {
        postHandlerStarted = true;
        try {
          const response = await route.fetch();
          postFetchedResolve();
          await postReleased;
          await route.fulfill({ response });
        } finally {
          postHandlerFinished();
        }
      },
      { times: 1 },
    );
    const latePreviewResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === linkedEndpoint &&
        response.request().method() === 'POST',
    );
    const pendingPreviewClick = calculate.click();
    try {
      await postFetched;
      await valuation.fill('1101');
      await expect(review).not.toBeChecked();
      await expect(result).toBeHidden();
      postRelease();
      expect((await latePreviewResponse).status()).toBe(200);
      await pendingPreviewClick;
      await expect(result).toBeHidden();
    } finally {
      postRelease();
      if (postHandlerStarted) await postFinished;
      await page.unroute(`**${linkedEndpoint}`);
    }

    await valuation.fill('1100');
    await review.check();
    const recalculated = await browserPost(page, linkedPath, () => calculate.click());
    expect(recalculated.status()).toBe(200);
    await expect(result).toBeVisible();
    await expect(rate).toHaveText('21');

    await api.result(
      'POST',
      `${flowsPath}/${created.flow.flowId}/corrections`,
      201,
      flowCommand(1, '1200'),
    );
    financialBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    const stale = await browserPost(page, linkedPath, () => calculate.click());
    expect(stale.status()).toBe(409);
    await expect(result).toBeHidden();
    await expect(valuation).toHaveCount(0);
    await expect(review).not.toBeChecked();
    await expect(loadPlan).toBeVisible();

    const currentPlanResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === boundaryEndpoint &&
        response.request().method() === 'GET',
    );
    await loadPlan.click();
    expect((await currentPlanResponse).status()).toBe(200);
    await expect(
      section.getByLabel(`Оценка перед потоком ${at}, USD`, { exact: true }),
    ).toHaveValue('');
    await expect(review).not.toBeChecked();
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
    'Linked plan and preview reads preserve all financial rows',
  ).toBe(financialBefore);
  expect(providerRequests()).toEqual(providersBefore);
});
