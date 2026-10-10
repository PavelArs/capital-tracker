import { ownerSettingsApi } from '@api/owner-settings.api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MainCurrencyProvider } from '../shell/main-currency';
import { CurrencySwitch, switchCurrencies } from './currency';
import { money } from './format';

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

describe('CUR-MORE currencies beyond USD, EUR and RUB', () => {
  it('offers the three base currencies, then the main currency when it is another one', () => {
    expect(switchCurrencies(undefined, 'USD')).toEqual(['USD', 'EUR', 'RUB']);
    expect(switchCurrencies('EUR', 'RUB')).toEqual(['USD', 'EUR', 'RUB']);
    expect(switchCurrencies('KZT', 'USD')).toEqual(['USD', 'EUR', 'RUB', 'KZT']);
    // A currency asked in the address stays visible so the checked one is on screen.
    expect(switchCurrencies('EUR', 'GBP')).toEqual(['USD', 'EUR', 'RUB', 'GBP']);
  });

  it('shows the main currency next to USD, EUR and RUB once the shell knows it', async () => {
    vi.spyOn(ownerSettingsApi, 'get').mockResolvedValue({
      mainCurrency: 'TRY',
      dustThresholdUsd: null,
    });
    render(
      <MainCurrencyProvider>
        <CurrencySwitch value="TRY" onChange={vi.fn()} />
      </MainCurrencyProvider>,
    );
    expect(await screen.findByRole('radio', { name: 'TRY' })).toBeChecked();
    await waitFor(() =>
      expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
        'USD',
        'EUR',
        'RUB',
        'TRY',
      ]),
    );
  });

  it('writes an amount with the symbol of each added currency', () => {
    expect(money('88.1', 'GBP')).toBe('£88.10');
    expect(money('-1234.5', 'CHF')).toBe('-CHF 1,234.50');
    expect(money('10', 'CNY')).toBe('CN¥10.00');
    expect(money('10', 'JPY')).toBe('JP¥10.00');
    expect(money('10', 'KZT')).toBe('₸10.00');
    expect(money('10', 'TRY')).toBe('₺10.00');
    expect(money('10', 'AED')).toBe('AED 10.00');
  });
});
