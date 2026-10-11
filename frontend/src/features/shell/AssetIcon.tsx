import type { AssetType } from '@api/portfolio-assets.api';
import { assetIdentity, type Blockchain, networkIdentity } from './asset-identity';
import './asset-icon.css';

/**
 * Round coloured glyph of an asset; decorative, the ticker or name sits next to it.
 * The glyph is drawn by CSS, so it stays out of the row's text. A token adds its blockchain's
 * glyph in the corner (TOKEN-CHAIN); the text next to it names the blockchain too.
 */
export default function AssetIcon({
  symbol,
  name,
  assetType,
  network,
  size = 'md',
}: {
  symbol: string | null;
  name: string;
  assetType?: AssetType;
  network?: Blockchain;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { color, glyph } = assetIdentity({ symbol, name, assetType });
  const chain = network ? networkIdentity(network) : null;
  return (
    <span
      className={`asset-icon asset-icon--${size}`}
      style={{ background: color }}
      data-glyph={glyph}
      aria-hidden="true"
    >
      {chain && (
        <span
          className="asset-icon__chain"
          style={{ background: chain.color }}
          data-chain={chain.glyph}
        />
      )}
    </span>
  );
}
