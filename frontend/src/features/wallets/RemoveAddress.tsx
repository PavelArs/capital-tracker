import { announceSyncChange } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { useState } from 'react';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { requestFailure } from '@/utils/request-failure';

interface Props {
  id: string;
  /** A Bybit account: it has no address and its API key is deleted. */
  exchange: boolean;
  onRemoved: () => void;
}

/** WALLET-REMOVE: the reason a removal failed, in a plain sentence. */
const removalFailure = (caught: unknown) =>
  requestFailure(caught, {
    unreachable: 'Could not reach the server. It may have been removed; reload the page to check.',
    status: { 404: 'This address is no longer tracked. Reload the page.' },
    unsure: 'Could not remove it. It may have been removed; reload the page to check.',
    fallback: 'Could not remove it. Nothing was changed; try again.',
  });

// WALLET-REMOVE: stops tracking one address after a plain statement of what happens to its
// history. The confirmation covers the drawer (Cancel focused first); Escape closes it alone.
export default function RemoveAddress({ id, exchange, onRemoved }: Props) {
  const [asking, setAsking] = useState(false);
  const noun = exchange ? 'account' : 'address';

  return (
    <section aria-labelledby="address-remove">
      <h3 id="address-remove" className="ui-section-t">
        Stop tracking
      </h3>
      <p className="ui-muted wallets-small">
        Remove this {noun} from tracking. What it recorded stays in your history.
      </p>
      <Button
        variant="ghost"
        destructive
        className="wallets-remove"
        onClick={() => setAsking(true)}
      >
        Remove {noun}…
      </Button>
      {asking && (
        <ConfirmDialog
          title={`Remove this ${noun}?`}
          confirmLabel={`Remove ${noun}`}
          busyLabel="Removing…"
          failure={removalFailure}
          overDrawer
          onConfirm={async () => {
            await walletAddressesApi.remove(id);
            announceSyncChange();
            onRemoved();
          }}
          onClose={() => setAsking(false)}
        >
          It stops syncing and leaves your wallets and balances. Transactions already loaded, and
          everything you recorded or classified, stay in your history, and coins you have not
          classified yet stop counting. Adding it again brings them back.
          {exchange ? ' The stored API key is deleted.' : ''}
        </ConfirmDialog>
      )}
    </section>
  );
}
