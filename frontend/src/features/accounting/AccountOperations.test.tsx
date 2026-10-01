import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountOperations, type OperationWorkflow } from './AccountOperations';

afterEach(cleanup);

function Draft({ label }: { label: string }) {
  const [value, setValue] = useState('');
  return (
    <input aria-label={label} value={value} onChange={(event) => setValue(event.target.value)} />
  );
}

function Workflows() {
  const [selected, setSelected] = useState<OperationWorkflow>('trades');
  return (
    <AccountOperations
      selected={selected}
      onSelect={setSelected}
      trades={<Draft label="Сделка" />}
      swaps={<Draft label="Обмен" />}
      rewards={<Draft label="Вознаграждение" />}
      imports={<Draft label="Файл" />}
    />
  );
}

describe('WORKFLOW-001/002 mounted operation selection', () => {
  it('shows one workflow and associates the native selector with its visible panel', () => {
    render(<Workflows />);
    const select = screen.getByRole('combobox', { name: 'Вид операций' });
    expect(select).toHaveValue('trades');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Сделка' })).toBeVisible();
    for (const [value, label] of [
      ['trades', 'Сделка'],
      ['swaps', 'Обмен'],
      ['rewards', 'Вознаграждение'],
      ['imports', 'Файл'],
    ]) {
      fireEvent.change(select, { target: { value } });
      const panel = document.getElementById(select.getAttribute('aria-controls')!);
      expect(panel).toBeVisible();
      expect(panel).toContainElement(screen.getByRole('textbox', { name: label }));
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
    }
  });

  it('preserves independent editor nodes and exact values through switching', () => {
    render(<Workflows />);
    const select = screen.getByRole('combobox', { name: 'Вид операций' });
    const trade = screen.getByLabelText('Сделка');
    fireEvent.change(trade, { target: { value: '0.000000000000000001' } });
    fireEvent.change(select, { target: { value: 'swaps' } });
    const swap = screen.getByLabelText('Обмен');
    fireEvent.change(swap, { target: { value: '9007199254740993' } });
    for (const value of ['rewards', 'imports', 'trades'])
      fireEvent.change(select, { target: { value } });
    expect(screen.getByLabelText('Сделка')).toBe(trade);
    expect(trade).toHaveValue('0.000000000000000001');
    expect(screen.getByLabelText('Обмен')).toBe(swap);
    expect(swap).toHaveValue('9007199254740993');
    expect(swap).not.toBeVisible();
  });
});
