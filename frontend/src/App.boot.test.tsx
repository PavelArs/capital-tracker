import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

// BOOT-SHELL: while the sign-in check is on its way the page already stands in its frame, with
// grey blocks where the content will be, instead of a sentence on an empty screen.
vi.mock('@contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: null, loading: true }),
}));
vi.mock('@components/Layout', () => ({ default: () => <p>the real layout</p> }));

function open(path: string) {
  window.history.replaceState(null, '', path);
  render(<App />);
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('BOOT-SHELL: the frame is drawn before the sign-in check answers', () => {
  it('shows the navigation and grey blocks, not a sentence, and stays on the asked page', () => {
    open('/portfolio');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText(/Загрузка/)).not.toBeInTheDocument();
    expect(screen.queryByText('the real layout')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/portfolio');
  });

  it('lays the blocks out like the page that was asked for', () => {
    open('/transactions');
    // Transactions is a long list, not figures with a chart.
    expect(document.querySelectorAll('.shell-skeleton__row').length).toBeGreaterThan(6);
    expect(document.querySelector('.shell-skeleton__stats')).toBeNull();
  });

  it('lays out the Dashboard for the bare address, which leads there', () => {
    open('/');
    // Figures and a chart, not figures and a list.
    expect(document.querySelector('.shell-skeleton__stats')).not.toBeNull();
    expect(document.querySelector('.shell-skeleton__rows')).toBeNull();
  });

  it('keeps the asked currency on the links and a place for the bell, like the real navigation', () => {
    open('/portfolio?currency=EUR');
    expect(screen.getByRole('link', { name: 'Transactions' })).toHaveAttribute(
      'href',
      '/transactions?currency=EUR',
    );
    expect(document.querySelector('.shell-owner__bell')).not.toBeNull();
  });

  it('lays out an asset page with its chart between the figures and the list', () => {
    open('/portfolio/some-asset');
    expect(document.querySelector('.shell-skeleton__stats')).not.toBeNull();
    expect(document.querySelector('.shell-skeleton__rows')).not.toBeNull();
    // The chart's card sits between the figures and the list.
    expect(document.querySelectorAll('.shell-skeleton__card')).toHaveLength(2);
    expect(document.querySelector('.shell-skeleton__cards')).toBeNull();
    expect(screen.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('aria-current', 'page');
  });

  it('draws a deposit page as cards', () => {
    open('/deposits/some-deposit');
    expect(document.querySelector('.shell-skeleton__cards')).not.toBeNull();
    expect(document.querySelector('.shell-skeleton__stats')).toBeNull();
  });

  it('marks and lays out the section a retired bookmark leads to', () => {
    open('/settings');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('.shell-skeleton__cards')).not.toBeNull();
    expect(document.querySelector('.shell-skeleton__stats')).toBeNull();
  });

  it('lets the first real page appear at once and restores the fade a moment after the frame leaves', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<App />);
      expect(document.documentElement).toHaveAttribute('data-from-boot');
      unmount();
      // The mark stays while the page that replaces the frame mounts, then comes off.
      expect(document.documentElement).toHaveAttribute('data-from-boot');
      vi.advanceTimersByTime(500);
      expect(document.documentElement).not.toHaveAttribute('data-from-boot');
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws as many rows as the history page does while its data is on its way', () => {
    open('/history');
    expect(document.querySelectorAll('.shell-skeleton__row')).toHaveLength(8);
  });
});
