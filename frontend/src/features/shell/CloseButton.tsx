import type { Ref } from 'react';
import { Icon } from './icons';

/** The ✕ at the right of a drawer's title (prototype), named "Close" for screen readers. */
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
    <button
      ref={buttonRef}
      type="button"
      className="shell-close"
      aria-label="Close"
      title="Close"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="close" />
    </button>
  );
}
