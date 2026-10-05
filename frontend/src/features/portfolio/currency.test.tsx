import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CurrencySwitch } from './currency';

describe('CurrencySwitch', () => {
  it('marks the clicked currency at once, before the address catches up', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CurrencySwitch value="EUR" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'RUB' }));
    expect(onChange).toHaveBeenCalledWith('RUB');
    expect(screen.getByRole('radio', { name: 'RUB' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'EUR' })).not.toBeChecked();

    // The page's currency then decides again, whichever it is.
    rerender(<CurrencySwitch value="USD" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'USD' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'RUB' })).not.toBeChecked();
  });
});
