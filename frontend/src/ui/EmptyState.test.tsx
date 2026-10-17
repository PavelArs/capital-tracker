import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';
import EmptyState from './EmptyState';

afterEach(cleanup);

describe('EmptyState', () => {
  it('by default is a card region named by its h2 title, with the next step', () => {
    render(
      <EmptyState id="no-wallets" title="No wallets yet" actions={<Button>Add wallet</Button>}>
        Add an address to follow its balance.
      </EmptyState>,
    );
    const region = screen.getByRole('region', { name: 'No wallets yet' });
    expect(region).toHaveClass('ui-card', 'ui-empty');
    expect(screen.getByRole('heading', { level: 2, name: 'No wallets yet' })).toHaveAttribute(
      'id',
      'no-wallets',
    );
    expect(region).toHaveTextContent('Add an address to follow its balance.');
    expect(screen.getByRole('button', { name: 'Add wallet' })).toBeInTheDocument();
  });

  it('compact is a muted block with no card or heading; pos marks the all-done case', () => {
    const { container } = render(
      <EmptyState id="caught-up" title="All caught up" tone="pos" compact />,
    );
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    const block = container.firstElementChild;
    expect(block).toHaveClass('ui-empty', 'ui-empty--compact', 'ui-empty--pos');
    expect(screen.getByText('All caught up')).toHaveAttribute('id', 'caught-up');
  });
});
