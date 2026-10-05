import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DASH } from '../portfolio/format';
import OperationDrawer from './OperationDrawer';
import {
  amount,
  assetKey,
  day,
  networkName,
  placeLabel,
  shortAddress,
  signedAmount,
  sourceLabels,
  statusLabels,
  ticker,
  time,
  typeLabel,
  usd,
  walletLabel,
} from './operation-format';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import './transactions.css';

type View = 'all' | 'needs-classification' | Operation['source'];
const views: [View, string][] = [
  ['all', 'All'],
  ['needs-classification', 'Needs classification'],
  ['chain', 'Blockchain'],
  ['manual', 'Manual'],
  ['csv', 'CSV'],
];

function inView(operation: Operation, view: View): boolean {
  if (view === 'all') return true;
  if (view === 'needs-classification') return operation.status === view;
  return operation.source === view;
}

function placeKeys(operation: Operation): string[] {
  if (operation.wallet) return [`wallet:${operation.wallet.id}`];
  return [operation.account?.id, operation.counterAccount?.id].filter(
    (key): key is string => key !== undefined,
  );
}

function assetKeys(operation: Operation): string[] {
  return [operation.asset, operation.counterAsset].flatMap((asset) =>
    asset ? [assetKey(asset)] : [],
  );
}

function searchable(operation: Operation): string {
  return [
    typeLabel(operation),
    operation.asset.symbol,
    operation.asset.name,
    operation.counterAsset?.symbol,
    operation.counterAsset?.name,
    placeLabel(operation),
    operation.wallet?.address,
    operation.chain?.txid,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Options of a filter, in first-seen order of the newest-first list. */
function options(operations: Operation[], entries: (operation: Operation) => [string, string][]) {
  const found = new Map<string, string>();
  for (const operation of operations)
    for (const [key, label] of entries(operation)) if (!found.has(key)) found.set(key, label);
  return [...found].sort((left, right) => left[1].localeCompare(right[1], 'en'));
}

function ValueCell({ operation }: { operation: Operation }) {
  if (operation.valueUsd !== null) return <>{usd(operation.valueUsd)}</>;
  if (operation.estimatedValueUsd !== null)
    return (
      <span className="transactions-muted">
        ≈ {usd(operation.estimatedValueUsd)}
        <span className="portfolio-sub">at latest price</span>
      </span>
    );
  if (operation.costBasisUsd !== null)
    return (
      <>
        {usd(operation.costBasisUsd)}
        <span className="portfolio-sub">cost basis</span>
      </>
    );
  return <span className="transactions-muted">{DASH}</span>;
}

function OperationRow({ operation, onOpen }: { operation: Operation; onOpen: () => void }) {
  const needs = operation.status === 'needs-classification';
  return (
    <tr className={needs ? 'transactions-row--needs' : undefined} onClick={onOpen}>
      <td>
        {day(operation.occurredAt)}
        <span className="portfolio-sub">{time(operation.occurredAt)}</span>
      </td>
      <td className="transactions-wrap">
        <button
          type="button"
          className="transactions-open"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {typeLabel(operation)}
        </button>
      </td>
      <td className="transactions-wrap">
        <span className="transactions-asset">
          {ticker(operation.asset)}
          {operation.counterAsset && ` → ${ticker(operation.counterAsset)}`}
        </span>
        <span className="portfolio-sub">
          {operation.asset.name}
          {operation.counterAsset && ` → ${operation.counterAsset.name}`}
        </span>
      </td>
      <td className="portfolio-num">
        {signedAmount(operation)}
        {operation.counterAsset && operation.counterQuantity && (
          <span className="portfolio-sub">
            {amount(operation.counterQuantity, operation.counterAsset, '+')}
          </span>
        )}
      </td>
      <td className="portfolio-num">
        <ValueCell operation={operation} />
      </td>
      <td className="transactions-wrap transactions-place">
        {operation.wallet ? (
          <>
            {networkName(operation.wallet)} wallet{' '}
            <span className="transactions-nowrap">{shortAddress(operation.wallet.address)}</span>
          </>
        ) : (
          placeLabel(operation)
        )}
      </td>
      <td>
        {needs ? (
          <span className="transactions-badge transactions-badge--warn">
            {statusLabels[operation.status]}
          </span>
        ) : (
          <span className="transactions-status">{statusLabels[operation.status]}</span>
        )}
      </td>
      <td>{sourceLabels[operation.source]}</td>
    </tr>
  );
}

// Every operation the app knows in one list (list-all-operations, OPS-4).
export default function TransactionsPage() {
  const [list, setList] = useState<OperationList | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    setList(null);
    try {
      const next = await operationsApi.list();
      if (request === latest.current) setList(next);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Filters live in the address, so other screens can link to "Needs classification".
  const view: View = (
    params.get('status') === 'needs-classification'
      ? 'needs-classification'
      : (views.find(([key]) => key === params.get('source'))?.[0] ?? 'all')
  ) as View;
  const asset = params.get('asset') ?? '';
  const place = params.get('account') ?? '';
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const setView = (next: View) =>
    update({
      status: next === 'needs-classification' ? next : '',
      source: next === 'all' || next === 'needs-classification' ? '' : next,
    });

  const operations = list?.operations ?? [];
  const assetOptions = useMemo(
    () =>
      options(operations, (operation) =>
        [operation.asset, operation.counterAsset].flatMap((item) =>
          item
            ? [[assetKey(item), item.symbol?.toUpperCase() ?? item.name] as [string, string]]
            : [],
        ),
      ),
    [operations],
  );
  const placeOptions = useMemo(
    () =>
      options(operations, (operation) => {
        if (operation.wallet)
          return [[`wallet:${operation.wallet.id}`, walletLabel(operation.wallet)]];
        return [operation.account, operation.counterAccount].flatMap((item) =>
          item ? [[item.id, item.name] as [string, string]] : [],
        );
      }),
    [operations],
  );
  const query = search.trim().toLowerCase();
  const visible = operations.filter(
    (operation) =>
      inView(operation, view) &&
      (!asset || assetKeys(operation).includes(asset)) &&
      (!place || placeKeys(operation).includes(place)) &&
      (!query || searchable(operation).includes(query)),
  );
  const filtered = view !== 'all' || asset || place || query;
  const opened = operations.find((operation) => operation.id === openId) ?? null;
  const clear = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <div className="shell-page">
      <div className="shell-page__head">
        <h1>Transactions</h1>
      </div>
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your transactions. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : list === null ? (
        <section className="shell-card portfolio-state" role="status">
          Loading transactions…
        </section>
      ) : operations.length === 0 ? (
        <section className="shell-card shell-empty" aria-labelledby="transactions-empty">
          <h2 id="transactions-empty">No transactions yet</h2>
          <p>
            Purchases, sales and transfers you record and transactions found in your wallets appear
            here.
          </p>
          <div className="transactions-actions">
            <Link className="shell-button" to="/manual-accounts">
              Open manual accounts
            </Link>
            <Link className="shell-button" to="/wallet-addresses">
              Open wallet addresses
            </Link>
          </div>
        </section>
      ) : (
        <section className="shell-card" aria-label="All transactions">
          <div className="portfolio-toolbar">
            <div className="portfolio-chips" role="group" aria-label="Filter transactions">
              {views.map(([key, label]) => {
                const count = operations.filter((operation) => inView(operation, key)).length;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`portfolio-chip${key === 'needs-classification' && count > 0 ? ' transactions-chip--warn' : ''}`}
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                  >
                    {label}
                    <span className="portfolio-chip__count"> {count}</span>
                  </button>
                );
              })}
            </div>
            <div className="transactions-filters">
              <label className="transactions-filter">
                <span>Asset</span>
                <select value={asset} onChange={(event) => update({ asset: event.target.value })}>
                  <option value="">All assets</option>
                  {assetOptions.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="transactions-filter">
                <span>Account</span>
                <select value={place} onChange={(event) => update({ account: event.target.value })}>
                  <option value="">All accounts</option>
                  {placeOptions.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <input
                className="transactions-search"
                type="search"
                placeholder="Search asset, account, type"
                aria-label="Search transactions"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          {visible.length === 0 ? (
            <div className="portfolio-none transactions-none">
              <p>
                {view === 'needs-classification' && !asset && !place && !query
                  ? 'All caught up'
                  : 'No transactions match'}
              </p>
              <button type="button" className="shell-button" onClick={clear}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="portfolio-table-wrap">
              <table className="portfolio-table transactions-table" aria-label="Transactions">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Type</th>
                    <th scope="col">Asset</th>
                    <th scope="col" className="portfolio-num">
                      Amount
                    </th>
                    <th scope="col" className="portfolio-num">
                      Value
                    </th>
                    <th scope="col">Account</th>
                    <th scope="col">Status</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((operation) => (
                    <OperationRow
                      key={operation.id}
                      operation={operation}
                      onOpen={() => setOpenId(operation.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="shell-note portfolio-note">
            {filtered ? `${visible.length} of ${operations.length}` : operations.length}{' '}
            {operations.length === 1 ? 'transaction' : 'transactions'}, newest first. Values are in
            USD as recorded; ≈ marks an estimate at the latest stored price. Dates are in UTC.
          </p>
        </section>
      )}
      {opened && <OperationDrawer operation={opened} onClose={() => setOpenId(null)} />}
    </div>
  );
}
