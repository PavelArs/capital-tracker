import { type ReactNode, useId, useState } from 'react';
import '@/ui/chart.css';

/** The ⓘ beside a chart's title: opens a note on how its numbers are made. */
export default function AboutChart({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="dashboard-about">
      <button
        type="button"
        className="dashboard-about__button"
        aria-label="About this chart"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((shown) => !shown)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        onBlur={() => setOpen(false)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
      {open && (
        <p id={id} className="dashboard-about__note" role="note">
          {children}
        </p>
      )}
    </div>
  );
}
