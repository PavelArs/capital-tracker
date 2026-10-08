import { type ReactNode, useEffect, useRef } from 'react';

interface Props {
  title: string;
  titleId: string;
  /** Escape and the focus trap stay; Escape closes only when this is given. */
  onEscape?: () => void;
  children: ReactNode;
}

// Prototype modal: keeps focus inside, returns it to the opener and closes on Escape when allowed.
export default function SecurityDialog({ title, titleId, onEscape, children }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const escapeHandler = useRef(onEscape);
  escapeHandler.current = onEscape;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialog.current?.querySelector<HTMLElement>('input, button:not([disabled])');
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escapeHandler.current?.();
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [
        ...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input'),
      ];
      const head = items[0];
      const tail = items[items.length - 1];
      if (event.shiftKey ? document.activeElement === head : document.activeElement === tail) {
        event.preventDefault();
        (event.shiftKey ? tail : head)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="portfolio-scrim">
      <div
        ref={dialog}
        className="portfolio-dialog security-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="portfolio-dialog__head">
          <h2 id={titleId}>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}
