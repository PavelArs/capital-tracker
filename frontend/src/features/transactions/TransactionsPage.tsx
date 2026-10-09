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
  sourceLabel,
  statusLabel,
  statusLabels,
  ticker,
  transactionHash,
  typeLabel,
  walletLabel,
} from './operation-format';
import TypeIcon, { Glyph } from './TypeIcon';
import { useNarrowScreen } from './useNarrowScreen';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import './transactions.css';

type StatusView = 'needs-classification' | 'hidden' | 'dust';
type View = 'all' | StatusView | Operation['source'];
const views: [View, string][] = [
  ['all', 'All'],
  ['needs-classification', 'Needs classification'],
  ['hidden', 'Hidden'],
  ['dust', 'Dust'],
  ['chain', 'Blockchain'],
  ['manual', 'Manual'],
  ['csv', 'CSV'],
];
const isStatusView = (value: string | null): value is StatusView =>
  value === 'needs-classification' || value === 'hidden' || value === 'dust';

// Dust is filtered out of every view but its own (CLS-DUST).
function inView(operation: Operation, view: View): boolean {
  if (isStatusView(view)) return operation.status === view;
  if (operation.status === 'dust') return false;
  return view === 'all' || operation.source === view;
}

/** Where a row happened; a blockchain row's suggested other side is not a place yet (M13). */
function places(operation: Operation) {
  const moved = operation.type === 'transfer' || operation.type === 'swap';
  return {
    accounts: [operation.account, moved ? operation.counterAccount : null],
    wallets: [operation.wallet, moved ? operation.counterWallet : null],
  };
}

function placeKeys(operation: Operation): string[] {
  // A chain row is found by its address and, once it belongs to one, by its wallet (M10).
  const { accounts, wallets } = places(operation);
  return [
    ...wallets.map((wallet) => (wallet ? `wallet:${wallet.id}` : undefined)),
    ...accounts.map((account) => account?.id),
  ].filter((key): key is string => key !== undefined);
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
    operation.type === 'transfer' || operation.type === 'swap'
      ? operation.counterWallet?.address
      : undefined,
    operation.chain?.txid,
    transactionHash(operation),
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

// Fixed widths: a chip or filter that shows other rows never moves the columns.
const columns = ['type', 'asset', 'amount', 'value', 'place', 'status'];

/** Status, then where the row came from on a second line: "To classify / Blockchain". */
function StatusCell({ operation }: { operation: Operation }) {
  const needs = operation.status === 'needs-classification';
  const muted = operation.status === 'hidden' || operation.status === 'dust';
  return (
    <td>
      {needs || muted ? (
        <span
          className={`transactions-badge ${needs ? 'transactions-badge--warn' : 'transactions-badge--muted'}`}
        >
          {needs ? 'To classify' : statusLabels[operation.status]}
        </span>
      ) : (
        <span className="transactions-status">
          <Glyph name="check" />
          {statusLabel(operation)}
        </span>
      )}
      <span className="portfolio-sub transactions-source">
        {operation.source === 'chain' && <Glyph name="chain" />}
        {sourceLabel(operation)}
      </span>
    </td>
  );
}

function OperationRow({
  operation,
  currency,
  current,
  onOpen,
}: {
  operation: Operation;
  currency: AccountingCurrency;
  current: boolean;
  onOpen: () => void;
}) {
  const needs = operation.status === 'needs-classification';
  const muted = operation.status === 'hidden' || operation.status === 'dust';
  return (
    <tr
      className={
        [
          needs && 'transactions-row--needs',
          muted && 'transactions-row--hidden',
          current && 'transactions-row--open',
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      data-operation={operation.id}
      aria-current={current || undefined}
      onClick={onOpen}
    >
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
          <AssetIcon
            symbol={operation.asset.symbol}
            name={operation.asset.name}
            network={operation.asset.network}
            size="sm"
          />
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
        {operation.wallet && !operation.account ? (
          <>
            {networkName(operation.wallet)} wallet{' '}
            <span className="transactions-nowrap">{shortAddress(operation.wallet.address)}</span>
          </>
        ) : (
          placeLabel(operation)
        )}
      </td>
      <StatusCell operation={operation} />
    </tr>
  );
}

/** A row's value on one short line: "≈ $780.10", "$375.50 · 30,000 RUB", "No rate". */
function phoneValue(operation: Operation, currency: AccountingCurrency): string {
  if (operation.value !== null) {
    const paid = operation.paid && operation.paid.currency !== currency && operation.paid;
    const shown = money(operation.value, currency);
    return paid ? `${shown} · ${quantity(paid.gross)} ${paid.currency}` : shown;
  }
  if (operation.estimatedValue !== null) return `≈ ${money(operation.estimatedValue, currency)}`;
  if (operation.costBasis !== null) return `${money(operation.costBasis, currency)} cost basis`;
  if (
    operation.valueUsd !== null ||
    operation.estimatedValueUsd !== null ||
    operation.costBasisUsd !== null
  )
    return 'No rate';
  return DASH;
}

// Phones: one tappable two-line row per operation; status and source stay in the drawer.
function OperationItem({
  operation,
  currency,
  current,
  onOpen,
}: {
  operation: Operation;
  currency: AccountingCurrency;
  current: boolean;
  onOpen: () => void;
}) {
  const needs = operation.status === 'needs-classification';
  const at = rowTime(operation);
  const title = [
    typeLabel(operation),
    ticker(operation.asset) +
      (operation.counterAsset ? ` → ${ticker(operation.counterAsset)}` : ''),
  ].join(' ');
  return (
    <li data-operation={operation.id} aria-current={current || undefined}>
      <button
        type="button"
        className={`transactions-item${needs ? ' transactions-item--needs' : ''}${current ? ' transactions-item--open' : ''}`}
        onClick={onOpen}
      >
        <AssetIcon
          symbol={operation.asset.symbol}
          name={operation.asset.name}
          network={operation.asset.network}
        />
        <span className="transactions-item__main">
          <span className="transactions-item__title">{title}</span>
          {needs ? (
            <span className="transactions-badge transactions-badge--warn transactions-item__badge">
              To classify
            </span>
          ) : (
            <span className="transactions-item__detail">
              {(operation.status === 'hidden' || operation.status === 'dust') &&
                `${statusLabels[operation.status]} · `}
              {placeLabel(operation)}
              {at !== 'No time' && ` · ${at}`}
            </span>
          )}
        </span>
        <span className="transactions-item__side">
          <span className="transactions-item__amount">{signedQuantity(operation)}</span>
          <span className="transactions-item__value">{phoneValue(operation, currency)}</span>
        </span>
      </button>
    </li>
  );
}

// OPS-RETURN: the list last shown, so coming back from another page shows it at once while
// a fresh one loads, instead of a loading card that makes the page jump.
let lastList: { asked: AccountingCurrency | undefined; list: OperationList } | null = null;

/** Tests start from an empty page. */
export function forgetLastList() {
  lastList = null;
}

/** Brings a row into view unless it is already on screen; the drawer covers only its right. */
function reveal(row: Element) {
  const box = row.getBoundingClientRect();
  if (box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
  row.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
}

// Every operation the app knows in one list (list-all-operations, OPS-4).
export default function TransactionsPage() {
  // No currency in the address means the owner's main currency (Settings).
  const [asked] = useAskedCurrency();
  const [list, setList] = useState<OperationList | null>(() =>
    lastList && lastList.asked === asked ? lastList.list : null,
  );
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

  const narrow = useNarrowScreen();
  const listRef = useRef<HTMLElement>(null);

  // A switched currency keeps the rows on screen until its values arrive.
  const load = useCallback(async (currency: AccountingCurrency | undefined, fresh: boolean) => {
    const request = ++latest.current;
    setFailed(false);
    if (fresh) setList(null);
    try {
      const next = await operationsApi.list(currency);
      if (request !== latest.current) return null;
      lastList = { asked: currency, list: next };
      setList(next);
      return next;
    } catch {
      if (request === latest.current) setFailed(true);
      return null;
    }
  }, []);
  useEffect(() => {
    void load(asked, false);
  }, [load, asked]);

  // Filters live in the address, so other screens can link to "Needs classification".
  const status = params.get('status');
  const view: View = isStatusView(status)
    ? status
    : (views.find(([key]) => key === params.get('source'))?.[0] ?? 'all');
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
      status: isStatusView(next) ? next : '',
      source: next === 'all' || isStatusView(next) ? '' : next,
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
        const { accounts, wallets } = places(operation);
        return [
          ...accounts.flatMap((item) => (item ? [[item.id, item.name] as [string, string]] : [])),
          ...wallets.flatMap((item) =>
            item ? [[`wallet:${item.id}`, walletLabel(item)] as [string, string]] : [],
          ),
        ];
      }),
    [operations],
  );
  const query = search.trim().toLowerCase();
  // Asset, account and search; the chips choose the view on top of them.
  const matches = (operation: Operation) =>
    (!asset || assetKeys(operation).includes(asset)) &&
    (!place || placeKeys(operation).includes(place)) &&
    (!query || searchable(operation).includes(query));
  const visible = operations.filter((operation) => inView(operation, view) && matches(operation));
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
  // OPS-DELETE: an added, changed or deleted transaction keeps the rows on screen until the
  // new list replaces them, so nothing jumps.
  const changed = () => {
    setDialog(null);
    setOpenId(null);
    void load(asked, false);
  };
  // CLS-NEXT: the open transaction is marked in the list and brought into view, so the one
  // opened after a classification can be found when the drawer closes.
  const rowOf = useCallback(
    (id: string) =>
      [...(listRef.current?.querySelectorAll<HTMLElement>('[data-operation]') ?? [])].find(
        (row) => row.dataset.operation === id,
      ),
    [],
  );
  useEffect(() => {
    if (!openId) return;
    const row = rowOf(openId);
    if (row) reveal(row);
  }, [openId, rowOf]);
  const [notice, setNotice] = useState<string | null>(null);
  const open = (id: string) => {
    setNotice(null);
    setOpenId(id);
  };
  const toClassify = operations.filter((item) => item.status === 'needs-classification');
  // CLS-BUY: after an answer the next transaction to classify opens, newest first, so a
  // backlog is worked through without going back to the list.
  const classified = async (label: string) => {
    const was = opened;
    const next = await load(asked, false);
    if (!next || !was) return;
    const said =
      label === 'hidden'
        ? 'Hidden from calculations.'
        : label === 'included'
          ? 'Included in calculations again.'
          : `Saved as ${label}.`;
    const waiting = next.operations.filter(
      (item) => item.status === 'needs-classification' && item.id !== was.id,
    );
    // CLS-ADJACENT: the next one is the neighbour in time among the rows the filters show:
    // the next older one below it in the list, or at the end the next newer one above it.
    const open = new Map(waiting.filter(matches).map((item) => [item.id, item]));
    const at = operations.findIndex((item) => item.id === was.id);
    const older = operations.slice(at + 1).find((item) => open.has(item.id));
    const newer = operations
      .slice(0, Math.max(at, 0))
      .reverse()
      .find((item) => open.has(item.id));
    const neighbour = was.status === 'needs-classification' ? (older ?? newer) : undefined;
    const following = neighbour && open.get(neighbour.id);
    if (following) {
      setOpenId(following.id);
      setNotice(`${said} Here is the next one.`);
    } else if (was.status === 'needs-classification') {
      // The last one: back to the list, which now says so.
      setOpenId(null);
      setNotice(
        waiting.length > 0
          ? `${said} Nothing else to classify here.`
          : `All transactions classified. The last one was ${label === 'hidden' ? 'hidden' : `saved as ${label}`}.`,
      );
    } else {
      setOpenId(was.id);
      setNotice(said);
    }
  };

  return (
    <div className="shell-page">
      {/* The header's switch sets ?currency=; the list reloads in that currency. */}
      <PageHeader
        title="Transactions"
        currency={list?.quoteCurrency}
        onTransactionSaved={changed}
      />
      {notice && !opened && (
        <p className="transactions-notice" role="status">
          {notice}
        </p>
      )}
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
            <Link className="shell-button" to="/wallets">
              Open wallets
            </Link>
          </div>
        </section>
      ) : (
        <section className="shell-card" aria-label="All transactions" ref={listRef}>
          <div className="portfolio-toolbar">
            <div className="portfolio-chips" role="group" aria-label="Filter transactions">
              {views.map(([key, label]) => {
                // OPS-COUNTS: what the chip would show with the other filters as they are.
                const count = operations.filter(
                  (operation) => inView(operation, key) && matches(operation),
                ).length;
                // The Dust chip appears once a threshold is set or something is dust.
                if (key === 'dust' && count === 0 && list.dustThresholdUsd === null && view !== key)
                  return null;
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
          {view === 'dust' && (
            <p className="transactions-info transactions-dust-note">
              {list.dustThresholdUsd === null
                ? 'No dust threshold is set, so every incoming wallet transaction asks to be classified.'
                : `Incoming wallet transactions worth less than ${money(list.dustThresholdUsd, 'USD')} at the latest price. They count in your balances but don't ask to be classified; open one to classify or hide it.`}{' '}
              <Link to="/preferences">Change the threshold in Settings</Link>
            </p>
          )}
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
          ) : narrow ? (
            <ol className="transactions-list" aria-label="Transactions">
              {days.map((group) => (
                <li key={group.heading} className="transactions-list__day">
                  <h2 className="transactions-list__heading">{group.heading}</h2>
                  <ul>
                    {group.operations.map((operation) => (
                      <OperationItem
                        key={operation.id}
                        operation={operation}
                        currency={currency}
                        current={operation.id === openId}
                        onOpen={() => open(operation.id)}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <div className="portfolio-table-wrap">
              <table className="portfolio-table transactions-table" aria-label="Transactions">
                <colgroup>
                  {columns.map((column) => (
                    <col key={column} className={`transactions-col--${column}`} />
                  ))}
                </colgroup>
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
                  </tr>
                </thead>
                {days.map((group) => (
                  <tbody key={group.heading}>
                    <tr className="transactions-day">
                      <th scope="rowgroup" colSpan={columns.length}>
                        {group.heading}
                      </th>
                    </tr>
                    {group.operations.map((operation) => (
                      <OperationRow
                        key={operation.id}
                        operation={operation}
                        currency={currency}
                        current={operation.id === openId}
                        onOpen={() => open(operation.id)}
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
            ; ≈ marks an estimate at the price stored for the transaction's time. Dates and times
            are in UTC.
          </p>
        </section>
      )}
      {opened && (
        <OperationDrawer
          key={`${opened.id}:${opened.classification?.version ?? 0}`}
          operation={opened}
          left={toClassify.length}
          notice={notice}
          onClassified={(label) => void classified(label)}
          currency={currency}
          operations={operations}
          dustThresholdUsd={list?.dustThresholdUsd ?? null}
          onClose={() => {
            const closed = opened.id;
            setOpenId(null);
            setNotice(null);
            // The keyboard comes back to the row the drawer showed last.
            window.requestAnimationFrame(() => rowOf(closed)?.querySelector('button')?.focus());
          }}
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
