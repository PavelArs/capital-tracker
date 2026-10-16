import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Card, CardHeader } from './Card';

afterEach(cleanup);

describe('Card and CardHeader', () => {
  it('a section card is a region named by its header', () => {
    render(
      <Card labelledBy="alloc-title">
        <CardHeader
          id="alloc-title"
          title="Allocation"
          sub="By class"
          actions={<Button size="sm">Edit</Button>}
        />
        <p>Rows</p>
      </Card>,
    );
    const region = screen.getByRole('region', { name: 'Allocation' });
    expect(region.tagName).toBe('SECTION');
    expect(region).toHaveClass('ui-card');
    expect(
      within(region).getByRole('heading', { level: 2, name: 'Allocation' }),
    ).toBeInTheDocument();
    expect(within(region).getByText('By class')).toHaveClass('ui-card-h__sub');
    expect(within(region).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('takes another element, a level-3 title and the flush and chart variants', () => {
    const { container, rerender } = render(
      <Card as="li" variant="flush">
        <CardHeader title="Bybit" level={3} sub={0} />
      </Card>,
    );
    const card = container.querySelector('li');
    expect(card).toHaveClass('ui-card', 'ui-card--flush');
    expect(screen.getByRole('heading', { level: 3, name: 'Bybit' })).toBeInTheDocument();
    // A count of 0 is still shown: missing is not zero, and zero is not missing.
    expect(screen.getByText('0')).toHaveClass('ui-card-h__sub');
    rerender(
      <Card as="div" variant="chart" className="extra">
        <CardHeader title="Net worth" />
      </Card>,
    );
    expect(container.querySelector('div.ui-card')).toHaveClass('ui-card--chart', 'extra');
    expect(container.querySelector('.ui-card-h__sub')).toBeNull();
  });

  it('CARD-LABEL is a region named by aria-label, and says it is busy while it loads', () => {
    const { rerender } = render(
      <Card label="Nearest goal" busy>
        <p>Rows</p>
      </Card>,
    );
    const region = screen.getByRole('region', { name: 'Nearest goal' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    rerender(
      <Card label="Nearest goal">
        <p>Rows</p>
      </Card>,
    );
    expect(screen.getByRole('region', { name: 'Nearest goal' })).not.toHaveAttribute('aria-busy');
  });
});
