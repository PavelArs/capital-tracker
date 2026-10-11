import { cachedReads } from '@api/cached-reads';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { useEffect, useId, useState } from 'react';

// TOKEN-HIDE: an asset that is one of the other tokens of Ethereum or Solana wallets can be
// removed from the portfolio from its own page. It is the wallets' hiding, applied to every
// address that holds the token: the asset leaves the lists, the filters and the totals the same
// way a hidden token does, and Restore under Hidden tokens on the wallet brings it back.

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
  symbol,
  onHidden,
}: {
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
    // Without the wallets there is nothing to hide the asset in, so the button stays away.
    cachedReads.wallets
      .load()
      .then((loaded) => live && setWallets(loaded))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const holders = holdersOf(symbol, wallets);
  if (!symbol || holders.length === 0) return null;

  const hide = async () => {
    setBusy(true);
    setFailed(false);
    try {
      for (const address of holders)
        await walletAddressesApi.tokens(address.id, [symbol], 'hidden');
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
            Hide {symbol}? It leaves the portfolio, the wallet balances, the totals and the filters.
            Its transactions stay in the list under Dust. Bring it back with Restore under Hidden
            tokens on the wallet.
          </p>
          {failed && (
            <p className="portfolio-warn-text" role="alert">
              Could not hide {symbol}. Nothing may have changed; try again.
            </p>
          )}
          <div className="portfolio-confirm__actions">
            <button
              type="button"
              className="shell-button"
              disabled={busy}
              onClick={() => void hide()}
            >
              Hide {symbol}
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
