import { type Locator, type Page, type Request, type TestInfo, expect } from '@playwright/test';

export async function withoutWorkbenchRequests(page: Page, action: () => Promise<void>) {
  const requests: string[] = [];
  const record = (request: Request) => requests.push(`${request.method()} ${request.url()}`);
  page.on('request', record);
  try {
    await action();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(requests, 'Native presentation toggles make no requests').toEqual([]);
  } finally {
    page.off('request', record);
  }
}

export async function expectNativeDisclosure(summary: Locator) {
  await expect(summary).toBeVisible();
  expect(await summary.evaluate((node) => node.tagName)).toBe('SUMMARY');
  const details = summary.locator('..');
  expect(await details.evaluate((node) => node.tagName)).toBe('DETAILS');
  return details;
}

export async function inspectPeriodMethods(page: Page) {
  const header = page.locator('.profit-header');
  for (const scope of [
    /ручн|вручную/i,
    /не сверены|несверенн/i,
    /временн|не сохраня/i,
    /не.*(текущ|денежн).*остаток|остаток.*не/i,
  ]) {
    await expect(header.locator('p').filter({ hasText: scope }).first()).toBeVisible();
  }
  const summary = page.getByText('Как считаются показатели', { exact: true });
  const methods = await expectNativeDisclosure(summary);
  await expect(methods).not.toHaveAttribute('open', '');
  await withoutWorkbenchRequests(page, async () => {
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(methods).toHaveAttribute('open', '');
    await expect(methods).toContainText(/прибыль/i);
    await expect(methods).toContainText(/XIRR/);
    await expect(methods).toContainText(/годов/i);
    await expect(methods).toContainText(/TWR/);
    await expect(methods).toContainText(/период/i);
    await page.keyboard.press('Space');
    await expect(methods).not.toHaveAttribute('open', '');
  });
}

export async function openPeriodEvidence(page: Page, result: Locator) {
  const summary = result.getByText('Основание расчёта', { exact: true });
  const evidence = await expectNativeDisclosure(summary);
  await expect(evidence).not.toHaveAttribute('open', '');
  await withoutWorkbenchRequests(page, async () => {
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(evidence).toHaveAttribute('open', '');
  });
  return evidence;
}

export async function capturePeriodWorkbench(
  page: Page,
  testInfo: TestInfo,
  name: string,
  targets: Locator[],
  scrollRegion?: Locator,
) {
  const viewport = page.viewportSize();
  const originalTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  try {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const width of [360, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          )
          .toBe(true);
        const controls = await page
          .locator(
            '.profit-page input:not([type="checkbox"]), .profit-page button, .profit-page summary, .profit-page .profit-review',
          )
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => node.getClientRects().length > 0)
              .map((node) => ({
                label: node.textContent || node.getAttribute('aria-label') || node.tagName,
                height: node.getBoundingClientRect().height,
              })),
          );
        expect(controls.length).toBeGreaterThan(0);
        for (const control of controls)
          expect(control.height, control.label).toBeGreaterThanOrEqual(44);
        if (scrollRegion && width === 360) {
          await expect(scrollRegion).toHaveAttribute('tabindex', '0');
          expect(await scrollRegion.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(
            true,
          );
          await scrollRegion.evaluate((node) => {
            node.scrollLeft = 0;
          });
          await scrollRegion.focus();
          await page.keyboard.press('ArrowRight');
          await expect
            .poll(() => scrollRegion.evaluate((node) => node.scrollLeft))
            .toBeGreaterThan(0);
          await scrollRegion.evaluate((node) => {
            node.scrollLeft = 0;
          });
        }
        for (const [targetIndex, target] of targets.entries()) {
          const bounds = await target.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return { top: box.top + window.scrollY, height: box.height };
          });
          for (let index = 0; index < Math.ceil(bounds.height / 900); index++) {
            const offset = Math.min(index * 900, Math.max(0, bounds.height - 900));
            await page.evaluate(
              (top) => window.scrollTo(0, Math.max(0, top - 16)),
              bounds.top + offset,
            );
            await expect(
              page.getByRole('link', { name: 'К содержимому', exact: true }),
            ).not.toBeInViewport();
            const imageName = `${name}-${theme}-${width}-${targetIndex + 1}-${index + 1}`;
            await testInfo.attach(imageName, {
              body: await page.screenshot({
                path: testInfo.outputPath(`${imageName}.png`),
                animations: 'disabled',
                fullPage: false,
              }),
              contentType: 'image/png',
            });
          }
        }
      }
    }
  } finally {
    await page.evaluate((value) => {
      if (value === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', value);
    }, originalTheme);
    if (viewport) await page.setViewportSize(viewport);
  }
}
