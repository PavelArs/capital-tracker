import CloseButton from '@features/shell/CloseButton';
import { type ReactNode, type Ref, type RefObject, useRef } from 'react';
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
      {/* The scrim stays live while the page behind is inert: a tap on it closes the drawer. */}
      <div className="ui-drawer-scrim" aria-hidden="true" data-inert-keep="" onClick={onClose} />
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

/** A drawer's head: the 16 px title (h2, id `titleId`) and the ✕. */
export function DrawerHeader({
  titleId,
  title,
  onClose,
  closeRef,
}: {
  titleId: string;
  title: ReactNode;
  onClose: () => void;
  /** The ✕, for a drawer that starts the keyboard on it or moves it back there. */
  closeRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="ui-drawer__head">
      <h2 id={titleId}>{title}</h2>
      <CloseButton buttonRef={closeRef} onClick={onClose} />
    </div>
  );
}

/** The drawer's buttons, above the home indicator. */
export function DrawerFooter({ children }: { children: ReactNode }) {
  return <div className="ui-drawer__foot">{children}</div>;
}
