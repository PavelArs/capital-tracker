import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { age } from '../portfolio/format';
import { useAttention } from './attention-context';
import { Icon } from './icons';

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
  const label = count === 0 ? 'Notifications' : `Notifications, ${count} need attention`;

  return (
    <div className="shell-bell" ref={root}>
      <button
        ref={button}
        type="button"
        className="shell-bell__button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" />
        {count > 0 && (
          <span className="shell-bell__count" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="shell-bell__scrim" aria-hidden="true" />
          <section id={panelId} className="shell-bell__panel" aria-label="Notifications">
            <header className="shell-bell__head">
              <h2>Notifications</h2>
              {count > 0 && <span>{count} need attention</span>}
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
                      <Link
                        className={`shell-button shell-button--small${item.key === 'classify' ? '' : ' shell-button--ghost'}`}
                        to={withAsked(item.action.to, asked)}
                        onClick={() => setOpen(false)}
                      >
                        {item.action.label}
                      </Link>
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
          </section>
        </>
      )}
    </div>
  );
}
