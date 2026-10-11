import { type ReactNode, type RefObject, useRef } from 'react';
import { useDialogFocus } from './useDialogFocus';
import './drawer.css';

interface Props {
  /** The id of the heading inside that names the drawer. */
  titleId: string;
  /** Escape and a click on the scrim close the drawer. */
  onClose: () => void;
  /** Where the keyboard starts; the first control (the close button) by default. */
  initialFocus?: ((root: HTMLElement) => HTMLElement | null | undefined) | undefined;
  /** Hidden from assistive technology while a confirmation is open over it. */
  covered?: boolean;
  /** The drawer panel, for a drawer that moves the keyboard itself. */
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

/** The one side drawer: a scrim and a panel on the right that keeps focus until it closes. */
export default function Drawer({
  titleId,
  onClose,
  initialFocus,
  covered = false,
  panelRef,
  children,
}: Props) {
  const own = useRef<HTMLDivElement>(null);
  const panel = panelRef ?? own;
  useDialogFocus(panel, { onEscape: onClose, initialFocus });
  return (
    <>
      <div className="ui-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className="ui-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={covered ? true : undefined}
      >
        {children}
      </div>
    </>
  );
}
