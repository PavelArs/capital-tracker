import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DateTimeField } from './DateTimeField';
import { datePart, timePart } from './date-time';

function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateTimeField label="Дата" timeLabel="Время, UTC" value={value} onChange={setValue} />
      <output aria-label="value">{value}</output>
      <button type="button" onClick={() => setValue('')}>
        reset
      </button>
    </>
  );
}

const date = () => screen.getByLabelText('Дата') as HTMLInputElement;
const time = () => screen.getByLabelText('Время, UTC') as HTMLInputElement;
const value = () => screen.getByLabelText('value').textContent;

describe('DateTimeField while the owner types', () => {
  it('keeps an intermediate midnight time visible', () => {
    render(<Controlled initial="2025-06-13T00:30:00.000Z" />);
    fireEvent.change(time(), { target: { value: '00:00' } });
    expect(value()).toBe('2025-06-13T00:00:00.000Z');
    expect(time()).toHaveValue('00:00');
    fireEvent.change(time(), { target: { value: '00:05' } });
    expect(value()).toBe('2025-06-13T00:05:00.000Z');
  });

  it('keeps the seconds segment while seconds pass through zero', () => {
    render(<Controlled initial="2025-07-11T14:30:15.000Z" />);
    fireEvent.change(time(), { target: { value: '14:30:00' } });
    expect(value()).toBe('2025-07-11T14:30:00.000Z');
    expect(time()).toHaveValue('14:30:00');
    expect(time()).toHaveAttribute('step', '1');
  });

  it('forgets an earlier time after the form resets the value', () => {
    render(<Controlled initial="2025-07-11T12:30:00.000Z" />);
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    fireEvent.change(date(), { target: { value: '2025-08-01' } });
    expect(value()).toBe('2025-08-01T00:00:00.000Z');
    expect(time()).toHaveValue('');
  });

  it('keeps the time when the owner clears and re-enters only the date', () => {
    render(<Controlled initial="2025-07-11T12:30:00.000Z" />);
    fireEvent.change(date(), { target: { value: '' } });
    expect(value()).toBe('');
    fireEvent.change(date(), { target: { value: '2025-07-12' } });
    expect(value()).toBe('2025-07-12T12:30:00.000Z');
  });
});

describe('date-time conversion', () => {
  it('ignores instants without an explicit zone instead of reading local time', () => {
    expect(datePart('2025-06-13T14:30')).toBe('');
    expect(timePart('2025-06-13T14:30:00+03:00')).toBe('11:30');
  });
});
