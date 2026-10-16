import type { AssetType } from '@api/portfolio-assets.api';
import type { AllocationSlice, PortfolioValuation } from '@api/portfolio-valuation.api';
import { useId, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Card, CardHeader } from '@/ui/Card';
import { SegmentedControl } from '@/ui/SegmentedControl';
import {
  type AccountClasses,
  assetClassColors,
  assetIdentity,
  assetTypeColors,
  depositColor,
  heldClass,
} from '../shell/asset-identity';
import { useAccountClasses } from '../shell/useAccountClasses';
import { sum } from '../wallets/wallets';
import { money, percent } from './format';
import './allocation.css';

type Grouping = 'byAsset' | 'byType' | 'byAccount';
const groupings: [Grouping, string][] = [
  ['byAsset', 'Assets'],
  ['byAccount', 'Wallets'],
  ['byType', 'Type'],
];

/** Allocation key of all bank deposits in the by-type grouping. */
const DEPOSITS = 'deposits';

/**
 * Slice colour: the asset's own, or its class's when brokers or property accounts hold it; a
 * type's; a broker or property account's class colour; other accounts keep the positional palette.
 */
function sliceColor(
  portfolio: PortfolioValuation,
  classes: AccountClasses,
  grouping: Grouping,
  key: string,
): string | undefined {
  if (grouping === 'byType')
    return key === DEPOSITS ? depositColor : assetTypeColors[key as AssetType];
  if (grouping === 'byAccount') {
    if (key.startsWith('bank:')) return depositColor;
    const assetClass = classes[key];
    return assetClass ? assetClassColors[assetClass] : undefined;
  }
  if (key.startsWith('deposit:')) return depositColor;
  const asset = portfolio.assets.find((item) => item.instrumentId === key);
  return asset
    ? assetIdentity({ ...asset, assetClass: heldClass(asset.holdings, classes) }).color
    : undefined;
}

/**
 * A slice's share of the portfolio as shown. A held share too small for two decimals reads
 * "<0.01%", never "0.00%", which would say it holds nothing (polish 23).
 */
export function shareText(value: string | null): string {
  const shown = percent(value, false);
  return value !== null && shown === '0.00%' && Number(value) > 0 ? '<0.01%' : shown;
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
  const classes = useAccountClasses();
  const { shown, rest } = folded(portfolio.allocation[grouping], limit);
  const slices = shown.map((slice, index) => {
    const other = slice.key === OTHER;
    const color = other ? 'var(--c-other)' : sliceColor(portfolio, classes, grouping, slice.key);
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
    <Card labelledBy={heading}>
      <CardHeader
        id={heading}
        title="Allocation"
        actions={
          <SegmentedControl
            name={`${heading}-grouping`}
            label="Group allocation by"
            options={groupings}
            value={grouping}
            onChange={setGrouping}
            size="sm"
          />
        }
      />
      {slices.length === 0 ? (
        <p className="ui-none">Nothing with a price yet.</p>
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
                <span className="portfolio-slices__percent">{shareText(slice.percent)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!portfolio.allocation.complete && (
        <Banner tone="info" role="none" className="portfolio-allocation__note">
          {portfolio.missingPriceCount > 0 && 'Assets without a price are not included.'}
          {portfolio.missingPriceCount > 0 && portfolio.unavailableAccountCount > 0 && ' '}
          {portfolio.unavailableAccountCount > 0 &&
            'Accounts whose history starts later are not included.'}
          {portfolio.unratedDepositCount > 0 &&
            `${portfolio.missingPriceCount + portfolio.unavailableAccountCount > 0 ? ' ' : ''}Deposits without a current exchange rate are not included.`}
        </Banner>
      )}
    </Card>
  );
}
