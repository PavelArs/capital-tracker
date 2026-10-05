import { accountingApi } from '@api/accounting.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';

const MAX_NAME = 120;

function failure(error: unknown): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === undefined) return 'Could not reach the server. Try again.';
  if (status === 400) return 'Use a name of 1 to 120 characters on one line.';
  if (status === 404) return 'This wallet no longer exists. Reload the page.';
  if (status === 401) return 'Your session has ended. Sign in again.';
  return 'Could not rename the wallet. Try again.';
}

interface Props {
  accountId: string;
  name: string;
  onClose: () => void;
  onRenamed: (name: string) => void;
}

// WAL-RENAME, prototype "Rename wallet": only the name changes; transactions stay as they are.
export default function RenameWalletDialog({ accountId, name, onClose, onRenamed }: Props) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  const trimmed = value.trim();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) {
      setError('Enter a name.');
      return;
    }
    if (trimmed === name) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await accountingApi.renameAccount(accountId, trimmed);
      onRenamed(saved.name);
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
    }
  };

  return (
    <div className="portfolio-scrim">
      <div
        ref={dialog}
        className="portfolio-dialog wallets-rename"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-wallet"
      >
        <form onSubmit={save} noValidate>
          <div className="portfolio-dialog__head">
            <h2 id="rename-wallet">Rename wallet</h2>
          </div>
          <div className="portfolio-dialog__body">
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor="wallet-new-name">
                Name
              </label>
              <input
                ref={input}
                id="wallet-new-name"
                className="portfolio-input"
                maxLength={MAX_NAME}
                value={value}
                aria-invalid={error ? true : undefined}
                onChange={(event) => setValue(event.target.value)}
              />
              <span className="portfolio-field__hint">
                Transactions, addresses and balances stay as they are.
              </span>
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
            <span className="wallets-grow" />
            <button type="submit" className="shell-button shell-button--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
