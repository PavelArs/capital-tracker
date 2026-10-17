import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ButtonLink } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { useDialogFocus } from '@/ui/useDialogFocus';
import { useCompactScreen } from '@/ui/useMediaQuery';
import { age } from '../portfolio/format';
import { needAttention } from './attention';
import { useAttention } from './attention-context';
import CloseButton from './CloseButton';
import { Icon } from './icons';
import './shell-page.css';

/** Keeps the switched currency on a link that may already carry a query. */
const withAsked = (path: string, asked: AccountingCurrency | undefined) =>
  asked ? `${path}${path.includes('?') ? '&' : '?'}currency=${asked}` : path;

/**
 * ATTN-BELL (prototype bell in the top bar): the count of things that need the owner and,
 * on a click, a panel with one row per problem and its way out, or one quiet line. A
 * popover on wide screens, a sheet over the page on phones.
 */
export default function NotificationsBell({ asked }: { asked: AccountingCurrency | undefined }) {
  const state = useAttention();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();
  // On a phone the panel is a sheet over the page, and a sheet keeps the keyboard (shell-03).
  const compact = useCompactScreen();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!state) return null;
  const { loaded, attention, now } = state;
  const { items, checked, pricesUpdatedAt } = attention;
  const count = items.length;
  const updated = pricesUpdatedAt ? `Prices updated ${age(pricesUpdatedAt, now)}.` : '';
  const quiet = !loaded
    ? 'Checking prices and wallets…'
    : checked
      ? `Everything is up to date.${updated ? ` ${updated}` : ''}`
      : 'Could not check the sync status. Try again later.';

  return (
    <div className="shell-bell" ref={root}>
      <IconButton
        buttonRef={button}
        label="Notifications"
        icon="bell"
        count={count}
        countLabel={needAttention(count)}
        className="shell-bell__button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <>
          {/* The dimmed page behind the phone sheet: a tap on it closes the sheet. */}
          <div
            className="shell-bell__scrim"
            aria-hidden="true"
            data-inert-keep=""
            onClick={() => setOpen(false)}
          />
          <Panel id={panelId} titleId={titleId} sheet={compact}>
            <header className="shell-bell__head">
              <h2 id={titleId}>Notifications</h2>
              {count > 0 && <span>{needAttention(count)}</span>}
              <span className="shell-bell__close">
                <CloseButton
                  onClick={() => {
                    setOpen(false);
                    button.current?.focus();
                  }}
                />
              </span>
            </header>
            {count === 0 ? (
              <p className="shell-bell__quiet">
                <Icon
                  name={loaded && checked ? 'check' : 'info'}
                  className={`shell-icon${loaded && checked ? ' shell-bell__ok' : ''}`}
                />
                <span>{quiet}</span>
              </p>
            ) : (
              <ul className="shell-bell__list">
                {items.map((item) => (
                  <li key={item.key} className="shell-bell__row">
                    <span className={`shell-bell__icon shell-bell__icon--${item.tone}`}>
                      <Icon name={item.icon} className="shell-icon shell-icon--sm" />
                    </span>
                    <span className="shell-bell__text">
                      {item.title}
                      <small>{item.detail}</small>
                    </span>
                    {item.action && (
                      // Prototype attention rows: Review is the one to do, Open only looks.
                      <ButtonLink
                        variant={item.key === 'classify' ? 'secondary' : 'ghost'}
                        size="sm"
                        to={withAsked(item.action.to, asked)}
                        onClick={() => setOpen(false)}
                      >
                        {item.action.label}
                      </ButtonLink>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {count > 0 && (updated || !checked) && (
              <p className="shell-bell__foot">
                <Icon
                  name={checked ? 'check' : 'info'}
                  className={`shell-icon shell-icon--sm${checked ? ' shell-bell__ok' : ''}`}
                />
                <span>{checked ? updated : 'Some checks could not run.'}</span>
              </p>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

interface PanelProps {
  id: string;
  titleId: string;
  /** A modal sheet over the page (phones) rather than a popover beside the bell. */
  sheet: boolean;
  children: ReactNode;
}

function Panel({ id, titleId, sheet, children }: PanelProps) {
  if (sheet)
    return (
      <Sheet id={id} titleId={titleId}>
        {children}
      </Sheet>
    );
  return (
    <section id={id} className="shell-bell__panel" aria-labelledby={titleId}>
      {children}
    </section>
  );
}

/** The phone sheet: the keyboard starts on its ✕, stays inside and goes back to the bell. */
function Sheet({ id, titleId, children }: Omit<PanelProps, 'sheet'>) {
  const ref = useRef<HTMLElement>(null);
  // Escape is the bell's own: it closes the panel and puts the keyboard back on the bell.
  useDialogFocus(ref, {});
  return (
    <section
      ref={ref}
      id={id}
      className="shell-bell__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {children}
    </section>
  );
}
