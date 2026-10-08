import { expect } from '@playwright/test';
import {
  completeFactor,
  currentEnrollment,
  getCsrf,
  origin,
  owner,
  passwordStep,
  query,
  recoveryFactor,
  test,
  totpAt,
} from './mfa-fixtures';

// PR-AUTH-4 over the real frontend, proxy, backend and PostgreSQL; nothing is mocked.
const phone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const codePattern = /^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/;

test('SEC-UI / SEC-CODES / SEC-SESSIONS: Settings lists both browsers, makes new recovery codes after a TOTP and logs out everywhere', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const enrollment = currentEnrollment();
  const other = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    userAgent: phone,
  });
  try {
    // Two browsers signed in with recovery codes keep the current TOTP step unused.
    const otherPage = await other.newPage();
    await passwordStep(otherPage);
    await completeFactor(otherPage, recoveryFactor(enrollment));
    await passwordStep(page);
    await completeFactor(page, recoveryFactor(enrollment));

    await page.goto('/preferences');
    const security = page.getByRole('region', { name: 'Security', exact: true });
    await expect(security.getByText('8 of 10 unused', { exact: false })).toBeVisible();
    const sessions = security.getByRole('list', { name: 'Active sessions' });
    await expect(sessions.getByRole('listitem')).toHaveCount(2);
    const current = sessions.getByRole('listitem').filter({ hasText: 'This browser' });
    await expect(current).toContainText('Chrome on Linux');
    const iphone = sessions.getByRole('listitem').filter({ hasText: 'Safari on iPhone' });
    await expect(iphone.getByRole('button', { name: 'Log out Safari on iPhone' })).toBeVisible();

    // SEC-CODES: a TOTP from the authenticator makes ten new codes, shown once.
    const oldCode = enrollment.recoveryCodes[enrollment.recoveryIndex];
    await security.getByRole('button', { name: 'Generate new codes', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate new recovery codes' });
    enrollment.usedTotp = true;
    await dialog.getByLabel('Code from your authenticator app', { exact: true }).fill(totpAt(enrollment));
    const generated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/security/recovery-codes' &&
        response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Generate new codes', exact: true }).click();
    const response = await generated;
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    const shown = page.getByRole('dialog', { name: 'New recovery codes' });
    const codes = await shown.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').allInnerTexts();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(codePattern);
      expect(enrollment.recoveryCodes).not.toContain(code);
    }
    await shown.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(shown.getByRole('alert')).toHaveText('Confirm that you saved the codes.');
    await shown.getByLabel('I have saved these codes', { exact: true }).check();
    await shown.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(shown).toHaveCount(0);
    await expect(security.getByText('10 of 10 unused', { exact: false })).toBeVisible();
    await page.reload();
    await expect(security.getByText('10 of 10 unused', { exact: false })).toBeVisible();
    await expect(page.getByText(codes[0])).toHaveCount(0);

    // An old code no longer completes a sign-in; the third browser's pending step stays pending.
    const third = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
    try {
      const csrf = await getCsrf(third.request);
      const login = await third.request.post('/api/auth/login', {
        headers: { Origin: origin, 'X-CSRF-Token': csrf },
        data: { email: owner.email, password: owner.password },
      });
      expect(login.status()).toBe(200);
      const refused = await third.request.post('/api/auth/mfa', {
        headers: { Origin: origin, 'X-CSRF-Token': (await login.json()).csrfToken },
        data: { kind: 'recovery', code: oldCode },
      });
      expect(refused.status()).toBe(401);
    } finally {
      await third.close();
    }

    // SEC-SESSIONS: log out everywhere ends both browsers and this one returns to login.
    await security.getByRole('button', { name: 'Log out everywhere', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Log out everywhere?' });
    const ended = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/security/logout-everywhere' &&
        response.request().method() === 'POST',
    );
    await confirm.getByRole('button', { name: 'Log out everywhere', exact: true }).click();
    expect((await ended).status()).toBe(204);
    await expect(page).toHaveURL(`${origin}/login`);
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    expect((await other.request.get('/api/auth/me')).status()).toBe(401);
    await otherPage.goto('/preferences');
    await expect(otherPage).toHaveURL(`${origin}/login`);
    expect(query('SELECT count(*) FROM auth_sessions WHERE "userId" IS NOT NULL')).toBe('0');
    expect(errors).toEqual([]);
  } finally {
    await other.close();
  }
});
