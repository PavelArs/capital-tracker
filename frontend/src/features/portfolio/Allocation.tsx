import type { AssetType } from '@api/portfolio-assets.api';
import type { AllocationSlice, PortfolioValuation } from '@api/portfolio-valuation.api';
import { useId, useState } from 'react';
import { assetIdentity, assetTypeColors } from '../shell/asset-identity';
import { sum } from '../wallets/wallets';
import { money, percent } from './format';

type Grouping = 'byAsset' | 'byType' | 'byAccount';
const groupings: [Grouping, string][] = [
  ['byAsset', 'Asset'],
  ['byType', 'Type'],
  ['byAccount', 'Account'],
];

/** Slice colour: the asset's own or its type's; accounts keep the positional palette. */
function sliceColor(
  portfolio: PortfolioValuation,
  grouping: Grouping,
  key: string,
): string | undefined {
  if (grouping === 'byType') return assetTypeColors[key as AssetType];
  if (grouping !== 'byAsset') return undefined;
  const asset = portfolio.assets.find((item) => item.instrumentId === key);
  return asset ? assetIdentity(asset).color : undefined;
}

const OTHER = '__other__';

/** At most `limit` rows: the largest slices, then the rest added up as "Other". */
function folded(slices: AllocationSlice[], limit: number | undefined) {
  if (limit === undefined || slices.length <= limit) return { shown: slices, rest: 0 };
  const rest = slices.slice(limit - 1);
  const percents = rest.map((slice) => slice.percent);
  return {
    shown: [
      ...slices.slice(0, limit - 1),
      {
        key: OTHER,
        label: 'Other',
        value: sum(rest.map((slice) => slice.value)),
        percent: percents.includes(null) ? null : sum(percents as string[]),
      },
    ],
    rest: rest.length,
  };
}

/**
 * Allocation by asset, type or account (PR-VAL-3, ALLOC): a bar and one row per slice. The
 * Dashboard passes a limit and the smallest slices become one "Other" row.
 */
export default function Allocation({
  portfolio,
  limit,
}: {
  portfolio: PortfolioValuation;
  limit?: number;
}) {
  const [grouping, setGrouping] = useState<Grouping>('byAsset');
  const heading = useId();
  const { shown, rest } = folded(portfolio.allocation[grouping], limit);
  const slices = shown.map((slice, index) => {
    const other = slice.key === OTHER;
    const color = other ? 'var(--c-other)' : sliceColor(portfolio, grouping, slice.key);
    const asset =
      grouping === 'byAsset'
        ? portfolio.assets.find((item) => item.instrumentId === slice.key)
        : undefined;
    // An asset is shown as "Bitcoin BTC" when its ticker differs from its name.
    const ticker = other
      ? `${rest} ${grouping === 'byAccount' ? 'accounts' : grouping === 'byType' ? 'types' : 'assets'}`
      : asset?.symbol && asset.symbol !== slice.label
        ? asset.symbol
        : undefined;
    return { ...slice, ticker, color, tone: color ? undefined : index % 6 };
  });
  return (
    <section className="shell-card" aria-labelledby={heading}>
      <div className="portfolio-toolbar">
        <h2 id={heading}>Allocation</h2>
        <div className="shell-seg" role="radiogroup" aria-label="Group allocation by">
          {groupings.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name={`${heading}-grouping`}
                value={value}
                checked={grouping === value}
                onChange={() => setGrouping(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      {slices.length === 0 ? (
        <p className="portfolio-none">Nothing with a price yet.</p>
      ) : (
        <>
          <div className="portfolio-bar" aria-hidden="true">
            {slices.map((slice) => (
              <span
                key={slice.key}
                style={{ width: `${slice.percent ?? 0}%`, background: slice.color }}
                data-tone={slice.tone}
              />
            ))}
          </div>
          <ul
            className="portfolio-slices"
            aria-label={`Allocation by ${grouping.slice(2).toLowerCase()}`}
          >
            {slices.map((slice) => (
              <li key={slice.key}>
                <span
                  className="portfolio-swatch"
                  style={{ background: slice.color }}
                  data-tone={slice.tone}
                  aria-hidden="true"
                />
                <span className="portfolio-slices__label">
                  {slice.label}
                  {slice.ticker && (
                    <span className="portfolio-slices__ticker"> {slice.ticker}</span>
                  )}
                </span>
                <span className="portfolio-slices__value">
                  {money(slice.value, portfolio.currency)}
                </span>
                <span className="portfolio-slices__percent">{percent(slice.percent, false)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!portfolio.allocation.complete && (
        <p className="shell-note portfolio-note">
          {portfolio.missingPriceCount > 0 && 'Assets without a price are not included.'}
          {portfolio.missingPriceCount > 0 && portfolio.unavailableAccountCount > 0 && ' '}
          {portfolio.unavailableAccountCount > 0 &&
            'Accounts whose history starts later are not included.'}
        </p>
      )}
    </section>
  );
}
