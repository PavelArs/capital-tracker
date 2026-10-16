import { type ReactNode, useId, useState } from 'react';
import { Button } from './Button';
import Modal from './Modal';
import { useNarrowScreen } from './useMediaQuery';
import './filter-sheet.css';

interface Props {
  /** How many of the filters inside are set; the phone button shows the number. */
  active: number;
  /** Clears the filters inside. */
  onReset: () => void;
  /** The sheet's closing button, e.g. "Show 37 transactions". */
  done?: string;
  /** The search box: after the filters on wide screens, beside the Filters button on phones. */
  search?: ReactNode;
  /** The filters: ui-filter labels with their selects and dates. */
  children: ReactNode;
}

/**
 * Filters over a list. Wide screens show them in one row; phones show only the search and a
 * Filters button that opens them in a sheet from the bottom, so the list starts near the top.
 */
export default function FilterSheet({ active, onReset, done = 'Done', search, children }: Props) {
  const narrow = useNarrowScreen();
  const [open, setOpen] = useState(false);
  // Reset draws the filters afresh, so a filter's own state (a custom range being picked)
  // clears with the address.
  const [round, setRound] = useState(0);
  const titleId = useId();
  if (!narrow)
    return (
      <div className="ui-filters">
        {children}
        {search}
      </div>
    );
  return (
    <div className="ui-filter-bar">
      {search}
      <Button
        className="ui-filter-bar__button"
        aria-haspopup="dialog"
        aria-label={active > 0 ? `Filters, ${active} set` : 'Filters'}
        onClick={() => setOpen(true)}
      >
        Filters
        {active > 0 && <span className="ui-filter-bar__count">{active}</span>}
      </Button>
      {open && (
        <Modal
          titleId={titleId}
          size="narrow"
          className="ui-modal--sheet"
          onEscape={() => setOpen(false)}
        >
          <div className="ui-modal__head">
            <h2 id={titleId}>Filters</h2>
          </div>
          <div key={round} className="ui-modal__body ui-filters ui-filters--sheet">
            {children}
          </div>
          <div className="ui-modal__foot">
            <Button
              disabled={active === 0}
              onClick={() => {
                onReset();
                setRound((count) => count + 1);
              }}
            >
              Reset
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              {done}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
