import type { ReactNode } from 'react';
import './list-row.css';

/**
 * A phone row (design: tables on phones): the icon, then line 1 title | amount and line 2
 * detail | value. The caller's own element (a link, a button or a div) carries `rowClass` and
 * the icon; this fills in the two lines.
 */
export function ListRowText({
  title,
  detail,
  amount,
  value,
}: {
  title: ReactNode;
  /** Line 2 on the left: a string fades out at the end; a badge is shown as it is. */
  detail?: ReactNode;
  /** Line 1 on the right: the main number, or several stacked amounts. */
  amount?: ReactNode;
  value?: ReactNode;
}) {
  return (
    <>
      <span className="ui-row__main">
        <span className="ui-row__title">{title}</span>
        {typeof detail === 'string' || typeof detail === 'number' ? (
          <span className="ui-row__detail">{detail}</span>
        ) : (
          detail
        )}
      </span>
      {(amount !== undefined || value !== undefined) && (
        <span className="ui-row__side">
          {typeof amount === 'string' ? <span className="ui-row__amount">{amount}</span> : amount}
          {value !== undefined && <span className="ui-row__value">{value}</span>}
        </span>
      )}
    </>
  );
}

/** The row's class: a warning bar for a row that needs the owner, an accent bar for the open one. */
export function rowClass({ warn = false, open = false }: { warn?: boolean; open?: boolean } = {}) {
  return `ui-row${warn ? ' ui-row--warn' : ''}${open ? ' ui-row--open' : ''}`;
}
