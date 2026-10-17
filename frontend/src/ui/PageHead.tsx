import { Icon } from '@features/shell/icons';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './page-head.css';

/**
 * The way back to the parent page (prototype .crumb): a chevron and the parent's name, named
 * "Back to <parent>" for screen readers.
 */
export function Crumb({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="ui-crumb" aria-label={`Back to ${children}`}>
      <Icon name="chevron" className="shell-icon ui-crumb__chevron" />
      {children}
    </Link>
  );
}

/**
 * The head of a detail page under the top bar (prototype .page-head): an icon, the 28 px title
 * and a muted line, a figure at the right (`aside`) or the page's actions.
 */
export function PageHead({
  icon,
  title,
  titleId,
  subtitle,
  aside,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  titleId?: string;
  subtitle?: ReactNode;
  /** A figure at the right: the price and its change, the wallet's value. */
  aside?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ui-page-head">
      {icon && (
        <span className="ui-page-head__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="ui-page-head__title">
        <h2 id={titleId}>{title}</h2>
        {subtitle && <p className="ui-page-head__sub">{subtitle}</p>}
      </div>
      {aside && <div className="ui-page-head__aside">{aside}</div>}
      {actions && <div className="ui-page-head__actions">{actions}</div>}
    </div>
  );
}
