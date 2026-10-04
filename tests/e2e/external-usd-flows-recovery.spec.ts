import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ownerCount,
} from './admission-fixtures';
import { test } from './external-usd-flows-fixtures';
import { providerRequests, rows } from './manual-opening-fixtures';
import {
  completeFactor,
  cookie,
  fingerprint,
  hashToken,
  owner,
  query,
  recoveryFactor,
} from './mfa-fixtures';
import { browserPost, coverageFrom, trackBrowserRequests, tradeApi } from './usd-trades-fixtures';

const journalPath = '/portfolio/cash-flow-journal';
const flowsPath = '/portfolio/cash-flows';
const flowEndpoint = `/api/accounting${flowsPath}`;
const journalEndpoint = `/api/accounting${journalPath}`;
const retry = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Повторить исходную команду', exact: true });
const refresh = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Обновить состояние потоков', exact: true });

test('FLOW-004-B: accepted flow survives lost delivery, real 401/MFA and a lost current read', async ({
  page,
}) => {
  const api = await tradeApi(page);
  await api.result('POST', journalPath, 201, {
    requestId: randomUUID(),
    coverageFrom,
    assertReviewed: true,
  });
  const oldRows = fingerprint([
    'auth_sessions',
    'auth_request_limits',
    'owner_mfa_recovery',
    'portfolio_flow_journals',
    'portfolio_flow_versions',
  ]);
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const providers = providerRequests();
  const assertQuota = trackBrowserRequests(page, api);
  const commands: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === flowEndpoint)
      commands.push(request.postDataJSON());
  });
  await page.goto('/capital-flows');
  await expect(page.getByRole('heading', { name: 'Внешние денежные потоки' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Направление', exact: true })
    .selectOption('contribution');
  await page.getByLabel('Момент операции (ISO)', { exact: true }).fill('2025-01-02T00:00:00Z');
  await page.getByLabel('Сумма, USD', { exact: true }).fill('1000');
  await page.getByRole('checkbox', { name: 'Это внешний ввод или вывод USD' }).check();

  type FlowReceipt = {
    journalRevision: number;
    flow: {
      flowId: string;
      requestId: string;
      amountUsd: string;
      version: number;
    };
  };
  const delivery: { receipt?: FlowReceipt; lost: boolean } = { lost: false };
  await page.route(
    `**${flowEndpoint}`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      delivery.receipt = await response.json();
      expect(delivery.receipt).toMatchObject({
        journalRevision: 1,
        flow: { version: 1, amountUsd: '1000', requestId: expect.any(String) },
      });
      delivery.lost = true;
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
  try {
    await page.getByRole('button', { name: 'Сохранить поток', exact: true }).click();
    await expect.poll(() => delivery.lost).toBe(true);
    const receipt = delivery.receipt;
    expect(receipt).toBeDefined();
    if (!receipt) throw new Error('Accepted flow receipt was not observed');
    await expect(retry(page)).toBeEnabled();
    expect(commands).toHaveLength(1);
    const original = commands[0];
    expect(original).toEqual({
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      expectedJournalRevision: 0,
      direction: 'contribution',
      occurredAt: '2025-01-02T00:00:00Z',
      amountUsd: '1000',
      assertExternal: true,
    });
    expect(receipt.flow.requestId).toBe((original as { requestId: string }).requestId);
    await expect(page.getByRole('button', { name: 'Сохранить поток', exact: true })).toBeDisabled();
    const afterCommit = fingerprint(['auth_sessions', 'auth_request_limits']);
    const afterCommitWithoutRecovery = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa_recovery',
    ]);

    await page.getByRole('link', { name: 'Ручные счета', exact: true }).click();
    await page.getByRole('link', { name: 'Вводы и выводы', exact: true }).click();
    await expect(retry(page)).toBeEnabled();
    expect(commands).toEqual([original]);

    // Expire this real session. The original retry must receive the actual admission 401.
    const tokenHash = hashToken(await cookie(page));
    query(
      `UPDATE auth_sessions SET "expiresAt"=clock_timestamp() WHERE "tokenHash"='${tokenHash}'`,
    );
    const denied = await browserPost(page, flowsPath, () => retry(page).click());
    expect(denied.status()).toBe(401);
    expect(commands).toEqual([original, original]);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(afterCommit);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();

    const beforeLogin = fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa_recovery']);
    const recoveryBefore = rows<{ codeHash: string; usedAt: string | null }>(
      'SELECT "codeHash","usedAt" FROM owner_mfa_recovery ORDER BY "codeHash"',
    );
    await page.getByLabel('Email', { exact: true }).fill(owner.email);
    await page.getByLabel('Пароль', { exact: true }).fill(owner.password);
    const login = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/login' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Вход', exact: true }).click();
    expect((await login).status()).toBe(200);
    await completeFactor(page, recoveryFactor());
    await page.getByRole('link', { name: 'Вводы и выводы', exact: true }).click();
    await expect(retry(page)).toBeEnabled();
    expect(commands).toEqual([original, original]);

    let lostRead = 0;
    const journalPattern = `**${journalEndpoint}`;
    await page.route(journalPattern, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      lostRead++;
      await route.abort('connectionreset');
    });
    try {
      const replay = await browserPost(page, flowsPath, () => retry(page).click());
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toEqual(receipt);
      expect(commands).toEqual([original, original, original]);
      await expect.poll(() => lostRead).toBe(1);
      await expect(retry(page)).toHaveCount(0);
      await expect(
        page.getByRole('status').filter({
          hasText: `Принятая команда: Создание потока ${receipt.flow.flowId}`,
        }),
      ).toBeVisible();
      await expect(
        page.getByText('Команда принята, но актуальный журнал ещё не подтверждён.'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Сохранить поток', exact: true })).toHaveCount(
        0,
      );
      expect(fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa_recovery'])).toBe(
        beforeLogin,
      );
      expect(fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa_recovery'])).toBe(
        afterCommitWithoutRecovery,
      );
    } finally {
      await page.unroute(journalPattern);
    }

    const updated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === journalEndpoint &&
        response.request().method() === 'GET',
    );
    await refresh(page).click();
    expect((await updated).status()).toBe(200);
    await expect(
      page.getByText('Команда принята, но актуальный журнал ещё не подтверждён.'),
    ).toHaveCount(0);
    await expect(retry(page)).toHaveCount(0);
    expect(commands).toHaveLength(3);
    expect(fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa_recovery'])).toBe(
      afterCommitWithoutRecovery,
    );
    expect(oldRows).toBe(
      fingerprint([
        'auth_sessions',
        'auth_request_limits',
        'owner_mfa_recovery',
        'portfolio_flow_journals',
        'portfolio_flow_versions',
      ]),
    );
    expect(
      query(`SELECT count(*) FROM portfolio_flow_versions WHERE "ownerId"='${owner.id}'
        AND "requestId"='${(original as { requestId: string }).requestId}'`),
    ).toBe('1');
    expect(
      query(`SELECT count(*) FROM portfolio_flow_versions WHERE "ownerId"='${owner.id}'
        AND "flowId"='${receipt.flow.flowId}'`),
    ).toBe('1');
    const recoveryAfter = rows<{ codeHash: string; usedAt: string | null }>(
      'SELECT "codeHash","usedAt" FROM owner_mfa_recovery ORDER BY "codeHash"',
    );
    expect(recoveryAfter.map((row) => row.codeHash)).toEqual(
      recoveryBefore.map((row) => row.codeHash),
    );
    const consumed = recoveryAfter.filter(
      (row, index) => row.usedAt !== recoveryBefore[index].usedAt,
    );
    expect(consumed).toHaveLength(1);
    expect(recoveryBefore.find((row) => row.codeHash === consumed[0].codeHash)?.usedAt).toBeNull();
    expect(consumed[0].usedAt).not.toBeNull();
    expectAdmissionDelta(admissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
      { scope: 'login-ip', subject: await hostSubject(), hits: 1 },
      { scope: 'mfa-ip', subject: await hostSubject(), hits: 1 },
      ownerCount(1),
    ]);
  } finally {
    await page.unroute(`**${flowEndpoint}`);
    expect(providerRequests()).toEqual(providers);
    assertQuota();
  }
});
