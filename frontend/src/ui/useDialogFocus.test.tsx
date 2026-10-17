import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import Drawer, { DrawerHeader } from './Drawer';
import Modal from './Modal';

afterEach(cleanup);

const inert = (element: Element | null) => element?.hasAttribute('inert') ?? false;
const marked = () => document.body.classList.contains('has-dialog');

function Page({ confirm = false }: { confirm?: boolean }) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  return (
    <>
      <nav aria-label="Main navigation">
        <a href="/dashboard">Dashboard</a>
      </nav>
      <main>
        <h1>Wallets</h1>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        {open && (
          <Drawer titleId="d" onClose={() => setOpen(false)}>
            <DrawerHeader titleId="d" title="Wallet" onClose={() => setOpen(false)} />
            <button type="button" onClick={() => setAsked(true)}>
              Remove
            </button>
          </Drawer>
        )}
        {confirm && asked && (
          <Modal titleId="c" size="narrow" overDrawer onEscape={() => setAsked(false)}>
            <h2 id="c">Remove wallet?</h2>
            <button type="button" onClick={() => setAsked(false)}>
              Cancel
            </button>
          </Modal>
        )}
      </main>
      <section className="ui-toasts" aria-label="Messages">
        <button type="button">Dismiss</button>
      </section>
    </>
  );
}

describe('useDialogFocus: the page behind an open dialog', () => {
  it('DIALOG-INERT makes everything outside the dialog inert and gives it back on close', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const title = screen.getByRole('heading', { level: 1, name: 'Wallets' });
    const open = screen.getByRole('button', { name: 'Open' });
    expect(marked()).toBe(false);

    await user.click(open);
    const drawer = screen.getByRole('dialog', { name: 'Wallet' });
    expect(inert(nav)).toBe(true);
    expect(inert(title)).toBe(true);
    expect(inert(open)).toBe(true);
    expect(inert(drawer)).toBe(false);
    expect(drawer.querySelector('[inert]')).toBeNull();
    expect(marked()).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Wallet' })).toBeNull();
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
    expect(marked()).toBe(false);
    // The keyboard goes back to the opener once it is no longer inert.
    expect(open).toHaveFocus();
  });

  it('DIALOG-INERT keeps the toasts and the scrim that closes the drawer usable', async () => {
    const user = userEvent.setup();
    const { container } = render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(inert(screen.getByRole('region', { name: 'Messages' }))).toBe(false);
    const scrim = container.querySelector('.ui-drawer-scrim');
    expect(inert(scrim)).toBe(false);
    await user.click(scrim as Element);
    expect(screen.queryByRole('dialog', { name: 'Wallet' })).toBeNull();
  });

  it('DIALOG-INERT covers the drawer under a confirmation and only that confirmation', async () => {
    const user = userEvent.setup();
    render(<Page confirm />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const drawer = screen.getByRole('dialog', { name: 'Wallet' });
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const confirm = screen.getByRole('dialog', { name: 'Remove wallet?' });
    expect(inert(drawer)).toBe(true);
    expect(inert(confirm)).toBe(false);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    // Closing the confirmation gives the drawer back; the page under the drawer stays inert.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(inert(drawer)).toBe(false);
    expect(inert(screen.getByRole('navigation', { name: 'Main navigation' }))).toBe(true);
    expect(marked()).toBe(true);
    await user.keyboard('{Escape}');
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
    expect(marked()).toBe(false);
  });

  it('DIALOG-INERT leaves an element that was inert before the dialog inert after it', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    nav.setAttribute('inert', '');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    expect(inert(nav)).toBe(true);
  });

  it('DIALOG-TRAP keeps Tab and Shift+Tab inside the top-most dialog', async () => {
    const user = userEvent.setup();
    render(<Page confirm />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const drawer = screen.getByRole('dialog', { name: 'Wallet' });
    for (let press = 0; press < 5; press += 1) {
      await user.tab();
      expect(drawer).toContainElement(document.activeElement as HTMLElement);
    }
    for (let press = 0; press < 5; press += 1) {
      await user.tab({ shift: true });
      expect(drawer).toContainElement(document.activeElement as HTMLElement);
    }
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const confirm = screen.getByRole('dialog', { name: 'Remove wallet?' });
    for (let press = 0; press < 3; press += 1) {
      await user.tab();
      expect(confirm).toContainElement(document.activeElement as HTMLElement);
    }
  });
});
