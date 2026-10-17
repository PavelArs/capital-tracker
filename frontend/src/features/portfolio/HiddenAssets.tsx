import { cachedReads } from '@api/cached-reads';
import { type HiddenAsset, hiddenAssetsApi } from '@api/hidden-assets.api';
import { announceSyncChange } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { useToast } from '@contexts/ToastContext';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { ErrorState } from '@/ui/ErrorState';
import { SettingRow } from '@/ui/SettingRow';
import { Bone } from '../shell/Skeleton';

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

  const toast = useToast();
  const load = useCallback(() => {
    setLoadFailed(false);
    return cachedReads.hiddenAssets
      .load()
      .then((loaded) => {
        setItems(loaded);
        return true;
      })
      .catch(() => {
        setLoadFailed(true);
        return false;
      });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

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
      toast.show({ tone: 'success', title: `${label(asset)} is shown again` });
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
    <Card labelledBy="settings-hidden-assets">
      <CardHeader id="settings-hidden-assets" title="Hidden assets" />
      {items === null ? (
        loadFailed ? (
          <ErrorState onRetry={() => void load()}>
            Could not load the hidden assets; try again later.
          </ErrorState>
        ) : (
          <p className="ui-sub" aria-busy="true">
            <Bone width="60%" height={12} />
          </p>
        )
      ) : items.length === 0 ? (
        <p className="ui-sub">
          Nothing is hidden. Hide an asset from its own page under Portfolio; it comes back here.
        </p>
      ) : (
        items.map((asset) => (
          <SettingRow
            key={asset.instrumentId}
            title={label(asset)}
            description={
              <span role={failed === asset.instrumentId ? 'alert' : undefined}>
                {failed === asset.instrumentId
                  ? `Could not show ${label(asset)}. Nothing may have changed; try again.`
                  : `${asset.name} is out of the portfolio, its totals, history and filters.`}
              </span>
            }
            control={
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                aria-label={`Show ${label(asset)}`}
                onClick={() => void show(asset)}
              >
                Show
              </Button>
            }
          />
        ))
      )}
    </Card>
  );
}
