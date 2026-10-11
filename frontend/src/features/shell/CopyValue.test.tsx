import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CopyValue, { shortValue } from './CopyValue';

const address = '0x3B9d1f0a77c1a54e3b9d1f0a77c1a54e3b9d8F32';

afterEach(cleanup);

describe('CopyValue', () => {
  it('shortens like the prototype: 0x keeps five characters, others six, always the last four', () => {
    expect(shortValue(address)).toBe('0x3B9…8F32');
    expect(shortValue('bc1q9h7garjzk3y5aqv0t6pcw4n2mlu8e5vf3x2r8k')).toBe('bc1q9h…2r8k');
    expect(shortValue('0x3B9d1f0a77c1a5')).toBe('0x3B9d1f0a77c1a5');
  });

  it('shows the short form, keeps the whole value in the tooltip and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = render(<CopyValue value={address} label="Copy address" />);

    expect(screen.getByText('0x3B9…8F32')).toBeVisible();
    expect(container.querySelector('.copy-value')).toHaveAttribute('title', address);
    await user.click(screen.getByRole('button', { name: 'Copy address' }));

    expect(writeText).toHaveBeenCalledWith(address);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('shows a given text instead of the short form', () => {
    render(<CopyValue value="123456789012345678" text="UID 123456789012345678" label="Copy UID" />);

    expect(screen.getByText('UID 123456789012345678')).toBeVisible();
  });
});
