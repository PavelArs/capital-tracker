import type { ReactNode } from 'react';
import './summary-card.css';

export interface SummaryFigure {
  label: string;
  value: ReactNode;
  /** Why the value is missing or what it leaves out, under that figure. */
  note?: ReactNode;
}

/**
 * The totals card at the top of a section page (design: "In brokers", "Share of net worth"): a
 * few figures side by side, each a label over its value, and one note for the whole card. On a
 * phone the figures take two columns.
 */
export default function SummaryCard({
  label,
  figures,
  note,
}: {
  /** The card's name for screen readers. */
  label: string;
  figures: readonly SummaryFigure[];
  note?: ReactNode;
}) {
  return (
    <section className="shell-card ui-summary" aria-label={label}>
      <dl className="ui-summary__figures">
        {figures.map((figure) => (
          <div key={figure.label} className="ui-summary__figure">
            <dt className="ui-summary__label">{figure.label}</dt>
            <dd className="ui-summary__value">{figure.value}</dd>
            {figure.note && <dd className="ui-summary__reason">{figure.note}</dd>}
          </div>
        ))}
      </dl>
      {note && <p className="ui-summary__note">{note}</p>}
    </section>
  );
}
