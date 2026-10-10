import { accountingApi, type WalletKind } from '@api/accounting.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { kindLabels, walletKinds } from './wallets';

const MAX_NAME = 120;

function failure(error: unknown): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === undefined) return 'Could not reach the server. Try again.';
  if (status === 400) return 'Use a name of 1 to 120 characters on one line.';
  if (status === 404) return 'This wallet no longer exists. Reload the page.';
  if (status === 401) return 'Your session has ended. Sign in again.';
  return 'Could not save the wallet. Try again.';
}

interface Props {
  accountId: string;
  name: string;
  kind: WalletKind | null;
  onClose: () => void;
  onSaved: () => void;
}

const NOT_CHOSEN = '';

// WAL-RENAME, W1, prototype "Rename wallet": the name and how the wallet is held change;
// transactions stay as they are.
export default function EditWalletDialog({ accountId, name, kind, onClose, onSaved }: Props) {
  const [value, setValue] = useState(name);
  const [chosen, setChosen] = useState<WalletKind | typeof NOT_CHOSEN>(kind ?? NOT_CHOSEN);
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
        ...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, select'),
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
    const nextKind = chosen === NOT_CHOSEN ? null : chosen;
    const changes = {
      ...(trimmed === name ? {} : { name: trimmed }),
      ...(nextKind === kind ? {} : { kind: nextKind }),
    };
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await accountingApi.updateAccount(accountId, changes);
      onSaved();
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
        aria-labelledby="edit-wallet"
      >
        <form onSubmit={save} noValidate>
          <div className="portfolio-dialog__head">
            <h2 id="edit-wallet">Edit wallet</h2>
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
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor="wallet-kind">
                How you hold it
              </label>
              <select
                id="wallet-kind"
                className="portfolio-input"
                value={chosen}
                onChange={(event) =>
                  setChosen(event.target.value as WalletKind | typeof NOT_CHOSEN)
                }
              >
                <option value={NOT_CHOSEN}>Not chosen</option>
                {walletKinds.map((item) => (
                  <option key={item} value={item}>
                    {kindLabels[item]}
                  </option>
                ))}
              </select>
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
