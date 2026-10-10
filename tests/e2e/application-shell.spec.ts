import { randomUUID } from 'node:crypto';
import { type Page, expect } from '@playwright/test';
import { nextFactor, origin, owner, passwordStep, test } from './mfa-fixtures';

async function fitsViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

test('SHELL-UI: real owner login, responsive keyboard navigation, older screens reached from Settings and logout', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('/manual-accounts');
  await expect(page).toHaveURL(`${origin}/login`);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect((await page.request.get('/api/accounting/accounts')).status()).toBe(401);
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('login-360.png'), fullPage: true });

  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-synthetic-password');
  const refusedLogin = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await refusedLogin).status()).toBe(401);
  await expect(page.getByRole('alert')).toBeVisible();
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('login-error-360.png'), fullPage: true });

  await passwordStep(page);
  expect((await page.request.get('/api/accounting/accounts')).status()).toBe(401);
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('mfa-360.png'), fullPage: true });
  await page.getByRole('button', { name: 'Use a recovery code instead', exact: true }).click();
  await expect(page.getByLabel('Recovery code', { exact: true })).toBeVisible();
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('recovery-360.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to authenticator code', exact: true }).click();
  const factor = nextFactor();
  expect(factor.kind).toBe('totp');
  await page.getByLabel('Code from your authenticator app', { exact: true }).fill(factor.code);
  const pendingFactor = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/mfa' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  const factorResponse = await pendingFactor;
  expect(factorResponse.status()).toBe(200);
  expect((await factorResponse.json()).user.email).toBe(owner.email);
  // Genuine predecessor RED: before add-app-shell a successful login opened /manual-accounts.
  await expect(page).toHaveURL(`${origin}/dashboard`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true }),
  ).toBeVisible();
  // record-portfolio-snapshots: the dashboard shows net worth instead of a placeholder, or
  // the empty state while the owner has recorded nothing (other cases share the database).
  const start = (await (await page.request.get('/api/accounting/portfolio/history')).json()) as {
    value: string | null;
    invested: string | null;
    complete: boolean;
    points: { value: string | null }[];
  };
  const zero = (value: string | null) => value !== null && Number(value) === 0;
  const nothing =
    start.complete &&
    zero(start.value) &&
    zero(start.invested) &&
    start.points.every((point) => point.value === null || zero(point.value));
  await expect(
    page.getByRole('region', { name: nothing ? 'Your portfolio is empty' : 'Net worth' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: nothing ? 'Net worth' : 'Your portfolio is empty' }),
  ).toHaveCount(0);
  await expect(page.getByRole('main').getByText(/not built yet/i)).toHaveCount(0);
  expect((await page.request.get('/api/accounting/accounts')).status()).toBe(200);

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  // The sections are always on screen; there is no menu button on any width (M31).
  const menuButton = page.getByRole('button', { name: 'Menu', exact: true });
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/')) apiRequests.push(`${request.method()} ${pathname}`);
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(menuButton).toHaveCount(0);
  const sections = [
    ['Dashboard', '/dashboard'],
    ['Portfolio', '/portfolio'],
    ['Transactions', '/transactions'],
    ['Wallets', '/wallets'],
    ['Settings', '/preferences'],
  ] as const;
  for (const [index, [name, path]] of sections.entries()) {
    await expect(nav.getByRole('link').nth(index)).toHaveAttribute('href', path);
    // CLS-COUNT: Transactions may carry the number of blockchain transactions to classify.
    await expect(nav.getByRole('link').nth(index)).toHaveText(
      name === 'Transactions' ? /^Transactions(\d+)?$/ : name,
    );
  }
  // SYNC-STATUS: the sidebar reads the background sync state and opens Wallets.
  const syncStatus = nav.locator('[data-sync-status]');
  await expect(syncStatus).toHaveAttribute('href', '/wallets');
  await expect(syncStatus).not.toContainText('Checking sync');
  await expect(syncStatus).not.toContainText('Sync status unavailable');
  await expect(nav.getByText(owner.email, { exact: true })).toBeVisible();

  // WAL-LIST: Wallets is a real page that reads the owner's wallets, no longer a placeholder.
  await nav.getByRole('link', { name: 'Wallets', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/wallets`);
  await expect(nav.getByRole('link', { name: 'Wallets', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const wallets = page.getByRole('main');
  await expect(
    wallets.getByRole('heading', { level: 1, name: 'Wallets', exact: true }),
  ).toBeVisible();
  await expect(
    wallets.getByRole('button', { name: 'Add wallet', exact: true }).first(),
  ).toBeVisible();
  await expect(wallets.getByText(/not built yet/i)).toHaveCount(0);
  await expect(wallets.getByText(/your portfolio is empty/i)).toHaveCount(0);
  await expect.poll(() => apiRequests).toContain('GET /api/wallet-addresses');
  // Opening the page only reads.
  expect(apiRequests.filter((request) => !request.startsWith('GET '))).toEqual([]);
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('wallets-1440-light.png'), fullPage: true });

  // AST-UI: Portfolio lists real assets with their classification and adds one.
  await nav.getByRole('link', { name: 'Portfolio', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/portfolio`);
  await expect(nav.getByRole('link', { name: 'Portfolio', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const portfolio = page.getByRole('main');
  await expect(
    portfolio.getByRole('heading', { level: 1, name: 'Portfolio', exact: true }),
  ).toBeVisible();
  await expect(portfolio.getByText(/not built yet/i)).toHaveCount(0);
  await portfolio.getByRole('button', { name: 'Add asset', exact: true }).first().click();
  const addAsset = page.getByRole('dialog', { name: 'Add asset' });
  // A coin may start without a balance whatever accounts the shared database holds.
  const depositName = `SHELL-UI coin ${randomUUID()}`;
  await addAsset.getByRole('radio', { name: 'Cryptocurrency', exact: true }).check();
  await addAsset.getByLabel('Name', { exact: true }).fill(depositName);
  await addAsset.getByLabel('Ticker', { exact: true }).fill('shui');
  const assetCreated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/accounting/instruments' &&
      response.request().method() === 'POST',
  );
  await addAsset.getByRole('button', { name: 'Add asset', exact: true }).click();
  const assetResponse = await assetCreated;
  expect(assetResponse.status()).toBe(201);
  expect(await assetResponse.json()).toMatchObject({
    name: depositName,
    symbol: 'SHUI',
    assetType: 'crypto',
    valuationCurrency: 'USD',
    priceSource: 'manual',
  });
  await expect(addAsset).toHaveCount(0);
  // The asset cell carries the type and value currency; a coin outside the market catalog
  // never bought shows amount 0 and no price yet (portfolio-valuation PV-5).
  const depositCells = portfolio
    .getByRole('row', { name: new RegExp(`^${depositName}`) })
    .getByRole('cell');
  await expect(depositCells.nth(0)).toHaveText(`${depositName}SHUI · Crypto · USD`);
  await expect(depositCells.nth(1)).toHaveText('0');
  await expect(depositCells.nth(2)).toHaveText('No priceManual');
  await page.reload();
  await expect(depositCells.nth(0)).toHaveText(`${depositName}SHUI · Crypto · USD`);
  await expect(depositCells.nth(2)).toHaveText('No priceManual');
  const chips = portfolio.getByRole('group', { name: 'Filter assets' });
  await chips.getByRole('button', { name: /^Crypto/ }).click();
  await expect(chips.getByRole('button', { name: /^Crypto/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(portfolio.getByRole('row', { name: new RegExp(`^${depositName}`) })).toBeVisible();
  for (const other of ['Manual', 'Cash']) {
    await expect(
      portfolio
        .locator('.portfolio-asset__ticker')
        .filter({ hasText: new RegExp(`^(.+ · )?${other} · `) }),
    ).toHaveCount(0);
  }
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('portfolio-1440-light.png'), fullPage: true });

  // G1: no Legacy group in the sidebar; the screens no new section covers yet are reached from
  // Settings, which stays the current section while one of them is open.
  await expect(nav.getByText('Legacy', { exact: true })).toHaveCount(0);
  await expect(nav.locator('a[href^="/manual-"]')).toHaveCount(0);
  const openOlder = async (name: string) => {
    await nav.getByRole('link', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('region', { name: 'Older screens' })
      .getByRole('link', { name, exact: true })
      .click();
  };
  await nav.getByRole('link', { name: 'Settings', exact: true }).click();
  const older = page.getByRole('region', { name: 'Older screens' });
  await expect(older.getByRole('link')).toHaveCount(2);
  for (const [name, path] of [
    ['Open manual accounts', '/manual-accounts'],
    ['Open manual prices', '/manual-prices'],
  ] as const) {
    await expect(older.getByRole('link', { name, exact: true })).toHaveAttribute('href', path);
  }
  await expect(nav.locator('a[href^="/liabilities"]')).toHaveCount(0);

  await older.getByRole('link', { name: 'Open manual accounts', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/manual-accounts`);
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: 'Ручные счета', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Новый счет', exact: true }).click();
  await page.getByLabel('Название счета', { exact: true }).fill('Основной счет');
  const accountCreated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/accounting/accounts' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Создать счет', exact: true }).click();
  const createdResponse = await accountCreated;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  await page.goto('/');
  await expect(page).toHaveURL(`${origin}/dashboard`);
  await openOlder('Open manual accounts');
  await expect(page.locator(`a[href="/manual-accounts/${created.id}"]`)).toContainText(
    'Основной счет',
  );

  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(menuButton).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
    const accountLink = nav.getByRole('link', { name: 'Settings', exact: true });
    await expect(accountLink).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    // The strip scrolls the current section into view instead of hiding it behind a menu.
    const strip = await nav.locator('#application-menu').boundingBox();
    await expect
      .poll(async () => {
        const link = await accountLink.boundingBox();
        return (
          !!strip &&
          !!link &&
          link.x >= strip.x - 1 &&
          link.x + link.width <= strip.x + strip.width + 1
        );
      })
      .toBe(true);
    await fitsViewport(page);
    await page.screenshot({ path: testInfo.outputPath(`menu-${width}.png`), fullPage: true });
    await openOlder('Open manual prices');
    await expect(page).toHaveURL(`${origin}/manual-prices`);
    await openOlder('Open manual accounts');
    await expect(page).toHaveURL(`${origin}/manual-accounts`);
    await fitsViewport(page);
  }

  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(menuButton).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await fitsViewport(page);
  }
  const skip = page.getByRole('link', { name: 'Skip to content', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  // LEGACY-RETIRE: a bookmark of a retired screen opens the section that replaced it.
  for (const [retired, replacement, heading] of [
    ['/legacy-overview', '/dashboard', 'Dashboard'],
    ['/liabilities', '/portfolio', 'Portfolio'],
    ['/crypto', '/wallets', 'Wallets'],
    ['/wallet-addresses', '/wallets', 'Wallets'],
    ['/owned-transfers', '/transactions', 'Transactions'],
    ['/capital-flows', '/dashboard', 'Dashboard'],
    ['/period-profit', '/dashboard', 'Dashboard'],
    ['/settings', '/preferences', 'Settings'],
  ] as const) {
    await page.goto(retired);
    await expect(page).toHaveURL(`${origin}${replacement}`);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
  }

  // SHELL-006-A: with no stored choice System follows a dark device, then a light one.
  await page.emulateMedia({ colorScheme: 'dark' });
  await nav.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/preferences`);
  const html = page.locator('html');
  const theme = page.getByRole('radiogroup', { name: 'Theme' });
  await expect(theme.getByRole('radio', { name: 'System' })).toBeChecked();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.goto('/dashboard');
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('dashboard-1440-dark.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: testInfo.outputPath('dashboard-1440-light.png'), fullPage: true });

  // SHELL-006-B: an explicit choice wins over the device and survives reload.
  await page.emulateMedia({ colorScheme: 'dark' });
  await nav.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await theme.getByRole('radio', { name: 'Light' }).check();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(theme.getByRole('radio', { name: 'Light' })).toBeChecked();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 1280, height: 800 });
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('settings-1280-light.png'), fullPage: true });
  await theme.getByRole('radio', { name: 'System' }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.setViewportSize({ width: 360, height: 800 });
  await nav.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/login`);
  expect((await page.request.get('/api/accounting/accounts')).status()).toBe(401);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.goto('/mvp-unknown-route');
  await expect(page).toHaveURL(`${origin}/login`);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(errors).toEqual([]);
});
