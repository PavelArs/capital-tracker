import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { manualApi, type Account, type PageResult } from './manual-opening-fixtures';
import { owner, query, test } from './mfa-fixtures';

async function fitsViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

function catalogResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/accounting/accounts' &&
      response.request().method() === 'GET',
  );
}

test('DIRECTORY-UI: browse saved accounts and preserve explicit creation retry across disclosure', async ({
  page,
}, testInfo) => {
  const api = await manualApi(page);
  for (let index = 0; index < 51; index++) {
    await api.account(
      index === 0
        ? '<b>Неразмеченное длинное имя счета</b> '.repeat(3).trim()
        : `Каталог ${index} ${randomUUID()}`,
    );
  }
  const firstResponse = catalogResponse(page);
  await page.goto('/manual-accounts');
  const first = await firstResponse;
  expect(first.status()).toBe(200);
  const firstPage = (await first.json()) as PageResult<Account, string>;
  const directory = page.getByRole('region', { name: 'Счета', exact: true });
  await expect(directory).toBeVisible();
  // Genuine predecessor RED: creation is always expanded on the old page.
  await expect(page.getByLabel('Название счета', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Дата оценки', { exact: true })).toBeHidden();
  await expect(directory.getByRole('link')).toHaveCount(50);
  await expect(directory).toContainText('Показано счетов: 50');
  expect(firstPage.nextCursor).not.toBeNull();
  const nextResponse = catalogResponse(page);
  await directory.getByRole('button', { name: 'Показать еще счета', exact: true }).click();
  const second = await nextResponse;
  expect(second.status()).toBe(200);
  const secondPage = (await second.json()) as PageResult<Account, string>;
  const accounts = [...firstPage.items, ...secondPage.items];
  await expect(directory.getByRole('link')).toHaveCount(accounts.length);
  expect(new Set(accounts.map((account) => account.id)).size).toBe(accounts.length);
  for (const account of accounts) {
    const link = directory.locator(`a[href="/manual-accounts/${account.id}"]`);
    await expect(link).toContainText(account.name);
    await expect(link).toContainText(`Ревизия ${account.currentRevision}`);
  }
  await expect(directory.locator('b')).toHaveCount(0);
  await expect(directory).toContainText(`Показано счетов: ${accounts.length}`);

  const trigger = page.getByRole('button', { name: 'Новый счет', exact: true });
  const nameField = page.getByLabel('Название счета', { exact: true });
  const name = `Резервный счет ${randomUUID()}`;
  const requests: { requestId: string; name: string }[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/accounting/accounts'
    )
      requests.push(request.postDataJSON());
  });
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(nameField).toBeFocused();
    if (width === 360) await nameField.fill(name);
    await expect(nameField).toHaveValue(name);
    await fitsViewport(page);
    await page.screenshot({
      path: testInfo.outputPath(`directory-create-${width}.png`),
      fullPage: false,
    });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(nameField).toBeHidden();
    await fitsViewport(page);
  }
  expect(requests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('directory-1440.png'), fullPage: false });
  const postPath = '**/api/accounting/accounts';
  let committed: Account | undefined;
  await page.route(postPath, async (route) => {
    if (route.request().method() !== 'POST' || committed) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed = await response.json();
    await route.abort('connectionreset');
  });
  try {
    await trigger.click();
    const mountedInput = await nameField.elementHandle();
    await page.getByRole('button', { name: 'Создать счет', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать счет', exact: true })).toBeEnabled();
    expect(requests).toHaveLength(1);
    await page.getByRole('button', { name: 'Закрыть форму', exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    expect(await mountedInput?.evaluate((node) => node.isConnected)).toBe(true);
    await expect(nameField).toHaveValue(name);
    expect(requests).toHaveLength(1);
    const retry = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/accounting/accounts' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Создать счет', exact: true }).click();
    const replay = await retry;
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(committed);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await expect(nameField).toBeHidden();
    const status = page.getByRole('status').filter({ hasText: 'Счет создан.' });
    await status.getByRole('link', { name, exact: true }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect(committed?.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      query(
        `SELECT count(*) FROM manual_accounts WHERE "ownerId"='${owner.id}' AND name='${name}'`,
      ),
    ).toBe('1');
    await mountedInput?.dispose();
  } finally {
    await page.unroute(postPath);
  }
});
