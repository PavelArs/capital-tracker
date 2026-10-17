import { cachedReads } from '@api/cached-reads';
import { hiddenAssetsApi } from '@api/hidden-assets.api';
import { announceSyncChange } from '@api/sync-status.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { useToast } from '@contexts/ToastContext';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

// ASSET-HIDE: any asset can be removed from the portfolio from its own page. It leaves the
// portfolio, its totals and history and the filters; its transactions stay in the list. A token
// that Ethereum or Solana wallets hold as one of their other tokens is also hidden in every
// address that holds it (TOKEN-HIDE), so wallet balances and price requests leave it as well.
// Settings → Hidden assets brings it back, wallet tokens included.

/** The addresses that hold a token by this ticker, as one of their other tokens. */
export function holdersOf(
  symbol: string | null,
  wallets: readonly WalletAddress[],
): WalletAddress[] {
  if (!symbol) return [];
  return wallets.filter((address) =>
    (address.balances ?? []).some(
      (balance) => balance.name !== undefined && balance.symbol === symbol,
    ),
  );
}

export default function HideAsset({
  instrumentId,
  symbol,
  onHidden,
}: {
  instrumentId: string;
  symbol: string | null;
  onHidden: () => void;
}) {
  const toast = useToast();
  const [wallets, setWallets] = useState<readonly WalletAddress[]>(
    () => cachedReads.wallets.last() ?? [],
  );
  const [asking, setAsking] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    // Without the wallets the asset is still hidden; only its wallet tokens are left as they are.
    cachedReads.wallets
      .load()
      .then((loaded) => live && setWallets(loaded))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const holders = holdersOf(symbol, wallets);
  const name = symbol ?? 'this asset';

  // A failure throws to the dialog, which says so and keeps the owner on the page.
  const hide = async () => {
    if (symbol)
      for (const address of holders)
        await walletAddressesApi.tokens(address.id, [symbol], 'hidden');
    await hiddenAssetsApi.hide(instrumentId);
    // The bell checks wallet balances against the portfolio again.
    announceSyncChange();
    toast.show({
      tone: 'success',
      title: `${symbol ?? 'Asset'} hidden`,
      detail: 'Bring it back in Settings under Hidden assets.',
      action: { label: 'Open', onClick: () => navigate('/preferences#settings-hidden-assets') },
    });
    onHidden();
  };

  return (
    <>
      <Button variant="ghost" size="sm" icon="eyeOff" onClick={() => setAsking(true)}>
        Hide asset
      </Button>
      {asking && (
        <ConfirmDialog
          title="Hide this asset"
          confirmLabel={`Hide ${name}`}
          busyLabel="Hiding…"
          tone="primary"
          failure={`Could not hide ${name}. Nothing may have changed; try again.`}
          onConfirm={hide}
          onClose={() => setAsking(false)}
        >
          <p>
            Hide {name}? It leaves the portfolio, the totals and the filters. Its transactions stay
            in the list.{holders.length > 0 && ' It also leaves the wallet balances.'} Bring it back
            in Settings under Hidden assets.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
