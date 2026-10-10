import { announceSyncChange } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

interface Props {
  id: string;
  /** A Bybit account: it has no address and its API key is deleted. */
  exchange: boolean;
  onRemoved: () => void;
}

// WALLET-REMOVE: stops tracking one address after a plain statement of what happens to its
// history. The confirmation stays inside the drawer, so its focus trap and Escape keep working.
export default function RemoveAddress({ id, exchange, onRemoved }: Props) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const noun = exchange ? 'account' : 'address';
  useEffect(() => {
    if (asking) cancel.current?.focus();
  }, [asking]);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await walletAddressesApi.remove(id);
      announceSyncChange();
      onRemoved();
    } catch (caught) {
      const status = isAxiosError(caught) ? caught.response?.status : undefined;
      setError(
        status === undefined
          ? 'Could not reach the server. Nothing was changed; try again.'
          : status === 404
            ? 'This address is no longer tracked. Reload the page.'
            : 'Could not remove it. Nothing was changed; try again.',
      );
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="address-remove">
      <h3 id="address-remove" className="transactions-section">
        Stop tracking
      </h3>
      {!asking ? (
        <>
          <p className="wallets-muted">
            Remove this {noun} from tracking. What it recorded stays in your history.
          </p>
          <button
            type="button"
            className="shell-button shell-button--ghost wallets-remove"
            onClick={() => setAsking(true)}
          >
            Remove {noun}…
          </button>
        </>
      ) : (
        <div className="wallets-confirm" role="group" aria-label={`Remove this ${noun}`}>
          <p>
            Remove this {noun}? It stops syncing and leaves your wallets and balances. Transactions
            already loaded, and everything you recorded or classified, stay in your history, and
            coins you have not classified yet stop counting. Adding it again brings them back.
            {exchange ? ' The stored API key is deleted.' : ''}
          </p>
          {error && (
            <p className="wallets-message wallets-message--error" role="alert">
              {error}
            </p>
          )}
          <div className="wallets-confirm__actions">
            <button
              ref={cancel}
              type="button"
              className="shell-button shell-button--ghost"
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="shell-button shell-button--danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? 'Removing…' : `Remove ${noun}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
