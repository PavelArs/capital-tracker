import type { Ref } from 'react';
import { IconButton } from '@/ui/IconButton';

/**
 * The ✕ at the right of a dialog's or a drawer's title (prototype), named "Close" for screen
 * readers. Its `ui-close` class is a hook: dialogs that start the keyboard on their first field skip
 * the ✕ by that name.
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
      className="ui-close"
      buttonRef={buttonRef}
      disabled={disabled}
      onClick={onClick}
    />
  );
}
