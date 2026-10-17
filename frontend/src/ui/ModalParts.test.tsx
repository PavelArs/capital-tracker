import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import Drawer, { DrawerFooter, DrawerHeader } from './Drawer';
import Modal, { ModalBody, ModalFooter, ModalHeader } from './Modal';

afterEach(cleanup);

describe('ModalHeader, ModalBody and ModalFooter', () => {
  it('name the dialog, close it with the ✕ and show the steps and the summary', async () => {
    const close = vi.fn();
    render(
      <Modal titleId="add-title">
        <ModalHeader
          titleId="add-title"
          title="Add wallet"
          onClose={close}
          steps={{ current: 1, total: 3 }}
          intro="Follow an address read-only."
        />
        <ModalBody>
          <input aria-label="Address" />
        </ModalBody>
        <ModalFooter summary="Nothing is signed or sent.">
          <Button variant="primary">Next</Button>
        </ModalFooter>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Add wallet' })).toHaveAttribute(
      'id',
      'add-title',
    );
    expect(within(dialog).getByText('Step 1 of 3')).toBeInTheDocument();
    expect(within(dialog).getByText('Follow an address read-only.')).toHaveClass('ui-modal__intro');
    expect(within(dialog).getByText('Nothing is signed or sent.')).toHaveClass('ui-modal__summary');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('without onClose there is no ✕; closeDisabled holds it while saving', () => {
    const { rerender } = render(
      <Modal titleId="t">
        <ModalHeader titleId="t" title="Set up two-factor" />
        <ModalFooter>
          <Button>Continue</Button>
        </ModalFooter>
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(document.querySelector('.ui-modal__summary')).toBeNull();
    rerender(
      <Modal titleId="t">
        <ModalHeader titleId="t" title="Rename" onClose={() => {}} closeDisabled />
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });
});

describe('DrawerHeader and DrawerFooter', () => {
  it('name the drawer and close it with the ✕', async () => {
    const close = vi.fn();
    render(
      <Drawer titleId="tx-title" onClose={close}>
        <DrawerHeader titleId="tx-title" title="Transaction" onClose={close} />
        <DrawerFooter>
          <Button>Edit</Button>
        </DrawerFooter>
      </Drawer>,
    );
    const drawer = screen.getByRole('dialog', { name: 'Transaction' });
    const closeButton = within(drawer).getByRole('button', { name: 'Close' });
    // The keyboard starts on the first control, the ✕.
    expect(closeButton).toHaveFocus();
    await userEvent.click(closeButton);
    expect(close).toHaveBeenCalledOnce();
    expect(within(drawer).getByRole('button', { name: 'Edit' }).parentElement).toHaveClass(
      'ui-drawer__foot',
    );
  });
});
