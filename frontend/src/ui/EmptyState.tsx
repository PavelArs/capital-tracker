import type { ReactNode } from 'react';
import './empty-state.css';

/**
 * The card a page shows when it has nothing to list, or what was asked for is not there: an
 * optional picture, a title, one line of text and the next step.
 */
export default function EmptyState({
  id,
  title,
  icon,
  actions,
  children,
}: {
  /** The title's id; the card is labelled by it. */
  id: string;
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="shell-card ui-empty" aria-labelledby={id}>
      {icon && (
        <span className="ui-empty__ill" aria-hidden="true">
          {icon}
        </span>
      )}
      <h2 id={id} className="ui-empty__title">
        {title}
      </h2>
      {children && <p className="ui-empty__text">{children}</p>}
      {actions && <div className="ui-empty__actions">{actions}</div>}
    </section>
  );
}
