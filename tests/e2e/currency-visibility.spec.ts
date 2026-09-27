import { randomUUID } from 'node:crypto';
import { type Request, type Route, expect } from '@playwright/test';
import { foreignOwner, literal, providerRequests } from './manual-opening-fixtures';
import { fingerprint, loginWithMfa, owner, query, test } from './mfa-fixtures';

const listPath = '/api/currencies/list';
const hiddenPath = '/api/currencies/hidden';
const hidePath = '/api/currencies/hide';
const showPath = '/api/currencies/show';
const hiddenRoute = (url: URL) => url.pathname === hiddenPath;
const hideRoute = (url: URL) => url.pathname === hidePath;
type StoredCurrency = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  type: 'fiat' | 'crypto' | 'stablecoin';
  isActive: boolean;
  isSystem: boolean;
  contractAddress: string | null;
};
type Preference = {
  id: string;
  userId: string;
  currencyId: string;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
};
const preferences = (): Preference[] =>
  JSON.parse(
    query(
      `SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text, '[]') FROM user_currency_preferences p`,
    ),
  );
const businessRows = () =>
  fingerprint(['auth_sessions', 'auth_request_limits', 'user_currency_preferences']);

function seedVisibility(): StoredCurrency[] {
  expect(query("SELECT current_database() || ':' || current_user")).toBe(
    'capital_tracker_e2e:capital_e2e',
  );
  const suffix = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  const currencies: StoredCurrency[] = [
    {
      id: randomUUID(),
      code: `S${suffix}`,
      name: `<img src=x onerror="window.currencyLabelExecuted=true"> ${suffix}`,
      symbol: '₮',
      type: 'stablecoin',
      isActive: true,
      isSystem: true,
      contractAddress: '0x0123456789abcdef0123456789abcdef01234567',
    },
    {
      id: randomUUID(),
      code: `N${suffix}`,
      name: `Несистемная запись ${suffix}`,
      symbol: 'N',
      type: 'crypto',
      isActive: true,
      isSystem: false,
      contractAddress: null,
    },
    {
      id: randomUUID(),
      code: `I${suffix}`,
      name: `Неактивная запись ${suffix}`,
      symbol: 'I',
      type: 'fiat',
      isActive: false,
      isSystem: true,
      contractAddress: null,
    },
  ];
  const values = currencies.map(
    (row) =>
      `('${row.id}', ${literal(row.code)}, ${literal(row.name)}, ${literal(row.symbol)}, '${row.type}', ${row.isActive}, ${row.isSystem}, ${row.contractAddress === null ? 'NULL' : literal(row.contractAddress)})`,
  );
  // Synthetic catalogue/preferences only; no authentication substitution or financial setup.
  query(`BEGIN;
    INSERT INTO currencies (id, code, name, symbol, type, "isActive", "isSystem", "contractAddress") VALUES ${values.join(',')};
    INSERT INTO user_currency_preferences ("userId", "currencyId", "isHidden") VALUES
      ('${owner.id}', '${currencies[0].id}', false),
      ('${owner.id}', '${currencies[2].id}', true),
      ('${owner.id}', '${currencies[1].id}', false),
      ('${foreignOwner}', '${currencies[0].id}', true),
      ('${foreignOwner}', '${currencies[2].id}', false);
    COMMIT;`);
  const saved = JSON.parse(
    query(
      `SELECT jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'symbol', symbol, 'type', type, 'isActive', "isActive", 'isSystem', "isSystem", 'contractAddress', "contractAddress") ORDER BY code)::text FROM currencies WHERE id IN (${currencies.map((row) => `'${row.id}'`).join(',')})`,
    ),
  ) as StoredCurrency[];
  expect(saved).toEqual([...currencies].sort((left, right) => left.code.localeCompare(right.code)));
  return currencies;
}

function expectedLists() {
  return JSON.parse(
    query(`SELECT jsonb_build_object(
    'visible', (SELECT COALESCE(jsonb_agg(c.id ORDER BY c.code), '[]') FROM currencies c WHERE c."isActive" AND NOT EXISTS (SELECT 1 FROM user_currency_preferences p WHERE p."userId"='${owner.id}' AND p."currencyId"=c.id AND p."isHidden")),
    'hidden', (SELECT COALESCE(jsonb_agg(c.id ORDER BY c.code), '[]') FROM currencies c JOIN user_currency_preferences p ON p."currencyId"=c.id WHERE p."userId"='${owner.id}' AND p."isHidden")
  )::text`),
  ) as { visible: string[]; hidden: string[] };
}

test('CVIS-UI: currency visibility recovers real lost reads and committed preferences without financial effects', async ({
  page,
}, testInfo) => {
  await loginWithMfa(page);
  const [system, nonSystem, inactive] = seedVisibility();
  const before = businessRows();
  const originalPreferences = preferences();
  const targetPreference = originalPreferences.find(
    (row) => row.userId === owner.id && row.currencyId === system.id,
  )!;
  expect(targetPreference.isHidden).toBe(false);
  const providersBefore = providerRequests();
  const currencyRequests: { method: string; path: string; body: unknown }[] = [];
  const accountingRequests: string[] = [];
  const record = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/currencies/'))
      currencyRequests.push({
        method: request.method(),
        path,
        body: request.method() === 'POST' ? request.postDataJSON() : null,
      });
    if (path.startsWith('/api/accounting/')) accountingRequests.push(request.url());
  };
  page.on('request', record);
  let inactiveWasShown = false;
  const verifyPreferences = (isHidden: boolean) => {
    const actual = preferences();
    const target = actual.find((row) => row.id === targetPreference.id)!;
    expect(target).toEqual({ ...targetPreference, isHidden, updatedAt: expect.any(String) });
    expect(Number.isNaN(Date.parse(target.updatedAt))).toBe(false);
    expect(Date.parse(target.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(targetPreference.updatedAt),
    );
    const inactivePreference = originalPreferences.find(
      (row) => row.userId === owner.id && row.currencyId === inactive.id,
    )!;
    const actualInactive = actual.find((row) => row.id === inactivePreference.id)!;
    if (inactiveWasShown) {
      expect(actualInactive).toEqual({
        ...inactivePreference,
        isHidden: false,
        updatedAt: expect.any(String),
      });
      expect(Date.parse(actualInactive.updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(inactivePreference.updatedAt),
      );
    }
    expect(actual).toEqual(
      originalPreferences.map((row) =>
        row.id === target.id
          ? target
          : inactiveWasShown && row.id === inactivePreference.id
            ? actualInactive
            : row,
      ),
    );
    expect(businessRows()).toBe(before);
    expect(providerRequests()).toEqual(providersBefore);
    expect(accountingRequests).toEqual([]);
  };
  let lostRead = false;
  const loseHiddenRead = async (route: Route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([expect.objectContaining(inactive)]),
    );
    await route.abort('failed');
    lostRead = true;
  };
  await page.route(hiddenRoute, loseHiddenRead, { times: 1 });
  try {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Валюты', exact: true }).click();
    await expect.poll(() => lostRead).toBe(true);
    // Genuine predecessor RED: the original catch silently loses this actual backend response.
    await expect(
      page
        .locator('#settings-panel')
        .getByRole('alert')
        .filter({ hasText: 'Не удалось загрузить списки валют. Повторите загрузку.' }),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await page.unroute(hiddenRoute, loseHiddenRead);
  }
  const manager = page.getByRole('region', { name: 'Видимость валют', exact: true });
  await expect(
    manager.getByRole('heading', { name: 'Прежний список валют', exact: true }),
  ).toBeVisible();
  const filters = manager.getByRole('group', { name: 'Списки валют', exact: true });
  const visible = filters.getByRole('button', { name: /^Показываемые \(/ });
  const hidden = filters.getByRole('button', { name: /^Скрытые \(/ });
  const reload = manager.getByRole('button', { name: 'Обновить списки', exact: true });
  await expect(visible).toHaveText('Показываемые (—)');
  await expect(hidden).toHaveText('Скрытые (—)');
  await expect(manager.getByRole('table')).toHaveCount(0);
  await expect(manager.getByText(/Нет (?:скрытых )?валют|Список пуст/i)).toHaveCount(0);
  expect(preferences()).toEqual(originalPreferences);
  const reloadPair = async (action: () => Promise<void>) => {
    const reads = [listPath, hiddenPath].map((path) =>
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === path && response.request().method() === 'GET',
      ),
    );
    await action();
    const responses = await Promise.all(reads);
    const actual = expectedLists();
    for (const [index, response] of responses.entries()) {
      expect(response.status()).toBe(200);
      const ids = (await response.json()).map((row: StoredCurrency) => row.id).sort();
      expect(ids).toEqual([...(index === 0 ? actual.visible : actual.hidden)].sort());
    }
    await expect(visible).toHaveText(`Показываемые (${actual.visible.length})`);
    await expect(hidden).toHaveText(`Скрытые (${actual.hidden.length})`);
  };
  await reloadPair(() => reload.click());
  verifyPreferences(false);
  await expect(visible).toHaveAttribute('aria-pressed', 'true');
  await expect(hidden).toHaveAttribute('aria-pressed', 'false');
  const relatedId = await visible.getAttribute('aria-controls');
  expect(relatedId).toBeTruthy();
  const results = page.locator(`[id="${relatedId}"]`);
  await expect(results).toHaveAttribute('role', 'region');
  await expect(results).toHaveAttribute('aria-labelledby', (await visible.getAttribute('id'))!);
  const systemRow = manager.getByRole('row').filter({ hasText: system.code });
  const nonSystemRow = manager.getByRole('row').filter({ hasText: nonSystem.code });
  const inactiveRow = manager.getByRole('row').filter({ hasText: inactive.code });
  const hideSystem = systemRow.getByRole('button', { name: `Скрыть ${system.code}`, exact: true });
  await expect(hideSystem).toBeEnabled();
  await expect(
    nonSystemRow.getByRole('button', { name: `Скрыть ${nonSystem.code}`, exact: true }),
  ).toBeDisabled();
  await expect(nonSystemRow).toContainText('Скрывать можно только системные записи.');
  for (const caption of ['Фиатные валюты', 'Криптовалюты', 'Стейблкоины'])
    await expect(manager.getByRole('table', { name: caption, exact: true })).toBeVisible();
  await expect(systemRow).toContainText(system.name);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'currencyLabelExecuted'))).toBeUndefined();
  const navigationBefore = [...currencyRequests];
  const systemDetails = systemRow.locator('details');
  await expect(systemDetails.locator('summary')).toHaveText(`Реквизиты ${system.code}`);
  await systemDetails.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => systemDetails.evaluate((node: HTMLDetailsElement) => node.open))
    .toBe(true);
  await expect(systemDetails.getByText(system.id, { exact: true })).toBeVisible();
  await expect(systemDetails.getByText(system.contractAddress!, { exact: true })).toBeVisible();
  await hidden.focus();
  await page.keyboard.press('Enter');
  await expect(hidden).toBeFocused();
  await expect(hidden).toHaveAttribute('aria-pressed', 'true');
  await expect(results).toHaveAttribute('aria-labelledby', (await hidden.getAttribute('id'))!);
  await expect(inactiveRow).toContainText(/Неактивн/i);
  await expect(
    inactiveRow.getByRole('button', { name: `Показать ${inactive.code}`, exact: true }),
  ).toBeEnabled();
  await inactiveRow.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(inactiveRow.getByText(inactive.id, { exact: true })).toBeVisible();
  await expect(inactiveRow.getByText('Контракт не указан', { exact: true })).toBeVisible();
  await visible.focus();
  await page.keyboard.press('Space');
  await expect(visible).toBeFocused();
  await expect(visible).toHaveAttribute('aria-pressed', 'true');
  expect(currencyRequests).toEqual(navigationBefore);
  verifyPreferences(false);

  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let complete = () => {};
  const handlerDone = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let started = false;
  let committed = false;
  const loseCommittedHide = async (route: Route) => {
    started = true;
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed = true;
      await gate;
      await route.abort('failed');
    } finally {
      complete();
    }
  };
  const beforeCommandReads = currencyRequests.filter((row) => row.method === 'GET');
  await page.route(hideRoute, loseCommittedHide, { times: 1 });
  try {
    await hideSystem.click();
    await expect.poll(() => committed).toBe(true);
    verifyPreferences(true);
    await expect(
      manager.getByText('Сохраняем настройку видимости…', { exact: true }),
    ).toBeVisible();
    await expect(systemRow).toBeVisible();
    await expect(hideSystem).toBeDisabled();
    await expect(reload).toBeDisabled();
    for (const action of await manager.getByRole('button', { name: /^(?:Скрыть|Показать) / }).all())
      await expect(action).toBeDisabled();
    await hideSystem.click({ force: true });
    await visible.focus();
    release();
    await handlerDone;
    await expect(
      manager.getByRole('alert').filter({
        hasText:
          'Не удалось подтвердить видимость валюты. Обновите списки, прежде чем менять видимость снова.',
      }),
    ).toBeVisible();
    await expect(
      manager.getByText(
        'Показаны последние успешно загруженные списки; видимость могла измениться.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(visible).toBeFocused();
    await expect(systemRow).toBeVisible();
    await expect(hideSystem).toBeDisabled();
    await expect(reload).toBeEnabled();
    expect(currencyRequests.filter((row) => row.method === 'GET')).toEqual(beforeCommandReads);
    expect(currencyRequests.filter((row) => row.method === 'POST')).toEqual([
      { method: 'POST', path: hidePath, body: { currencyId: system.id } },
    ]);
  } finally {
    release();
    if (started) await handlerDone;
    await page.unroute(hideRoute, loseCommittedHide);
  }
  await reloadPair(() => reload.click());
  await expect(systemRow).toHaveCount(0);
  await expect(visible).toHaveAttribute('aria-pressed', 'true');
  await hidden.click();
  await expect(systemRow).toBeVisible();
  const showSystem = systemRow.getByRole('button', {
    name: `Показать ${system.code}`,
    exact: true,
  });
  await expect(showSystem).toBeEnabled();
  const showResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === showPath && response.request().method() === 'POST',
  );
  await reloadPair(() => showSystem.click());
  expect((await showResponse).status()).toBe(200);
  await expect(
    manager.getByText('Настройка видимости сохранена. Списки обновлены.', { exact: true }),
  ).toBeVisible();
  await expect(hidden).toHaveAttribute('aria-pressed', 'true');
  await expect(hidden).toBeFocused();
  await expect(systemRow).toHaveCount(0);
  verifyPreferences(false);
  await visible.click();
  await expect(systemRow).toBeVisible();
  const snapshotPreferences = preferences();
  await reloadPair(() => reload.click());
  expect(preferences()).toEqual(snapshotPreferences);
  await page.reload();
  await reloadPair(() => page.getByRole('button', { name: 'Валюты', exact: true }).click());
  await expect(systemRow).toBeVisible();
  await expect(hideSystem).toBeEnabled();
  verifyPreferences(false);

  const screenshotRows = businessRows();
  const screenshotPreferences = preferences();
  const screenshotRequests = [...currencyRequests];
  const viewport = page.viewportSize();
  const scheme = await page.evaluate(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  try {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const width of [360, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await visible.click();
        const details = systemRow.locator('details');
        if (!(await details.evaluate((node: HTMLDetailsElement) => node.open)))
          await details.locator('summary').click();
        await expect(details.getByText(system.id, { exact: true })).toBeVisible();
        await expect(details.getByText(system.contractAddress!, { exact: true })).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          )
          .toBe(true);
        for (const control of await manager.locator('button, summary').all()) {
          if (!(await control.isVisible())) continue;
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        const scroll = manager.getByRole('region', { name: 'Прокрутка: Стейблкоины', exact: true });
        await expect(scroll).toHaveAttribute('tabindex', '0');
        if (width === 360) {
          expect(await scroll.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
          await scroll.focus();
          await page.keyboard.press('ArrowRight');
          await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
          await scroll.evaluate((node) => {
            node.scrollLeft = 0;
          });
        }
        for (const [part, target] of [
          ['header', filters],
          ['evidence', scroll],
        ] as const) {
          await target.evaluate((node) => node.scrollIntoView({ block: 'start' }));
          await expect(
            page.getByRole('link', { name: 'К содержимому', exact: true }),
          ).not.toBeInViewport();
          await page.screenshot({
            path: testInfo.outputPath(`currency-visible-${theme}-${width}-${part}.png`),
            animations: 'disabled',
            fullPage: false,
          });
        }
        await hidden.click();
        await expect(inactiveRow).toContainText(/Неактивн/i);
        const inactiveDetails = inactiveRow.locator('details');
        if (!(await inactiveDetails.evaluate((node: HTMLDetailsElement) => node.open)))
          await inactiveDetails.locator('summary').click();
        await expect(inactiveRow.getByText(inactive.id, { exact: true })).toBeVisible();
        await expect(inactiveRow.getByText('Контракт не указан', { exact: true })).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          )
          .toBe(true);
        for (const control of await manager.locator('button, summary').all()) {
          if (await control.isVisible())
            expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await manager.evaluate((node) => node.scrollIntoView({ block: 'start' }));
        await expect(
          page.getByRole('link', { name: 'К содержимому', exact: true }),
        ).not.toBeInViewport();
        await page.screenshot({
          path: testInfo.outputPath(`currency-hidden-${theme}-${width}.png`),
          animations: 'disabled',
          fullPage: false,
        });
      }
    }
    expect(currencyRequests).toEqual(screenshotRequests);
    expect(preferences()).toEqual(screenshotPreferences);
    expect(businessRows()).toBe(screenshotRows);
  } finally {
    await page.emulateMedia({ colorScheme: scheme });
    if (viewport) await page.setViewportSize(viewport);
  }
  // A fresh Settings mount must wait for the previous component's genuine command.
  await visible.click();
  let releaseRemount = () => {};
  const remountGate = new Promise<void>((resolve) => {
    releaseRemount = resolve;
  });
  let finishRemount = () => {};
  const remountDone = new Promise<void>((resolve) => {
    finishRemount = resolve;
  });
  let remountStarted = false;
  let remountCommitted = false;
  const holdRemountedHide = async (route: Route) => {
    remountStarted = true;
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      remountCommitted = true;
      await remountGate;
      await route.fulfill({ response });
    } finally {
      finishRemount();
    }
  };
  await page.route(hideRoute, holdRemountedHide, { times: 1 });
  try {
    await hideSystem.click();
    await expect.poll(() => remountCommitted).toBe(true);
    verifyPreferences(true);
    const readsBeforeRemount = currencyRequests.filter((row) => row.method === 'GET');
    await page.getByRole('button', { name: 'Общие', exact: true }).click();
    await expect(manager).toHaveCount(0);
    await page.getByRole('button', { name: 'Валюты', exact: true }).click();
    await expect(reload).toBeDisabled();
    for (const action of await manager.getByRole('button', { name: /^(?:Скрыть|Показать) / }).all())
      await expect(action).toBeDisabled();
    // Keep the request listener through an observable interval after the navigation.
    await page.waitForTimeout(500);
    expect(currencyRequests.filter((row) => row.method === 'GET')).toEqual(readsBeforeRemount);
    const general = page.getByRole('button', { name: 'Общие', exact: true });
    await general.focus();
    await reloadPair(async () => {
      releaseRemount();
      await remountDone;
    });
    await expect(general).toBeFocused();
    await expect(systemRow).toHaveCount(0);
    await expect(reload).toBeEnabled();
    verifyPreferences(true);
  } finally {
    releaseRemount();
    if (remountStarted) await remountDone;
    await page.unroute(hideRoute, holdRemountedHide);
  }
  await hidden.click();
  await reloadPair(() => showSystem.click());
  await expect(hidden).toBeFocused();
  verifyPreferences(false);

  // Showing an inactive catalogue record clears only its preference, not network activation.
  const visibleCount = expectedLists().visible.length;
  await expect(inactiveRow).toContainText(/Неактивн/i);
  await reloadPair(() =>
    inactiveRow.getByRole('button', { name: `Показать ${inactive.code}`, exact: true }).click(),
  );
  inactiveWasShown = true;
  await expect(inactiveRow).toHaveCount(0);
  await expect(hidden).toBeFocused();
  await expect(visible).toHaveText(`Показываемые (${visibleCount})`);
  await visible.click();
  await expect(inactiveRow).toHaveCount(0);
  verifyPreferences(false);
  page.off('request', record);
  expect(currencyRequests.filter((row) => row.method === 'POST')).toEqual([
    { method: 'POST', path: hidePath, body: { currencyId: system.id } },
    { method: 'POST', path: showPath, body: { currencyId: system.id } },
    { method: 'POST', path: hidePath, body: { currencyId: system.id } },
    { method: 'POST', path: showPath, body: { currencyId: system.id } },
    { method: 'POST', path: showPath, body: { currencyId: inactive.id } },
  ]);
  expect(
    currencyRequests.every((row) => [listPath, hiddenPath, hidePath, showPath].includes(row.path)),
  ).toBe(true);
  expect(currencyRequests.length).toBeLessThanOrEqual(26);
  verifyPreferences(false);
});
