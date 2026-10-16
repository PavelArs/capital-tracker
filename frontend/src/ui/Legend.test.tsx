import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Badge from './Badge';
import { Legend } from './Legend';

afterEach(cleanup);

describe('Legend', () => {
  it('lists what each mark stands for; the swatches are hidden', () => {
    render(
      <Legend
        items={[
          { key: 'value', label: 'Value', swatch: 'line', color: 'var(--accent)' },
          { key: 'in', label: 'Put in', swatch: 'dash', color: 'var(--ink-3)' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Value', 'Put in']);
    const swatch = items[1].querySelector('.ui-legend__key');
    expect(swatch).toHaveClass('ui-legend__key--dash');
    expect(swatch).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Badge', () => {
  it('says its state in words; pulse implies the dot', () => {
    const { rerender } = render(
      <Badge tone="info" pulse>
        Syncing
      </Badge>,
    );
    expect(screen.getByText('Syncing')).toHaveClass(
      'ui-badge',
      'ui-badge--info',
      'ui-badge--dot',
      'ui-badge--pulse',
    );
    rerender(<Badge>Manual</Badge>);
    expect(screen.getByText('Manual')).toHaveClass('ui-badge', 'ui-badge--neutral');
    expect(screen.getByText('Manual')).not.toHaveClass('ui-badge--dot');
  });
});
