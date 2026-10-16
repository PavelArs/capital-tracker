import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field } from './Field';
import { Input } from './inputs';

afterEach(cleanup);

describe('Field', () => {
  it('labels its control and points it at the hint', () => {
    render(
      <Field id="goal-name" label="Name" hint="Shown on the dashboard.">
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('id', 'goal-name');
    expect(input).toHaveAccessibleDescription('Shown on the dashboard.');
    expect(input).toHaveAttribute('aria-describedby', 'goal-name-hint');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(document.getElementById('goal-name-hint')).toHaveTextContent('Shown on the dashboard.');
  });

  it('once wrong, marks the control invalid and shows the error in place of the hint', () => {
    render(
      <Field id="goal-target" label="Target" hint="In USD." error="Enter an amount above 0.">
        {(control) => <Input numeric {...control} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Target' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'goal-target-error');
    expect(input).toHaveAccessibleDescription('Enter an amount above 0.');
    expect(document.getElementById('goal-target-error')).toHaveTextContent(
      'Enter an amount above 0.',
    );
    expect(document.getElementById('goal-target-hint')).toBeNull();
    expect(screen.queryByText('In USD.')).toBeNull();
  });

  it('without hint or error describes nothing, and makes an id when none is given', () => {
    render(
      <Field label="Comment" labelAside={<a href="#help">Help</a>}>
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Comment' });
    expect(input.id).not.toBe('');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
  });

  it('treats an empty or null error as no error', () => {
    render(
      <Field id="f" label="Amount" hint="Optional." error={null}>
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Amount' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription('Optional.');
  });
});
