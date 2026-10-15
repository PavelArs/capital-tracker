import { ErrorProvider, useError } from '@contexts/ErrorContext';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ToastViewport from './Toast';

function Trigger({ messages }: { messages: string[] }) {
  const { showError } = useError();
  return (
    <button type="button" onClick={() => messages.forEach(showError)}>
      Fail
    </button>
  );
}

const setup = (messages: string[]) =>
  render(
    <ErrorProvider>
      <Trigger messages={messages} />
      <ToastViewport />
    </ErrorProvider>,
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TOAST pop-up errors', () => {
  it('shows an error as an alert and closes it with the dismiss button', async () => {
    const user = userEvent.setup();
    setup(['Network error. Please check your connection.']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fail' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Network error. Please check your connection.',
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the same message once and keeps the three newest', async () => {
    const user = userEvent.setup();
    setup(['One', 'Two', 'Two', 'Three', 'Four']);
    await user.click(screen.getByRole('button', { name: 'Fail' }));
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'Two',
      'Three',
      'Four',
    ]);
  });

  it('hides itself after a while, but not while the pointer rests on it', () => {
    vi.useFakeTimers();
    setup(['Slow down']);
    act(() => screen.getByRole('button', { name: 'Fail' }).click());
    const alert = screen.getByRole('alert');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(alert).toBeInTheDocument();
    fireEvent.mouseEnter(alert);
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.mouseLeave(alert);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shell-16 sits under the pinned strip only below 960 px, not at 960 px', async () => {
    const user = userEvent.setup();
    const nav = document.createElement('nav');
    nav.className = 'shell-nav';
    nav.getBoundingClientRect = () => ({ bottom: 48 }) as DOMRect;
    document.body.append(nav);
    const at = (width: number) =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: width <= Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? Number.NaN),
      }));
    try {
      at(960);
      const { container, unmount } = setup(['Unable to log out. Please try again.']);
      await user.click(screen.getByRole('button', { name: 'Fail' }));
      expect(container.querySelector<HTMLElement>('.toast-viewport')?.style.top).toBe('');
      unmount();
      at(959);
      const narrow = setup(['Unable to log out. Please try again.']);
      await user.click(screen.getByRole('button', { name: 'Fail' }));
      expect(narrow.container.querySelector<HTMLElement>('.toast-viewport')?.style.top).toBe(
        '56px',
      );
    } finally {
      nav.remove();
      vi.unstubAllGlobals();
    }
  });
});
