import { type FxRatesReport, fxRatesApi } from '@api/fx-rates.api';
import { ownerSettingsApi } from '@api/owner-settings.api';
import { securityApi } from '@api/security.api';
import { ThemeProvider } from '@contexts/ThemeContext';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

// Settings → Security has its own tests; here it only has to render.
vi.mock('@contexts/AuthContext', () => ({
  useAuth: () => ({ logoutEverywhere: vi.fn(), user: { email: 'owner@example.test' } }),
}));

// A controllable device colour scheme behind window.matchMedia.
let deviceDark = false;
const listeners = new Set<() => void>();
function setDevice(dark: boolean) {
  deviceDark = dark;
  act(() => {
    for (const listener of listeners) listener();
  });
}

const stored = new Map<string, string>();

beforeEach(() => {
  vi.restoreAllMocks();
  // Theme cases do not depend on the server settings; they stay pending.
  vi.spyOn(ownerSettingsApi, 'get').mockReturnValue(new Promise(() => {}));
  vi.spyOn(fxRatesApi, 'get').mockReturnValue(new Promise(() => {}));
  vi.spyOn(securityApi, 'get').mockReturnValue(new Promise(() => {}));
  stored.clear();
  listeners.clear();
  vi.mocked(window.localStorage.getItem).mockImplementation((key) => stored.get(key) ?? null);
  vi.mocked(window.localStorage.setItem).mockImplementation((key, value) => {
    stored.set(key, String(value));
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query === '(prefers-color-scheme: dark)' ? deviceDark : false;
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }),
  });
  document.documentElement.removeAttribute('data-theme');
});

afterEach(cleanup);

function renderSettings() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const applied = () => document.documentElement.getAttribute('data-theme');

describe('SHELL-006 theme setting', () => {
  it('SHELL-006-A: defaults to System and follows the device while open', () => {
    deviceDark = true;
    renderSettings();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Light' })).not.toBeChecked();
    expect(applied()).toBe('dark');
    setDevice(false);
    expect(applied()).toBe('light');
    expect(screen.getByText(/follows your device/i)).toBeInTheDocument();
  });

  it('SHELL-006-B: an explicit choice applies at once, persists and ignores the device', async () => {
    deviceDark = false;
    const user = userEvent.setup();
    const first = renderSettings();
    expect(applied()).toBe('light');
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(applied()).toBe('dark');
    expect(stored.get('theme')).toBe('dark');
    first.unmount();

    renderSettings();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(applied()).toBe('dark');
    setDevice(false);
    expect(applied()).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(stored.get('theme')).toBe('system');
    expect(applied()).toBe('light');
    setDevice(true);
    expect(applied()).toBe('dark');
  });

  it('S1: Settings starts with a Profile card that shows the sign-in email', () => {
    renderSettings();
    const profile = screen.getByRole('region', { name: 'Profile' });
    expect(within(profile).getByText('owner@example.test')).toBeInTheDocument();
    expect(
      profile.compareDocumentPosition(screen.getByRole('region', { name: 'Security' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('HIST-LINK: Settings opens the change history', () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open history' })).toHaveAttribute('href', '/history');
  });

  it('G1: Settings no longer lists older screens', () => {
    renderSettings();
    expect(screen.queryByRole('heading', { level: 2, name: 'Older screens' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open manual accounts' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open manual prices' })).toBeNull();
    expect(screen.queryByText(/still in Russian/)).toBeNull();
  });

  it('no longer points to the retired legacy settings (M20)', () => {
    renderSettings();
    expect(screen.queryByRole('link', { name: 'Legacy settings' })).toBeNull();
    expect(screen.queryByText(/old display rates/)).toBeNull();
  });
});

describe('CUR-SWITCH main currency setting', () => {
  const rates: FxRatesReport = {
    date: '2026-10-04',
    source: 'cbr',
    rates: [
      { currency: 'USD', rubPerUnit: '95.1234', date: '2026-10-04' },
      { currency: 'EUR', rubPerUnit: '110', date: '2026-10-03' },
    ],
    sync: null,
  };

  it('loads the saved currency, saves a new one and shows the stored rates', async () => {
    vi.spyOn(ownerSettingsApi, 'get').mockResolvedValue({
      mainCurrency: 'USD',
      dustThresholdUsd: null,
    });
    const update = vi.spyOn(ownerSettingsApi, 'update').mockImplementation(async (settings) => ({
      mainCurrency: 'USD',
      dustThresholdUsd: null,
      ...settings,
    }));
    vi.spyOn(fxRatesApi, 'get').mockResolvedValue(rates);
    const user = userEvent.setup();
    renderSettings();
    const group = screen.getByRole('radiogroup', { name: 'Main currency' });
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'USD' })).toBeChecked());
    expect(
      await screen.findByText(
        'Bank of Russia: 1 USD = 95.1234 RUB (Oct 4, 2026), 1 EUR = 110.00 RUB (Oct 3, 2026).',
      ),
    ).toBeInTheDocument();
    await user.click(within(group).getByRole('radio', { name: 'EUR' }));
    expect(update).toHaveBeenCalledWith({ mainCurrency: 'EUR' });
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'EUR' })).toBeChecked());
    expect(screen.getByText(/Portfolio values, cost and P&L are shown in it/)).toBeInTheDocument();
  });

  it('keeps the saved currency when saving fails and says so', async () => {
    vi.spyOn(ownerSettingsApi, 'get').mockResolvedValue({
      mainCurrency: 'RUB',
      dustThresholdUsd: null,
    });
    vi.spyOn(ownerSettingsApi, 'update').mockRejectedValue(new Error('offline'));
    vi.spyOn(fxRatesApi, 'get').mockResolvedValue({
      ...rates,
      rates: [],
      sync: {
        key: 'fx:cbr',
        state: 'failed',
        lastAttemptAt: '2026-10-04T10:05:00.000Z',
        lastSuccessAt: null,
        nextRunAt: '2026-10-04T11:05:00.000Z',
        errorCode: 'unavailable',
        errorMessage: 'Bank of Russia did not answer; no new rates for USD, EUR',
      },
    });
    const user = userEvent.setup();
    renderSettings();
    const group = screen.getByRole('radiogroup', { name: 'Main currency' });
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'RUB' })).toBeChecked());
    expect(
      await screen.findByText(
        /No Bank of Russia rate is stored yet; EUR and RUB show "No rate"\. Last update failed: Bank of Russia did not answer/,
      ),
    ).toBeInTheDocument();
    await user.click(within(group).getByRole('radio', { name: 'USD' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the main currency; nothing changed.',
    );
    expect(within(group).getByRole('radio', { name: 'RUB' })).toBeChecked();
  });
});

describe('dust threshold (CLS-DUST)', () => {
  it('saves a threshold, refuses a bad one and turns it off when emptied', async () => {
    vi.spyOn(ownerSettingsApi, 'get').mockResolvedValue({
      mainCurrency: 'USD',
      dustThresholdUsd: null,
    });
    const update = vi.spyOn(ownerSettingsApi, 'update').mockImplementation(async (settings) => ({
      mainCurrency: 'USD',
      dustThresholdUsd: null,
      ...settings,
    }));
    const user = userEvent.setup();
    renderSettings();
    const input = await screen.findByRole('textbox', { name: 'Dust threshold' });
    await waitFor(() => expect(input).toBeEnabled());
    expect(
      screen.getByText('Off: every incoming wallet transaction asks to be classified.'),
    ).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save' });

    await user.type(input, '0');
    await user.click(save);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an amount in USD above 0 and up to 1,000,000, or leave it empty to turn it off.',
    );
    expect(update).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '1.5');
    await user.click(save);
    expect(update).toHaveBeenCalledWith({ dustThresholdUsd: '1.5' });
    expect(
      await screen.findByText(
        'Saved. Smaller incoming transactions are under Transactions → Dust.',
      ),
    ).toBeInTheDocument();

    await user.clear(input);
    await user.click(save);
    expect(update).toHaveBeenLastCalledWith({ dustThresholdUsd: null });
    expect(
      await screen.findByText(
        'Saved. Every incoming wallet transaction asks to be classified again.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the saved threshold and keeps it when saving fails', async () => {
    vi.spyOn(ownerSettingsApi, 'get').mockResolvedValue({
      mainCurrency: 'USD',
      dustThresholdUsd: '2',
    });
    vi.spyOn(ownerSettingsApi, 'update').mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderSettings();
    const input = await screen.findByRole('textbox', { name: 'Dust threshold' });
    await waitFor(() => expect(input).toHaveValue('2'));
    expect(
      screen.getByText(
        "Incoming wallet transactions worth less than $2.00 at the latest price don't ask to be classified.",
      ),
    ).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the dust threshold; nothing changed.',
    );
  });
});
