import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Affix, Input, Select, Textarea } from './inputs';

afterEach(cleanup);

describe('Input, Select, Textarea and Affix', () => {
  it('an amount is a text field with the decimal keypad and tabular figures, never type=number', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Amount" numeric size="sm" aria-invalid />);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).not.toHaveAttribute('type', 'number');
    expect(input).toHaveClass('ui-input', 'ui-input--sm', 'ui-num');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(ref.current).toBe(input);
  });

  it('keeps a caller inputMode and the mono class for addresses', () => {
    render(<Input aria-label="Address" mono inputMode="text" />);
    const input = screen.getByRole('textbox', { name: 'Address' });
    expect(input).toHaveClass('ui-input', 'ui-input--mono');
    expect(input).toHaveAttribute('inputmode', 'text');
  });

  it('a select and a textarea keep their native roles', () => {
    render(
      <>
        <Select aria-label="Currency" defaultValue="USD">
          <option>USD</option>
          <option>RUB</option>
        </Select>
        <Textarea aria-label="Comment" />
      </>,
    );
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveValue('USD');
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveClass('ui-input', 'ui-textarea');
  });

  it('an affix shows the unit after the field, where it can be read', () => {
    render(
      <Affix suffix="USD per 1 BTC" wide>
        <Input aria-label="Price" numeric />
      </Affix>,
    );
    const unit = screen.getByText('USD per 1 BTC');
    expect(unit).toHaveClass('ui-affix__suffix');
    expect(unit).not.toHaveAttribute('aria-hidden');
    expect(unit.parentElement).toHaveClass('ui-affix', 'ui-affix--wide');
  });
});
