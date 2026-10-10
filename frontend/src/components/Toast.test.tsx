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
});
