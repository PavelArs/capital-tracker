import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { Goal, GoalInsights } from '../../frontend/src/api/goals.api';
import { moscowDay } from '../../frontend/src/features/goals/goal-format';
import { money } from '../../frontend/src/features/portfolio/format';
import { origin, test } from './mfa-fixtures';
import { forgetBrowserReads, tradeApi, tradeInput } from './usd-trades-fixtures';

test('GOAL-WIDGETS-UI: priced-subset goals load contributions and growth over real HTTPS', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const api = await tradeApi(page);
  const suffix = randomUUID().slice(0, 8);
  const account = await api.account(`GOAL-WIDGETS account ${suffix}`);
  await api.initialize(account.id);
  const cash = (await api.result('POST', '/instruments', 201, {
    requestId: randomUUID(),
    name: `Goal dollars ${suffix}`,
    symbol: 'USD',
    assetType: 'fiat',
  })) as { id: string };
  const unpriced = (await api.result('POST', '/instruments', 201, {
    requestId: randomUUID(),
    name: `Goal unpriced ${suffix}`,
    assetType: 'manual',
  })) as { id: string };
  const purchasedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
  await api.create(
    account.id,
    tradeInput(cash.id, 0, { occurredAt: purchasedAt, quantity: '1000', grossUsd: '1000' }),
  );
  await api.create(
    account.id,
    tradeInput(unpriced.id, 1, { occurredAt: purchasedAt, quantity: '1', grossUsd: '200' }),
  );
  const deadline = `${Number(moscowDay(new Date().toISOString()).slice(0, 4)) + 10}-12-01`;
  const created = await api.request.post('/api/goals', {
    headers: { Origin: origin, 'X-CSRF-Token': api.csrfToken },
    data: {
      requestId: randomUUID(),
      name: `Safety reserve ${suffix}`,
      currency: 'USD',
      targetAmount: '1000000',
      deadline,
      expectedReturnPercent: '4',
      monthlyContribution: '5000',
    },
  });
  expect(created.status()).toBe(201);
  const goal = (await created.json()) as Goal;
  expect(goal.progress.complete).toBe(false);
  expect(goal.progress.current).not.toBeNull();
  await forgetBrowserReads(page);
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === `/api/goals/${goal.id}/insights`) requests++;
  });
  const response = page.waitForResponse(
    (item) => new URL(item.url()).pathname === `/api/goals/${goal.id}/insights`,
  );
  await page.goto(`${origin}/goals/${goal.id}`);
  expect((await response).status()).toBe(200);
  const insights = (await (await response).json()) as GoalInsights;
  const contributions = page.getByRole('region', { name: 'Your contributions' });
  const growth = page.getByRole('region', { name: 'Where the growth came from' });
  await expect(contributions.getByText('Last 6 months', { exact: true })).toBeVisible();
  await expect(
    growth
      .getByText('Net worth grew by', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText(money(insights.growth.total, 'USD', true));
  await expect(growth.getByRole('img')).toBeVisible();
  await expect(
    page.getByText('Could not load contributions and growth.', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      'Estimated from priced assets only. Assets without a price or rate are excluded.',
      { exact: true },
    ),
  ).toHaveCount(1);
  expect(requests, 'The first Insights request finishes without the client timeout retry').toBe(1);
  await testInfo.attach('goal-insights-timing.json', {
    body: JSON.stringify({ responseMs: (await response).request().timing().responseEnd, requests }),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath('goal-1440-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(contributions.getByText('Last 6 months', { exact: true })).toBeVisible();
  await expect(growth.getByRole('img')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('goal-390-light.png'), fullPage: true });
  for (const variant of [
    { key: 'goal-open', targetAmount: '1000000', deadline: null },
    { key: 'goal-done', targetAmount: '1', deadline },
  ]) {
    const saved = await api.request.post('/api/goals', {
      headers: { Origin: origin, 'X-CSRF-Token': api.csrfToken },
      data: {
        requestId: randomUUID(),
        name: `${variant.key === 'goal-open' ? 'Long-term reserve' : 'First milestone'} ${suffix}`,
        currency: 'USD',
        targetAmount: variant.targetAmount,
        deadline: variant.deadline,
        expectedReturnPercent: '4',
        monthlyContribution: '5000',
      },
    });
    expect(saved.status()).toBe(201);
    const item = (await saved.json()) as Goal;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto(`${origin}/goals/${item.id}`);
    await expect(
      page
        .getByRole('region', { name: 'Your contributions' })
        .getByText('Last 6 months', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Where the growth came from' }).getByRole('img'),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`${variant.key}-1440-dark.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`${variant.key}-390-light.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
