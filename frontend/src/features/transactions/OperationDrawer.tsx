import { assetRewardsApi } from '@api/asset-rewards.api';
import { cachedReads } from '@api/cached-reads';
import { announceClassificationChange, type Operation, operationsApi } from '@api/operations.api';
import { ownedTransfersApi } from '@api/owned-transfers.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { type DependentOperation, type TradeVersion, tradesApi } from '@api/trades.api';
import { isAxiosError } from 'axios';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AmountHero } from '@/ui/AmountHero';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import Drawer, { DrawerFooter, DrawerHeader } from '@/ui/Drawer';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { newRequestId, useAttempt } from '../accounting/feedback';
import { dependentOf } from '../portfolio/AddTransactionDialog';
import { entryKind } from '../portfolio/add-transaction';
import { DASH, money, price, quantity } from '../portfolio/format';
import CopyValue from '../shell/CopyValue';
import { Icon } from '../shell/icons';
import ClassifyForm, { POOL_DEPOSIT_NAMED, recordText } from './ClassifyForm';
import {
  amount,
  assetNetwork,
  day,
  exchangeChain,
  exchangeRecord,
  explorerUrl,
  hashOf,
  isCountedGap,
  moment,
  networkName,
  operationMoment,
  placeLabel,
  signedAmount,
  sourceLabel,
  statusLabel,
  statusLabels,
  ticker,
  transactionHash,
  typeLabel,
} from './operation-format';
import RemoveCounted from './RemoveCounted';

const sourceDetails: Record<Operation['source'], string> = {
  manual: 'Added by you',
  csv: 'Imported from CSV',
  chain: 'Blockchain',
};

/**
 * A trade, transfer, reward or airdrop recorded by hand or from CSV: edited and deleted right
 * here (M9). Staking rewards, swaps and blockchain data keep their own screens.
 */
export const editable = (operation: Operation) =>
  operation.account !== null &&
  operation.version !== null &&
  (operation.kind === 'trade' ||
    ((operation.kind === 'transfer' || operation.kind === 'reward') &&
      entryKind(operation) !== null));

/** Where a stake row's coins went: a Solana stake account, an Ethereum staking pool. */
function stakePlace(operation: Operation): string {
  return operation.wallet?.network === 'ethereum'
    ? 'a staking pool of this wallet'
    : 'a stake account of this wallet';
}

/** POOL-WITHDRAW: "+400 USDC" above the deposit, "-0.1 ETH" below it. */
function poolDifference(operation: Operation): { label: string; text: string } | null {
  const pool = operation.pool;
  if (!pool) return null;
  const negative = pool.difference.startsWith('-');
  const magnitude = pool.difference.replace('-', '');
  if (Number(magnitude) === 0) return { label: 'Difference', text: 'None' };
  return negative
    ? { label: 'Impermanent loss', text: amount(magnitude, operation.asset, '-') }
    : { label: 'Pool income', text: amount(magnitude, operation.asset, '+') };
}

/**
 * The ticker of an asset in the drawer's title: a link to the asset's page when the page exists.
 * A journal row names its asset by id; a blockchain leg only by ticker, which the portfolio's
 * assets resolve.
 */
function TickerLink({
  asset,
  pages,
}: {
  asset: Operation['asset'];
  pages: ReadonlyMap<string, string>;
}) {
  const name = asset.symbol ?? asset.name;
  const id =
    asset.instrumentId ?? (asset.symbol ? pages.get(asset.symbol.toUpperCase()) : undefined);
  const network = assetNetwork(asset);
  return (
    <>
      {id ? (
        <Link className="ui-link" to={`/portfolio/${id}`}>
          {name}
        </Link>
      ) : (
        name
      )}
      {network && ` (${network})`}
    </>
  );
}

function title(operation: Operation, pages: ReadonlyMap<string, string>): ReactNode {
  const label = operation.type ? typeLabel(operation) : `${typeLabel(operation)} transaction`;
  return (
    <>
      {label} · <TickerLink asset={operation.asset} pages={pages} />
      {operation.type === 'swap' && operation.counterAsset && (
        <>
          {' → '}
          <TickerLink asset={operation.counterAsset} pages={pages} />
        </>
      )}
    </>
  );
}

/** The pages of the portfolio's assets by ticker; empty until they are read. */
function useAssetPages(currency: AccountingCurrency): ReadonlyMap<string, string> {
  const [pages, setPages] = useState<ReadonlyMap<string, string>>(() =>
    assetPages(cachedReads.portfolio.last(currency)?.assets),
  );
  useEffect(() => {
    let live = true;
    // Without the portfolio the title shows plain tickers.
    cachedReads.portfolio
      .load(currency)
      .then((portfolio) => live && setPages(assetPages(portfolio.assets)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [currency]);
  return pages;
}

function assetPages(
  assets: readonly { instrumentId: string; symbol: string | null }[] | undefined,
): ReadonlyMap<string, string> {
  return new Map(
    (assets ?? []).flatMap((asset) =>
      asset.symbol ? [[asset.symbol.toUpperCase(), asset.instrumentId] as [string, string]] : [],
    ),
  );
}

/** An amount in the list's currency; a recorded one without that date's rate says so. */
function shown(
  value: string | null,
  usd: string | null,
  currency: AccountingCurrency,
  missing: string,
): string {
  if (value !== null) return money(value, currency);
  return usd === null ? missing : 'No Bank of Russia rate for this date';
}

/** TOKEN-FEE: a network fee in its coin and, when known, what it was worth at the time. */
function networkFee(fee: NonNullable<Operation['fee']>, currency: AccountingCurrency): string {
  const coins = amount(fee.quantity, fee.asset);
  return fee.value != null ? `${coins} · ≈ ${money(fee.value, currency)}` : coins;
}

/** A transaction hash: copied in one click, opened on its network's explorer when it has one. */
function TxHash({
  hash,
  network,
  record,
}: {
  hash: string;
  network: string | undefined;
  /** A Bybit record name such as "Trade 2100…": it reads as it is, not as a hash. */
  record?: boolean;
}) {
  const url = explorerUrl(hash, network);
  return (
    <span className="transactions-hash">
      <CopyValue
        value={hash}
        text={record ? hash : undefined}
        label={record ? 'Copy record' : 'Copy transaction hash'}
      />
      {url && (
        <a className="ui-link" href={url} target="_blank" rel="noopener noreferrer">
          View in explorer
        </a>
      )}
    </span>
  );
}

const addressLine = (wallet: NonNullable<Operation['wallet']>) => (
  <span className="ui-mono transactions-line">
    {networkName(wallet)} · {wallet.label ? `${wallet.label} · ` : ''}
    <CopyValue value={wallet.address} label="Copy address" />
  </span>
);

/** SWAP-ONE-TX: the owner's transaction called a contract, by the method the explorer names. */
function callFact(call: { method: string | null }): [string, ReactNode] {
  return ['Contract call', call.method ?? 'Method not named'];
}

/**
 * CLS-SWAP: a blockchain swap reads as both of its transactions, what was paid and from where,
 * then what arrived and where; its value is the cost basis of the coins bought.
 */
function swapFacts(
  operation: Operation,
  currency: AccountingCurrency,
  walletLink: (place: NonNullable<Operation['account']>) => ReactNode,
): [string, ReactNode][] {
  const { wallet, chain } = operation;
  if (!wallet || !chain) return [];
  const other = operation.counterWallet;
  const payer = operation.counterAccount ?? operation.account;
  const rows: [string, ReactNode][] = [['Paid', signedAmount(operation)]];
  if (payer) rows.push(['Paid from', walletLink(payer)]);
  if (other) rows.push(['Paying address', addressLine(other)]);
  if (chain.pairedTxid)
    rows.push([
      'Paying transaction',
      <TxHash
        key="paid"
        hash={hashOf(chain.pairedTxid, other?.network)}
        network={other?.network}
      />,
    ]);
  if (operation.counterAsset && operation.counterQuantity)
    rows.push(['Received', amount(operation.counterQuantity, operation.counterAsset, '+')]);
  rows.push(
    ['Received in', operation.account ? walletLink(operation.account) : 'Not in a wallet yet'],
    ['Address', addressLine(wallet)],
    [
      'Transaction',
      <TxHash key="txid" hash={hashOf(chain.txid, wallet.network)} network={wallet.network} />,
    ],
  );
  if (chain.call) rows.push(callFact(chain.call));
  // A Bybit record has no block (M22).
  if (wallet.network !== 'bybit')
    rows.push(['Block', new Intl.NumberFormat('en-US').format(chain.blockHeight)]);
  rows.push(
    ['Network fee', operation.fee ? networkFee(operation.fee, currency) : 'Paid by sender'],
    ['Value', shown(operation.value, operation.valueUsd, currency, 'Not recorded')],
    ['Cost basis', shown(operation.costBasis, operation.costBasisUsd, currency, 'Unknown')],
  );
  return rows;
}

function facts(
  operation: Operation,
  currency: AccountingCurrency,
  record?: Operation,
): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [['Date', operationMoment(operation)]];
  const { wallet, chain } = operation;
  const walletLink = (place: NonNullable<Operation['account']>) => (
    <Link key={place.id} className="ui-link" to={`/wallets/${place.id}`}>
      {place.name}
    </Link>
  );
  if (wallet && chain && operation.type === 'swap') {
    rows.push(...swapFacts(operation, currency, walletLink));
    if (operation.classification)
      rows.push(['Comment', operation.classification.comment ?? 'None']);
  } else if (wallet && chain) {
    // XFER-AUTO: a transfer names both wallets and, when it is one, the other address.
    const moved =
      operation.type === 'transfer' && operation.account && operation.counterAccount
        ? { from: operation.account, to: operation.counterAccount }
        : null;
    const exchange = wallet.network === 'bybit';
    const onChain = exchangeChain(operation);
    rows.push(['Network', networkName(wallet)]);
    if (onChain) rows.push(['Blockchain', onChain.chainName]);
    if (moved) rows.push(['From', walletLink(moved.from)], ['To', walletLink(moved.to)]);
    else
      rows.push([
        'Wallet',
        operation.account ? walletLink(operation.account) : 'Not in a wallet yet',
      ]);
    rows.push([
      exchange ? 'Account' : 'Address',
      <span key="wallet" className="ui-mono transactions-line">
        {wallet.label ? `${wallet.label} · ` : ''}
        {exchange ? (
          <CopyValue value={wallet.address} text={`UID ${wallet.address}`} label="Copy UID" />
        ) : (
          <CopyValue value={wallet.address} label="Copy address" />
        )}
      </span>,
    ]);
    const other = operation.counterWallet;
    if (other)
      rows.push([
        moved ? 'Other address' : 'Your other address',
        <span key="other" className="ui-mono transactions-line">
          {other.label ? `${other.label} · ` : ''}
          <CopyValue value={other.address} label="Copy address" />
        </span>,
      ]);
    // BYBIT-CHAIN-FACTS: the address a Bybit withdrawal went to, or its deposit came to.
    if (onChain?.address || onChain?.fromAddress)
      rows.push([
        onChain.address ? onChain.addressLabel : 'Sending address',
        <span key="onchain" className="ui-mono transactions-line">
          <CopyValue value={onChain.address ?? onChain.fromAddress ?? ''} label="Copy address" />
        </span>,
      ]);
    // A Bybit record has no block; its id stands in for a hash it does not have (M22).
    const chainHash = onChain?.hash ?? transactionHash(operation);
    rows.push([
      exchange && !chainHash ? 'Bybit record' : 'Transaction',
      <TxHash
        key="txid"
        hash={chainHash ?? exchangeRecord(operation) ?? chain.txid}
        network={onChain?.hash ? (onChain.network ?? undefined) : wallet.network}
        record={exchange && !chainHash}
      />,
    ]);
    if (chain.call) rows.push(callFact(chain.call));
    if (!exchange) rows.push(['Block', new Intl.NumberFormat('en-US').format(chain.blockHeight)]);
    rows.push(
      [
        exchange ? 'Fee' : 'Network fee',
        operation.fee ? networkFee(operation.fee, currency) : exchange ? 'None' : 'Paid by sender',
      ],
      [
        'Estimated value',
        operation.estimatedValue !== null && chain.priceObservedAt
          ? `≈ ${money(operation.estimatedValue, currency)} at the price stored ${moment(chain.priceObservedAt)}`
          : operation.estimatedValueUsd !== null
            ? 'No Bank of Russia rate for that date'
            : 'No stored price for that time',
      ],
    );
    // POOL-WITHDRAW: what the deposit put in, the difference and the deposit's transaction.
    const difference = poolDifference(operation);
    if (operation.pool && difference)
      rows.push(
        ['Deposited', amount(operation.pool.deposited, operation.asset)],
        [difference.label, difference.text],
      );
    if (operation.pool?.partial && operation.pool.remaining !== undefined)
      rows.push(['Left in the pool', amount(operation.pool.remaining, operation.asset)]);
    if (operation.type === 'pool-withdrawal' && chain.pairedTxid)
      rows.push([
        'Deposit transaction',
        <CopyValue
          key="deposit"
          value={hashOf(chain.pairedTxid, wallet.network)}
          label="Copy transaction hash"
        />,
      ]);
    // CLS-BUY: what the owner answered, as the entry it produced reads; a transfer has no
    // value of its own, only the network fee (XFER-CAPITAL).
    // SOL-STAKE-MOVE: SOL kept in the wallet's own stake account has no value of its own either,
    // nor have coins in a liquidity pool; a withdrawal's value is that of its pool income.
    const staking = operation.type === 'stake' || operation.type === 'unstake';
    const pooled =
      operation.type === 'pool-deposit' ||
      (operation.type === 'pool-withdrawal' && operation.valueUsd === null);
    // CLS-RECORDED: the record added by hand carries the value; the transaction has none.
    const linked = operation.classification?.value?.type === 'recorded';
    if (linked && operation.status === 'recorded')
      rows.push([
        'Recorded as',
        record
          ? recordText(record, record.account?.id !== operation.account?.id)
          : 'A record added by hand or from CSV',
      ]);
    if (operation.status === 'recorded' && !moved && !staking && !pooled && !linked) {
      rows.push(['Value', shown(operation.value, operation.valueUsd, currency, 'Not recorded')]);
      if (
        exchange &&
        (operation.type === 'buy' || operation.type === 'sell') &&
        operation.value !== null
      )
        rows.push([
          'Price',
          `${price(String(Number(operation.value) / Number(operation.quantity)), currency)} per ${ticker(operation.asset)}`,
        ]);
      if (operation.paid)
        rows.push([
          'Paid',
          `${quantity(operation.paid.gross)} ${operation.paid.currency} at ${operation.paid.perUsd} ${operation.paid.currency} per USD`,
        ]);
      const cash = operation.settlement;
      if (cash && Number(cash.quantity) > 0)
        rows.push(
          operation.type === 'sell'
            ? ['Kept as cash', amount(cash.quantity, cash.asset, '+')]
            : ['Paid from cash', amount(cash.quantity, cash.asset)],
        );
      if (operation.costBasisUsd !== null)
        rows.push([
          'Cost basis',
          shown(operation.costBasis, operation.costBasisUsd, currency, DASH),
        ]);
    }
    if (operation.classification)
      rows.push(['Comment', operation.classification.comment ?? 'None']);
  } else {
    if (operation.counterAccount && operation.account)
      rows.push(['From', operation.account.name], ['To', operation.counterAccount.name]);
    else rows.push(['Account', operation.account?.name ?? 'Whole portfolio']);
    if (operation.counterAsset && operation.counterQuantity)
      rows.push(['Received', amount(operation.counterQuantity, operation.counterAsset, '+')]);
    rows.push(['Value', shown(operation.value, operation.valueUsd, currency, 'Not recorded')]);
    if ((operation.type === 'buy' || operation.type === 'sell') && operation.value !== null)
      rows.push([
        'Price',
        `${price(String(Number(operation.value) / Number(operation.quantity)), currency)} per ${ticker(operation.asset)}`,
      ]);
    if (operation.paid)
      rows.push([
        'Paid',
        `${quantity(operation.paid.gross)} ${operation.paid.currency} at ${operation.paid.perUsd} ${operation.paid.currency} per USD`,
      ]);
    // M9: where the money stayed or came from in the trade's own account.
    const cash = operation.settlement;
    if (cash && Number(cash.quantity) > 0)
      rows.push(
        operation.type === 'sell'
          ? ['Kept as cash', amount(cash.quantity, cash.asset, '+')]
          : ['Paid from cash', amount(cash.quantity, cash.asset)],
      );
    if (operation.costBasisUsd !== null)
      rows.push(['Cost basis', shown(operation.costBasis, operation.costBasisUsd, currency, DASH)]);
    rows.push([
      'Fee',
      operation.feeUsd !== null && Number(operation.feeUsd) !== 0
        ? shown(operation.feeValue, operation.feeUsd, currency, DASH)
        : operation.fee
          ? amount(operation.fee.quantity, operation.fee.asset)
          : 'None',
    ]);
    if (operation.kind === 'trade') rows.push(['Comment', operation.comment ?? 'None']);
  }
  rows.push(
    ['Status', statusLabel(operation)],
    ['Source', sourceLabel(operation) === 'Bybit' ? 'Bybit' : sourceDetails[operation.source]],
  );
  return rows;
}

const essential = new Set(['Date', 'Network', 'Wallet', 'From', 'To']);

const versionLabels: Record<TradeVersion['kind'], string> = {
  create: 'Added',
  correct: 'Changed',
  void: 'Deleted',
};

/** "Sell of 0.8 BTC on May 1, 2026 in Trust Wallet", the operation a deletion would break. */
export function describe(operation: Operation): string {
  return `${typeLabel(operation)} of ${amount(operation.quantity, operation.asset)} on ${day(operation.occurredAt)} in ${placeLabel(operation)}`;
}

type Confirm =
  | { step: 'ask'; error: string | null }
  | { step: 'deleting' }
  | { step: 'blocked'; dependent: string; account: string; coin: string };

/**
 * The ticker of an instrument the list names: this operation's coin, its cash or fee, or a coin of
 * another operation; "coins" when none names it.
 */
function coinOf(instrumentId: string, operation: Operation, operations: Operation[]): string {
  for (const item of [operation, ...operations])
    for (const asset of [item.asset, item.counterAsset, item.settlement?.asset, item.fee?.asset])
      if (asset?.instrumentId === instrumentId) return ticker(asset);
  return 'coins';
}

interface Props {
  operation: Operation;
  /** The list's quote currency, which the operation's amounts are in. */
  currency?: AccountingCurrency;
  /** The whole list, to name the operation that depends on this one. */
  operations?: Operation[];
  /** CLS-DUST: the list's dust threshold, kept out of a swap's choices. Null: off. */
  dustThresholdUsd?: string | null;
  onClose: () => void;
  onEdit?: (operation: Operation) => void;
  onDeleted?: () => void;
  /** Blockchain transactions still to classify, this one included. */
  left?: number;
  /** A blockchain transaction got its answer: "Buy", "hidden" or "included". */
  onClassified?: (label: string) => void;
  /** What the last answer did, shown at the top. */
  notice?: string | null;
}

// Side drawer of the accepted prototype: details, history, and Edit and Delete for trades.
export default function OperationDrawer({
  operation,
  currency = 'USD',
  operations = [],
  dustThresholdUsd = null,
  onClose,
  onEdit,
  onDeleted,
  left = 0,
  onClassified,
  notice = null,
}: Props) {
  const pages = useAssetPages(currency);
  const modal = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [history, setHistory] = useState<TradeVersion[] | null>(null);
  const chain =
    operation.kind === 'chain' && operation.wallet && operation.chain ? operation : null;
  const needs = operation.status === 'needs-classification';
  // CLS-RECORDED: the trade or swap added by hand this transaction already is.
  const saved = operation.classification?.value;
  const record =
    saved?.type === 'recorded'
      ? operations.find((item) => item.id === `${saved.operation.kind}:${saved.operation.id}`)
      : undefined;
  const [classifying, setClassifying] = useState(needs);
  const [toggling, setToggling] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  // Cancel or OK closes the confirmation and gives the keyboard back to Delete; a deletion in
  // flight cannot be dismissed.
  const dismiss = () => {
    if (confirm?.step === 'deleting') return;
    setConfirm(null);
    deleteButton.current?.focus();
  };
  const step = confirm?.step;
  useEffect(() => {
    if (step)
      modal.current?.querySelector<HTMLElement>('.ui-modal__foot button:not([disabled])')?.focus();
  }, [step]);

  const changeable = editable(operation) && operation.account ? operation.account : null;
  const trade = operation.kind === 'trade' ? changeable : null;
  const tradeId = operation.id.replace(/^trade:/, '');
  const tradeAccountId = trade?.id;
  useEffect(() => {
    if (!tradeAccountId) return;
    let live = true;
    tradesApi
      .versions(tradeAccountId, tradeId)
      .then((page) => live && setHistory(page.items))
      .catch(() => live && setHistory(null));
    return () => {
      live = false;
    };
  }, [tradeAccountId, tradeId]);

  /** OPS-DELETE-GUARD: the refusal that names the operation a deletion would leave short. */
  const blocked = (dependent: DependentOperation): Confirm => {
    const found = operations.find((item) => item.id === dependent.operationId);
    return {
      step: 'blocked',
      dependent: found ? describe(found) : `A later transaction on ${day(dependent.occurredAt)}`,
      // A transfer's coins may be spent in the account they went to.
      account:
        operation.counterAccount?.id === dependent.accountId
          ? operation.counterAccount.name
          : (operation.account?.name ?? 'the account'),
      coin: coinOf(dependent.instrumentId, operation, operations),
    };
  };
  // A trade that cannot be deleted says so at once, before the owner confirms; the void still
  // refuses if that changes in between. Without an answer the confirmation asks as before.
  const checking = useRef(false);
  const askToDelete = async () => {
    if (checking.current) return;
    if (trade) {
      checking.current = true;
      const check = await tradesApi.voidCheck(trade.id, tradeId).catch(() => null);
      checking.current = false;
      if (check?.dependent) {
        setConfirm(blocked(check.dependent));
        return;
      }
    }
    setConfirm({ step: 'ask', error: null });
  };

  // Deleting voids the operation: its history keeps every version, the void included
  // (OPS-DELETE). A retry after a lost answer or a server error sends the same command again,
  // with its request id and the revisions read the first time, so the server records it once.
  const deletion = useRef<{ key: string; requestId: string; from: number; to: number } | null>(
    null,
  );
  const remove = async () => {
    if (!changeable) return;
    setConfirm({ step: 'deleting' });
    const revision = async (accountId: string) =>
      (await tradesApi.state(accountId)).journal?.journalRevision ?? 0;
    const [kind, id] = [operation.kind, operation.id.slice(operation.id.indexOf(':') + 1)];
    const expectedVersion = operation.version ?? 0;
    const key = `${operation.id}:${expectedVersion}`;
    try {
      if (deletion.current?.key !== key) {
        const [from, to] = await Promise.all([
          revision(changeable.id),
          kind === 'transfer' ? revision(operation.counterAccount?.id ?? changeable.id) : 0,
        ]);
        deletion.current = { key, requestId: newRequestId(), from, to };
      }
      const { requestId, from, to } = deletion.current;
      if (kind === 'transfer')
        await ownedTransfersApi.void(id, {
          requestId,
          expectedVersion,
          expectedFromJournalRevision: from,
          expectedToJournalRevision: to,
        });
      else if (kind === 'reward')
        await assetRewardsApi.void(changeable.id, id, {
          requestId,
          expectedJournalRevision: from,
          expectedVersion,
        });
      else
        await tradesApi.void(changeable.id, tradeId, { requestId, expectedJournalRevision: from });
      onDeleted?.();
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      // A definite refusal deleted nothing: the next try is a new command at the current revisions.
      if (status !== undefined && status < 500) deletion.current = null;
      const dependent = dependentOf(error);
      if (dependent) {
        setConfirm(blocked(dependent));
        return;
      }
      setConfirm({
        step: 'ask',
        error:
          status === undefined
            ? 'Could not reach the server. The transaction may have been deleted; reload the page to check.'
            : status === 409
              ? 'This transaction was changed elsewhere. Close this window, reload and try again.'
              : 'Could not delete the transaction. Try again.',
      });
    }
  };

  // BYBIT-GAP-DELETE: a counted difference is the owner's own record, so it can be deleted.
  const counted = Boolean(chain?.chain && isCountedGap(chain.chain.txid));

  // CLS-HIDE: hiding keeps the answer, so including the row again restores it.
  const hideAttempt = useAttempt();
  const toggleHidden = async () => {
    if (!chain?.wallet || !chain.chain) return;
    setToggling({ busy: true, error: null });
    const saved = chain.classification;
    const change = {
      expectedVersion: saved?.version ?? 0,
      hidden: chain.status !== 'hidden',
      classification: saved?.value ?? null,
      ...(saved?.comment ? { comment: saved.comment } : {}),
    };
    try {
      await operationsApi.classify(chain.wallet, chain.chain.txid, {
        requestId: hideAttempt([chain.wallet.id, chain.chain.txid, change]),
        ...change,
      });
      hideAttempt.done([chain.wallet.id, chain.chain.txid, change]);
      announceClassificationChange();
      onClassified?.(chain.status === 'hidden' ? 'included' : 'hidden');
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setToggling({
        busy: false,
        error:
          dependentOf(error) !== null
            ? 'A later transaction spends these coins, so this one cannot be hidden. Change that transaction first.'
            : status === 422 &&
                isAxiosError(error) &&
                (error.response?.data as { message?: unknown } | undefined)?.message ===
                  POOL_DEPOSIT_NAMED
              ? 'A pool withdrawal returns this deposit, so it cannot be hidden. Change that withdrawal first.'
              : status === undefined
                ? 'Could not reach the server. It may have been saved; reload the page to check.'
                : status === 409
                  ? 'This transaction was changed elsewhere. Close this window, reload and try again.'
                  : 'Could not save. Try again.',
      });
    }
  };

  const hidden = operation.status === 'hidden';
  const dust = operation.status === 'dust';
  const value =
    operation.value !== null
      ? money(operation.value, currency)
      : operation.estimatedValue !== null
        ? `≈ ${money(operation.estimatedValue, currency)} at the price at the time`
        : null;
  const purchase = operation.type === 'buy';
  // SOL-STAKE-MOVE, ETH-STAKE-MOVE: a move into the wallet's own stake account or staking pool
  // or back has nothing to classify.
  const stakeMove = operation.type === 'stake' || operation.type === 'unstake';
  // CLS-COMPACT: while a blockchain transaction waits for its answer, only what identifies it
  // stays above the question; the technical facts fold into "Details".
  const compact = Boolean(chain && classifying);
  const rows = facts(operation, currency, record);
  const summary = (
    <>
      {/* CLS-NEXT: what the last answer did, above the next one to classify. */}
      {notice && <Banner tone="pos">{notice}</Banner>}
      <AmountHero
        badge={
          <Badge tone={needs ? 'warn' : hidden || dust ? 'muted' : 'neutral'} dot={needs}>
            {needs || hidden || dust
              ? statusLabels[operation.status]
              : `${sourceLabel(operation)} · ${typeLabel(operation)}`}
          </Badge>
        }
        amount={
          operation.counterAsset && operation.counterQuantity ? (
            <>
              <span className="transactions-hero__line">{signedAmount(operation)}</span>
              <span className="transactions-hero__line">
                {amount(operation.counterQuantity, operation.counterAsset, '+')}
              </span>
            </>
          ) : (
            signedAmount(operation)
          )
        }
        detail={value ?? `Value ${DASH}`}
      />
      {stakeMove && (
        <Banner tone="pos" role="note">
          {operation.type === 'stake'
            ? `Moved into ${stakePlace(operation)}: the coins stay yours and keep their purchase price.`
            : `Returned from ${stakePlace(operation)}: not income and not a deposit, rewards count as they are earned.`}{' '}
          Only the network fee is a cost.
        </Banner>
      )}
      {operation.status === 'recorded' && operation.type === 'pool-deposit' && (
        <Banner tone="pos" role="note">
          Moved into a liquidity pool: the coins stay yours and keep their purchase price until a
          pool withdrawal returns them. Only the network fee is a cost.
        </Banner>
      )}
      {operation.status === 'recorded' && operation.type === 'pool-withdrawal' && (
        <Banner tone="pos" role="note">
          Returned from a liquidity pool:{' '}
          {operation.pool?.partial ? 'a part of the deposit' : 'the deposit'} comes back as your own
          coins, not income and not a deposit.
          {operation.pool?.partial &&
            (Number(operation.pool.remaining ?? 0) > 0
              ? ` The ${amount(operation.pool.remaining!, operation.asset)} left in the pool stay yours, with their purchase price.`
              : ' Nothing is left in the pool.')}
          {operation.pool &&
            (operation.pool.difference.startsWith('-')
              ? ` The ${amount(operation.pool.difference.slice(1), operation.asset)} below it left without a sale price (impermanent loss).`
              : Number(operation.pool.difference) > 0
                ? ` The ${amount(operation.pool.difference, operation.asset)} above it is pool income.`
                : '')}
        </Banner>
      )}
      {record && operation.status === 'recorded' && operation.type !== 'transfer' && (
        <Banner tone="pos" role="note">
          Already recorded by hand or from CSV: this transaction doesn't count on its own, so its
          coins are not counted twice. Change the classification if it is wrong.
        </Banner>
      )}
      {record && operation.status === 'recorded' && operation.type === 'transfer' && (
        <Banner tone="pos" role="note">
          These coins moved to {record.account?.name ?? 'that account'} and paid for the purchase
          you added there, so the purchase is not new money. Change the classification if it is
          wrong.
        </Banner>
      )}
      {dust && (
        <Banner tone="pos" role="note">
          Worth less than your dust threshold, or a token no price source lists, so it doesn't ask
          to be classified. It still counts in your balance. Classify it if it matters, or hide it.
        </Banner>
      )}
      {operation.classification?.automatic &&
        operation.status === 'recorded' &&
        (operation.type === 'buy' || operation.type === 'sell') && (
          <Banner tone="pos" role="note">
            Recognised automatically from Bybit's{' '}
            {operation.chain?.txid.startsWith('bybit-trade-convert-')
              ? 'convert history'
              : 'trade history'}
            :{' '}
            {operation.type === 'buy'
              ? 'paid from the USDT or USDC this account already held'
              : 'the coins sold were already in this account'}
            , so it counts as a {operation.type === 'buy' ? 'purchase' : 'sale'}, not a deposit.
            Change the classification if it is wrong.
          </Banner>
        )}
      {operation.classification?.automatic &&
        operation.status === 'recorded' &&
        operation.type === 'staking-reward' &&
        operation.wallet?.network === 'bybit' && (
          <Banner tone="pos" role="note">
            Recognised automatically from Bybit's Earn yield history: counts as staking income at
            the coin's price when Bybit paid it. Change the classification if it is wrong.
          </Banner>
        )}
      {operation.classification?.automatic &&
        operation.status === 'recorded' &&
        operation.counterAccount && (
          <Banner tone="pos" role="note">
            Recognised automatically: both addresses belong to your wallets and{' '}
            {operation.counterAccount.name} received the same amount minus the network fee. Counts
            as a transfer, not a sale or a deposit.
          </Banner>
        )}
      <section aria-label="Details">
        <KeyValue>
          {(compact ? rows.filter(([label]) => essential.has(label)) : rows).map(
            ([label, content]) => (
              <KeyValueRow key={label} term={label}>
                {content}
              </KeyValueRow>
            ),
          )}
        </KeyValue>
        {compact && rows.some(([label]) => !essential.has(label)) && (
          <details className="ui-more transactions-facts-more">
            <summary>
              <Icon name="chevron" className="shell-icon" />
              Details
            </summary>
            <div>
              <KeyValue>
                {rows
                  .filter(([label]) => !essential.has(label))
                  .map(([label, content]) => (
                    <KeyValueRow key={label} term={label}>
                      {content}
                    </KeyValueRow>
                  ))}
              </KeyValue>
            </div>
          </details>
        )}
      </section>
    </>
  );
  return (
    <>
      <Drawer
        titleId="operation-title"
        onClose={onClose}
        initialFocus={() => closeButton.current}
        covered={confirm !== null}
      >
        <DrawerHeader
          titleId="operation-title"
          title={title(operation, pages)}
          onClose={onClose}
          closeRef={closeButton}
        />
        {chain && classifying ? (
          <ClassifyForm
            operation={chain}
            operations={operations}
            dustThresholdUsd={dustThresholdUsd}
            left={left}
            onSaved={(label) => onClassified?.(label)}
            onDeleted={() => {
              announceClassificationChange();
              onClassified?.('deleted');
            }}
            onCancel={needs ? onClose : () => setClassifying(false)}
          >
            {summary}
          </ClassifyForm>
        ) : (
          <>
            <div className="ui-drawer__body">
              {summary}
              {trade && history && history.length > 1 && (
                <section aria-labelledby="operation-history">
                  <h3 id="operation-history" className="ui-section-t">
                    History
                  </h3>
                  <ol className="transactions-history">
                    {history.map((version) => (
                      <li key={version.version}>
                        <span>
                          {versionLabels[version.kind]} {moment(version.createdAt)}
                        </span>
                        <span className="ui-soft">
                          {version.side === 'buy' ? 'Buy' : 'Sell'} {quantity(version.quantity)}{' '}
                          {version.instrumentSymbol ?? version.instrumentName} for{' '}
                          {version.paid
                            ? `${quantity(version.paid.gross)} ${version.paid.currency}`
                            : money(version.grossUsd, 'USD')}
                          {version.comment ? ` · ${version.comment}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {chain && !stakeMove && (
                // Guidance on what the buttons below can do; not a note of its own (role none), so
                // the drawer's one note stays the verdict on this transaction.
                <Banner tone="info" role="none">
                  {counted
                    ? 'You counted this difference yourself, so you can delete it. Until then you can also change the classification, add a comment or hide it from calculations.'
                    : `${sourceLabel(operation) === 'Bybit' ? 'Bybit records' : 'Blockchain transactions'} can't be deleted. You can change the classification, add a comment or hide it from calculations. Your changes survive the next sync.`}
                </Banner>
              )}
              {toggling.error && <Banner tone="neg">{toggling.error}</Banner>}
            </div>
            {chain ? (
              <DrawerFooter>
                {!stakeMove && (
                  <Button
                    variant="secondary"
                    disabled={toggling.busy}
                    onClick={() => setClassifying(true)}
                  >
                    {operation.classification?.value ? 'Change classification' : 'Classify'}
                  </Button>
                )}
                <span className="ui-grow" />
                <RemoveCounted
                  operation={chain}
                  disabled={toggling.busy}
                  onDeleted={() => {
                    announceClassificationChange();
                    onClassified?.('deleted');
                  }}
                />
                <Button
                  variant="ghost"
                  disabled={toggling.busy}
                  onClick={() => void toggleHidden()}
                >
                  {hidden ? 'Include in calculations' : 'Hide from calculations'}
                </Button>
              </DrawerFooter>
            ) : changeable ? (
              <DrawerFooter>
                <Button
                  ref={deleteButton}
                  variant="ghost"
                  destructive
                  icon="trash"
                  onClick={() => void askToDelete()}
                >
                  Delete
                </Button>
                <span className="ui-grow" />
                <Button variant="secondary" icon="edit" onClick={() => onEdit?.(operation)}>
                  Edit
                </Button>
              </DrawerFooter>
            ) : null}
          </>
        )}
      </Drawer>
      {confirm && (
        <Modal
          titleId="operation-confirm-title"
          size="narrow"
          // Both steps interrupt with an answer to give, as every confirmation (ConfirmDialog):
          // Cancel (or OK when it cannot be deleted) takes the keyboard first.
          role="alertdialog"
          describedBy="operation-confirm-text"
          onEscape={dismiss}
          overDrawer
          boxRef={modal}
        >
          <ModalHeader
            titleId="operation-confirm-title"
            onClose={dismiss}
            closeDisabled={confirm.step === 'deleting'}
            title={
              confirm.step === 'blocked'
                ? `This ${purchase ? 'purchase' : 'transaction'} can't be deleted`
                : 'Delete this transaction?'
            }
          />
          <ModalBody>
            <p id="operation-confirm-text" className="ui-confirm__text">
              {confirm.step === 'blocked'
                ? `${confirm.dependent} spends these ${confirm.coin}. Without this ${purchase ? 'purchase' : 'transaction'} ${confirm.account} would not hold enough. Delete or change that transaction first.`
                : `${describe(operation)} will be removed. Balances, cost basis and the portfolio history will be recalculated without it.`}
            </p>
            {confirm.step === 'ask' && confirm.error && <Banner tone="neg">{confirm.error}</Banner>}
          </ModalBody>
          <ModalFooter>
            {confirm.step === 'blocked' ? (
              <Button variant="primary" onClick={dismiss}>
                OK
              </Button>
            ) : (
              <>
                <Button variant="ghost" disabled={confirm.step === 'deleting'} onClick={dismiss}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={confirm.step === 'deleting'}
                  onClick={() => void remove()}
                >
                  {confirm.step === 'deleting' ? 'Deleting…' : 'Delete transaction'}
                </Button>
              </>
            )}
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
