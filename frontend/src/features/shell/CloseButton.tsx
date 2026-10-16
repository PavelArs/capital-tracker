import type { Ref } from 'react';
import { IconButton } from '@/ui/IconButton';

/**
 * The ✕ at the right of a dialog's or a drawer's title (prototype), named "Close" for screen
 * readers. It keeps the old `shell-close` class: dialogs that start the keyboard on their first
 * field skip it by that name.
 */
export default function CloseButton({
  onClick,
  buttonRef,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <IconButton
      label="Close"
      icon="close"
      className="shell-close"
      buttonRef={buttonRef}
      disabled={disabled}
      onClick={onClick}
    />
  );
}
