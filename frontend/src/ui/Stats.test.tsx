import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AmountHero } from './AmountHero';
import { Stat, Stats } from './Stats';

afterEach(cleanup);

describe('Stats and Stat', () => {
  it('is a named description list: each label a term, each figure its value', () => {
    const { container } = render(
      <Stats label="Summary" size="lg">
        <Stat label="Value" value="$12,400.00" hint="Estimated" />
        <Stat label="Profit" value="Unknown" tone="neg" />
      </Stats>,
    );
    const list = container.querySelector('dl');
    expect(list).toHaveAttribute('aria-label', 'Summary');
    expect(list).toHaveClass('ui-stats', 'ui-stats--lg');
    const value = screen.getByText('Value');
    expect(value.tagName).toBe('DT');
    expect(value.nextElementSibling).toHaveTextContent('$12,400.00');
    // The estimated flag stays on the page next to the figure.
    expect(screen.getByText('Estimated')).toHaveClass('ui-stat__hint');
    // A missing figure is shown as the caller wrote it, not as 0.
    const profit = screen.getByText('Unknown');
    expect(profit.tagName).toBe('DD');
    expect(profit).toHaveClass('ui-stat__value', 'ui-stat__value--neg');
  });
});

describe('AmountHero', () => {
  it('shows the badge, the amount as given and the detail line', () => {
    render(
      <AmountHero badge={<span>Blockchain · Buy</span>} amount="+0.5 BTC" detail="Cost unknown" />,
    );
    expect(screen.getByText('+0.5 BTC')).toHaveClass('ui-amt-hero__amount');
    expect(screen.getByText('Cost unknown')).toHaveClass('ui-amt-hero__detail');
    expect(screen.getByText('Blockchain · Buy')).toBeInTheDocument();
  });
});
