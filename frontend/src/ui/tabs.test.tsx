import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useTabs } from './tabs';

const periods = ['7D', '1M', '1Y'] as const;

function Periods() {
  const [period, setPeriod] = useState<(typeof periods)[number]>('1M');
  const tabs = useTabs(periods, period, setPeriod);
  return (
    <>
      <div aria-label="Period" {...tabs.list}>
        {periods.map((value) => (
          <button key={value} type="button" {...tabs.tab(value)}>
            {value}
          </button>
        ))}
      </div>
      <div {...tabs.panel}>Chart of {period}</div>
    </>
  );
}

describe('portfolio-19 tabs follow the WAI-ARIA tabs pattern', () => {
  const tab = (name: string) => screen.getByRole('tab', { name });

  it('portfolio-19 keeps one tab stop, the chosen tab, and links every tab to the panel', () => {
    render(<Periods />);
    expect(screen.getByRole('tablist', { name: 'Period' })).toBeInTheDocument();
    expect(tab('1M')).toHaveAttribute('aria-selected', 'true');
    expect(tab('1M')).toHaveAttribute('tabindex', '0');
    expect(tab('7D')).toHaveAttribute('tabindex', '-1');
    expect(tab('1Y')).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel', { name: '1M' });
    for (const name of ['7D', '1M', '1Y'])
      expect(tab(name)).toHaveAttribute('aria-controls', panel.id);
  });

  it('portfolio-19 moves and chooses with the arrow keys round the ends, Home and End', async () => {
    const user = userEvent.setup();
    render(<Periods />);
    await user.tab();
    expect(tab('1M')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('1Y')).toHaveFocus();
    expect(tab('1Y')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: '1Y' })).toHaveTextContent('Chart of 1Y');
    await user.keyboard('{ArrowRight}');
    expect(tab('7D')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('1Y')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('7D')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('1Y')).toHaveFocus();
    // Other keys are left to the page.
    await user.keyboard('{ArrowDown}');
    expect(tab('1Y')).toHaveFocus();
    expect(tab('1Y')).toHaveAttribute('aria-selected', 'true');
    // A click chooses too, and Tab leaves the row from the chosen tab.
    await user.click(tab('7D'));
    expect(tab('7D')).toHaveAttribute('tabindex', '0');
    await user.tab();
    expect(document.body).toHaveFocus();
  });
});
