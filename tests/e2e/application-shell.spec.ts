import { expect, type Page } from '@playwright/test';
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
  // Genuine predecessor RED: the existing successful login opens the legacy root.
  await expect(page).toHaveURL(`${origin}/manual-accounts`);
  await expect(page.getByRole('heading', { name: 'Ручные счета', exact: true })).toBeVisible();
  expect((await page.request.get('/api/accounting/accounts')).status()).toBe(200);

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
  await expect(page).toHaveURL(`${origin}/manual-accounts`);
  await expect(page.locator(`a[href="/manual-accounts/${created.id}"]`)).toContainText(
    'Основной счет',
  );

  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  const toggle = page.getByRole('button', { name: 'Меню', exact: true });
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'application-menu');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const accountLink = nav.getByRole('link', { name: 'Ручные счета', exact: true });
    await expect(accountLink).toHaveAttribute('aria-current', 'page');
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

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(toggle).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Ручные счета', exact: true })).toBeVisible();
  const skip = page.getByRole('link', { name: 'К содержимому', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('accounts-1440-light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('accounts-1440-dark.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await nav.getByText('Прежние данные', { exact: true }).click();
  await nav.getByRole('link', { name: 'Прежний обзор', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/legacy-overview`);
  await expect(page.getByRole('note', { name: 'Область прежнего обзора' })).toContainText(
    'не включает ручные счета',
  );
  await expect(nav.locator('a[href="/assets"]')).toBeVisible();
  await expect(nav.locator('a[href="/crypto"]')).toBeVisible();
  await expect(nav.locator('a[href^="/liabilities"]')).toHaveCount(0);
  await nav.getByRole('link', { name: 'Ручные счета', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  await toggle.click();
  await nav.getByRole('button', { name: 'Выход', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/login`);
  expect((await page.request.get('/api/accounting/accounts')).status()).toBe(401);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(errors).toEqual([]);
});
