import { AuthProvider } from '@contexts/AuthContext';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from './ForgotPasswordPage';
import ResetPasswordPage from './ResetPasswordPage';

const api = vi.hoisted(() => ({
  request: vi.fn(),
  status: vi.fn(),
  confirm: vi.fn(),
}));
const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn(), logout: vi.fn() }));
vi.mock('@api', () => ({ passwordResetApi: api, authApi: auth }));

const token = 'A'.repeat(43);
const newPassword = 'Synthetic-new-reset-password-42!';
const refusal = (status: number, error?: string) => ({
  isAxiosError: true,
  response: { status, data: { error } },
});

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  const [pathname] = path.split('#');
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>Sign-in page</div>} />
          <Route path="/password-reset" element={<ForgotPasswordPage />} />
          <Route path="/password-reset/new" element={<ResetPasswordPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  for (const mock of [...Object.values(api), ...Object.values(auth)]) mock.mockReset();
  auth.getCurrentUser.mockRejectedValue(new Error('Unauthorized'));
  api.request.mockResolvedValue(undefined);
  api.status.mockResolvedValue('valid');
  api.confirm.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('RESET-REQUEST reset request screen', () => {
  it('asks for a valid email before sending anything', async () => {
    const user = renderAt('/password-reset');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(screen.getByText('Enter the email you sign in with')).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(api.request).not.toHaveBeenCalled();
  });

  it('shows the same "Check your email" answer and can send again', async () => {
    const user = renderAt('/password-reset');
    await user.type(screen.getByLabelText('Email'), ' owner@example.invalid ');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeVisible();
    expect(screen.getByText('owner@example.invalid')).toBeVisible();
    expect(screen.getByText(/works once and expires in 30 minutes/)).toBeVisible();
    expect(api.request).toHaveBeenCalledExactlyOnceWith('owner@example.invalid');

    await user.click(screen.getByRole('button', { name: 'Send again' }));
    expect(await screen.findByText('Sent again. Check your inbox and spam folder.')).toBeVisible();
    expect(api.request).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('link', { name: 'Back to sign in' }));
    expect(screen.getByText('Sign-in page')).toBeVisible();
  });

  it('RESET-LIMIT says to wait when the server refuses more requests', async () => {
    api.request.mockRejectedValueOnce(refusal(429));
    const user = renderAt('/password-reset');
    await user.type(screen.getByLabelText('Email'), 'owner@example.invalid');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument();
  });
});

describe('RESET-USE new password screen', () => {
  it('checks the link from the fragment and sets a new password', async () => {
    const user = renderAt(`/password-reset/new#token=${token}`);
    expect(screen.getByText('Checking the link…')).toBeVisible();
    await screen.findByLabelText('New password');
    expect(screen.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    expect(api.status).toHaveBeenCalledExactlyOnceWith(token);

    await user.type(screen.getByLabelText('New password'), 'too-short');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText('Use at least 15 characters')).toBeVisible();

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), newPassword);
    await user.type(screen.getByLabelText('Confirm password'), `${newPassword}x`);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText("Passwords don't match")).toBeVisible();
    expect(api.confirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Show new password' }));
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Confirm password'), newPassword);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeVisible();
    expect(screen.getByText(/signed out on all devices/)).toBeVisible();
    expect(api.confirm).toHaveBeenCalledExactlyOnceWith(token, newPassword);
    expect(window.location.hash).toBe('');
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(screen.getByText('Sign-in page')).toBeVisible();
  });

  it('RESET-EXPIRED offers a new link for an expired one', async () => {
    api.status.mockResolvedValueOnce('expired');
    const user = renderAt(`/password-reset/new#token=${token}`);

    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeVisible();
    expect(screen.getByText(/Your password hasn't changed/)).toBeVisible();
    expect(window.location.hash).toBe('');
    await user.click(screen.getByRole('link', { name: 'Send a new link' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  });

  it('RESET-REUSE refuses a used link and a link without a token', async () => {
    api.status.mockResolvedValueOnce('invalid');
    renderAt(`/password-reset/new#token=${token}`);
    expect(await screen.findByRole('heading', { name: 'This link no longer works' })).toBeVisible();
    cleanup();

    renderAt('/password-reset/new');
    expect(screen.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
    expect(api.status).toHaveBeenCalledTimes(1);
  });

  it('shows the expired page when the link runs out while the form is open', async () => {
    api.confirm.mockRejectedValueOnce(refusal(410, 'expired'));
    const user = renderAt(`/password-reset/new#token=${token}`);
    await user.type(await screen.findByLabelText('New password'), newPassword);
    await user.type(screen.getByLabelText('Confirm password'), newPassword);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeVisible();
  });

  it('keeps the form open after a refused or failed attempt', async () => {
    api.confirm.mockRejectedValueOnce(refusal(429)).mockRejectedValueOnce(new Error('offline'));
    const user = renderAt(`/password-reset/new#token=${token}`);
    await user.type(await screen.findByLabelText('New password'), newPassword);
    await user.type(screen.getByLabelText('Confirm password'), newPassword);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');

    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reset the password");
    expect(screen.getByLabelText('New password')).toHaveValue(newPassword);
  });
});
