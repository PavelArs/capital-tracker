import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSegmentedTabs } from './SegmentedTabs';

afterEach(cleanup);

type Period = '1M' | '1Y' | 'ALL';

function Chart({ size }: { size?: 'md' | 'sm' }) {
  const [period, setPeriod] = useState<Period>('1Y');
  const { tabs, panelProps } = useSegmentedTabs<Period>({
    label: 'Period',
    options: ['1M', '1Y', ['ALL', 'All time']],
    value: period,
    onChange: setPeriod,
    size,
  });
  return (
    <>
      {tabs}
      <div {...panelProps}>Chart for {period}</div>
    </>
  );
}

describe('useSegmentedTabs', () => {
  it('is a named tab list whose chosen tab names the one panel', () => {
    render(<Chart />);
    const list = screen.getByRole('tablist', { name: 'Period' });
    expect(list).toHaveClass('ui-seg');
    expect(list).not.toHaveClass('ui-seg--sm');
    const chosen = screen.getByRole('tab', { name: '1Y' });
    expect(chosen).toHaveAttribute('aria-selected', 'true');
    expect(chosen).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: '1M' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: '1M' })).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel', { name: '1Y' });
    expect(panel).toHaveTextContent('Chart for 1Y');
    expect(chosen).toHaveAttribute('aria-controls', panel.id);
  });

  it('chooses a tab on a click and with the arrow, Home and End keys', async () => {
    const user = userEvent.setup();
    render(<Chart />);
    await user.click(screen.getByRole('tab', { name: 'All time' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Chart for ALL');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '1M' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: '1M' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'All time' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tabpanel', { name: '1M' })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(screen.getByRole('tabpanel', { name: 'All time' })).toBeInTheDocument();
  });

  it('draws the small pill when asked', () => {
    render(<Chart size="sm" />);
    expect(screen.getByRole('tablist', { name: 'Period' })).toHaveClass('ui-seg', 'ui-seg--sm');
  });
});
