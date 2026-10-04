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

test('SHELL-UI: real owner login, responsive keyboard navigation, honest legacy entry and logout', async ({
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
  await page.getByLabel('Пароль', { exact: true }).fill('incorrect-synthetic-password');
  const refusedLogin = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Вход', exact: true }).click();
  expect((await refusedLogin).status()).toBe(401);
  await expect(page.getByRole('alert')).toBeVisible();
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('login-error-360.png'), fullPage: true });

  await passwordStep(page);
  expect((await page.request.get('/api/accounting/accounts')).status()).toBe(401);
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('mfa-360.png'), fullPage: true });
  await page.getByRole('button', { name: 'Использовать код восстановления', exact: true }).click();
  await expect(page.getByLabel('Код восстановления', { exact: true })).toBeVisible();
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('recovery-360.png'), fullPage: true });
  await page.getByRole('button', { name: 'Использовать код из приложения', exact: true }).click();
  const factor = nextFactor();
  expect(factor.kind).toBe('totp');
  await page.getByLabel('Код из приложения', { exact: true }).fill(factor.code);
  const pendingFactor = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/mfa' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const factorResponse = await pendingFactor;
  expect(factorResponse.status()).toBe(200);
  expect((await factorResponse.json()).user.email).toBe(owner.email);
  // Genuine predecessor RED: before add-app-shell a successful login opened /manual-accounts.
  await expect(page).toHaveURL(`${origin}/dashboard`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true }),
  ).toBeVisible();
  expect((await page.request.get('/api/accounting/accounts')).status()).toBe(200);

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const toggle = page.getByRole('button', { name: 'Menu', exact: true });
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/')) apiRequests.push(`${request.method()} ${pathname}`);
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(toggle).toBeHidden();
  const sections = [
    ['Dashboard', '/dashboard'],
    ['Portfolio', '/portfolio'],
    ['Transactions', '/transactions'],
    ['Wallets', '/wallets'],
    ['Settings', '/preferences'],
  ] as const;
  for (const [index, [name, path]] of sections.entries()) {
    await expect(nav.getByRole('link').nth(index)).toHaveAttribute('href', path);
    await expect(nav.getByRole('link').nth(index)).toHaveText(name);
  }
  await expect(nav.getByText('Sync not set up', { exact: true })).toBeVisible();
  await expect(nav.getByText(owner.email, { exact: true })).toBeVisible();

  // SHELL-005-A: honest placeholders, each linking to the legacy screen meanwhile.
  for (const [name, path, legacyLink, legacyPath] of [
    ['Dashboard', '/dashboard', 'Open manual accounts', '/manual-accounts'],
    ['Transactions', '/transactions', 'Open manual accounts', '/manual-accounts'],
    ['Wallets', '/wallets', 'Open wallet addresses', '/wallet-addresses'],
  ] as const) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(`${origin}${path}`);
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
    await expect(main.getByText(/not built yet/i)).toBeVisible();
    await expect(main.getByText(/your portfolio is empty/i)).toHaveCount(0);
    await expect(main.getByRole('link', { name: legacyLink, exact: true })).toHaveAttribute(
      'href',
      legacyPath,
    );
  }
  // Client-side navigation fires no load event; give a late request time to appear.
  await page.waitForTimeout(1_000);
  expect(apiRequests).toEqual([]);
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('wallets-1440-light.png'), fullPage: true });
  await page.getByRole('main').getByRole('link', { name: 'Open wallet addresses' }).click();
  await expect(page).toHaveURL(`${origin}/wallet-addresses`);

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
  const depositName = `SHELL-UI deposit ${randomUUID()}`;
  await addAsset.getByRole('radio', { name: 'Manual', exact: true }).check();
  await addAsset.getByLabel('Name', { exact: true }).fill(depositName);
  await addAsset.getByRole('radio', { name: 'RUB', exact: true }).check();
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
    symbol: null,
    assetType: 'manual',
    valuationCurrency: 'RUB',
    priceSource: 'manual',
  });
  await expect(addAsset).toHaveCount(0);
  await expect(
    portfolio.getByRole('row', { name: new RegExp(`^${depositName}`) }).getByRole('cell'),
  ).toHaveText([depositName, 'Manual', 'RUB', 'Manual']);
  await page.reload();
  await expect(
    portfolio.getByRole('row', { name: new RegExp(`^${depositName}`) }).getByRole('cell'),
  ).toHaveText([depositName, 'Manual', 'RUB', 'Manual']);
  const chips = portfolio.getByRole('group', { name: 'Filter assets' });
  await chips.getByRole('button', { name: /^Manual/ }).click();
  await expect(chips.getByRole('button', { name: /^Manual/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(portfolio.getByRole('row', { name: new RegExp(`^${depositName}`) })).toBeVisible();
  for (const other of ['Crypto', 'Cash']) {
    await expect(
      portfolio
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: other, exact: true }) }),
    ).toHaveCount(0);
  }
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('portfolio-1440-light.png'), fullPage: true });

  // SHELL-001-A: current screens stay reachable under the open Legacy group.
  const legacy = nav.locator('details', { has: page.getByText('Legacy', { exact: true }) });
  await expect(legacy).toHaveAttribute('open', '');
  for (const [name, path] of [
    ['Ручные счета', '/manual-accounts'],
    ['Переводы между счетами', '/owned-transfers'],
    ['Вводы и выводы', '/capital-flows'],
    ['Ручные цены', '/manual-prices'],
    ['Адреса кошельков', '/wallet-addresses'],
    ['Прибыль за период', '/period-profit'],
    ['Настройки', '/settings'],
    ['Прежний обзор', '/legacy-overview'],
    ['Активы', '/assets'],
    ['Криптокошельки', '/crypto'],
  ] as const) {
    await expect(legacy.getByRole('link', { name, exact: true })).toHaveAttribute('href', path);
  }
  await expect(nav.locator('a[href^="/liabilities"]')).toHaveCount(0);

  await legacy.getByRole('link', { name: 'Ручные счета', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/manual-accounts`);
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
  await legacy.getByRole('link', { name: 'Ручные счета', exact: true }).click();
  await expect(page.locator(`a[href="/manual-accounts/${created.id}"]`)).toContainText(
    'Основной счет',
  );

  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'application-menu');
    await expect(nav.getByText(owner.email, { exact: true })).toBeVisible();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const accountLink = nav.getByRole('link', { name: 'Ручные счета', exact: true });
    await expect(accountLink).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await accountLink.focus();
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await expect(accountLink).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(nav.locator('#application-menu :focus')).toHaveCount(0);
    await toggle.click();
    await fitsViewport(page);
    await page.screenshot({ path: testInfo.outputPath(`menu-${width}.png`), fullPage: true });
    await nav.getByRole('link', { name: 'Ручные цены', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/manual-prices`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await nav.getByRole('link', { name: 'Ручные счета', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/manual-accounts`);
    await fitsViewport(page);
  }

  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(toggle).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ручные счета', exact: true })).toBeVisible();
    await fitsViewport(page);
  }
  const skip = page.getByRole('link', { name: 'Skip to content', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await nav.getByRole('link', { name: 'Прежний обзор', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/legacy-overview`);
  await expect(page.getByRole('note', { name: 'Область прежнего обзора' })).toContainText(
    'не включает ручные счета',
  );
  // Router-major compatibility: the retained assets splat and fixed absolute tab paths.
  await nav.locator('a[href="/assets"]').click();
  await expect(page).toHaveURL(`${origin}/assets/overview`);
  for (const [label, path] of [
    ['Балансовые активы', '/assets/stock'],
    ['Потоковые активы', '/assets/flow'],
    ['Обзор', '/assets/overview'],
  ] as const) {
    const tab = page.getByRole('button', { name: label, exact: true });
    await tab.click();
    await expect(page).toHaveURL(`${origin}${path}`);
    await expect(tab).toHaveAttribute('aria-current', 'page');
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
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(errors).toEqual([]);
});
