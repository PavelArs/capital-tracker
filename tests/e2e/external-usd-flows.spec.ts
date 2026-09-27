import { randomUUID } from 'node:crypto';
import { type Locator, type Request, expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ledgerState,
} from './admission-fixtures';
import { test } from './external-usd-flows-fixtures';
import { providerRequests } from './manual-opening-fixtures';
import { fingerprint } from './mfa-fixtures';
import {
  browserPost,
  coverageFrom,
  trackBrowserRequests,
  tradeApi,
  tradeInput,
} from './usd-trades-fixtures';

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

test('FLOW-004-A: real Russian owner explicitly initializes, records, corrects and reviews a contribution', async ({
  page,
}, testInfo) => {
  const api = await tradeApi(page);
  const account = await api.account(`External-flow UI trade ${randomUUID()}`);
  const instrument = await api.instrument(`External-flow UI token ${randomUUID()}`, 'FLOW');
  await api.initialize(account.id);
  await api.create(
    account.id,
    tradeInput(instrument.id, 0, {
      occurredAt: '2025-01-02T12:00:00.000Z',
      quantity: '1',
      grossUsd: '100',
    }),
  );

  const priorFinancialRows = oldFinancialFingerprint();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const priorProviders = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);

  try {
    await page.goto('/capital-flows');
    await expect(
      page.getByRole('heading', { name: 'Внешние денежные потоки', exact: true }),
    ).toBeVisible();

    const rulesSummary = page.getByText('Правила учёта потоков', { exact: true });
    const rules = rulesSummary.locator('..');
    await expect(rulesSummary).toBeVisible();
    expect(await rulesSummary.evaluate((node) => node.tagName)).toBe('SUMMARY');
    expect(await rules.evaluate((node) => node.tagName)).toBe('DETAILS');
    await expect(rules).not.toHaveAttribute('open', '');
    await expect(page.getByText(/объявленные.*USD|USD.*объявленные/)).toBeVisible();
    await expect(page.getByText(/не сверены|не сверено/)).toBeVisible();
    await rulesSummary.focus();
    await page.keyboard.press('Enter');
    await expect(rules).toHaveAttribute('open', '');
    await expect(rules).toContainText(/покупки.*продажи/i);
    await expect(rules).toContainText(/своими счетами|собственными счетами/i);
    await expect(rules).toContainText(/остатки.*награды.*комиссии/i);
    await expect(rules).toContainText(/памят.*вкладк|вкладк.*памят/i);
    await expect(rules).toContainText(/перезагруз.*очища|очища.*перезагруз/i);
    await page.keyboard.press('Space');
    await expect(rules).not.toHaveAttribute('open', '');

    const coverage = page.getByLabel('Граница учёта потоков (ISO)', { exact: true });
    await expect(coverage).toHaveAccessibleDescription(/UTC|часов.*пояс|смещени/i);
    const periodStart = page.getByLabel('Начало периода (ISO, включительно)', { exact: true });
    const periodEnd = page.getByLabel('Конец периода (ISO, не включительно)', { exact: true });

    const checkPresentation = async (phase: 'initialization' | 'recorded') => {
      const rowsBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
      const providersBefore = providerRequests();
      const viewport = page.viewportSize();
      const originalTheme = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      );
      const capture = async (target: Locator, name: string, firstOnly = false) => {
        const bounds = await target.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return { top: box.top + window.scrollY, height: box.height };
        });
        const segments = firstOnly ? 1 : Math.ceil(bounds.height / 900);
        for (let index = 0; index < segments; index++) {
          const offset = Math.min(index * 900, Math.max(0, bounds.height - 900));
          await page.evaluate(
            (top) => window.scrollTo(0, Math.max(0, top - 16)),
            bounds.top + offset,
          );
          await expect(
            page.getByRole('link', { name: 'К содержимому', exact: true }),
          ).not.toBeInViewport();
          await testInfo.attach(`${name}-${index + 1}`, {
            body: await page.screenshot({
              path: testInfo.outputPath(`${name}-${index + 1}.png`),
              animations: 'disabled',
              fullPage: false,
            }),
            contentType: 'image/png',
          });
        }
      };
      try {
        for (const theme of ['light', 'dark']) {
          await page.evaluate(
            (value) => document.documentElement.setAttribute('data-theme', value),
            theme,
          );
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          for (const width of [360, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            await expect
              .poll(() =>
                page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
              )
              .toBe(true);
            const controls = await page
              .locator(
                '.flow-page input:not([type="checkbox"]), .flow-page select, .flow-page button, .flow-page summary',
              )
              .evaluateAll((nodes) =>
                nodes
                  .filter((node) => node.getClientRects().length > 0)
                  .map((node) => ({
                    label: node.textContent || node.getAttribute('aria-label') || node.tagName,
                    height: node.getBoundingClientRect().height,
                  })),
              );
            expect(controls.length).toBeGreaterThan(0);
            for (const control of controls)
              expect(control.height, control.label).toBeGreaterThanOrEqual(44);
            if (phase === 'recorded' && width === 360) {
              for (const name of ['Таблица потоков', 'Таблица версий потока']) {
                const region = page.getByRole('region', { name, exact: true });
                await expect(region).toHaveAttribute('tabindex', '0');
                expect(await region.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(
                  true,
                );
                await region.evaluate((node) => {
                  node.scrollLeft = 0;
                });
                await region.focus();
                await page.keyboard.press('ArrowRight');
                await expect
                  .poll(() => region.evaluate((node) => node.scrollLeft))
                  .toBeGreaterThan(0);
                await region.evaluate((node) => {
                  node.scrollLeft = 0;
                });
              }
            }
            if (phase === 'initialization') {
              await capture(page.locator('.flow-page'), `flow-${phase}-${theme}-${width}`, true);
            } else {
              for (const name of ['Команда потока', 'Потоки за период', 'Версии потока']) {
                await capture(
                  page.getByRole('region', { name, exact: true }),
                  `flow-${phase}-${name}-${theme}-${width}`,
                );
              }
            }
          }
        }
      } finally {
        await page.evaluate((value) => {
          if (value === null) document.documentElement.removeAttribute('data-theme');
          else document.documentElement.setAttribute('data-theme', value);
        }, originalTheme);
        if (viewport) await page.setViewportSize(viewport);
      }
      expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(rowsBefore);
      expect(providerRequests()).toEqual(providersBefore);
    };
    await checkPresentation('initialization');

    await coverage.fill(coverageFrom);
    const coverageReview = page.getByRole('checkbox', {
      name: 'Я проверил границу учёта',
      exact: true,
    });
    const initialize = page.getByRole('button', {
      name: 'Начать учёт потоков',
      exact: true,
    });
    await expect(coverageReview).not.toBeChecked();
    await expect(initialize).toBeDisabled();
    await coverageReview.check();
    await expect(initialize).toBeEnabled();
    const originResponse = await browserPost(page, '/portfolio/cash-flow-journal', () =>
      initialize.click(),
    );
    expect(originResponse.status()).toBe(201);
    expect(await originResponse.json()).toMatchObject({
      requestId: expect.any(String),
      coverageFrom,
      createdAt: expect.any(String),
    });

    await expect(periodStart).toHaveAccessibleDescription(/включ|\[from,\s*to\)/i);
    await expect(periodEnd).toHaveAccessibleDescription(/не включ|исключ|\[from,\s*to\)/i);

    const direction = page.getByRole('combobox', { name: 'Направление', exact: true });
    await direction.selectOption({ label: 'Ввод' });
    await page.getByLabel('Момент операции (ISO)', { exact: true }).fill('2025-01-02T00:00:00Z');
    const amount = page.getByLabel('Сумма, USD', { exact: true });
    await expect(
      page.getByLabel('Момент операции (ISO)', { exact: true }),
    ).toHaveAccessibleDescription(/UTC|часов.*пояс|смещени/i);
    await expect(amount).toHaveAccessibleDescription(/положительн|больше нуля|>\s*0/i);
    await expect(amount).toHaveAccessibleDescription(/USD/);
    await amount.fill('1000');
    const externalReview = page.getByRole('checkbox', {
      name: 'Это внешний ввод или вывод USD',
      exact: true,
    });
    const save = page.getByRole('button', { name: 'Сохранить поток', exact: true });
    await expect(externalReview).not.toBeChecked();
    await expect(save).toBeDisabled();
    await externalReview.check();
    await expect(save).toBeEnabled();
    const createResponse = await browserPost(page, '/portfolio/cash-flows', () => save.click());
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as FlowReceipt;
    expect(created.flow).toMatchObject({
      version: 1,
      kind: 'create',
      direction: 'contribution',
      occurredAt: '2025-01-02T00:00:00.000Z',
      amountUsd: '1000',
    });

    await page.getByLabel('Начало периода (ISO, включительно)', { exact: true }).fill(dateFrom);
    await page.getByLabel('Конец периода (ISO, не включительно)', { exact: true }).fill(dateTo);
    const periodPath = '/api/accounting/portfolio/cash-flows';
    const firstRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === periodPath && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Показать потоки', exact: true }).click();
    const firstReadResponse = await firstRead;
    expect(firstReadResponse.status()).toBe(200);
    expect(await firstReadResponse.json()).toMatchObject({
      summary: {
        contributionsUsd: '1000',
        withdrawalsUsd: '0',
        netContributionsUsd: '1000',
        flowCount: 1,
      },
      completeness: 'unreconciled',
    });
    const periodTable = page.getByRole('table', {
      name: 'Записанные потоки за период',
      exact: true,
    });
    const row = periodTable.getByRole('row').filter({ hasText: created.flow.flowId });
    const identity = row.getByText('Идентификатор потока', { exact: true });
    const identityDisclosure = identity.locator('..');
    expect(await identity.evaluate((node) => node.tagName)).toBe('SUMMARY');
    expect(await identityDisclosure.evaluate((node) => node.tagName)).toBe('DETAILS');
    const exactId = identityDisclosure.locator('code');
    await expect(exactId).toBeHidden();
    await identity.focus();
    await page.keyboard.press('Enter');
    await expect(exactId).toBeVisible();
    await expect(exactId).toHaveText(created.flow.flowId);
    await page.keyboard.press('Space');
    await expect(exactId).toBeHidden();
    await expect(page.getByText('1000', { exact: true })).toBeVisible();

    const correctAction = row.getByRole('button', { name: 'Исправить', exact: true });
    const voidAction = row.getByRole('button', { name: 'Аннулировать', exact: true });
    const selectionRows = fingerprint(['auth_sessions', 'auth_request_limits']);
    const selectionWrites: string[] = [];
    const recordSelectionWrite = (request: Request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname.startsWith('/api/accounting/portfolio/cash-flow')
      )
        selectionWrites.push(request.url());
    };
    page.on('request', recordSelectionWrite);
    try {
      await correctAction.click();
      await expect(
        page.getByRole('heading', { name: 'Исправление потока', exact: true }),
      ).toBeFocused();
      await expect(amount).toHaveValue('1000');
      await page.getByRole('button', { name: 'Отменить исправление', exact: true }).click();
      await expect(correctAction).toBeFocused();
      await voidAction.click();
      await expect(
        page.getByRole('heading', { name: 'Аннулирование потока', exact: true }),
      ).toBeFocused();
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
      await expect(voidAction).toBeFocused();
      expect(selectionWrites).toEqual([]);
      expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(selectionRows);
    } finally {
      page.off('request', recordSelectionWrite);
    }
    await correctAction.click();
    await expect(
      page.getByRole('heading', { name: 'Исправление потока', exact: true }),
    ).toBeFocused();
    await amount.fill('1200');
    await expect(externalReview).toBeChecked();
    const correctionResponse = await browserPost(
      page,
      `/portfolio/cash-flows/${created.flow.flowId}/corrections`,
      () => save.click(),
    );
    expect(correctionResponse.status()).toBe(201);
    expect(await correctionResponse.json()).toMatchObject({
      journalRevision: 2,
      flow: {
        flowId: created.flow.flowId,
        version: 2,
        kind: 'correct',
        amountUsd: '1200',
      },
    });

    const secondRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === periodPath && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Показать потоки', exact: true }).click();
    const secondReadResponse = await secondRead;
    expect(secondReadResponse.status()).toBe(200);
    expect(await secondReadResponse.json()).toMatchObject({
      journalRevision: 2,
      summary: {
        contributionsUsd: '1200',
        withdrawalsUsd: '0',
        netContributionsUsd: '1200',
        flowCount: 1,
      },
    });
    await expect(page.getByText('1200', { exact: true })).toBeVisible();

    const versionsPath = `${periodPath}/${created.flow.flowId}/versions`;
    const versionsResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === versionsPath && response.request().method() === 'GET',
    );
    await page
      .getByRole('row')
      .filter({ hasText: created.flow.flowId })
      .getByRole('button', { name: 'Версии', exact: true })
      .click();
    const versionsResponse = await versionsResponsePromise;
    expect(versionsResponse.status()).toBe(200);
    expect(await versionsResponse.json()).toMatchObject({
      flowId: created.flow.flowId,
      items: [
        { version: 2, kind: 'correct', amountUsd: '1200' },
        { version: 1, kind: 'create', amountUsd: '1000' },
      ],
    });
    await expect(page.getByRole('heading', { name: 'Версии потока', exact: true })).toBeFocused();
    await expect(
      page.getByRole('table', { name: 'Неизменяемые версии потока', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('1000', { exact: true })).toBeVisible();
    await correctAction.click();
    await amount.fill('1300');
    await checkPresentation('recorded');
    const closeRows = fingerprint(['auth_sessions', 'auth_request_limits']);
    page.on('request', recordSelectionWrite);
    try {
      await page.getByRole('button', { name: 'Закрыть версии', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Версии потока', exact: true })).toHaveCount(0);
      await expect(row.getByRole('button', { name: 'Версии', exact: true })).toBeFocused();
      expect(selectionWrites).toEqual([]);
      expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(closeRows);
    } finally {
      page.off('request', recordSelectionWrite);
    }
    expect(page.url()).toContain('/capital-flows');

    // Keep an unsaved correction while a real completed read is delivered late.
    await row.getByRole('button', { name: 'Исправить', exact: true }).click();
    await amount.fill('1300');
    let releaseRead: () => void = () => {};
    let readFetched = false;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const pattern = `**${periodPath}?*`;
    await page.route(
      pattern,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect((await response.json()).summary.contributionsUsd).toBe('1200');
        readFetched = true;
        await readGate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    try {
      await page.getByRole('button', { name: 'Показать потоки', exact: true }).click();
      await expect.poll(() => readFetched).toBe(true);
      await page
        .getByLabel('Конец периода (ISO, не включительно)', { exact: true })
        .fill('2025-01-06T00:00:00.000Z');
      const delivered = page.waitForResponse(
        (response) => new URL(response.url()).pathname === periodPath,
      );
      releaseRead();
      await delivered;
      await expect(page.getByText('Количество потоков: 1', { exact: true })).toHaveCount(0);
      await expect(amount).toHaveValue('1300');
      await expect(periodEnd).toBeFocused();
    } finally {
      releaseRead();
      await page.unroute(pattern);
    }

    // Only browser pagination/intent belongs here; arithmetic permutations are below E2E.
    for (let revision = 2; revision < 52; revision++) {
      await api.result(
        'POST',
        '/portfolio/cash-flows',
        201,
        flowCommand(revision, 'contribution', '2025-01-03T00:00:00.000Z', '1'),
      );
    }
    const refresh = page.getByRole('button', { name: 'Обновить состояние потоков', exact: true });
    await refresh.click();
    await expect(save).toBeEnabled();
    const periodRead = page.waitForResponse(
      (response) => new URL(response.url()).pathname === periodPath,
    );
    await page.getByRole('button', { name: 'Показать потоки', exact: true }).click();
    expect(await (await periodRead).json()).toMatchObject({
      journalRevision: 52,
      summary: { contributionsUsd: '1250', flowCount: 51 },
      nextOffset: 50,
    });
    const next = page.getByRole('button', { name: 'Следующая страница', exact: true });
    await expect(next).toBeVisible();
    await api.result(
      'POST',
      '/portfolio/cash-flows',
      201,
      flowCommand(52, 'withdrawal', '2025-01-04T00:00:00.000Z', '2'),
    );
    const staleRead = page.waitForResponse(
      (response) => new URL(response.url()).pathname === periodPath,
    );
    await next.click();
    const stale = await staleRead;
    expect(new URL(stale.url()).searchParams.get('journalRevision')).toBe('52');
    expect(stale.status()).toBe(409);
    await expect(next).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Журнал изменился' })).toBeVisible();
    await expect(amount).toHaveValue('1300');
    await expect(save).toBeDisabled();
    await refresh.click();
    await expect(save).toBeEnabled();
    const currentRead = page.waitForResponse(
      (response) => new URL(response.url()).pathname === periodPath,
    );
    await page.getByRole('button', { name: 'Показать потоки', exact: true }).click();
    expect(await (await currentRead).json()).toMatchObject({
      journalRevision: 53,
      summary: {
        contributionsUsd: '1250',
        withdrawalsUsd: '2',
        netContributionsUsd: '1248',
        flowCount: 52,
      },
    });
    const continuation = page.waitForResponse(
      (response) => new URL(response.url()).pathname === periodPath,
    );
    await next.click();
    const last = await continuation;
    expect(last.status()).toBe(200);
    expect(await last.json()).toMatchObject({ journalRevision: 53, nextOffset: null });
    await expect(
      page
        .getByRole('row')
        .filter({ has: page.getByRole('button', { name: 'Исправить', exact: true }) }),
    ).toHaveCount(52);
    await expect(amount).toHaveValue('1300');

    // A newly selected flow must never be labelled with another flow's old versions.
    const oldHistory = page.waitForResponse(
      (response) => new URL(response.url()).pathname === versionsPath,
    );
    await row.getByRole('button', { name: 'Версии', exact: true }).click();
    expect((await oldHistory).status()).toBe(200);
    const historyPanel = page.getByRole('region', { name: 'Версии потока', exact: true });
    await expect(historyPanel.getByRole('cell', { name: '1000', exact: true })).toBeVisible();
    const other = page
      .getByRole('row')
      .filter({ hasNotText: created.flow.flowId })
      .filter({ has: page.getByRole('button', { name: 'Версии', exact: true }) })
      .first();
    await other.getByText('Идентификатор потока', { exact: true }).click();
    const otherId = await other.locator('details code').innerText();
    expect(otherId).toMatch(/^[a-f0-9-]{36}$/);
    let releaseHistory: () => void = () => {};
    let historyFetched = false;
    const historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    let historyDelivered: () => void = () => {};
    const historyDone = new Promise<void>((resolve) => {
      historyDelivered = resolve;
    });
    const historyPattern = `**${periodPath}/${otherId}/versions*`;
    await page.route(historyPattern, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ flowId: otherId, items: [{ amountUsd: '1' }] });
      historyFetched = true;
      await historyGate;
      try {
        await route.fulfill({ response });
      } finally {
        historyDelivered();
      }
    });
    try {
      await other.getByRole('button', { name: 'Версии', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Версии потока', exact: true })).toBeFocused();
      await expect.poll(() => historyFetched).toBe(true);
      await amount.focus();
      await expect(historyPanel.getByRole('cell', { name: '1000', exact: true })).toHaveCount(0);
      const nextHistory = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `${periodPath}/${otherId}/versions`,
      );
      releaseHistory();
      await nextHistory;
      await expect(historyPanel.getByRole('cell', { name: '1', exact: true })).toHaveCount(2);
      await expect(amount).toHaveValue('1300');
      await expect(amount).toBeFocused();
      const closeHistoryRows = fingerprint(['auth_sessions', 'auth_request_limits']);
      page.on('request', recordSelectionWrite);
      try {
        await page.getByRole('button', { name: 'Закрыть версии', exact: true }).click();
        await expect(historyPanel).toHaveCount(0);
        await expect(other.getByRole('button', { name: 'Версии', exact: true })).toBeFocused();
        expect(selectionWrites).toEqual([]);
        expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(closeHistoryRows);
      } finally {
        page.off('request', recordSelectionWrite);
      }
    } finally {
      releaseHistory();
      await historyDone;
      await page.unroute(historyPattern);
    }

    // Closing a panel invalidates an actual read that has completed on the backend.
    let releaseClosedHistory: () => void = () => {};
    let closedHistoryFetched = false;
    const closedHistoryGate = new Promise<void>((resolve) => {
      releaseClosedHistory = resolve;
    });
    let closedHistoryDelivered: () => void = () => {};
    const closedHistoryDone = new Promise<void>((resolve) => {
      closedHistoryDelivered = resolve;
    });
    await page.route(
      historyPattern,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({
          flowId: otherId,
          items: [{ amountUsd: '1' }],
        });
        closedHistoryFetched = true;
        await closedHistoryGate;
        try {
          await route.fulfill({ response });
        } finally {
          closedHistoryDelivered();
        }
      },
      { times: 1 },
    );
    const pendingCloseRows = fingerprint(['auth_sessions', 'auth_request_limits']);
    page.on('request', recordSelectionWrite);
    try {
      const versionsAction = other.getByRole('button', { name: 'Версии', exact: true });
      await versionsAction.click();
      await expect(page.getByRole('heading', { name: 'Версии потока', exact: true })).toBeFocused();
      await expect.poll(() => closedHistoryFetched).toBe(true);
      await page.getByRole('button', { name: 'Закрыть версии', exact: true }).click();
      await expect(versionsAction).toBeFocused();
      const closedDelivery = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `${periodPath}/${otherId}/versions`,
      );
      releaseClosedHistory();
      await closedDelivery;
      await expect(historyPanel).toHaveCount(0);
      await expect(versionsAction).toBeFocused();
      await expect(amount).toHaveValue('1300');
      expect(selectionWrites).toEqual([]);
      expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(pendingCloseRows);
    } finally {
      releaseClosedHistory();
      await closedHistoryDone;
      await page.unroute(historyPattern);
      page.off('request', recordSelectionWrite);
    }
  } finally {
    expect(oldFinancialFingerprint(), 'Flow UI preserves every prior financial row').toBe(
      priorFinancialRows,
    );
    expectAdmissionDelta(admissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
    ]);
    expect(providerRequests(), 'External flow review makes no provider requests').toEqual(
      priorProviders,
    );
    assertQuota();
  }
});
