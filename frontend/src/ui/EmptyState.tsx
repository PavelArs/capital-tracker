import type { ReactNode } from 'react';
import { Card } from './Card';
import './empty-state.css';

/**
 * What a page or a list shows when it has nothing, or nothing matches: an optional picture, a
 * title, one line of text and the next step. By default a card labelled by its title;
 * `compact` is the muted block inside a card that already has its own heading ("No assets
 * match"). `tone="pos"` is the all-done case ("All caught up").
 */
export default function EmptyState({
  id,
  title,
  icon,
  actions,
  tone = 'default',
  compact = false,
  children,
}: {
  /** The title's id; the card is labelled by it. */
  id: string;
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  tone?: 'default' | 'pos';
  compact?: boolean;
  children?: ReactNode;
}) {
  const ill = icon && (
    <span className="ui-empty__ill" aria-hidden="true">
      {icon}
    </span>
  );
  const text = children && <p className="ui-empty__text">{children}</p>;
  const next = actions && <div className="ui-empty__actions">{actions}</div>;
  const toneClass = tone === 'pos' ? ' ui-empty--pos' : '';
  if (compact)
    return (
      <div className={`ui-empty ui-empty--compact${toneClass}`}>
        {ill}
        <p id={id} className="ui-empty__title">
          {title}
        </p>
        {text}
        {next}
      </div>
    );
  return (
    <Card labelledBy={id} className={`ui-empty${toneClass}`}>
      {ill}
      <h2 id={id} className="ui-empty__title">
        {title}
      </h2>
      {text}
      {next}
    </Card>
  );
}
