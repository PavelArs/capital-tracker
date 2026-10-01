import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { type AccountSection, AccountWorkspace } from './AccountWorkspace';

afterEach(cleanup);

function Draft() {
  const [value, setValue] = useState('');
  return (
    <input aria-label="Черновик" value={value} onChange={(event) => setValue(event.target.value)} />
  );
}

function Workspace() {
  const [section, setSection] = useState<AccountSection>('operations');
  return (
    <AccountWorkspace
      section={section}
      onSelect={setSection}
      operations={<Draft />}
      analytics={<input aria-label="Дата анализа" />}
      setup={<input aria-label="Начальные данные" />}
    />
  );
}

describe('WORKSPACE-001/002 presentation lifecycle', () => {
  it('exposes only the selected section with labelled controls', () => {
    render(<Workspace />);
    const buttons = screen.getByRole('group', { name: 'Разделы счета' }).querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Операции' })).toBeVisible();
    expect(screen.getByLabelText('Дата анализа')).not.toBeVisible();
    for (const button of buttons) {
      fireEvent.click(button);
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('aria-pressed', 'true');
      const controlled = document.getElementById(button.getAttribute('aria-controls')!);
      expect(controlled).toBeVisible();
      expect(controlled).toHaveAttribute('aria-labelledby', button.id);
      expect(screen.getAllByRole('region')).toHaveLength(1);
    }
  });

  it('keeps the same stateful editor while another section is selected', () => {
    render(<Workspace />);
    const input = screen.getByLabelText('Черновик');
    fireEvent.change(input, { target: { value: '0.123456789012345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Аналитика' }));
    expect(input).toBeInTheDocument();
    expect(input).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Начальные данные' }));
    fireEvent.click(screen.getByRole('button', { name: 'Операции' }));
    expect(screen.getByLabelText('Черновик')).toBe(input);
    expect(input).toHaveValue('0.123456789012345678');
  });
});
