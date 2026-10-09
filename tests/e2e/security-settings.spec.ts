import { expect } from '@playwright/test';
import {
  completeFactor,
  currentEnrollment,
  databaseCounter,
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
    // The Desktop Chrome device of the Playwright config reports Windows.
    await expect(current).toContainText('Chrome on Windows');
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
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
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

// SEC-TOTP over the real stack. The mfa-ip budget is five per minute per client, so this case
// spends exactly five: two sign-ins, the setup, its confirmation and a sign-in with the new app.
test('SEC-TOTP: Settings sets the authenticator up again after a fresh code; other browsers sign out and the new app signs in', async ({
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
    const otherPage = await other.newPage();
    await passwordStep(otherPage);
    await completeFactor(otherPage, recoveryFactor(enrollment));
    await passwordStep(page);
    await completeFactor(page, recoveryFactor(enrollment));
    const before = query('SELECT "activeVersion"::text FROM owner_mfa WHERE id = 1');

    await page.goto('/preferences');
    const security = page.getByRole('region', { name: 'Security', exact: true });
    await security.getByRole('button', { name: 'Set up again', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Set up authenticator again' });
    enrollment.usedTotp = true;
    await dialog
      .getByLabel('Code from your authenticator app', { exact: true })
      .fill(totpAt(enrollment));
    const prepared = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/security/authenticator' &&
        response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    const preparedResponse = await prepared;
    expect(preparedResponse.status()).toBe(200);
    expect(preparedResponse.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    const setup = (await preparedResponse.json()) as Record<string, string>;
    expect(Object.keys(setup).sort()).toEqual(['candidateId', 'expiresAt', 'secret', 'uri']);
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.uri).toContain(`secret=${setup.secret}`);
    expect(setup.uri).not.toBe(enrollment.uri);

    // The candidate waits encrypted; the current factor and its codes are untouched so far.
    expect(
      query(`SELECT "candidateId"::text, position('${setup.secret}' in "candidateEnvelope"::text),
        "candidateExpiresAt" > clock_timestamp() + interval '9 minutes'
        FROM owner_mfa WHERE id = 1`),
    ).toBe(`${setup.candidateId}|0|t`);
    expect(query('SELECT "activeVersion"::text FROM owner_mfa WHERE id = 1')).toBe(before);

    const scan = page.getByRole('dialog', { name: 'Scan the new code' });
    await expect(
      scan.getByRole('img', { name: 'QR code for your authenticator app', exact: true }),
    ).toBeVisible();
    await expect(scan.getByText(setup.secret.match(/.{4}/g)!.join(' '), { exact: true })).toBeVisible();
    const replacement = { uri: setup.uri };
    await scan.getByLabel('Code from the new app', { exact: true }).fill(totpAt(replacement));
    const confirmed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/security/authenticator/confirm' &&
        response.request().method() === 'POST',
    );
    await scan.getByRole('button', { name: 'Verify and continue', exact: true }).click();
    const confirmedResponse = await confirmed;
    expect(confirmedResponse.status()).toBe(200);
    expect(confirmedResponse.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    const { recoveryCodes } = (await confirmedResponse.json()) as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) {
      expect(code).toMatch(codePattern);
      expect(enrollment.recoveryCodes).not.toContain(code);
    }

    const shown = page.getByRole('dialog', { name: 'Save your new recovery codes' });
    await expect(
      shown.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem'),
    ).toHaveText(recoveryCodes);
    await shown.getByLabel('I have saved these codes', { exact: true }).check();
    await shown.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(shown).toHaveCount(0);
    await expect(security.getByText('10 of 10 unused', { exact: false })).toBeVisible();
    const sessions = security.getByRole('list', { name: 'Active sessions' });
    await expect(sessions.getByRole('listitem')).toHaveCount(1);
    await expect(sessions.getByRole('listitem')).toContainText('This browser');

    // The new factor is active with only its own codes; this browser stays, the phone is out.
    expect(
      query(`SELECT m."activeVersion"::text, m."candidateId" IS NULL,
        (SELECT count(*) FROM owner_mfa_recovery r WHERE r."enrollmentVersion" = m."activeVersion"
          AND r."usedAt" IS NULL),
        (SELECT count(*) FROM owner_mfa_recovery r WHERE r."enrollmentVersion" <> m."activeVersion")
        FROM owner_mfa m WHERE m.id = 1`),
    ).toBe(`${setup.candidateId}|t|10|0`);
    expect((await page.request.get('/api/auth/me')).status()).toBe(200);
    expect((await other.request.get('/api/auth/me')).status()).toBe(401);
    expect(query("SELECT count(*) FROM auth_sessions WHERE state = 'authenticated'")).toBe('1');
    await page.reload();
    await expect(security.getByText('10 of 10 unused', { exact: false })).toBeVisible();
    await expect(page.getByText(setup.secret)).toHaveCount(0);

    // The phone signs in again with the new app; the next step is inside the one-step window.
    await otherPage.goto('/preferences');
    await expect(otherPage).toHaveURL(`${origin}/login`);
    await passwordStep(otherPage);
    await completeFactor(otherPage, {
      kind: 'totp',
      code: totpAt(replacement, databaseCounter() + 1),
    });
    expect((await other.request.get('/api/auth/me')).status()).toBe(200);
    expect(errors).toEqual([]);
  } finally {
    await other.close();
  }
});
