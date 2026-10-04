import { type Locator, type Page, type Request, type TestInfo, expect } from '@playwright/test';
import { providerRequests } from './manual-opening-fixtures';
import { fingerprint } from './mfa-fixtures';

export type AnalyticsTask = 'valuation' | 'history' | 'accounting';
export async function selectAnalysis(page: Page, task: AnalyticsTask) {
  await page.getByRole('combobox', { name: 'Задача анализа', exact: true }).selectOption(task);
}

export function isAnalysisRequest(request: Request) {
  return /\/api\/accounting\/accounts\/[^/]+\/(?:trade-journal\/history|valuation|valuation-history)$/.test(
    new URL(request.url()).pathname,
  );
}

export async function inspectAnalysis(
  page: Page,
  testInfo: TestInfo,
  region: Locator,
  task: AnalyticsTask,
) {
  const names = {
    accounting: [
      'Как читать учётный срез',
      'Прокрутка учётных позиций',
      'Позиции на выбранный момент',
    ],
    valuation: ['Как устроена оценка', 'Прокрутка оценки позиций', 'Оценка позиций'],
    history: ['Как строится история', 'Прокрутка истории стоимости', 'Оценки по датам'],
  } as const;
  const [methodName, scrollName, tableName] = names[task];
  const rows = fingerprint(['auth_sessions', 'auth_request_limits']);
  const providers = providerRequests();
  const requests: string[] = [];
  const record = (request: Request) => {
    if (
      isAnalysisRequest(request) ||
      (request.method() === 'POST' &&
        new URL(request.url()).pathname.startsWith('/api/accounting/'))
    )
      requests.push(request.url());
  };
  const viewport = page.viewportSize();
  const colorScheme = await page.evaluate(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  page.on('request', record);
  const table = region.getByRole('table', { name: tableName, exact: true });
  const originalTable = await table.elementHandle();
  const exactCells = await table.getByRole('cell').allTextContents();
  const inputs = region.locator('input');
  const inputValues = await inputs.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLInputElement).value),
  );
  try {
    for (const input of await inputs.all()) {
      await expect(input).toHaveAccessibleDescription(/UTC/);
      await expect(input).toHaveAccessibleDescription(/часов[\s\S]*пояс/i);
      if (task === 'valuation')
        await expect(input).toHaveAccessibleDescription(
          /ручн[\s\S]*(?:точн|совпад)|(?:точн|совпад)[\s\S]*ручн/i,
        );
      if (task === 'history') {
        await expect(input).toHaveAccessibleDescription(/30/);
        await expect(input).toHaveAccessibleDescription(/24/);
      }
    }
    const summary = region.locator('summary').filter({ hasText: new RegExp(`^${methodName}$`) });
    const details = summary.locator('..');
    expect(await summary.evaluate((node) => node.tagName)).toBe('SUMMARY');
    expect(await details.evaluate((node) => node.tagName)).toBe('DETAILS');
    await expect.poll(() => details.evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => details.evaluate((node: HTMLDetailsElement) => node.open)).toBe(true);
    await expect(summary).toBeFocused();
    if (task === 'accounting')
      await expect(details).toContainText(/не наблюдаемый баланс[\s\S]*не рыночная стоимость/);
    if (task === 'valuation')
      await expect(details).toContainText(/точном совпадении момента UTC[\s\S]*интерполяции/);
    if (task === 'history')
      await expect(details).toContainText(
        /30 истекших дней[\s\S]*24 часа[\s\S]*не непрерывная история/,
      );
    await page.keyboard.press('Space');
    await expect.poll(() => details.evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);
    const scroll = region.getByRole('region', { name: scrollName, exact: true });
    await expect(scroll).toHaveAttribute('tabindex', '0');
    await expect(scroll.getByRole('table', { name: tableName, exact: true })).toBeVisible();
    const coverage = region
      .locator('p')
      .filter({ hasText: /^Граница покрытия UTC:/ })
      .first();
    await expect(coverage).toBeVisible();
    expect(
      await table.evaluate(
        (node, metadata) =>
          Boolean(
            metadata && node.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        await coverage.elementHandle(),
      ),
    ).toBe(true);
    if (task === 'history') {
      const canvas = region.getByRole('img', { name: 'График стоимости счёта', exact: true });
      const originalCanvas = await canvas.elementHandle();
      try {
        for (const width of [360, 1440]) {
          await selectAnalysis(page, 'valuation');
          await expect(region).toBeHidden();
          expect(await originalCanvas?.evaluate((node) => node.isConnected)).toBe(true);
          await page.setViewportSize({ width, height: 900 });
          await selectAnalysis(page, 'history');
          await expect(canvas).toBeVisible();
          expect(await canvas.evaluate((node, original) => node === original, originalCanvas)).toBe(
            true,
          );
          await expect
            .poll(() =>
              canvas.evaluate((node) => {
                const box = node.getBoundingClientRect();
                const parent = node.parentElement!.getBoundingClientRect();
                const bitmap = node as HTMLCanvasElement;
                return (
                  box.width > 0 &&
                  box.height > 0 &&
                  bitmap.width > 0 &&
                  bitmap.height > 0 &&
                  box.width <= parent.width + 1
                );
              }),
            )
            .toBe(true);
          expect(await table.getByRole('cell').allTextContents()).toEqual(exactCells);
        }
      } finally {
        await originalCanvas?.dispose();
      }
    }
    // Switch each owner without any implicit calculation or replacing the result node.
    for (const other of ['valuation', 'history', 'accounting'] as const)
      await selectAnalysis(page, other);
    await selectAnalysis(page, task);
    expect(await originalTable?.evaluate((node) => node.isConnected)).toBe(true);
    expect(await table.evaluate((node, original) => node === original, originalTable)).toBe(true);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const width of [360, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          )
          .toBe(true);
        for (const control of await region.locator('input, button, summary').all()) {
          if (!(await control.isVisible())) continue;
          const box = await control.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        const choice = page.getByRole('combobox', { name: 'Задача анализа', exact: true });
        expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        if (width === 360) {
          expect(await scroll.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
          await scroll.evaluate((node) => {
            node.scrollLeft = 0;
          });
          await scroll.focus();
          await page.keyboard.press('ArrowRight');
          await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
          await scroll.evaluate((node) => {
            node.scrollLeft = 0;
          });
        }
        const bounds = await region.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return { top: box.top + window.scrollY, height: box.height };
        });
        // Include the real task selector and its label above the selected owner.
        const choiceTop = await choice.evaluate(
          (node) => node.getBoundingClientRect().top + window.scrollY,
        );
        const top = Math.min(bounds.top, Math.max(0, choiceTop - 48));
        bounds.height += bounds.top - top;
        bounds.top = top;
        for (let index = 0; index < Math.ceil(bounds.height / 800); index++) {
          const offset = Math.min(index * 800, Math.max(0, bounds.height - 800));
          await page.evaluate(
            (top) => window.scrollTo(0, Math.max(0, top - 16)),
            bounds.top + offset,
          );
          await expect(
            page.getByRole('link', { name: 'Skip to content', exact: true }),
          ).not.toBeInViewport();
          await page.screenshot({
            path: testInfo.outputPath(`analytics-${task}-${theme}-${width}-${index + 1}.png`),
            animations: 'disabled',
            fullPage: false,
          });
        }
        expect(await table.getByRole('cell').allTextContents()).toEqual(exactCells);
        expect(
          await inputs.evaluateAll((nodes) =>
            nodes.map((node) => (node as HTMLInputElement).value),
          ),
        ).toEqual(inputValues);
      }
    }
    expect(requests, 'Task, disclosure, viewport and theme changes do not calculate').toEqual([]);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(rows);
    expect(providerRequests()).toEqual(providers);
  } finally {
    page.off('request', record);
    await originalTable?.dispose();
    await page.emulateMedia({ colorScheme });
    if (viewport) await page.setViewportSize(viewport);
  }
}
