import { ThemeProvider } from '@contexts/ThemeContext';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

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

  it('points to the legacy settings that are still separate', () => {
    renderSettings();
    expect(screen.getByRole('link', { name: 'Legacy settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });
});
