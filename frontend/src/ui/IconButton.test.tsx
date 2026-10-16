import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

afterEach(cleanup);

describe('IconButton', () => {
  it('is named and titled by its label; the icon is hidden', async () => {
    const click = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton label="Close" icon="close" buttonRef={ref} onClick={click} />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('title', 'Close');
    expect(button).toHaveClass('ui-ibtn');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(ref.current).toBe(button);
    await userEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
  });

  it('adds the count to its name and draws it, but not at 0', () => {
    const { rerender } = render(
      <IconButton
        label="Notifications"
        icon="bell"
        count={3}
        countLabel="3 need attention"
        onClick={() => {}}
      />,
    );
    const bell = screen.getByRole('button', { name: 'Notifications, 3 need attention' });
    expect(bell).toHaveAttribute('title', 'Notifications');
    expect(bell.querySelector('.ui-ibtn__count')).toHaveTextContent('3');
    rerender(
      <IconButton
        label="Notifications"
        icon="bell"
        count={0}
        countLabel="Nothing needs attention"
        onClick={() => {}}
      />,
    );
    const quiet = screen.getByRole('button', { name: 'Notifications' });
    expect(quiet.querySelector('.ui-ibtn__count')).toBeNull();
  });

  it('a disabled one cannot be pressed; the small size has its class', async () => {
    const click = vi.fn();
    render(<IconButton label="Dismiss" icon="close" size="sm" disabled onClick={click} />);
    const button = screen.getByRole('button', { name: 'Dismiss' });
    expect(button).toHaveClass('ui-ibtn', 'ui-ibtn--sm');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(click).not.toHaveBeenCalled();
  });
});
