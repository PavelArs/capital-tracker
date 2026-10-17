import { AuthProvider, useAuth } from '@contexts/AuthContext';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';

const api = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  verifyFactor: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('@api', () => ({ authApi: api }));

const owner = {
  id: 'synthetic-owner',
  email: 'owner@example.invalid',
  createdAt: '2026-09-21T00:00:00Z',
  updatedAt: '2026-09-21T00:00:00Z',
};
const fullResponse = { user: owner, csrfToken: 'full-csrf' };

function ProfileStatus() {
  const { user } = useAuth();
  return <output aria-label="authenticated owner">{user?.email ?? 'anonymous'}</output>;
}

async function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <ProfileStatus />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Private portfolio</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByLabelText('Password');
  return userEvent.setup();
}

async function submitPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), owner.email);
  await user.type(screen.getByLabelText('Password'), 'Synthetic-password-42!');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Owner second-factor login (prototype Sign-in)', () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    api.getCurrentUser.mockRejectedValue(new Error('Unauthorized'));
    api.login.mockResolvedValue({ mfaRequired: true, csrfToken: 'pending-csrf' });
    api.verifyFactor.mockResolvedValue(fullResponse);
    vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens with the cursor in the email field', async () => {
    await renderLogin();

    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('links the password step to the emailed reset', async () => {
    await renderLogin();

    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/password-reset',
    );
  });

  it('keeps password success anonymous on the factor step without opening the portfolio', async () => {
    const user = await renderLogin();
    await submitPassword(user);

    expect(screen.queryByText('Private portfolio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
    expect(await screen.findByLabelText('Code from your authenticator app')).toBeVisible();
    expect(screen.getByLabelText('Code from your authenticator app')).toHaveFocus();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(api.verifyFactor).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });

  it('submits a leading-zero code only on explicit confirmation and authenticates only after completion', async () => {
    let completeFactor: (value: typeof fullResponse) => void = () => {};
    api.verifyFactor.mockReturnValueOnce(
      new Promise((resolve) => {
        completeFactor = resolve;
      }),
    );
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '012345');
    expect(api.verifyFactor).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(api.verifyFactor).toHaveBeenCalledExactlyOnceWith({ kind: 'totp', code: '012345' });
    expect(screen.queryByText('Private portfolio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
    expect(screen.getByLabelText('Code from your authenticator app')).toBeDisabled();
    completeFactor(fullResponse);
    expect(await screen.findByText('Private portfolio')).toBeVisible();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent(owner.email);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });

  it('offers a recovery form and preserves the recovery code as a string', async () => {
    const user = await renderLogin();
    await submitPassword(user);
    await user.click(await screen.findByRole('button', { name: 'Use a recovery code instead' }));
    const code = '01234567-89ABCDEF-01234567-89ABCDEF';
    await user.type(screen.getByLabelText('Recovery code'), code);
    expect(api.verifyFactor).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('Private portfolio');
    expect(api.verifyFactor).toHaveBeenCalledExactlyOnceWith({ kind: 'recovery', code });
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });

  it('shows a generic invalid-code error without retrying or exposing the server message', async () => {
    api.verifyFactor.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: { message: 'Internal secret marker' } },
    });
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(
      await screen.findByText(
        "That code didn't work. Enter the current one; if it keeps failing, sign in again.",
      ),
    ).toBeVisible();
    expect(api.verifyFactor).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Internal secret marker')).not.toBeInTheDocument();
    expect(screen.queryByText('Private portfolio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
  });

  it('shows cooldown guidance without automatically repeating a blocked factor', async () => {
    api.verifyFactor.mockRejectedValueOnce({ isAxiosError: true, response: { status: 429 } });
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText(/^Too many wrong codes, so codes are paused\./)).toBeVisible();
    expect(api.verifyFactor).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
  });

  it('can return to the password form and clears the previous password and factor input', async () => {
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '012345');
    // The way back sits in the box, as on every auth step.
    expect(
      screen.getByRole('button', { name: 'Back to sign in' }).closest('.auth-box'),
    ).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByLabelText('Code from your authenticator app')).not.toBeInTheDocument();
    expect(api.verifyFactor).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Password'), 'Synthetic-password-42!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Code from your authenticator app')).toHaveValue('');
    expect(api.login).toHaveBeenCalledTimes(2);
  });

  it('starts a new password step after reload instead of remembering a pending factor', async () => {
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '012345');
    cleanup();
    await renderLogin();

    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue(''));
    expect(screen.queryByLabelText('Code from your authenticator app')).not.toBeInTheDocument();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
    expect(api.verifyFactor).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });
  it('checks the fields first and explains a refused password without the server message', async () => {
    api.login.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: { message: 'Internal secret marker' } },
    });
    const user = await renderLogin();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email')).toBeVisible();
    expect(screen.getByText('Enter your password')).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(api.login).not.toHaveBeenCalled();

    await submitPassword(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email or password is incorrect. Check both and try again.',
    );
    expect(screen.queryByText('Internal secret marker')).not.toBeInTheDocument();
    // AUTH-INVALID: either may be wrong, so both fields say so, pointing at the explanation.
    for (const label of ['Email', 'Password']) {
      const field = screen.getByLabelText(label, { selector: 'input' });
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAccessibleDescription(
        'Email or password is incorrect. Check both and try again.',
      );
    }
    expect(api.login).toHaveBeenCalledExactlyOnceWith({
      email: owner.email,
      password: 'Synthetic-password-42!',
    });
  });

  it('shows and hides the password on request', async () => {
    const user = await renderLogin();
    const field = screen.getByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'current-password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');
  });

  it('keeps only digits in the authenticator code and asks for all six', async () => {
    const user = await renderLogin();
    await submitPassword(user);
    const field = await screen.findByLabelText('Code from your authenticator app');
    await user.type(field, '12 3a4');
    expect(field).toHaveValue('1234');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByText('Enter all 6 digits')).toBeVisible();
    expect(api.verifyFactor).not.toHaveBeenCalled();
  });

  it('auth-01 returns the cursor to the code field and announces a refused code', async () => {
    api.verifyFactor.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That code didn't work. Enter the current one; if it keeps failing, sign in again.",
    );
    expect(screen.getByLabelText('Code from your authenticator app')).toHaveFocus();
  });

  it('auth-01 returns the cursor to the recovery code and the password after a refusal', async () => {
    api.login
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } })
      .mockResolvedValueOnce({ mfaRequired: true, csrfToken: 'pending-csrf' });
    api.verifyFactor.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    const user = await renderLogin();
    await submitPassword(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByLabelText('Password')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Use a recovery code instead' }));
    await user.type(screen.getByLabelText('Recovery code'), '01234567-89abcdef-01234567-89abcdef');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That recovery code didn't work. Each code works once; check it and try again.",
    );
    expect(screen.getByLabelText('Recovery code')).toHaveFocus();
  });

  it('auth-05 moves the cursor to the first invalid field and announces the problem', async () => {
    const user = await renderLogin();
    await user.type(screen.getByLabelText('Email'), owner.email);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your password');
    expect(api.login).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Password'), 'Synthetic-password-42!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const field = await screen.findByLabelText('Code from your authenticator app');
    await user.type(field, '123');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(field).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter all 6 digits');
    expect(api.verifyFactor).not.toHaveBeenCalled();
  });

  it('auth-04 ends the sign-in after five refused codes and asks for the password again', async () => {
    api.verifyFactor.mockRejectedValue({ isAxiosError: true, response: { status: 401 } });
    const user = await renderLogin();
    await submitPassword(user);
    const field = await screen.findByLabelText('Code from your authenticator app');
    for (let attempt = 1; attempt < 5; attempt++) {
      await user.type(field, '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
      await screen.findByText(/That code didn't work/);
    }
    await user.type(field, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(
      await screen.findByText(
        'Too many wrong codes, so this sign-in ended. Enter your password again.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Too many wrong codes');
    expect(screen.queryByLabelText('Code from your authenticator app')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue(owner.email);
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(api.verifyFactor).toHaveBeenCalledTimes(5);
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
  });

  it('auth-04 says the sign-in took too long when the code comes after five minutes', async () => {
    api.verifyFactor.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    const realNow = performance.now.bind(performance);
    let skipped = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => realNow() + skipped);
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '123456');
    skipped = 5 * 60 * 1000;
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(
      await screen.findByText('The sign-in took too long. Enter your password again.'),
    ).toBeVisible();
    expect(screen.queryByText(/That code didn't work/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('auth-title names the sign-in page in the browser tab', async () => {
    await renderLogin();
    expect(document.title).toBe('Sign in · Capital Tracker');
  });

  it('auth-04 counts the five minutes from no earlier than the code step came on screen', async () => {
    api.verifyFactor.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    // The page has been open for ten minutes before the owner signs in.
    const realNow = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => realNow() + 10 * 60 * 1000);
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Link to="/elsewhere">Elsewhere</Link>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/elsewhere" element={<Link to="/login">Back to sign-in</Link>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByLabelText('Password');
    const user = userEvent.setup();
    await submitPassword(user);
    await screen.findByLabelText('Code from your authenticator app');
    // The code step is opened again: the sign-in form starts anew, the pending step goes on.
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    await user.click(screen.getByRole('link', { name: 'Back to sign-in' }));
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText(/That code didn't work/)).toBeVisible();
    expect(screen.queryByText(/took too long/)).not.toBeInTheDocument();
  });

  it('auth-04 keeps the code step for a refused code inside the five minutes', async () => {
    api.verifyFactor.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    const realNow = performance.now.bind(performance);
    let skipped = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => realNow() + skipped);
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '123456');
    skipped = 4 * 60 * 1000;
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText(/That code didn't work/)).toBeVisible();
    expect(screen.getByLabelText('Code from your authenticator app')).toHaveFocus();
  });

  it('auth-07 the owner code lock, which sends no Retry-After, promises no wait and names the way out', async () => {
    // The ten-minute cooldown and the hundred-failure lock answer alike (mfa.service.ts
    // complete()): 429, this body, no Retry-After. The lock never lifts with time, and a
    // recovery code is refused as well, so the copy promises neither.
    api.verifyFactor.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 429,
        headers: {},
        data: {
          statusCode: 429,
          message: 'Too many attempts',
          error: 'Too Many Requests',
          timestamp: '2026-10-15T09:00:00.000Z',
          path: '/api/auth/mfa',
        },
      },
    });
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Too many wrong codes, so codes are paused. Try again later. If they are still refused, restore access on the server with the owner recovery command.',
    );
    expect(alert).not.toHaveTextContent(/minute|recovery code/i);
  });

  it('auth-07 asks for a minute when the server says the limit lifts within one', async () => {
    api.verifyFactor.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 429, headers: { 'retry-after': '30' } },
    });
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait a minute and try again.',
    );
    expect(screen.getByLabelText('Code from your authenticator app')).toHaveFocus();
  });

  it('checks the recovery code shape, explains a refused code and returns to the authenticator', async () => {
    api.verifyFactor.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    const user = await renderLogin();
    await submitPassword(user);
    await user.click(await screen.findByRole('button', { name: 'Use a recovery code instead' }));
    expect(screen.getByRole('heading', { name: 'Use a recovery code' })).toBeVisible();
    const field = screen.getByLabelText('Recovery code');
    expect(field).toHaveFocus();
    await user.type(field, '1234-5678');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText(/Recovery codes look like/)).toBeVisible();
    expect(api.verifyFactor).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, ' 01234567-89abcdef-01234567-89abcdef ');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(api.verifyFactor).toHaveBeenCalledExactlyOnceWith({
      kind: 'recovery',
      code: '01234567-89abcdef-01234567-89abcdef',
    });
    expect(
      await screen.findByText(
        "That recovery code didn't work. Each code works once; check it and try again.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Back to authenticator code' }));
    expect(screen.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
    expect(screen.getByLabelText('Code from your authenticator app')).toHaveValue('');
    expect(screen.getByLabelText('Code from your authenticator app')).toHaveFocus();
  });
});
