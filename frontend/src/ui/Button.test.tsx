import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, ButtonLink, buttonClass } from './Button';

afterEach(cleanup);

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', async () => {
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const click = vi.fn();
    render(
      <form onSubmit={(event) => submit(event.nativeEvent as SubmitEvent)}>
        <Button onClick={click}>Cancel</Button>
        <Button type="submit" variant="primary">
          Save
        </Button>
      </form>,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveAttribute('type', 'button');
    expect(cancel).toHaveClass('ui-btn', 'ui-btn--secondary');
    await userEvent.click(cancel);
    expect(click).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('names itself by its text; the icon is hidden from screen readers', () => {
    render(
      <Button variant="primary" icon="plus">
        Add goal
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Add goal' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveClass('ui-btn--primary');
  });

  it('while busy, is announced as busy and cannot be pressed again', async () => {
    const click = vi.fn();
    const { rerender } = render(
      <Button busy onClick={click}>
        Saving…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    rerender(<Button onClick={click}>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('draws each variant, size and modifier with its own class', () => {
    expect(buttonClass({})).toBe('ui-btn ui-btn--secondary');
    expect(buttonClass({ variant: 'danger', size: 'sm' })).toBe('ui-btn ui-btn--danger ui-btn--sm');
    expect(buttonClass({ variant: 'ghost', destructive: true, block: true, size: 'lg' })).toBe(
      'ui-btn ui-btn--ghost ui-btn--lg ui-btn--destructive ui-btn--block',
    );
    // A link-styled button has no height of its own.
    expect(buttonClass({ variant: 'link', size: 'sm' })).toBe('ui-btn ui-btn--link');
  });

  it('forwards its ref to the button (React 19 ref prop)', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Retry</Button>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Retry' }));
  });
});

describe('ButtonLink', () => {
  it('is a link to the page, drawn as a button', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/wallets" variant="primary" icon="plus">
          Add wallet
        </ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Add wallet' });
    expect(link).toHaveAttribute('href', '/wallets');
    expect(link).toHaveClass('ui-btn', 'ui-btn--primary');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
