import { cachedReads } from '@api/cached-reads';
import { type HiddenAsset, hiddenAssetsApi } from '@api/hidden-assets.api';
import { announceSyncChange } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { useEffect, useState } from 'react';

// ASSET-HIDE: Settings lists the assets hidden from their own pages and shows them again. A
// token the owner hid in wallets goes back there as well, or it would stay out of the balances.

const label = (asset: HiddenAsset) => asset.symbol ?? asset.name;

export default function HiddenAssets() {
  const [items, setItems] = useState<HiddenAsset[] | null>(
    () => cachedReads.hiddenAssets.last() ?? null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    cachedReads.hiddenAssets
      .load()
      .then((loaded) => {
        if (!live) return;
        setItems(loaded);
        setLoadFailed(false);
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const show = async (asset: HiddenAsset) => {
    setBusy(asset.instrumentId);
    setFailed(null);
    try {
      if (asset.symbol) {
        const { symbol } = asset;
        const wallets = await cachedReads.wallets.load();
        for (const address of wallets) {
          const hidden = (address.hiddenTokens ?? []).some(
            (token) => token.symbol === symbol && token.reason === 'owner',
          );
          if (hidden) await walletAddressesApi.tokens(address.id, [symbol], 'shown');
        }
      }
      await hiddenAssetsApi.show(asset.instrumentId);
      announceSyncChange();
      setItems((current) =>
        current ? current.filter((item) => item.instrumentId !== asset.instrumentId) : current,
      );
    } catch {
      setFailed(asset.instrumentId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="shell-card" aria-labelledby="settings-hidden-assets">
      <h2 id="settings-hidden-assets">Hidden assets</h2>
      {items === null ? (
        <p
          className="shell-setting__hint"
          role={loadFailed ? 'alert' : undefined}
          aria-busy={!loadFailed}
        >
          {loadFailed ? 'Could not load the hidden assets; try again later.' : 'Loading…'}
        </p>
      ) : items.length === 0 ? (
        <p className="shell-setting__hint">
          Nothing is hidden. Hide an asset from its own page under Portfolio; it comes back here.
        </p>
      ) : (
        items.map((asset) => (
          <div className="shell-setting" key={asset.instrumentId}>
            <div className="shell-setting__text">
              <span className="shell-setting__label">{label(asset)}</span>
              <p
                className="shell-setting__hint"
                role={failed === asset.instrumentId ? 'alert' : undefined}
              >
                {failed === asset.instrumentId
                  ? `Could not show ${label(asset)}. Nothing may have changed; try again.`
                  : `${asset.name} is out of the portfolio, its totals, history and filters.`}
              </p>
            </div>
            <button
              type="button"
              className="shell-button shell-button--secondary"
              disabled={busy !== null}
              aria-label={`Show ${label(asset)}`}
              onClick={() => void show(asset)}
            >
              Show
            </button>
          </div>
        ))
      )}
    </section>
  );
}
