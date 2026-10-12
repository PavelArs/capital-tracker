import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { noStore, providerRequests } from './manual-opening-fixtures';
import { fingerprint, loginWithMfa, origin, passwordStep, test } from './mfa-fixtures';

const bookmarks = ['/liabilities', '/liabilities/legacy-bookmark'];

test('LIR-UI: retired bookmarks open Portfolio and the legacy API is gone', async ({
  page,
  browser,
}) => {
  const unauthenticated = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const visitor = await unauthenticated.newPage();
    for (const state of ['anonymous', 'password-only']) {
      if (state === 'password-only') await passwordStep(visitor);
      const denied = await unauthenticated.request.get('/api/export/backup');
      expect(denied.status(), state).toBe(401);
      noStore(denied);
      for (const path of bookmarks) {
        await visitor.goto(path);
        await expect(visitor).toHaveURL(`${origin}/login`);
        await expect(visitor.getByRole('navigation')).toHaveCount(0);
        await expect(
          visitor.getByRole('heading', { name: 'Раздел обязательств закрыт' }),
        ).toHaveCount(0);
      }
    }
  } finally {
    await unauthenticated.close();
  }

  await loginWithMfa(page);
  const before = fingerprint(['auth_sessions', 'auth_request_limits']);
  const providersBefore = providerRequests();

  for (const path of bookmarks) {
    // The legacy notice is retired with the other old screens (M20): Portfolio replaces it.
    await page.goto(path);
    await expect(page).toHaveURL(`${origin}/portfolio`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Portfolio', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('navigation').locator('a[href^="/liabilities"]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
  }
  expect(providerRequests()).toEqual(providersBefore);

  // The legacy API is retired (M20) and its table is dropped.
  for (const path of ['/api/liabilities', `/api/liabilities/${randomUUID()}`]) {
    const gone = await page.request.get(path);
    expect(gone.status(), path).toBe(404);
  }

  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(before);
  expect(providerRequests()).toEqual(providersBefore);
});
