import type { AssetType } from '@api/portfolio-assets.api';
import type { AccountingCurrency, AssetValuation } from '@api/portfolio-valuation.api';
import { type TokenChains, withChains } from '../shell/token-chains';
import { money, percent, tone } from './format';

// Small pieces the Portfolio screen shares with the asset page and the Dashboard. They live
// apart from the screen so the Dashboard does not pull the whole Portfolio file in with it.
export const typeLabels: Record<AssetType, string> = {
  crypto: 'Crypto',
  fiat: 'Cash',
  manual: 'Manual',
};
/**
 * "BTC · Crypto · USD": ticker, type and value currency of an asset; a token held in tracked
 * wallets names their blockchains, "USDT on Ethereum, Solana" (TOKEN-CHAIN).
 */
export function assetCaption(asset: AssetValuation, chains: TokenChains = new Map()): string {
  return [
    asset.symbol && withChains(asset.symbol, asset.symbol, chains),
    typeLabels[asset.assetType],
    asset.valuationCurrency,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function Signed({
  value,
  currency,
  ratio,
  inline,
}: {
  value: string | null;
  currency: AccountingCurrency;
  ratio?: string | null;
  /** The percentage beside the amount, on one line, as in a table row. */
  inline?: boolean;
}) {
  return (
    <span className={tone(value) ? `portfolio-${tone(value)}` : undefined}>
      {money(value, currency, true)}
      {ratio !== undefined && value !== null && ratio !== null && (
        <span className={`portfolio-sub${inline ? ' portfolio-sub--inline' : ''}`}>
          {percent(ratio)}
        </span>
      )}
    </span>
  );
}

/** A signed percentage in the gain or loss colour: "+2.10%", "-1.40%", or a dash. */
export function Change({ value }: { value: string | null }) {
  return (
    <span className={tone(value) ? `portfolio-${tone(value)}` : undefined}>{percent(value)}</span>
  );
}
