import { connection } from '@api/connection';
import { forgetReads, generationNow, remember } from '@api/read-cache';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionBanner from './ConnectionBanner';

const state = () => document.querySelector('[data-connection-state]') as HTMLElement;

const unanswered = () => {
  const token = {};
  act(() => {
    connection.started(token);
    connection.settled(token, false);
  });
};

beforeEach(() => {
  forgetReads();
  connection.reset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  forgetReads();
  connection.reset();
});

describe('STALE-STATE the page says when its figures are kept from before', () => {
  it('STALE-STATE keeps an empty live region in the page while all is well', () => {
    remember('portfolio:[]', {}, generationNow());
    render(<ConnectionBanner />);
    expect(state()).toBeEmptyDOMElement();
    expect(state()).toHaveAttribute('aria-live', 'polite');
  });

  it('STALE-STATE says it could not refresh, from when the figures are, and retries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-17T11:05:00Z'));
    remember('portfolio:[]', {}, generationNow());
    vi.setSystemTime(new Date('2026-10-17T11:20:00Z'));
    render(<ConnectionBanner />);
    unanswered();
    expect(state()).toHaveTextContent(
      "Couldn't refreshShowing what was loaded at 11:05 UTC. Figures may have changed since.",
    );
    const before = connection.get().attempt;
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Retry' }));
    expect(connection.get().attempt).toBe(before + 1);
  });

  it('STALE-STATE says the browser is offline', () => {
    remember('portfolio:[]', {}, generationNow());
    render(<ConnectionBanner />);
    act(() => connection.setOffline(true));
    expect(state()).toHaveTextContent(/^You're offlineShowing what was loaded at \d\d:\d\d UTC\./);
  });

  it('STALE-STATE says the kept figures are being refreshed when a read is slow', () => {
    vi.useFakeTimers();
    remember('portfolio:[]', {}, generationNow());
    render(<ConnectionBanner />);
    const token = {};
    act(() => connection.started(token));
    expect(state()).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(state()).toHaveTextContent(/^Refreshing… The figures shown were loaded at/);
    act(() => connection.settled(token, true));
    expect(state()).toBeEmptyDOMElement();
  });

  it('STALE-STATE says nothing when nothing is kept: the page shows its own error', () => {
    render(<ConnectionBanner />);
    unanswered();
    expect(state()).toBeEmptyDOMElement();
  });
});
