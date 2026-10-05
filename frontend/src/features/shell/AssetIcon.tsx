import type { AssetType } from '@api/portfolio-assets.api';
import { assetIdentity } from './asset-identity';
import './asset-icon.css';

/**
 * Round coloured glyph of an asset; decorative, the ticker or name sits next to it.
 * The glyph is drawn by CSS, so it stays out of the row's text.
 */
export default function AssetIcon({
  symbol,
  name,
  assetType,
  size = 'md',
}: {
  symbol: string | null;
  name: string;
  assetType?: AssetType;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { color, glyph } = assetIdentity({ symbol, name, assetType });
  return (
    <span
      className={`asset-icon asset-icon--${size}`}
      style={{ background: color }}
      data-glyph={glyph}
      aria-hidden="true"
    />
  );
}
