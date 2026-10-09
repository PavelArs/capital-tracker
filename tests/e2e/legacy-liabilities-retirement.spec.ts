import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { foreignOwner, noStore, providerRequests } from './manual-opening-fixtures';
import {
  fingerprint,
  loginWithMfa,
  origin,
  owner,
  passwordStep,
  query,
  test,
} from './mfa-fixtures';

const bookmarks = ['/liabilities', '/liabilities/legacy-bookmark'];

test('LIR-UI: retired bookmarks preserve private legacy records and open Portfolio', async ({
  page,
  browser,
}) => {
  const unauthenticated = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const visitor = await unauthenticated.newPage();
    for (const state of ['anonymous', 'password-only']) {
      if (state === 'password-only') await passwordStep(visitor);
      const denied = await unauthenticated.request.get('/api/liabilities');
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
  const ownId = randomUUID();
  const foreignId = randomUUID();
  const ownName = `Synthetic preserved liability ${ownId}`;
  const foreignName = `Synthetic foreign liability ${foreignId}`;
  expect(query("SELECT count(*) FROM currencies WHERE code = 'USD'")).toBe('1');
  // Existing records in isolated PostgreSQL; authentication always uses the real app.
  query(`INSERT INTO liabilities
    (id, "userId", name, category, amount, "currencyId", date, description, frequency, deadline)
    VALUES
    ('${ownId}', '${owner.id}', '${ownName}', 'loans', 123.45678901,
      (SELECT id FROM currencies WHERE code = 'USD'), '2025-01-02', 'Preserve every field', 'monthly', '2027-01-02'),
    ('${foreignId}', '${foreignOwner}', '${foreignName}', 'mortgage', 987.65432109,
      (SELECT id FROM currencies WHERE code = 'USD'), '2025-02-03', 'Private foreign record', 'yearly', NULL)`);
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
    const main = page.getByRole('main');
    await expect(main.getByText(ownName, { exact: true })).toHaveCount(0);
    await expect(main.getByText(foreignName, { exact: true })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
  }
  expect(providerRequests()).toEqual(providersBefore);

  const list = await page.request.get('/api/liabilities');
  expect(list.status()).toBe(200);
  noStore(list);
  const liabilities = await list.json();
  expect(liabilities.map((row: { id: string }) => row.id)).toContain(ownId);
  expect(liabilities.every((row: { userId: string }) => row.userId === owner.id)).toBe(true);
  expect(liabilities.map((row: { id: string }) => row.id)).not.toContain(foreignId);
  const own = await page.request.get(`/api/liabilities/${ownId}`);
  expect(own.status()).toBe(200);
  noStore(own);
  expect(await own.json()).toMatchObject({
    id: ownId,
    userId: owner.id,
    name: ownName,
    category: 'loans',
    amount: '123.45678901',
    date: '2025-01-02',
    description: 'Preserve every field',
    frequency: 'monthly',
    deadline: '2027-01-02',
  });
  const foreign = await page.request.get(`/api/liabilities/${foreignId}`);
  expect(foreign.status()).toBe(404);
  noStore(foreign);
  expect(await foreign.text()).not.toContain(foreignName);

  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(before);
  expect(providerRequests()).toEqual(providersBefore);
});
