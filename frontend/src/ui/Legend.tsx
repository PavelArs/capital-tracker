import type { CSSProperties, ReactNode } from 'react';
import './chart.css';

export interface LegendItem {
  key: string;
  label: ReactNode;
  /** line: a 2 px line; area: an 8 px block; dash: a dashed line; marker: a dot. */
  swatch: 'line' | 'area' | 'dash' | 'marker';
  /** A colour token, such as var(--accent). */
  color: string;
}

/** What the lines and marks of a chart stand for (prototype .legend). The swatches are hidden. */
export function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul className="ui-legend">
      {items.map((item) => (
        <li key={item.key}>
          <span
            className={`ui-legend__key ui-legend__key--${item.swatch}`}
            style={{ color: item.color } as CSSProperties}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
