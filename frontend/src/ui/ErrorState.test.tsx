import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorState } from './ErrorState';

afterEach(cleanup);

describe('ErrorState', () => {
  it('says what failed as an alert inside a card, with Try again', async () => {
    const retry = vi.fn();
    const { container } = render(
      <ErrorState onRetry={retry}>Could not load your goals.</ErrorState>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load your goals.');
    expect(alert).toHaveClass('ui-banner--neg');
    expect(container.firstElementChild).toHaveClass('ui-card', 'ui-error-state');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('while retrying the button is busy; without onRetry there is none', () => {
    const { rerender } = render(
      <ErrorState onRetry={() => {}} retrying retryLabel="Retry now">
        Prices failed.
      </ErrorState>,
    );
    const busy = screen.getByRole('button', { name: 'Retry now' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toBeDisabled();
    rerender(<ErrorState>Prices failed.</ErrorState>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Prices failed.');
  });
});
