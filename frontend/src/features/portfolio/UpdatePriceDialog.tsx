import { manualPricesApi } from '@api/manual-prices.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { newRequestId } from '../accounting/feedback';
import CloseButton from '../shell/CloseButton';
import { numberProblem, positive } from './add-transaction';

const status = (error: unknown) => (isAxiosError(error) ? error.response?.status : undefined);

function failure(error: unknown): string {
  const code = status(error);
  if (code === undefined)
    return 'Could not reach the server. Try again; the same request will not save the price twice.';
  if (code === 400) return 'Check the price and try again.';
  if (code === 404) return 'This asset no longer exists. Reload the page.';
  if (code === 409) return 'The price was changed elsewhere. Try again.';
  if (code === 401) return 'Your session has ended. Sign in again.';
  return 'Could not save the price. Try again.';
}

interface Props {
  instrumentId: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}

// G1: changing the price of a hand-valued asset after it exists. It replaces the manual prices
// screen: one new price from now on, in USD, which the page shows in the chosen currency.
export default function UpdatePriceDialog({ instrumentId, name, onClose, onSaved }: Props) {
  const [value, setValue] = useState('');
  const [left, setLeft] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One request id per distinct price, so a retry after a lost answer cannot save it twice. The
  // revision and the moment are kept with it: the same command is sent again, not a new one.
  const attempt = useRef<{
    price: string;
    requestId: string;
    observedAt: string;
    expectedRevision: number;
  } | null>(null);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const busy = useRef(false);
  busy.current = saving;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.select();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy.current) close.current();
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [
        ...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input'),
      ];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  const price = positive(value);
  const problem = price === null ? numberProblem(value, 'Enter a price greater than 0') : null;
  const shown = problem !== null && (tried || left);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (price === null) return;
    setSaving(true);
    setError(null);
    try {
      if (attempt.current?.price !== price) {
        const book = await manualPricesApi.list(instrumentId, 0);
        attempt.current = {
          price,
          requestId: newRequestId(),
          // Whole seconds, so the saved moment reads back exactly as sent.
          observedAt: `${new Date().toISOString().slice(0, 19)}Z`,
          expectedRevision: book.currentRevision,
        };
      }
      await manualPricesApi.set(instrumentId, {
        requestId: attempt.current.requestId,
        expectedRevision: attempt.current.expectedRevision,
        observedAt: attempt.current.observedAt,
        priceUsd: price,
        assertReviewed: true,
      });
      onSaved();
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
      // A refused request saved nothing: the retry starts from the current revision.
      if (status(caught) === 409 || status(caught) === 400) attempt.current = null;
    }
  };

  return (
    <div className="portfolio-scrim">
      <div
        ref={dialog}
        className="portfolio-dialog portfolio-dialog--narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <form onSubmit={save} noValidate>
          <div className="portfolio-dialog__head">
            <h2 id={`${id}-title`}>Update price</h2>
            <CloseButton onClick={onClose} disabled={saving} />
            <p className="shell-note">
              {name} is valued by hand. The new price applies from now on; earlier days keep the
              price they had.
            </p>
          </div>
          <div className="portfolio-dialog__body">
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor={`${id}-price`}>
                Price of one unit, USD
              </label>
              <input
                ref={input}
                id={`${id}-price`}
                className="portfolio-input"
                inputMode="decimal"
                autoComplete="off"
                value={value}
                aria-invalid={shown ? true : undefined}
                aria-describedby={shown ? `${id}-price-error` : undefined}
                onChange={(event) => setValue(event.target.value)}
                onBlur={() => setLeft(true)}
              />
              {shown && (
                <span className="portfolio-field__error" id={`${id}-price-error`}>
                  {problem}
                </span>
              )}
            </div>
            {error && (
              <p className="portfolio-dialog__error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="portfolio-dialog__foot">
            <button
              type="button"
              className="shell-button shell-button--ghost"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="shell-button shell-button--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save price'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
