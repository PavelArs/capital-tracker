import ToastViewport from '@components/Toast';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ToastInput, ToastProvider, useToast } from './ToastContext';

function Trigger({ toasts }: { toasts: ToastInput[] }) {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => toasts.forEach(show)}>
      Act
    </button>
  );
}

const setup = (toasts: ToastInput[]) =>
  render(
    <ToastProvider>
      <Trigger toasts={toasts} />
      <ToastViewport />
    </ToastProvider>,
  );

/** The texts of the toasts in the polite status region (success, info), oldest first. */
const polite = () =>
  Array.from(screen.getByRole('status').querySelectorAll('.ui-toast')).map(
    (toast) => toast.textContent,
  );
const toastCount = () =>
  screen.getByRole('region', { name: 'Messages' }).querySelectorAll('.ui-toast').length;

const fire = () => act(() => screen.getByRole('button', { name: 'Act' }).click());
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TOAST-SYSTEM: the app-wide toasts', () => {
  it('TOAST-LIVE keeps an empty polite status region in the page before the first toast', async () => {
    const user = userEvent.setup();
    setup([{ tone: 'success', title: 'Goal deleted.' }]);
    const region = screen.getByRole('region', { name: 'Messages' });
    const live = within(region).getByRole('status');
    expect(live).toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: 'Act' }));
    // The toast is added to the same node, which a screen reader was already watching.
    expect(within(region).getByRole('status')).toBe(live);
    expect(live).toHaveTextContent('Goal deleted.');
    expect(live.querySelector('[role]')).toBeNull();
  });

  it('TOAST-ROLE announces success and info politely, warnings and errors at once', async () => {
    const user = userEvent.setup();
    setup([
      { tone: 'success', title: 'Goal saved.', detail: 'On track for June 2027.' },
      { tone: 'info', title: 'Wallet added', detail: 'Syncing transactions…' },
      { tone: 'warning', title: 'Rate not saved' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Act' }));
    const region = screen.getByRole('region', { name: 'Messages' });
    expect(within(region).getByRole('status')).toBe(screen.getByRole('status'));
    expect(polite()).toEqual([
      'Goal saved.On track for June 2027.',
      'Wallet addedSyncing transactions…',
    ]);
    expect(within(region).getByRole('alert')).toHaveTextContent('Rate not saved');
    expect(region.querySelector('.ui-toast--success')).toHaveTextContent('Goal saved.');
  });

  it('TOAST-ROLE shows an error as an alert', async () => {
    const user = userEvent.setup();
    setup([{ tone: 'error', title: 'Unable to log out. Please try again.' }]);
    await user.click(screen.getByRole('button', { name: 'Act' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to log out. Please try again.');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('TOAST-LIFETIME hides success after 5 s and an error after 7 s', () => {
    vi.useFakeTimers();
    setup([
      { tone: 'success', title: 'Saved.' },
      { tone: 'error', title: 'Could not save.' },
    ]);
    fire();
    wait(4900);
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    wait(200);
    expect(polite()).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save.');
    wait(1800);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    wait(200);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toastCount()).toBe(0);
  });

  it('TOAST-HOLD stays while hovered or focused and restarts its time after', () => {
    vi.useFakeTimers();
    setup([{ tone: 'success', title: 'Wallet renamed.' }]);
    fire();
    const toast = screen.getByText('Wallet renamed.').closest('.ui-toast') as HTMLElement;
    fireEvent.mouseEnter(toast);
    wait(60_000);
    expect(polite()).toEqual(['Wallet renamed.']);
    fireEvent.mouseLeave(toast);
    fireEvent.focus(toast);
    wait(60_000);
    expect(polite()).toEqual(['Wallet renamed.']);
    fireEvent.blur(toast);
    wait(4900);
    expect(polite()).toEqual(['Wallet renamed.']);
    wait(200);
    expect(polite()).toEqual([]);
  });

  it('TOAST-STACK keeps the three newest and shows the same title once', async () => {
    const user = userEvent.setup();
    setup([
      { tone: 'success', title: 'One' },
      { tone: 'success', title: 'Two' },
      { tone: 'success', title: 'Two', detail: 'again' },
      { tone: 'success', title: 'Three' },
      { tone: 'success', title: 'Four' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Act' }));
    expect(polite()).toEqual(['Twoagain', 'Three', 'Four']);
  });

  it('TOAST-ACTION runs its one action and closes; Dismiss closes it too', async () => {
    const user = userEvent.setup();
    const review = vi.fn();
    setup([
      { tone: 'success', title: 'Wallet synced', action: { label: 'Review', onClick: review } },
      { tone: 'info', title: 'Copied' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Act' }));
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(review).toHaveBeenCalledOnce();
    expect(polite()).toEqual(['Copied']);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(polite()).toEqual([]);
  });

  it('TOAST-NO-PROVIDER does nothing, and does not fail, without a provider', async () => {
    const user = userEvent.setup();
    render(<Trigger toasts={[{ tone: 'success', title: 'Saved.' }]} />);
    await user.click(screen.getByRole('button', { name: 'Act' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
