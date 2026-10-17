import { cachedReads } from '@api/cached-reads';
import type {
  AccountingCurrency,
  AssetValuation,
  PortfolioValuation,
} from '@api/portfolio-valuation.api';
import { type MouseEvent, type ReactNode, useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { ListRowText, rowClass } from '@/ui/ListRow';
import { useNarrowScreen } from '@/ui/useMediaQuery';
import { dateText, rateText } from '../deposits/deposit-format';
import { Change } from '../portfolio/asset-parts';
import { withCurrency } from '../portfolio/currency';
import {
  age,
  DASH,
  missingLabel,
  money,
  percent,
  price,
  quantity,
  sourceLabels,
  tone,
} from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import { heldClass } from '../shell/asset-identity';
import { onlyChain, type TokenChains, withChains } from '../shell/token-chains';
import { useAccountClasses } from '../shell/useAccountClasses';
import { useCachedRead } from '../shell/useCachedRead';
import { AssetRowsLoading } from './DashboardLoading';

const TOP = 5;
const DEPOSIT = 'deposit:';

/** A bank deposit in the ranking: it has an allocation slice but no asset row. */
interface DepositHolding {
  id: string;
  name: string;
  value: string;
  share: string | null;
}

export type TopHolding =
  | { kind: 'asset'; key: string; asset: AssetValuation }
  | { kind: 'deposit'; key: string; deposit: DepositHolding };

/**
 * The five largest holdings, bank deposits included: the allocation by asset ranks everything
 * with a value, largest first; held assets without a price follow, as on the Portfolio.
 */
export function topAssets(portfolio: PortfolioValuation): TopHolding[] {
  const assets = new Map(portfolio.assets.map((asset) => [asset.instrumentId, asset]));
  const ranked = portfolio.allocation.byAsset.flatMap((slice): TopHolding[] => {
    if (slice.key.startsWith(DEPOSIT)) {
      const id = slice.key.slice(DEPOSIT.length);
      return [
        {
          kind: 'deposit',
          key: slice.key,
          deposit: { id, name: slice.label, value: slice.value, share: slice.percent },
        },
      ];
    }
    const asset = assets.get(slice.key);
    return asset ? [{ kind: 'asset', key: slice.key, asset }] : [];
  });
  const listed = new Set(ranked.map((holding) => holding.key));
  const unpriced = portfolio.assets
    .filter((asset) => Number(asset.quantity) !== 0 && !listed.has(asset.instrumentId))
    .map((asset): TopHolding => ({ kind: 'asset', key: asset.instrumentId, asset }));
  return [...ranked, ...unpriced].slice(0, TOP);
}

/** "500 USDT on Ethereum": a token held in tracked wallets names their blockchains. */
const amount = (asset: AssetValuation, chains: TokenChains) =>
  withChains(
    `${quantity(asset.quantity)}${asset.symbol ? ` ${asset.symbol}` : ''}`,
    asset.symbol,
    chains,
  );

/** A hand-valued item held as one whole (a flat, a painting) has no price per unit to show. */
const wholeItem = (asset: AssetValuation) =>
  asset.priceSource === 'manual' && asset.symbol === null && Number(asset.quantity) === 1;

/** "stale, 3 h ago" for a market price older than two hours (PR-PRC-3). */
const staleNote = (asset: AssetValuation, now: Date) =>
  asset.price?.status === 'stale' && asset.price.observedAt
    ? `stale, ${age(asset.price.observedAt, now)}`
    : null;

/** "Synthetic Bank · 12% · until Dec 1, 2026", read from the deposits list once it is here. */
function DepositTerms({ id }: { id: string }) {
  const { data } = useCachedRead(cachedReads.deposits);
  const deposit = data?.items.find((item) => item.id === id);
  if (!deposit) return 'Bank deposit';
  if (deposit.kind === 'account') return `${deposit.bank} · ${rateText(deposit)}`;
  const until = deposit.endDate ? `until ${dateText(deposit.endDate)}` : 'no end date';
  return `${deposit.bank} · ${rateText(deposit)} · ${until}`;
}

function DepositIcon({ name }: { name: string }) {
  return (
    <span
      className="asset-icon asset-icon--md dashboard-assets__deposit"
      data-glyph={name.charAt(0).toUpperCase()}
      aria-hidden="true"
    />
  );
}

const pathOf = (holding: TopHolding, asked: AccountingCurrency | undefined) =>
  withCurrency(
    holding.kind === 'deposit'
      ? `/deposits/${holding.deposit.id}`
      : `/portfolio/${holding.asset.instrumentId}`,
    asked,
  );

function AssetCells({
  asset,
  currency,
  now,
}: {
  asset: AssetValuation;
  currency: AccountingCurrency;
  now: Date;
}) {
  const stale = staleNote(asset, now);
  return (
    <>
      <td className="ui-num">
        {wholeItem(asset) ? (
          <span title="Valued as a whole, not per unit">{DASH}</span>
        ) : asset.price ? (
          <>
            {price(asset.price.value, currency)}
            {stale && <span className="dashboard-assets__stale">{stale}</span>}
          </>
        ) : (
          missingLabel(asset)
        )}
      </td>
      <td className="ui-num">
        {asset.priceSource === 'market' ? (
          <Change value={asset.priceChange24hPercent} />
        ) : (
          <span className="ui-muted">{sourceLabels[asset.priceSource]}</span>
        )}
      </td>
      <td className="ui-num ui-strong">{money(asset.value, currency)}</td>
      <td className="ui-num">{percent(asset.allocationPercent, false)}</td>
    </>
  );
}

function Table({
  holdings,
  currency,
  asked,
  chains,
}: {
  holdings: TopHolding[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
  chains: TokenChains;
}) {
  const navigate = useNavigate();
  const classes = useAccountClasses();
  const now = new Date();
  // DASH-ROW: a click anywhere on the row opens it; the name link stays the keyboard stop.
  const open = (to: string) => (event: MouseEvent) => {
    if ((event.target as Element).closest('a')) return;
    if (window.getSelection()?.toString()) return;
    navigate(to);
  };
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col" className="ui-num">
              Price
            </th>
            <th scope="col" className="ui-num">
              24h
            </th>
            <th scope="col" className="ui-num">
              Value
            </th>
            <th scope="col" className="ui-num">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const to = pathOf(holding, asked);
            const [icon, name, detail]: [ReactNode, string, ReactNode] =
              holding.kind === 'deposit'
                ? [
                    <DepositIcon key="icon" name={holding.deposit.name} />,
                    holding.deposit.name,
                    <DepositTerms key="terms" id={holding.deposit.id} />,
                  ]
                : [
                    <AssetIcon
                      key="icon"
                      symbol={holding.asset.symbol}
                      name={holding.asset.name}
                      assetType={holding.asset.assetType}
                      assetClass={heldClass(holding.asset.holdings, classes)}
                      network={onlyChain(holding.asset.symbol, chains)}
                    />,
                    holding.asset.name,
                    amount(holding.asset, chains),
                  ];
            return (
              <tr key={holding.key} onClick={open(to)}>
                <td>
                  <span className="dashboard-asset">
                    {icon}
                    <span>
                      <Link className="dashboard-asset__name" to={to}>
                        {name}
                      </Link>
                      <span className="dashboard-asset__detail">{detail}</span>
                    </span>
                  </span>
                </td>
                {holding.kind === 'deposit' ? (
                  <>
                    <td className="ui-num">{DASH}</td>
                    <td className="ui-num">
                      <span title="Interest accrues daily">{DASH}</span>
                    </td>
                    <td className="ui-num ui-strong">{money(holding.deposit.value, currency)}</td>
                    <td className="ui-num">{percent(holding.deposit.share, false)}</td>
                  </>
                ) : (
                  <AssetCells asset={holding.asset} currency={currency} now={now} />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Line 2 on the right of a phone row: today's change, the stale age or the price source. */
function phoneValue(asset: AssetValuation, now: Date): ReactNode {
  if (asset.priceSource !== 'market') return sourceLabels[asset.priceSource];
  const stale = staleNote(asset, now);
  if (stale) return <span className="dashboard-assets__stale">{stale}</span>;
  const change = asset.priceChange24hPercent;
  return (
    <span className={tone(change) ? `ui-${tone(change)}` : undefined}>{percent(change)} today</span>
  );
}

// Phones: the same two-line rows as the Portfolio list, with the 24h change on the right
// (mobile tables spec: "+0.80% today").
function List({
  holdings,
  currency,
  asked,
  chains,
}: {
  holdings: TopHolding[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
  chains: TokenChains;
}) {
  const classes = useAccountClasses();
  const now = new Date();
  return (
    <ul className="ui-rows">
      {holdings.map((holding) => (
        <li key={holding.key}>
          <Link className={rowClass()} to={pathOf(holding, asked)}>
            {holding.kind === 'deposit' ? (
              <>
                <DepositIcon name={holding.deposit.name} />
                <ListRowText
                  title={holding.deposit.name}
                  detail={
                    <span className="ui-row__detail">
                      <DepositTerms id={holding.deposit.id} />
                    </span>
                  }
                  amount={money(holding.deposit.value, currency)}
                  value="Interest daily"
                />
              </>
            ) : (
              <>
                <AssetIcon
                  symbol={holding.asset.symbol}
                  name={holding.asset.name}
                  assetType={holding.asset.assetType}
                  assetClass={heldClass(holding.asset.holdings, classes)}
                  network={onlyChain(holding.asset.symbol, chains)}
                />
                <ListRowText
                  title={holding.asset.name}
                  detail={amount(holding.asset, chains)}
                  amount={money(holding.asset.value, currency)}
                  value={phoneValue(holding.asset, now)}
                />
              </>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** DASH-MAIN: the five largest holdings, linking to their pages and to the whole Portfolio. */
export default function TopAssets({
  portfolio,
  failed,
  onRetry,
  asked,
  chains = new Map(),
}: {
  /** TOKEN-CHAIN: where the tracked wallets hold each token. */
  chains?: TokenChains;
  portfolio: PortfolioValuation | null;
  failed: boolean;
  onRetry: () => void;
  asked: AccountingCurrency | undefined;
}) {
  const heading = useId();
  const phone = useNarrowScreen();
  const holdings = portfolio ? topAssets(portfolio) : [];
  return (
    <Card className="dashboard-assets" labelledBy={heading} busy={portfolio === null && !failed}>
      <CardHeader
        id={heading}
        title="Top assets"
        actions={
          <Link className="ui-link ui-link--target" to={withCurrency('/portfolio', asked)}>
            All assets
          </Link>
        }
      />
      {failed && (
        <Banner
          tone="neg"
          action={
            <Button size="sm" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          {portfolio === null
            ? 'Could not load your assets.'
            : 'Could not update your assets. Showing the last loaded figures.'}
        </Banner>
      )}
      {portfolio === null ? (
        !failed && <AssetRowsLoading />
      ) : holdings.length === 0 ? (
        <p className="ui-none">No assets held right now.</p>
      ) : phone ? (
        <List holdings={holdings} currency={portfolio.currency} asked={asked} chains={chains} />
      ) : (
        <Table holdings={holdings} currency={portfolio.currency} asked={asked} chains={chains} />
      )}
    </Card>
  );
}
