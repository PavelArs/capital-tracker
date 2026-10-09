import { type APIResponse, expect, type Page, type Response } from '@playwright/test';
import {
  compose,
  completeFactor,
  getCsrf,
  hashToken,
  loginWithMfa,
  origin,
  owner,
  passwordStep,
  query,
  test,
} from './mfa-fixtures';

// BR 2.2 / PR-AUTH-3 over the real frontend, proxy, backend, PostgreSQL and the providers
// fixture's synthetic Yandex SMTP sink; the only mocked party is that mail provider.
const unknownEmail = 'nobody-reset@example.invalid';
const newPassword = 'Synthetic-новый-reset-password-42!';
const mailer = 'acceptance-mailer@example.invalid';

type Mail = { from: string; to: string[]; message: string };

function mailbox(): Mail[] {
  const result = JSON.parse(
    compose([
      'exec',
      '-T',
      'providers',
      'node',
      '-e',
      `fetch('http://127.0.0.1:8080/__control/mail').then(async (response) => {
        if (!response.ok) throw new Error('Synthetic mailbox unavailable');
        process.stdout.write(await response.text());
      }).catch(() => { process.exitCode = 1; });`,
    ]),
  );
  expect(Array.isArray(result)).toBe(true);
  return result as Mail[];
}

// The fixture keeps the raw SMTP DATA; the mailer sends one base64 text part.
function readMail(mail: Mail): { subject: string; text: string } {
  const split = mail.message.indexOf('\r\n\r\n');
  expect(split).toBeGreaterThan(0);
  const headers = mail.message.slice(0, split).replace(/\r\n[ \t]+/g, ' ');
  expect(headers).toMatch(/^Content-Transfer-Encoding: base64$/im);
  const subject = /^Subject: (.*)$/im.exec(headers)?.[1] ?? '';
  const text = Buffer.from(mail.message.slice(split + 4).replace(/\s+/g, ''), 'base64').toString(
    'utf8',
  );
  return { subject, text };
}

function ownerTokens(): number {
  return Number(
    query(`SELECT count(*) FROM password_reset_tokens WHERE "userId" = '${owner.id}'::uuid`),
  );
}

function recoverOwnerPassword(password: string): void {
  const output = compose(
    [
      'exec',
      '-T',
      'backend',
      'node',
      '/app/backend/dist/owner-cli.js',
      'recover',
      '--user-id',
      owner.id,
      '--password-stdin',
    ],
    JSON.stringify({ password, confirmation: password }),
  );
  expect(output.includes(password)).toBe(false);
}

async function resetCall(page: Page, path = ''): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/auth/password-reset${path}` &&
      response.request().method() === 'POST',
    { timeout: 20_000 },
  );
}

async function requestLink(page: Page, email: string) {
  await expect(
    page.getByRole('heading', { name: 'Reset your password', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  const pending = resetCall(page);
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  const response = await pending;
  await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
  const box = await page.locator('.auth-box').innerText();
  return {
    status: response.status(),
    cacheControl: response.headers()['cache-control'],
    body: await response.text(),
    page: box.replace(email, '<email>'),
  };
}

test('RESET-UI / RESET-REQUEST / RESET-USE / RESET-REUSE / RESET-LIMIT: an emailed single-use link sets a new password, signs every device out and still needs TOTP', async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Independent synthetic case isolation: no earlier link counts toward the hourly limit.
  query('DELETE FROM password_reset_tokens');
  const other = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const otherPage = await other.newPage();
    await loginWithMfa(otherPage);
    expect((await other.request.get('/api/auth/me')).status()).toBe(200);
    const before = mailbox().length;

    // RESET-REQUEST: unknown and known emails get the same answer and page; one email arrives.
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/password-reset`);
    const unknown = await requestLink(page, unknownEmail);
    await page.goto('/password-reset');
    const known = await requestLink(page, owner.email);
    expect(known.status).toBe(202);
    expect(known.cacheControl).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    expect(unknown).toEqual(known);
    expect(known.page).toContain('If an account exists for <email>');

    await expect.poll(() => mailbox().length - before, { timeout: 15_000 }).toBe(1);
    const sent = mailbox().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe(mailer);
    expect(sent[0].to).toEqual([owner.email]);
    const { subject, text } = readMail(sent[0]);
    expect(subject).toBe('Reset your Capital Tracker password');
    expect(text).toContain('works once and expires in 30 minutes');
    const link = /https:\/\/\S+/.exec(text)?.[0] ?? '';
    const token =
      /^https:\/\/127\.0\.0\.1:8443\/password-reset\/new#token=([A-Za-z0-9_-]{43})$/.exec(
        link,
      )?.[1];
    expect(token).toBeDefined();
    expect(
      query(`SELECT count(*) FROM password_reset_tokens WHERE "tokenHash" = '${hashToken(token!)}'
        AND "usedAt" IS NULL AND "revokedAt" IS NULL
        AND "expiresAt" = "createdAt" + interval '30 minutes'`),
    ).toBe('1');

    // RESET-USE: the link sets the new password and ends the other browser's session.
    const status = resetCall(page, '/status');
    await page.goto(link);
    expect((await status).status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'Set a new password', exact: true }),
    ).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm password', { exact: true }).fill(newPassword);
    const confirmed = resetCall(page, '/confirm');
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    expect((await confirmed).status()).toBe(204);
    await expect(
      page.getByRole('heading', { name: 'Password changed', exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(`${origin}/password-reset/new`);
    expect(query(`SELECT count(*) FROM auth_sessions WHERE "userId" = '${owner.id}'::uuid`)).toBe(
      '0',
    );

    expect((await other.request.get('/api/auth/me')).status()).toBe(401);
    await otherPage.goto('/dashboard');
    await expect(otherPage).toHaveURL(`${origin}/login`);

    // RESET-REUSE: the used link is refused and nothing changes.
    // Open the link as a fresh page load: from the same URL a fragment-only change reloads nothing.
    await page.goto('about:blank');
    const reopened = resetCall(page, '/status');
    await page.goto(link);
    expect(await (await reopened).json()).toEqual({ state: 'invalid' });
    await expect(
      page.getByRole('heading', { name: 'This link no longer works', exact: true }),
    ).toBeVisible();

    // RESET-LIMIT: past the per-client limit a request is refused and no link is made or sent.
    const csrf = await getCsrf(page.context().request);
    const headers = { Origin: origin, 'X-CSRF-Token': csrf };
    let refused: APIResponse | undefined;
    for (let attempt = 0; attempt < 6 && !refused; attempt++) {
      const response = await page.context().request.post('/api/auth/password-reset', {
        headers,
        data: { email: unknownEmail },
      });
      if (response.status() === 429) refused = response;
      else expect(response.status()).toBe(202);
    }
    expect(refused?.headers()['retry-after']).toMatch(/^[1-9][0-9]?$/);
    const tokens = ownerTokens();
    const mails = mailbox().length;
    await page.goto('/password-reset');
    await page.getByLabel('Email', { exact: true }).fill(owner.email);
    const limited = resetCall(page);
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    expect((await limited).status()).toBe(429);
    await expect(page.locator('.auth-box').getByRole('alert')).toHaveText(
      'Too many requests. Wait a minute and try again.',
    );
    await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toHaveCount(
      0,
    );
    expect(ownerTokens()).toBe(tokens);
    expect(mailbox().length).toBe(mails);

    // The old password fails; the new one still leaves only pending state until TOTP.
    const anonymous = await getCsrf(request);
    const old = await request.post('/api/auth/login', {
      headers: { Origin: origin, 'X-CSRF-Token': anonymous },
      data: { email: owner.email, password: owner.password },
    });
    expect(old.status()).toBe(401);
    await passwordStep(page, newPassword);
    expect((await page.context().request.get('/api/auth/me')).status()).toBe(401);
    await completeFactor(page);
    expect((await page.context().request.get('/api/auth/me')).status()).toBe(200);
    expect(errors).toEqual([]);
  } finally {
    // Restore the fixture's ordinary credentials first, so a failure here never locks the
    // owner out of the next independent cases.
    recoverOwnerPassword(owner.password);
    query('DELETE FROM password_reset_tokens');
    await other.close();
  }
});
