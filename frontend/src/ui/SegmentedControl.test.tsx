import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

afterEach(cleanup);

describe('SegmentedControl', () => {
  it('is a named radio group; the chosen value is checked and a click picks another', async () => {
    const change = vi.fn();
    render(
      <SegmentedControl
        name="kind"
        label="Kind"
        options={['Flat', ['house', 'House']]}
        value="Flat"
        onChange={change}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Kind' });
    expect(group).toHaveClass('ui-seg');
    expect(screen.getByRole('radio', { name: 'Flat' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'House' }));
    expect(change).toHaveBeenCalledWith('house');
  });

  it('draws the small and the wrapping pill when asked', () => {
    render(
      <SegmentedControl
        name="p"
        label="Period"
        options={['1M', '1Y']}
        value={null}
        onChange={() => {}}
        size="sm"
        wrap
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Period' })).toHaveClass(
      'ui-seg',
      'ui-seg--sm',
      'ui-seg--wrap',
    );
    expect(screen.getByRole('radio', { name: '1M' })).not.toBeChecked();
  });
});
