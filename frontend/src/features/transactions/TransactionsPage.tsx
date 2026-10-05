import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AddTransactionDialog from '../portfolio/AddTransactionDialog';
import { useAskedCurrency } from '../portfolio/currency';
import { DASH, money, quantity } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import PageHeader from '../shell/PageHeader';
import OperationDrawer from './OperationDrawer';
import {
  amount,
  assetKey,
  dayHeading,
  networkName,
  placeLabel,
  rowTime,
  shortAddress,
  signedQuantity,
  sourceLabels,
  statusLabels,
  ticker,
  typeLabel,
  walletLabel,
} from './operation-format';
import TypeIcon, { Glyph } from './TypeIcon';
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

function ValueCell({
  operation,
  currency,
}: {
  operation: Operation;
  currency: AccountingCurrency;
}) {
  // What a purchase or sale paid in RUB or EUR actually cost, unless the list is in it.
  const paid = operation.paid && operation.paid.currency !== currency && (
    <span className="portfolio-sub">
      paid {quantity(operation.paid.gross)} {operation.paid.currency}
    </span>
  );
  if (operation.value !== null)
    return (
      <>
        {money(operation.value, currency)}
        {paid}
      </>
    );
  if (operation.estimatedValue !== null)
    return (
      <span className="transactions-muted">≈ {money(operation.estimatedValue, currency)}</span>
    );
  if (operation.costBasis !== null)
    return (
      <>
        {money(operation.costBasis, currency)}
        <span className="portfolio-sub">cost basis</span>
      </>
    );
  // Recorded in USD, but no Bank of Russia rate is stored for that date.
  if (
    operation.valueUsd !== null ||
    operation.estimatedValueUsd !== null ||
    operation.costBasisUsd !== null
  )
    return (
      <span className="transactions-muted">
        {DASH}
        <span className="portfolio-sub">No rate</span>
      </span>
    );
  return <span className="transactions-muted">{DASH}</span>;
}

function OperationRow({
  operation,
  currency,
  onOpen,
}: {
  operation: Operation;
  currency: AccountingCurrency;
  onOpen: () => void;
}) {
  const needs = operation.status === 'needs-classification';
  return (
    <tr className={needs ? 'transactions-row--needs' : undefined} onClick={onOpen}>
      <td className="transactions-wrap">
        <span className="transactions-type">
          <TypeIcon operation={operation} />
          <span>
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
            <span className="portfolio-sub">{rowTime(operation)}</span>
          </span>
        </span>
      </td>
      <td className="transactions-wrap">
        <span
          className="transactions-asset"
          title={[operation.asset.name, operation.counterAsset?.name].filter(Boolean).join(' → ')}
        >
          <AssetIcon symbol={operation.asset.symbol} name={operation.asset.name} size="sm" />
          {ticker(operation.asset)}
          {operation.counterAsset && ` → ${ticker(operation.counterAsset)}`}
        </span>
      </td>
      <td className="portfolio-num">
        {signedQuantity(operation)}
        {operation.counterAsset && operation.counterQuantity && (
          <span className="portfolio-sub">
            {amount(operation.counterQuantity, operation.counterAsset, '+')}
          </span>
        )}
      </td>
      <td className="portfolio-num">
        <ValueCell operation={operation} currency={currency} />
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
          <span className="transactions-status">
            <Glyph name="check" />
            {statusLabels[operation.status]}
          </span>
        )}
      </td>
      <td>
        <span className="transactions-status">
          {operation.source === 'chain' && <Glyph name="chain" />}
          {sourceLabels[operation.source]}
        </span>
      </td>
    </tr>
  );
}

// Every operation the app knows in one list (list-all-operations, OPS-4).
export default function TransactionsPage() {
  const [list, setList] = useState<OperationList | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  // The Edit window of the prototype (M9); new transactions open from the page header.
  const [dialog, setDialog] = useState<{ editing?: Operation } | null>(null);
  const [params, setParams] = useSearchParams();
  // The router commits an address change later, in a transition; a second filter change
  // before that builds on the first one, not on the address it replaces.
  const pending = useRef<{ from: URLSearchParams; next: URLSearchParams } | null>(null);
  const latest = useRef(0);

  // No currency in the address means the owner's main currency (Settings).
  const [asked] = useAskedCurrency();

  // A switched currency keeps the rows on screen until its values arrive.
  const load = useCallback(async (currency: AccountingCurrency | undefined, fresh: boolean) => {
    const request = ++latest.current;
    setFailed(false);
    if (fresh) setList(null);
    try {
      const next = await operationsApi.list(currency);
      if (request === latest.current) setList(next);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load(asked, false);
  }, [load, asked]);

  // Filters live in the address, so other screens can link to "Needs classification".
  const view: View = (
    params.get('status') === 'needs-classification'
      ? 'needs-classification'
      : (views.find(([key]) => key === params.get('source'))?.[0] ?? 'all')
  ) as View;
  const asset = params.get('asset') ?? '';
  const place = params.get('account') ?? '';
  const replaceParams = (next: URLSearchParams) => {
    pending.current = { from: params, next };
    setParams(next, { replace: true });
  };
  const update = (changes: Record<string, string>) => {
    const base = pending.current?.from === params ? pending.current.next : params;
    const next = new URLSearchParams(base);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    replaceParams(next);
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
    // The header's display currency is not a filter.
    replaceParams(new URLSearchParams(asked ? { currency: asked } : {}));
  };
  const currency = list?.quoteCurrency ?? 'USD';
  // One group per UTC day, under a heading as in the prototype.
  const days: { heading: string; operations: Operation[] }[] = [];
  for (const operation of visible) {
    const heading = dayHeading(operation.occurredAt, list?.at ?? operation.occurredAt);
    const last = days.at(-1);
    if (last?.heading === heading) last.operations.push(operation);
    else days.push({ heading, operations: [operation] });
  }
  const changed = () => {
    setDialog(null);
    setOpenId(null);
    void load(asked, true);
  };

  return (
    <div className="shell-page">
      {/* The header's switch sets ?currency=; the list reloads in that currency. */}
      <PageHeader
        title="Transactions"
        currency={list?.quoteCurrency}
        onTransactionSaved={changed}
      />
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your transactions. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load(asked, true)}>
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
          {/* Add transaction is in the page header. */}
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
                {days.map((group) => (
                  <tbody key={group.heading}>
                    <tr className="transactions-day">
                      <th scope="rowgroup" colSpan={7}>
                        {group.heading}
                      </th>
                    </tr>
                    {group.operations.map((operation) => (
                      <OperationRow
                        key={operation.id}
                        operation={operation}
                        currency={currency}
                        onOpen={() => setOpenId(operation.id)}
                      />
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          <p className="shell-note portfolio-note">
            {filtered ? `${visible.length} of ${operations.length}` : operations.length}{' '}
            {operations.length === 1 ? 'transaction' : 'transactions'}, newest first.{' '}
            {currency === 'USD'
              ? 'Values are in USD as recorded'
              : `Values are in ${currency} at the Bank of Russia rate of each transaction's date`}
            ; ≈ marks an estimate at the latest stored price. Dates and times are in UTC.
          </p>
        </section>
      )}
      {opened && (
        <OperationDrawer
          operation={opened}
          currency={currency}
          operations={operations}
          onClose={() => setOpenId(null)}
          onEdit={(operation) => {
            setOpenId(null);
            setDialog({ editing: operation });
          }}
          onDeleted={changed}
        />
      )}
      {dialog && (
        <AddTransactionDialog
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSaved={changed}
        />
      )}
    </div>
  );
}
