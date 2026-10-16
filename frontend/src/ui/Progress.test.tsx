import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Progress } from './Progress';
import { Steps } from './Steps';

afterEach(cleanup);

describe('Progress', () => {
  it('determinate: says how far, clamped to 0..100', () => {
    const { rerender } = render(<Progress value={42.5} label="Saved towards Flat" />);
    const bar = screen.getByRole('progressbar', { name: 'Saved towards Flat' });
    expect(bar).toHaveAttribute('aria-valuenow', '42.5');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveClass('ui-progress', 'ui-progress--bar');
    rerender(<Progress value={130} label="Saved towards Flat" tone="pos" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar')).toHaveClass('ui-progress--pos');
  });

  it('indeterminate: no value is claimed while something runs', () => {
    render(<Progress label="Syncing transactions" size="thin" />);
    const bar = screen.getByRole('progressbar', { name: 'Syncing transactions' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).not.toHaveAttribute('aria-valuemin');
    expect(bar).toHaveClass('ui-progress--thin', 'ui-progress--indeterminate');
  });

  it('a value that is not a number is treated as unknown, not as 0', () => {
    render(<Progress value={Number.NaN} label="Saved towards Car" />);
    expect(screen.getByRole('progressbar', { name: 'Saved towards Car' })).not.toHaveAttribute(
      'aria-valuenow',
    );
  });
});

describe('Steps', () => {
  it('says the step in words and draws one bar per step, the done ones on', () => {
    const { container } = render(<Steps current={2} total={3} />);
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    const bars = container.querySelector('.ui-steps__bars');
    expect(bars).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.ui-steps__bar')).toHaveLength(3);
    expect(container.querySelectorAll('.ui-steps__bar--on')).toHaveLength(2);
  });
});
