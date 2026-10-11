import { cachedReads } from '@api/cached-reads';
import type { Operation, OperationList, OperationRange } from '@api/operations.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { useNarrowScreen } from '@/ui/useMediaQuery';
import AddTransactionDialog from '../portfolio/AddTransactionDialog';
import { useAskedCurrency } from '../portfolio/currency';
import { DASH, money, quantity } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import { useAttention } from '../shell/attention-context';
import LoadMore, { useInfinite, useScrollMemory } from '../shell/InfiniteScroll';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { leftOutSymbols } from '../wallets/WalletParts';
import DuplicateProposals from './DuplicateProposals';
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
import PeriodFilter from './PeriodFilter';
import { periodOf } from './period';
import { handOver } from './proposals-handover';
import TransferProposals from './TransferProposals';
import TypeIcon, { Glyph } from './TypeIcon';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import './transactions.css';
import EmptyState from '@/ui/EmptyState';
import { ListRowText, rowClass } from '@/ui/ListRow';
import PageIntro from '@/ui/PageIntro';

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

/**
 * COST-UNKNOWN: a row that brings coins in without a purchase price, so the asset's cost basis
 * and profit leave them out: an incoming wallet transaction nobody has answered, or a recorded
 * receipt, reward, opening balance or swap whose cost is missing. Hidden and dust rows do not
 * count in the balances. A transfer between own wallets carries the cost of its source row,
 * which is listed here when that one is unknown.
 */
export function lacksCost(operation: Operation, asset: string): boolean {
  if (operation.status === 'hidden' || operation.status === 'dust') return false;
  const brings = operation.direction === 'in' || operation.type === 'swap';
  // A purchase or an answered receipt costs what was paid; a reward or an opening balance
  // carries its own cost basis, which may be missing while the value is known.
  const known =
    operation.costBasisUsd !== null ||
    (operation.kind !== 'reward' && operation.kind !== 'opening' && operation.valueUsd !== null);
  return brings && !known && assetKey(operation.asset) === asset;
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

/** Filter key of a row's type; a wallet transaction nobody classified is told by its direction. */
const typeKey = (operation: Operation) => operation.type ?? `direction:${operation.direction}`;

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

/**
 * Options of a filter, in first-seen order of the newest-first list. What is chosen stays an
 * option when the period shows no row of it, under the label it was last seen with.
 */
function options(
  operations: Operation[],
  entries: (operation: Operation) => [string, string][],
  chosen: string,
  seen: Map<string, string>,
) {
  const found = new Map<string, string>();
  for (const operation of operations)
    for (const [key, label] of entries(operation)) {
      seen.set(key, label);
      if (!found.has(key)) found.set(key, label);
    }
  const label = seen.get(chosen);
  if (chosen && !found.has(chosen) && label) found.set(chosen, label);
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
        <Badge tone={needs ? 'warn' : 'muted'} dot={needs}>
          {needs ? 'To classify' : statusLabels[operation.status]}
        </Badge>
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
      <td className="ui-num">
        {signedQuantity(operation)}
        {operation.counterAsset && operation.counterQuantity && (
          <span className="portfolio-sub">
            {amount(operation.counterQuantity, operation.counterAsset, '+')}
          </span>
        )}
      </td>
      <td className="ui-num">
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
      <button type="button" className={rowClass({ warn: needs, open: current })} onClick={onOpen}>
        <AssetIcon
          symbol={operation.asset.symbol}
          name={operation.asset.name}
          network={operation.asset.network}
        />
        <ListRowText
          title={title}
          detail={
            needs ? (
              <Badge tone="warn" dot>
                To classify
              </Badge>
            ) : (
              [
                (operation.status === 'hidden' || operation.status === 'dust') &&
                  statusLabels[operation.status],
                placeLabel(operation),
                at !== 'No time' && at,
              ]
                .filter(Boolean)
                .join(' · ')
            )
          }
          amount={signedQuantity(operation)}
          value={phoneValue(operation, currency)}
        />
      </button>
    </li>
  );
}

/** Brings a row into view unless it is already on screen; the drawer covers only its right. */
function reveal(row: Element) {
  const box = row.getBoundingClientRect();
  if (box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
  row.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
}

// The same question asked of the cache with or without a period, so the other pages' reads
// (no period) and this one's share what they share.
const lastList = (currency?: AccountingCurrency, range?: OperationRange) =>
  range ? cachedReads.operations.last(currency, range) : cachedReads.operations.last(currency);
// The cards above the list (joined transfers, duplicates) are read with the list, so they are
// there when it appears instead of pushing it down a moment later. An answer already kept is
// painted at once and needs no wait, and a slow answer never holds the list back for long.
const PROPOSALS_WAIT_MS = 1500;
const proposalsKept = () =>
  cachedReads.transferProposals.last() !== undefined &&
  cachedReads.duplicateProposals.last() !== undefined;
// A kept list is painted at once only with its cards: another page may have kept the list alone,
// and the cards would then arrive above it.
const shownList = (currency?: AccountingCurrency, range?: OperationRange) =>
  proposalsKept() ? lastList(currency, range) : undefined;
const proposalsArrived = (): Promise<unknown> => {
  if (proposalsKept()) return Promise.resolve();
  const read = Promise.allSettled([
    cachedReads.transferProposals.load().then(() => handOver('transfer')),
    cachedReads.duplicateProposals.load().then(() => handOver('duplicate')),
  ]);
  return Promise.race([read, new Promise((resolve) => setTimeout(resolve, PROPOSALS_WAIT_MS))]);
};
const loadList = (currency?: AccountingCurrency, range?: OperationRange) =>
  range ? cachedReads.operations.load(currency, range) : cachedReads.operations.load(currency);

// Every operation the app knows in one list (list-all-operations, OPS-4).
export default function TransactionsPage() {
  // No currency in the address means the owner's main currency (Settings).
  const [asked] = useAskedCurrency();
  const [params, setParams] = useSearchParams();
  // OPS-PERIOD: the days shown live in the address (?from=, ?to=) and narrow the list on the
  // server; none means the whole history.
  const from = params.get('from');
  const to = params.get('to');
  const period = useMemo(() => periodOf(from, to), [from, to]);
  // OPS-RETURN: coming back from another page shows the last list at once while a fresh one
  // loads, instead of a loading card that makes the page jump.
  const [list, setList] = useState<OperationList | null>(() => shownList(asked, period) ?? null);
  const [failed, setFailed] = useState(false);
  // TOKEN-HIDE: the tickers of tokens the wallets leave out, kept out of the asset filter.
  // ASSET-HIDE: so are the assets the owner hid from their own pages.
  const [hiddenTokens, setHiddenTokens] = useState<ReadonlySet<string>>(() =>
    leftOutSymbols(cachedReads.wallets.last() ?? [], cachedReads.hiddenAssets.last() ?? []),
  );
  const [search, setSearch] = useState('');
  // OPS-OPEN: a link from another page (the wallet page) names the transaction to open.
  const [openId, setOpenId] = useState<string | null>(null);
  // The Edit window of the prototype (M9); new transactions open from the page header.
  const [dialog, setDialog] = useState<{ editing?: Operation } | null>(null);
  const attention = useAttention();
  // The router commits an address change later, in a transition; a second filter change
  // before that builds on the first one, not on the address it replaces.
  const pending = useRef<{ from: URLSearchParams; next: URLSearchParams } | null>(null);
  const latest = useRef(0);
  // A list is on screen: it was kept from before, or has arrived.
  const onScreen = useRef(list !== null);

  const narrow = useNarrowScreen();
  const listRef = useRef<HTMLElement>(null);

  // A switched currency keeps the rows on screen until its values arrive.
  const load = useCallback(
    async (
      currency: AccountingCurrency | undefined,
      range: OperationRange | undefined,
      fresh: boolean,
    ) => {
      const request = ++latest.current;
      setFailed(false);
      if (fresh) {
        const kept = shownList(currency, range);
        setList(kept ?? null);
        onScreen.current = kept !== undefined;
      }
      try {
        // Only the first paint waits for the cards; a refresh of a list on screen does not.
        const [next] = await Promise.all([
          loadList(currency, range),
          onScreen.current ? undefined : proposalsArrived(),
        ]);
        if (request !== latest.current) return null;
        onScreen.current = true;
        setList(next);
        return next;
      } catch {
        if (request === latest.current) setFailed(true);
        return null;
      }
    },
    [],
  );
  useEffect(() => {
    void load(asked, period, false);
  }, [load, asked, period]);
  useEffect(() => {
    let live = true;
    // Without the wallets or the hidden assets the filter lists every asset, as before.
    Promise.all([
      cachedReads.wallets.load().catch(() => []),
      cachedReads.hiddenAssets.load().catch(() => []),
    ]).then(([wallets, hidden]) => live && setHiddenTokens(leftOutSymbols(wallets, hidden)));
    return () => {
      live = false;
    };
  }, []);

  // Filters live in the address, so other screens can link to "Needs classification".
  const status = params.get('status');
  const view: View = isStatusView(status)
    ? status
    : (views.find(([key]) => key === params.get('source'))?.[0] ?? 'all');
  const asset = params.get('asset') ?? '';
  const place = params.get('account') ?? '';
  // COST-UNKNOWN: the asset page links the rows that leave its cost basis empty.
  const unknownCost = params.get('cost') === 'unknown' && asset !== '';
  const kind = params.get('type') ?? '';
  const replaceParams = (next: URLSearchParams) => {
    pending.current = { from: params, next };
    setParams(next, { replace: true });
  };
  // OPS-OPEN: the address names the transaction only to get here; it opens and the address
  // goes back to the filters, so Back returns to the page that linked and a reload keeps the list.
  const linked = params.get('open');
  useEffect(() => {
    if (!linked) return;
    setOpenId(linked);
    const next = new URLSearchParams(params);
    next.delete('open');
    replaceParams(next);
  });
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
  // OPS-PERIOD: the options are those of the period shown.
  const seenAssets = useRef(new Map<string, string>());
  const seenPlaces = useRef(new Map<string, string>());
  const seenKinds = useRef(new Map<string, string>());
  const assetOptions = useMemo(
    () =>
      options(
        operations,
        (operation) =>
          [operation.asset, operation.counterAsset].flatMap((item) =>
            item &&
            // A token the wallets leave out is no asset to filter by, unless it is chosen now.
            (assetKey(item) === asset || !(item.symbol && hiddenTokens.has(item.symbol)))
              ? [[assetKey(item), item.symbol?.toUpperCase() ?? item.name] as [string, string]]
              : [],
          ),
        asset,
        seenAssets.current,
      ),
    [operations, hiddenTokens, asset],
  );
  const placeOptions = useMemo(
    () =>
      options(
        operations,
        (operation) => {
          const { accounts, wallets } = places(operation);
          return [
            ...accounts.flatMap((item) => (item ? [[item.id, item.name] as [string, string]] : [])),
            ...wallets.flatMap((item) =>
              item ? [[`wallet:${item.id}`, walletLabel(item)] as [string, string]] : [],
            ),
          ];
        },
        place,
        seenPlaces.current,
      ),
    [operations, place],
  );
  const kindOptions = useMemo(
    () =>
      options(
        operations,
        (operation) => [[typeKey(operation), typeLabel(operation)] as [string, string]],
        kind,
        seenKinds.current,
      ),
    [operations, kind],
  );
  const query = search.trim().toLowerCase();
  // Asset, account and search; the chips choose the view on top of them.
  const matches = (operation: Operation) =>
    (!asset || assetKeys(operation).includes(asset)) &&
    (!place || placeKeys(operation).includes(place)) &&
    (!unknownCost || lacksCost(operation, asset)) &&
    (!kind || typeKey(operation) === kind) &&
    (!query || searchable(operation).includes(query));
  const visible = operations.filter((operation) => inView(operation, view) && matches(operation));
  // INFINITE: twenty rows first, twenty more each time the end of the list is reached; a
  // changed filter, period or search starts again at twenty.
  const paged = useInfinite(visible, {
    resetKey: `${view}|${asset}|${place}|${kind}|${from ?? ''}|${to ?? ''}|${query}|${unknownCost}`,
    keep: 'transactions',
  });
  // A reload comes back to the rows and the place the owner was at.
  useScrollMemory('transactions', list !== null && !failed);
  const filtered = view !== 'all' || asset || place || kind || query || period || unknownCost;
  const opened = operations.find((operation) => operation.id === openId) ?? null;
  const clear = () => {
    setSearch('');
    // The header's display currency is not a filter.
    replaceParams(new URLSearchParams(asked ? { currency: asked } : {}));
  };
  const currency = list?.quoteCurrency ?? 'USD';
  // One group per UTC day, under a heading as in the prototype.
  const days: { heading: string; operations: Operation[] }[] = [];
  for (const operation of paged.rows) {
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
    attention?.refresh();
    void load(asked, period, false);
  };
  const empty = operations.length === 0 && !period;
  const addButton = (
    <button
      type="button"
      className="shell-button shell-button--primary"
      onClick={() => setDialog({})}
    >
      <Icon name="plus" className="shell-icon shell-icon--sm" />
      Add transaction
    </button>
  );
  // CLS-NEXT: the open transaction is marked in the list and brought into view, so the one
  // opened after a classification can be found when the drawer closes.
  const rowOf = useCallback(
    (id: string) =>
      [...(listRef.current?.querySelectorAll<HTMLElement>('[data-operation]') ?? [])].find(
        (row) => row.dataset.operation === id,
      ),
    [],
  );
  // A transaction opened from elsewhere, or the next one to classify, may be further down than
  // the rows on screen: the list grows to it once, when it is first found, and then scrolls to it.
  const turned = useRef<string | null>(null);
  useEffect(() => {
    if (!openId) {
      turned.current = null;
      return;
    }
    if (turned.current === openId) return;
    const at = visible.findIndex((operation) => operation.id === openId);
    if (at < 0) return;
    turned.current = openId;
    paged.reveal(at);
  });
  const shown = paged.rows.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: growing the list puts the row on screen.
  useEffect(() => {
    if (!openId) return;
    const row = rowOf(openId);
    if (row) reveal(row);
  }, [openId, rowOf, shown]);
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
    const next = await load(asked, period, false);
    if (!next || !was) return;
    // BYBIT-GAP-DELETE: the record is gone from the list.
    if (label === 'deleted') {
      setOpenId(null);
      setNotice('Record deleted. The wallet shows the difference again.');
      return;
    }
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
      <PageHeader title="Transactions" currency={list?.quoteCurrency} />
      {/* The dialog saves without the list, so the button is there while it loads or fails too;
          only an empty list moves it into the empty-state card. */}
      {(failed || list === null || !empty) && (
        <PageIntro action={addButton}>
          Every purchase, sale, transfer and income in one list. Wallets and exchanges add theirs on
          their own; record the rest here.
        </PageIntro>
      )}
      {notice && !opened && (
        <p className="ui-banner ui-banner--pos transactions-notice" role="status">
          {notice}
        </p>
      )}
      {list !== null && !failed && (
        <>
          <DuplicateProposals
            onReplaced={(message) => {
              setNotice(message);
              void load(asked, period, false);
            }}
          />
          <TransferProposals
            onJoined={(message) => {
              setNotice(message);
              void load(asked, period, false);
            }}
          />
        </>
      )}
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your transactions. Your data is safe; try again.</p>
          <button
            type="button"
            className="shell-button"
            onClick={() => void load(asked, period, true)}
          >
            Try again
          </button>
        </section>
      ) : list === null ? (
        <PageSkeleton label="Loading transactions" show={['rows']} rows={10} />
      ) : empty ? (
        <EmptyState
          id="transactions-empty"
          title="No transactions yet"
          actions={
            <>
              {addButton}
              <Link className="shell-button" to="/wallets">
                Open wallets
              </Link>
            </>
          }
        >
          Purchases, sales and transfers you record and transactions found in your wallets appear
          here.
        </EmptyState>
      ) : (
        <section className="shell-card" aria-label="All transactions" ref={listRef}>
          <div className="ui-toolbar">
            <div className="ui-chips" role="group" aria-label="Filter transactions">
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
                    className={`ui-chip${key === 'needs-classification' && count > 0 ? ' transactions-chip--warn' : ''}`}
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                  >
                    {label}
                    <span className="ui-chip__count"> {count}</span>
                  </button>
                );
              })}
            </div>
            <div className="ui-filters">
              <label className="ui-filter">
                <span>Asset</span>
                <select
                  className="ui-input ui-input--sm"
                  value={asset}
                  onChange={(event) => update({ asset: event.target.value })}
                >
                  <option value="">All assets</option>
                  {assetOptions.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-filter">
                <span>Account</span>
                <select
                  className="ui-input ui-input--sm"
                  value={place}
                  onChange={(event) => update({ account: event.target.value })}
                >
                  <option value="">All accounts</option>
                  {placeOptions.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-filter">
                <span>Type</span>
                <select
                  className="ui-input ui-input--sm"
                  value={kind}
                  onChange={(event) => update({ type: event.target.value })}
                >
                  <option value="">All types</option>
                  {kindOptions.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <PeriodFilter
                period={period}
                today={new Date().toISOString().slice(0, 10)}
                onChange={(next) => update({ from: next?.from ?? '', to: next?.to ?? '' })}
              />
              <input
                className="ui-input ui-input--sm ui-search"
                type="search"
                placeholder="Search asset, account, type"
                aria-label="Search transactions"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          {unknownCost && (
            <p className="transactions-info">
              Incoming transactions without a purchase price, which leave the cost basis and profit
              of this asset incomplete. Open one and answer it as a purchase, income or a transfer
              from your own wallet to give it a cost.{' '}
              <button type="button" className="shell-link" onClick={() => update({ cost: '' })}>
                Show all of this asset
              </button>
            </p>
          )}
          {view === 'dust' && (
            <p className="transactions-info transactions-dust-note">
              {list.dustThresholdUsd === null
                ? 'No dust threshold is set, so incoming wallet transactions ask to be classified, except those of tokens no price source lists or that you hid.'
                : `Incoming wallet transactions worth less than ${money(list.dustThresholdUsd, 'USD')} at the latest price. They count in your balances but don't ask to be classified; open one to classify or hide it.`}{' '}
              <Link to="/preferences">Change the threshold in Settings</Link>
            </p>
          )}
          {visible.length === 0 ? (
            <div className="portfolio-none transactions-none">
              <p>
                {view === 'needs-classification' && !asset && !place && !kind && !query && !period
                  ? 'All caught up'
                  : 'No transactions match'}
              </p>
              <button type="button" className="shell-button" onClick={clear}>
                Clear filters
              </button>
            </div>
          ) : narrow ? (
            <ol className="ui-rows transactions-list" aria-label="Transactions">
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
            <div className="ui-table-wrap">
              <table className="ui-table transactions-table" aria-label="Transactions">
                <colgroup>
                  {columns.map((column) => (
                    <col key={column} className={`transactions-col--${column}`} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Asset</th>
                    <th scope="col" className="ui-num">
                      Amount
                    </th>
                    <th scope="col" className="ui-num">
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
          {paged.more && <LoadMore {...paged.more} label="transactions" />}
          <p className="shell-note portfolio-note">
            {filtered ? `${visible.length} of ${operations.length}` : operations.length}{' '}
            {operations.length === 1 ? 'transaction' : 'transactions'}
            {period ? ' in the period' : ''}, newest first.{' '}
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
