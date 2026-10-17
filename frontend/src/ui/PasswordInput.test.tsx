import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { PasswordInput } from './PasswordInput';

afterEach(cleanup);

describe('PasswordInput', () => {
  it('hides what was typed until the eye button shows it, and names what the button will do', async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="pw">Password</label>
        <PasswordInput id="pw" autoComplete="current-password" />
      </>,
    );
    const field = screen.getByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'current-password');
    const show = screen.getByRole('button', { name: 'Show password' });
    expect(show).toHaveAttribute('aria-controls', 'pw');
    await user.type(field, 'synthetic-secret');
    await user.click(show);
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveValue('synthetic-secret');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field).toHaveAttribute('type', 'password');
  });

  it('takes its own labels and is disabled with the field', () => {
    render(
      <PasswordInput
        id="secret"
        aria-label="API secret"
        disabled
        showLabel="Show secret"
        hideLabel="Hide secret"
      />,
    );
    expect(screen.getByLabelText('API secret')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show secret' })).toBeDisabled();
  });
});
