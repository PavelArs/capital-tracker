import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CurrencySwitch, ratesNote } from './currency';

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

describe('CUR-RATE-STALE ratesNote', () => {
  const euro = { currency: 'EUR' as const, date: '2026-10-04', rubPerUnit: '110' };
  const dollar = { currency: 'USD' as const, date: '2026-10-04', rubPerUnit: '95' };

  it('says only other currencies stop converting when the report currency rate is stale', () => {
    const note = ratesNote({
      currency: 'EUR',
      rates: [],
      staleRates: [{ currency: 'EUR', date: '2026-09-18' }],
    });
    expect(note).toBe(
      'Values in other currencies cannot be converted to EUR because the latest Bank of Russia EUR rate is older than 15 days (Sep 18, 2026); EUR holdings still show.',
    );
    expect(note).not.toMatch(/No Bank of Russia rate/);
  });

  it('names a stale other currency after the rates the values use', () => {
    expect(
      ratesNote({
        currency: 'RUB',
        rates: [euro],
        staleRates: [{ currency: 'USD', date: '2026-09-18' }],
      }),
    ).toBe(
      "Values are in RUB from the latest stored prices and Bank of Russia rates: 1 EUR = 110.00 RUB (Oct 4, 2026). Costs and realized P&L use the rate of each operation's date. Values in USD cannot be converted to RUB because the latest Bank of Russia USD rate is older than 15 days (Sep 18, 2026).",
    );
  });

  it('lists the rates alone when all are fresh', () => {
    expect(ratesNote({ currency: 'EUR', rates: [dollar, euro], staleRates: [] })).toBe(
      "Values are in EUR from the latest stored prices and Bank of Russia rates: 1 USD = 95.00 RUB (Oct 4, 2026), 1 EUR = 110.00 RUB (Oct 4, 2026). Costs and realized P&L use the rate of each operation's date.",
    );
  });

  it('does not claim a rate was never stored when it cannot tell', () => {
    // An answer saved before staleRates was added says nothing of which rates are stale.
    expect(ratesNote({ currency: 'USD', rates: [] })).toBe(
      'Values in other currencies cannot be converted to USD because no Bank of Russia USD rate from the last 15 days is stored; USD holdings still show.',
    );
  });
});
