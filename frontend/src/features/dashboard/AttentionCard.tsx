import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { Link } from 'react-router-dom';
import { age } from '../portfolio/format';
import { Icon } from '../shell/icons';
import type { Attention } from './attention';

/** Keeps the switched currency on a link that may already carry a query. */
const withAsked = (path: string, asked: AccountingCurrency | undefined) =>
  asked ? `${path}${path.includes('?') ? '&' : '?'}currency=${asked}` : path;

/**
 * DASH-ATTENTION (prototype "Needs your attention"): one row per problem with its way out,
 * or one quiet line when there is none.
 */
export default function AttentionCard({
  attention,
  loaded,
  asked,
  now,
}: {
  attention: Attention;
  loaded: boolean;
  asked: AccountingCurrency | undefined;
  now: Date;
}) {
  const { items, checked, pricesUpdatedAt } = attention;
  const updated = pricesUpdatedAt ? `Prices updated ${age(pricesUpdatedAt, now)}.` : '';
  if (!loaded || items.length === 0) {
    const quiet = !loaded
      ? 'Checking prices and wallets…'
      : checked
        ? `Everything is up to date.${updated ? ` ${updated}` : ''}`
        : 'Could not check the sync status. Try again later.';
    return (
      <section className="shell-card dashboard-attn" aria-label="Needs attention">
        <p className="dashboard-attn__quiet">
          <Icon
            name={loaded && checked ? 'check' : 'info'}
            className={`shell-icon${loaded && checked ? ' dashboard-attn__ok' : ''}`}
          />
          <span>{quiet}</span>
        </p>
      </section>
    );
  }
  return (
    <section className="shell-card dashboard-attn" aria-label="Needs attention">
      <h2 className="dashboard-attn__title">Needs attention</h2>
      <ul className="dashboard-attn__list">
        {items.map((item) => (
          <li key={item.key} className="dashboard-attn__row">
            <span className={`dashboard-attn__icon dashboard-attn__icon--${item.tone}`}>
              <Icon name={item.icon} className="shell-icon shell-icon--sm" />
            </span>
            <span className="dashboard-attn__text">
              {item.title}
              <small>{item.detail}</small>
            </span>
            {item.action && (
              <Link
                className={`shell-button shell-button--small${item.key === 'classify' ? '' : ' shell-button--ghost'}`}
                to={withAsked(item.action.to, asked)}
              >
                {item.action.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {(updated || !checked) && (
        <p className="dashboard-attn__foot">
          <Icon
            name={checked ? 'check' : 'info'}
            className={`shell-icon shell-icon--sm${checked ? ' dashboard-attn__ok' : ''}`}
          />
          <span>{checked ? updated : 'Some checks could not run.'}</span>
        </p>
      )}
    </section>
  );
}
