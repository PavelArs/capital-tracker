import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingRow } from './SettingRow';

afterEach(cleanup);

describe('SettingRow', () => {
  it('lets the control be labelled by the title and keeps a live status line', () => {
    const { rerender } = render(
      <SettingRow
        title="Main currency"
        titleId="main-currency"
        description="Totals are shown in it."
        control={
          <select aria-labelledby="main-currency">
            <option>USD</option>
          </select>
        }
        status=""
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Main currency' })).toBeInTheDocument();
    expect(screen.getByText('Totals are shown in it.')).toHaveClass('ui-setting__desc');
    // The status line is there, empty, before anything happens, so the change is heard.
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    rerender(<SettingRow title="Main currency" titleId="main-currency" status="Saved." />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('without a status has no live region', () => {
    render(<SettingRow title="Export" description="A JSON file." />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Export')).toHaveClass('ui-setting__title');
  });
});
