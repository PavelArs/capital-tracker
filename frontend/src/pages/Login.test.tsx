import { AuthProvider, useAuth } from '@contexts/AuthContext';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '../i18n/locales/ru.json';
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
  const i18n = createInstance();
  await i18n.init({
    lng: 'ru',
    resources: { ru: { translation: ru } },
    interpolation: { escapeValue: false },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter
        initialEntries={['/login']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <ProfileStatus />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<div>Private portfolio</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
  await screen.findByLabelText('Пароль');
  return userEvent.setup();
}

async function submitPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), owner.email);
  await user.type(screen.getByLabelText('Пароль'), 'Synthetic-password-42!');
  await user.click(screen.getByRole('button', { name: 'Вход' }));
}

describe('Russian owner second-factor login', () => {
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

  it('keeps password success anonymous on the factor step without opening the portfolio', async () => {
    const user = await renderLogin();
    await submitPassword(user);

    expect(screen.queryByText('Private portfolio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
    expect(await screen.findByLabelText('Код из приложения')).toBeVisible();
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
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
    await user.type(await screen.findByLabelText('Код из приложения'), '012345');
    expect(api.verifyFactor).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(api.verifyFactor).toHaveBeenCalledExactlyOnceWith({ kind: 'totp', code: '012345' });
    expect(screen.queryByText('Private portfolio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
    expect(screen.getByLabelText('Код из приложения')).toBeDisabled();
    completeFactor(fullResponse);
    expect(await screen.findByText('Private portfolio')).toBeVisible();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent(owner.email);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });

  it('offers a Russian recovery form and preserves the recovery code as a string', async () => {
    const user = await renderLogin();
    await submitPassword(user);
    await user.click(
      await screen.findByRole('button', { name: 'Использовать код восстановления' }),
    );
    const code = '01234567-89ABCDEF-01234567-89ABCDEF';
    await user.type(screen.getByLabelText('Код восстановления'), code);
    expect(api.verifyFactor).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await screen.findByText('Private portfolio');
    expect(api.verifyFactor).toHaveBeenCalledExactlyOnceWith({ kind: 'recovery', code });
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });

  it('shows a generic Russian invalid-code error without retrying or exposing the server message', async () => {
    api.verifyFactor.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: { message: 'Internal secret marker' } },
    });
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Код из приложения'), '123456');
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(
      await screen.findByText(
        'Не удалось подтвердить вход. Проверьте код или вернитесь к вводу пароля.',
      ),
    ).toBeVisible();
    expect(api.verifyFactor).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Internal secret marker')).not.toBeInTheDocument();
    expect(screen.queryByText('Private portfolio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
  });

  it('shows Russian cooldown guidance without automatically repeating a blocked factor', async () => {
    api.verifyFactor.mockRejectedValueOnce({ isAxiosError: true, response: { status: 429 } });
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Код из приложения'), '123456');
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(await screen.findByText('Слишком много попыток. Повторите позже.')).toBeVisible();
    expect(api.verifyFactor).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
  });

  it('can return to the password form and clears the previous password and factor input', async () => {
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Код из приложения'), '012345');
    await user.click(screen.getByRole('button', { name: 'Вернуться к паролю' }));

    expect(screen.getByLabelText('Пароль')).toHaveValue('');
    expect(screen.queryByLabelText('Код из приложения')).not.toBeInTheDocument();
    expect(api.verifyFactor).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Пароль'), 'Synthetic-password-42!');
    await user.click(screen.getByRole('button', { name: 'Вход' }));
    expect(await screen.findByLabelText('Код из приложения')).toHaveValue('');
    expect(api.login).toHaveBeenCalledTimes(2);
  });

  it('starts a new password step after reload instead of remembering a pending factor', async () => {
    const user = await renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText('Код из приложения'), '012345');
    cleanup();
    await renderLogin();

    await waitFor(() => expect(screen.getByLabelText('Пароль')).toHaveValue(''));
    expect(screen.queryByLabelText('Код из приложения')).not.toBeInTheDocument();
    expect(screen.getByLabelText('authenticated owner')).toHaveTextContent('anonymous');
    expect(api.verifyFactor).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });
});
