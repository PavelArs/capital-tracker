import { brokersApi } from '@api/brokers.api';
import { useEffect, useState } from 'react';
import ImportHistoryDialog from './ImportHistoryDialog';
import './broker.css';

interface Props {
  accountId: string;
  accountName: string;
  /** The history was written: the page loads again. */
  onImported: () => void;
}

// An empty broker account that reads T-Bank offers to load its history. An account that is not
// connected, or whose connection cannot be read, offers nothing.
export default function LoadHistory({ accountId, accountName, onImported }: Props) {
  const [connected, setConnected] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let current = true;
    brokersApi
      .connection(accountId)
      .then((state) => current && setConnected(state.connected))
      .catch(() => current && setConnected(false));
    return () => {
      current = false;
    };
  }, [accountId]);

  if (!connected) return null;
  return (
    <div className="broker-history">
      <button
        type="button"
        className="shell-button shell-button--secondary"
        onClick={() => setOpen(true)}
      >
        Load T-Bank history
      </button>
      {open && (
        <ImportHistoryDialog
          accountId={accountId}
          accountName={accountName}
          onClose={() => setOpen(false)}
          onImported={() => {
            setOpen(false);
            onImported();
          }}
        />
      )}
    </div>
  );
}
