import { cachedReads } from '@api/cached-reads';
import { hiddenAssetsApi } from '@api/hidden-assets.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { useEffect, useId, useState } from 'react';

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
  const id = useId();
  const [wallets, setWallets] = useState<readonly WalletAddress[]>(
    () => cachedReads.wallets.last() ?? [],
  );
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

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

  const hide = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (symbol)
        for (const address of holders)
          await walletAddressesApi.tokens(address.id, [symbol], 'hidden');
      await hiddenAssetsApi.hide(instrumentId);
      onHidden();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="shell-button shell-button--secondary"
        aria-expanded={asking}
        aria-controls={id}
        onClick={() => setAsking((current) => !current)}
      >
        Hide asset
      </button>
      {asking && (
        <section id={id} className="shell-card portfolio-confirm" aria-label="Hide this asset">
          <p>
            Hide {name}? It leaves the portfolio, the totals and the filters. Its transactions stay
            in the list.{holders.length > 0 && ' It also leaves the wallet balances.'} Bring it back
            in Settings under Hidden assets.
          </p>
          {failed && (
            <p className="portfolio-warn-text" role="alert">
              Could not hide {name}. Nothing may have changed; try again.
            </p>
          )}
          <div className="portfolio-confirm__actions">
            <button
              type="button"
              className="shell-button"
              disabled={busy}
              onClick={() => void hide()}
            >
              Hide {name}
            </button>
            <button
              type="button"
              className="shell-button shell-button--secondary"
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </>
  );
}
