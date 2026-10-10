import {
  announceClassificationChange,
  type ChainClassification,
  type Operation,
  operationsApi,
} from '@api/operations.api';
import { isAxiosError } from 'axios';
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { newRequestId } from '../accounting/feedback';
import { type Account, dependentOf, journalAccounts } from '../portfolio/AddTransactionDialog';
import { decimal, MAX_COMMENT_LENGTH, positive } from '../portfolio/add-transaction';
import {
  amount,
  assetKey,
  day,
  networkName,
  rowTime,
  shortAddress,
  signedAmount,
  typeLabels,
} from './operation-format';

type ChainType = ChainClassification['type'];
type Currency = Extract<ChainClassification, { currency: string }>['currency'];
const currencies: Currency[] = ['USD', 'USDT', 'USDC', 'EUR', 'RUB'];

// "What was this transaction?" from the accepted prototype, limited to what the coins did:
// what arrives can be bought or received, what leaves can be sold, spent or given, and either
// can move between the owner's own wallets (M13). Other is a movement nobody can name yet.
// A swap pairs a receipt with a payment in another coin, from any of the wallets (CLS-SWAP),
// or names the purchase the owner already added by hand or from CSV (CLS-RECORDED).
// Coins put into a liquidity pool stay the owner's; a withdrawal names the deposit it returns,
// and the pool's rewards are income (POOL-*).
const TRANSFER: [ChainType, string] = ['transfer', 'Transfer between my wallets'];
const SWAP: [ChainType, string] = ['swap', 'Swap'];
const incoming: [ChainType, string][] = [
  TRANSFER,
  ['buy', 'Buy'],
  SWAP,
  ['income', 'Income'],
  ['reward', 'Reward'],
  ['staking-reward', 'Staking reward'],
  ['airdrop', 'Airdrop'],
  ['gift', 'Gift received'],
  ['pool-reward', 'Pool reward'],
  ['pool-withdrawal', 'Pool withdrawal'],
  ['other', 'Other'],
];
const outgoing: [ChainType, string][] = [
  TRANSFER,
  ['sell', 'Sell'],
  SWAP,
  ['expense', 'Expense'],
  ['gift', 'Gift sent'],
  ['fee', 'Fee'],
  ['pool-deposit', 'Pool deposit'],
  ['other', 'Other'],
];
/** The leg's own direction: a recorded transfer reads as internal in the list. */
const legDirection = (operation: Operation) => operation.chain?.direction ?? operation.direction;
export function choices(operation: Operation): [ChainType, string][] {
  const leg = legDirection(operation);
  if (leg === 'in') return incoming;
  if (leg === 'out') return outgoing;
  // Between the wallet's own addresses only the network fee leaves.
  return outgoing.filter(([type]) => type === 'fee');
}
export const typeName = (operation: Operation, type: ChainType) =>
  choices(operation).find(([value]) => value === type)?.[1] ?? type;

interface Draft {
  type: ChainType | null;
  amount: string;
  currency: Currency;
  rate: string;
  value: string;
  /** Transfer only: the owner's other wallet. */
  account: string;
  /**
   * Swap only: the transaction on the other side, as "address id|txid", or the trade or swap
   * already added by hand or from CSV, as its list id "trade:id" or "swap:id".
   */
  pair: string;
  /** Pool withdrawal only: the deposit it returns, as "address id|txid". */
  deposit: string;
  /** Pool withdrawal only: just a part of the deposit came back; the rest is still in the pool. */
  partial: boolean;
  comment: string;
  hidden: boolean;
}

/** The wallet of this address: a transfer received lists it second. */
function ownAccount(operation: Operation) {
  return operation.type === 'transfer' && legDirection(operation) === 'in'
    ? operation.counterAccount
    : operation.account;
}

function draftOf(operation: Operation): Draft {
  const saved = operation.classification;
  const value = saved?.value ?? null;
  const priced = value && (value.type === 'buy' || value.type === 'sell') ? value : null;
  const valued = value && !priced && 'valueUsd' in value ? value : null;
  const moved = value?.type === 'transfer' ? value : null;
  const swapped = value?.type === 'swap' ? value : null;
  const recorded = value?.type === 'recorded' ? value.operation : null;
  const returned = value?.type === 'pool-withdrawal' ? value : null;
  // XFER-AUTO: the owner's other address in the same transaction suggests a transfer.
  const suggested = !value && operation.counterWallet && operation.counterAccount;
  // SWAP-ONE-TX-SUGGEST: another coin back in the same transaction suggests a swap.
  const together = !value && !suggested ? operation.chain?.swapWith : undefined;
  return {
    type: recorded ? 'swap' : (value?.type ?? (suggested ? 'transfer' : together ? 'swap' : null)),
    amount: priced?.amount ?? '',
    currency: priced?.currency ?? 'USDT',
    rate: priced?.perUsd ?? '',
    value: valued?.valueUsd ?? '',
    account: moved?.accountId ?? operation.counterAccount?.id ?? '',
    pair: swapped
      ? `${swapped.with.addressId}|${swapped.with.txid}`
      : recorded
        ? `${recorded.kind}:${recorded.id}`
        : together
          ? `${together.addressId}|${together.txid}`
          : '',
    deposit: returned ? `${returned.deposit.addressId}|${returned.deposit.txid}` : '',
    partial: returned?.partial === true,
    comment: saved?.comment ?? '',
    // Changing an answer starts from "included"; hiding is its own button outside this form.
    hidden: false,
  };
}

const WEEK_MS = 7 * 86_400_000;
const unpaired = new Set([
  'transfer',
  'swap',
  'stake',
  'unstake',
  'pool-deposit',
  'pool-withdrawal',
]);
/** The coin this leg moved: a swap row lists what was paid first. */
const legAsset = (operation: Operation) =>
  operation.type === 'swap' && operation.counterAsset ? operation.counterAsset : operation.asset;
const pairKey = (operation: Operation) =>
  operation.wallet && operation.chain ? `${operation.wallet.id}|${operation.chain.txid}` : '';
const addressText = (wallet: NonNullable<Operation['wallet']>) =>
  `${networkName(wallet)} ${wallet.label ?? shortAddress(wallet.address)}`;
/** CLS-RECORDED: a picked trade or swap added by hand or from CSV, by its list id. */
const recordKey = /^(trade|swap):(.+)$/;
/** CLS-DUST: a leg too small to be the other side of anything worth recording. */
const dust = (item: Operation, thresholdUsd: string | null) =>
  item.status === 'dust' ||
  Number(item.quantity) === 0 ||
  (thresholdUsd !== null &&
    item.estimatedValueUsd !== null &&
    Number(item.estimatedValueUsd) < Number(thresholdUsd));

/**
 * CLS-SWAP: the owner's blockchain transactions that can be the other side of this one, from
 * any wallet: moving the other way, another coin, within a week, nearest first. Hidden ones and
 * dust, worth less than the dust threshold either way, are left out (CLS-DUST). A saved pair
 * stays a choice though the list shows it inside the swap.
 */
export function swapCandidates(
  operation: Operation,
  operations: Operation[],
  dustThresholdUsd: string | null = null,
): [string, string][] {
  const leg = legDirection(operation);
  const coin = assetKey(legAsset(operation));
  const at = Date.parse(operation.occurredAt);
  const suggested = operation.chain?.swapWith;
  const together = suggested ? `${suggested.addressId}|${suggested.txid}` : '';
  const found = operations
    .filter(
      (item) =>
        item.kind === 'chain' &&
        item.id !== operation.id &&
        pairKey(item) !== '' &&
        legDirection(item) === (leg === 'in' ? 'out' : 'in') &&
        !(item.type && unpaired.has(item.type)) &&
        item.status !== 'hidden' &&
        !dust(item, dustThresholdUsd) &&
        assetKey(item.asset) !== coin &&
        Math.abs(Date.parse(item.occurredAt) - at) <= WEEK_MS,
    )
    .sort(
      (a, b) =>
        Number(pairKey(b) === together) - Number(pairKey(a) === together) ||
        Math.abs(Date.parse(a.occurredAt) - at) - Math.abs(Date.parse(b.occurredAt) - at),
    )
    .map((item): [string, string] => [
      pairKey(item),
      [
        // SWAP-ONE-TX: the other leg of this very transaction says so instead of its time.
        pairKey(item) === together
          ? 'Same transaction'
          : `${day(item.occurredAt)}, ${rowTime(item)}`,
        signedAmount(item),
        item.account?.name ?? 'Not in a wallet yet',
        addressText(item.wallet!),
      ].join(' · '),
    ]);
  const saved = operation.classification?.value;
  const pair = saved?.type === 'swap' ? `${saved.with.addressId}|${saved.with.txid}` : '';
  if (pair && !found.some(([key]) => key === pair)) {
    const other = operation.counterWallet;
    const place = operation.counterAccount ?? operation.account;
    found.unshift([
      pair,
      [
        operation.type === 'swap' ? signedAmount(operation) : 'The saved transaction',
        ...(place ? [place.name] : []),
        ...(other ? [addressText(other)] : []),
      ].join(' · '),
    ]);
  }
  return found;
}

/** CLS-RECORDED: the coins a manual or CSV record received and spent, by asset key. */
function recordCoins(item: Operation): { received: string[]; sent: string[] } {
  const cash = item.settlement ? [assetKey(item.settlement.asset)] : [];
  if (item.kind === 'swap')
    return {
      received: item.counterAsset ? [assetKey(item.counterAsset)] : [],
      sent: [assetKey(item.asset)],
    };
  return item.direction === 'in'
    ? { received: [assetKey(item.asset)], sent: cash }
    : { received: cash, sent: [assetKey(item.asset)] };
}

/**
 * CLS-RECORDED: a trade or swap added by hand or from CSV, as a choice and in the details; with
 * `elsewhere`, the account it was made in (CLS-PAID).
 */
export function recordText(item: Operation, elsewhere = false): string {
  return [
    `${day(item.occurredAt)}, ${rowTime(item)}`,
    item.kind === 'swap' && item.counterAsset && item.counterQuantity
      ? `Swap ${amount(item.quantity, item.asset)} for ${amount(item.counterQuantity, item.counterAsset)}`
      : `${item.type ? typeLabels[item.type] : 'Trade'} ${amount(item.quantity, item.asset)}${
          item.settlement && Number(item.settlement.quantity) > 0
            ? ` for ${amount(item.settlement.quantity, item.settlement.asset)}`
            : ''
        }`,
    item.source === 'csv' ? 'From CSV' : 'Added by you',
    ...(elsewhere && item.account ? [item.account.name] : []),
  ].join(' · ');
}

/** CLS-PAID: coins a wallet can send to pay for a purchase, which cash settles in. */
const payingCoins = new Set(['USDT', 'USDC']);

/**
 * CLS-PAID: a purchase added by hand in another account that these USDT or USDC may have paid
 * for: a plain buy, not paid in RUB or EUR, whose cash is not already all spent.
 */
function payable(item: Operation, operation: Operation, coin: string): boolean {
  if (item.kind !== 'trade' || item.type !== 'buy' || item.paid) return false;
  if (!item.account || item.account.id === operation.account?.id) return false;
  const cash = item.settlement;
  if (!cash || Number(cash.quantity) === 0) return true;
  return (
    assetKey(cash.asset) === coin &&
    Number(cash.quantity) < Number(item.valueUsd ?? 0) + Number(item.feeUsd ?? 0)
  );
}

/**
 * CLS-RECORDED: the trades and swaps added by hand or from CSV in this wallet's account that
 * moved this coin the same way within a week, nearest first: this transaction can be one of
 * them, already recorded. USDT or USDC sent out may also have paid for a purchase made by hand
 * in another account (CLS-PAID). The saved one stays a choice.
 */
export function recordCandidates(
  operation: Operation,
  operations: Operation[],
): [string, string][] {
  const inbound = legDirection(operation) === 'in';
  const coin = assetKey(legAsset(operation));
  const at = Date.parse(operation.occurredAt);
  const found = operations
    .filter(
      (item) =>
        (item.kind === 'trade' || item.kind === 'swap') &&
        item.source !== 'chain' &&
        item.status === 'recorded' &&
        operation.account !== null &&
        Math.abs(Date.parse(item.occurredAt) - at) <= WEEK_MS &&
        ((item.account?.id === operation.account.id &&
          recordCoins(item)[inbound ? 'received' : 'sent'].includes(coin)) ||
          (!inbound && payingCoins.has(coin) && payable(item, operation, coin))),
    )
    .sort(
      (a, b) => Math.abs(Date.parse(a.occurredAt) - at) - Math.abs(Date.parse(b.occurredAt) - at),
    )
    .map((item): [string, string] => [
      item.id,
      recordText(item, item.account?.id !== operation.account?.id),
    ]);
  const saved = operation.classification?.value;
  const key = saved?.type === 'recorded' ? `${saved.operation.kind}:${saved.operation.id}` : '';
  if (key && !found.some(([id]) => id === key)) found.unshift([key, 'The saved record']);
  return found;
}

/**
 * POOL-WITHDRAW, POOL-PARTIAL: the owner's pool deposits this receipt can return: the same coin,
 * from an address of the same wallet, made no later, that no other withdrawal closed and that
 * still has coins in the pool; newest first, with what is left when parts came back already.
 */
export function poolCandidates(operation: Operation, operations: Operation[]): [string, string][] {
  const coin = assetKey(operation.asset);
  const named = (item: Operation) => {
    const value = item.classification?.value;
    return value?.type === 'pool-withdrawal'
      ? { key: `${value.deposit.addressId}|${value.deposit.txid}`, partial: value.partial === true }
      : null;
  };
  const others = operations.filter(
    (item) => item.id !== operation.id && item.status === 'recorded',
  );
  const closed = new Set(
    others.flatMap((item) => {
      const found = named(item);
      return found && !found.partial ? [found.key] : [];
    }),
  );
  // What the latest part left in the pool, by deposit.
  const left = new Map<string, string>();
  for (const item of [...others].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const found = named(item);
    if (found?.partial && item.pool?.remaining !== undefined)
      left.set(found.key, item.pool.remaining);
  }
  const found = operations
    .filter(
      (item) =>
        item.kind === 'chain' &&
        item.type === 'pool-deposit' &&
        item.status === 'recorded' &&
        pairKey(item) !== '' &&
        !closed.has(pairKey(item)) &&
        Number(left.get(pairKey(item)) ?? 1) > 0 &&
        assetKey(item.asset) === coin &&
        item.account !== null &&
        item.account.id === operation.account?.id &&
        item.occurredAt <= operation.occurredAt,
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((item): [string, string] => [
      pairKey(item),
      [
        `${day(item.occurredAt)}, ${rowTime(item)}`,
        amount(item.quantity, item.asset),
        addressText(item.wallet!),
        ...(left.has(pairKey(item))
          ? [`${amount(left.get(pairKey(item))!, item.asset)} left in the pool`]
          : []),
      ].join(' · '),
    ]);
  const saved = named(operation)?.key;
  if (saved && !found.some(([key]) => key === saved)) found.unshift([saved, 'The saved deposit']);
  return found;
}

type Problem = 'amount' | 'rate' | 'value' | 'account' | 'pair' | 'deposit' | 'comment';

function problems(draft: Draft): Set<Problem> {
  const found = new Set<Problem>();
  if (draft.type === 'transfer') {
    if (!draft.account) found.add('account');
  } else if (draft.type === 'swap') {
    if (!draft.pair) found.add('pair');
    if (!recordKey.test(draft.pair) && draft.value.trim() && !positive(draft.value))
      found.add('value');
  } else if (draft.type === 'pool-withdrawal') {
    if (!draft.deposit) found.add('deposit');
    if (draft.value.trim() && !positive(draft.value)) found.add('value');
  } else if (draft.type === 'pool-deposit') {
    // Nothing to enter: the coins stay the owner's.
  } else if (draft.type === 'buy' || draft.type === 'sell') {
    if (!positive(draft.amount)) found.add('amount');
    if ((draft.currency === 'EUR' || draft.currency === 'RUB') && draft.rate.trim())
      if (!positive(draft.rate)) found.add('rate');
  } else if (
    draft.type === 'reward' ||
    draft.type === 'staking-reward' ||
    draft.type === 'pool-reward' ||
    draft.type === 'airdrop' ||
    draft.type === 'fee'
  ) {
    if (draft.value.trim() && !positive(draft.value)) found.add('value');
  } else if (draft.type && draft.type !== 'other' && !positive(draft.value)) found.add('value');
  if ([...draft.comment.trim()].length > MAX_COMMENT_LENGTH) found.add('comment');
  return found;
}

function answer(draft: Draft): ChainClassification | null {
  switch (draft.type) {
    case null:
      return null;
    case 'transfer':
      return { type: 'transfer', accountId: draft.account };
    case 'swap': {
      const record = recordKey.exec(draft.pair);
      if (record)
        return {
          type: 'recorded',
          operation: { kind: record[1] as 'trade' | 'swap', id: record[2] },
        };
      const [addressId, txid] = draft.pair.split('|');
      return {
        type: 'swap',
        with: { addressId, txid },
        valueUsd: draft.value.trim() ? decimal(draft.value) : null,
      };
    }
    case 'buy':
    case 'sell': {
      const rate =
        (draft.currency === 'EUR' || draft.currency === 'RUB') && draft.rate.trim()
          ? { perUsd: decimal(draft.rate)! }
          : {};
      return {
        type: draft.type,
        currency: draft.currency,
        amount: decimal(draft.amount)!,
        ...rate,
      };
    }
    case 'reward':
    case 'staking-reward':
    case 'pool-reward':
    case 'airdrop':
    case 'fee':
      return { type: draft.type, valueUsd: draft.value.trim() ? decimal(draft.value) : null };
    case 'other':
      return { type: 'other' };
    case 'pool-deposit':
      return { type: 'pool-deposit' };
    case 'pool-withdrawal': {
      const [addressId, txid] = draft.deposit.split('|');
      return {
        type: 'pool-withdrawal',
        deposit: { addressId, txid },
        valueUsd: draft.value.trim() ? decimal(draft.value) : null,
        ...(draft.partial ? { partial: true as const } : {}),
      };
    }
    case 'recorded':
      // CLS-RECORDED: asked for as a swap that names the record (draftOf); never a type here.
      return null;
    default:
      return { type: draft.type, valueUsd: decimal(draft.value)! };
  }
}

/** POOL-UNDO: the deposit a withdrawal returns cannot change or be hidden first. */
export const POOL_DEPOSIT_NAMED =
  'A pool withdrawal names this deposit; change the withdrawal first';

function failure(error: unknown): ReactNode {
  if (dependentOf(error))
    return 'A later transaction spends these coins, so this answer cannot change now. Change that transaction first.';
  if (!isAxiosError(error) || error.response === undefined)
    return 'Could not reach the server. Nothing was saved; try again.';
  const status = error.response.status;
  const message = (error.response.data as { message?: unknown } | undefined)?.message;
  if (status === 422 && message === 'Choose the account of this wallet first')
    return (
      <>
        This wallet is not in an account yet. <Link to="/wallets">Choose its account</Link>, then
        classify the transaction.
      </>
    );
  if (status === 422 && message === 'Choose the account of the other wallet first')
    return 'The address on the other side is not in a wallet yet. Choose its wallet first.';
  if (status === 422 && message === 'Choose a transaction that moved coins the other way')
    return 'The other transaction moved coins the same way. Choose one that moved them the other way.';
  if (status === 422 && message === 'A swap needs two different coins')
    return 'Both transactions moved the same coin. Choose a transaction in another coin.';
  if (status === 422 && message === 'Choose the other side of the swap')
    return 'Choose the transaction on the other side.';
  const records: Record<string, string> = {
    'Choose an operation you added or imported':
      'That record was deleted or was not added by you. Reload and choose another one.',
    'Choose an operation of this wallet':
      'That record is in another wallet. Choose one of the wallet of this address.',
    'That operation did not move this coin this way':
      'That record did not move this coin this way. Choose another one.',
  };
  if (status === 422 && typeof message === 'string' && records[message]) return records[message];
  const pools: Record<string, string> = {
    'Choose a pool deposit': 'Choose the pool deposit this withdrawal returns.',
    'A pool withdrawal returns the coin of its deposit':
      'That deposit was in another coin. Choose a deposit of the coin that came back.',
    'Choose a pool deposit of this wallet':
      'That deposit was made from another wallet. Choose a deposit of this wallet.',
    'Choose a pool deposit made before this withdrawal':
      'That deposit was made after this withdrawal. Choose an earlier one.',
    'That pool deposit was already withdrawn':
      'Another withdrawal already returns that deposit. Choose another one, or change that withdrawal first.',
    [POOL_DEPOSIT_NAMED]: 'A pool withdrawal returns this deposit. Change that withdrawal first.',
  };
  if (status === 422 && typeof message === 'string' && pools[message]) return pools[message];
  if (status === 422 && message === 'Choose an account other than the one of this wallet')
    return 'Choose a wallet other than the one of this address.';
  if (
    status === 422 &&
    message === 'The other wallet did not receive what this one sent, less the network fee'
  )
    return 'The other wallet did not receive what this one sent, less the network fee. Choose another wallet or another type.';
  if (
    status === 422 &&
    message === 'Several addresses of that account took part in this transaction'
  )
    return 'Several addresses of that wallet took part in this transaction, so it cannot be linked automatically. Choose another type.';
  if (status === 422 && message === 'No stored price for this coin at that time')
    return 'There is no stored price for this coin at that time. Enter the value in USD.';
  if (status === 422) return 'This type does not fit the direction of the transaction.';
  if (status === 409)
    return 'This could not be saved: it was changed elsewhere, or the account would not hold enough on that date. Close this window, reload and try again.';
  return 'Could not save the classification. Try again.';
}

interface Props {
  operation: Operation;
  /** The whole list, for the other side of a swap. */
  operations?: Operation[];
  /** CLS-DUST: the list's dust threshold; dust is no other side of a swap. Null: off. */
  dustThresholdUsd?: string | null;
  /** Shown first: the amount and the raw facts. */
  children: ReactNode;
  /** Other transactions still to classify, for the footer. */
  left: number;
  onSaved: (label: string) => void;
  onCancel: () => void;
}

// CLS-BUY, CLS-RECLASSIFY: the drawer's question for a blockchain transaction. Only the fields
// the chosen type needs appear; the answer is saved as its own version, the raw data untouched.
export default function ClassifyForm({
  operation,
  operations = [],
  dustThresholdUsd = null,
  children,
  left,
  onSaved,
  onCancel,
}: Props) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(operation));
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  // One request id per answer: a retry after a lost response cannot record it twice.
  const [requestId, setRequestId] = useState(newRequestId);
  const change = (next: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setRequestId(newRequestId());
    setError(null);
  };
  const found = problems(draft);
  // Fields the owner has left: their problems show on blur and clear as soon as the value is fixed.
  const [blurred, setBlurred] = useState<ReadonlySet<Problem>>(new Set());
  const leave = (problem: Problem) => () =>
    setBlurred((current) => (current.has(problem) ? current : new Set(current).add(problem)));
  const shows = (problem: Problem) => (tried || blurred.has(problem)) && found.has(problem);
  const invalid = (problem: Problem) =>
    shows(problem) ? { 'aria-invalid': true, 'aria-describedby': `${id}-${problem}-error` } : {};
  const fieldError = (problem: Problem, text: string) =>
    shows(problem) && (
      <span className="portfolio-field__error" id={`${id}-${problem}-error`}>
        {text}
      </span>
    );
  const ready = draft.type !== null || draft.hidden;
  // XFER-MANUAL: the wallets a transfer can name, loaded once it is chosen.
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsFailed, setAccountsFailed] = useState(false);
  const transfer = draft.type === 'transfer';
  const swap = draft.type === 'swap';
  // CLS-RECORDED: the swap names a record added by hand: nothing to value.
  const recorded = swap && recordKey.test(draft.pair);
  const poolDeposit = draft.type === 'pool-deposit';
  const poolWithdrawal = draft.type === 'pool-withdrawal';
  useEffect(() => {
    if (!transfer || accounts) return;
    let live = true;
    journalAccounts()
      .then((items) => live && setAccounts(items))
      .catch(() => live && setAccountsFailed(true));
    return () => {
      live = false;
    };
  }, [transfer, accounts]);
  const own = ownAccount(operation);
  const others = (accounts ?? []).filter((account) => account.id !== own?.id);
  const known = [operation.account, operation.counterAccount].find(
    (place) => place && place.id === draft.account && place.id !== own?.id,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!ready || found.size > 0 || !operation.wallet || !operation.chain) return;
    setSaving(true);
    setError(null);
    const comment = draft.comment.trim();
    try {
      await operationsApi.classify(operation.wallet, operation.chain.txid, {
        requestId,
        expectedVersion: operation.classification?.version ?? 0,
        hidden: draft.hidden,
        classification: answer(draft),
        ...(comment ? { comment } : {}),
      });
      announceClassificationChange();
      onSaved(transfer ? 'Transfer' : draft.type ? typeName(operation, draft.type) : 'hidden');
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
    }
  };

  const pairs = swap ? swapCandidates(operation, operations, dustThresholdUsd) : [];
  const records = swap ? recordCandidates(operation, operations) : [];
  // CLS-PAID: the picked record belongs to another account, so the coins go there to pay for it.
  const paidElsewhere = recorded
    ? operations.find(
        (item) => item.id === draft.pair && item.account?.id !== operation.account?.id,
      )?.account
    : undefined;
  const options = (items: [string, string][]) =>
    items.map(([key, label]) => (
      <option key={key} value={key}>
        {label}
      </option>
    ));
  const priced = draft.type === 'buy' || draft.type === 'sell';
  const rated = draft.currency === 'EUR' || draft.currency === 'RUB';
  const optional =
    draft.type === 'reward' ||
    draft.type === 'staking-reward' ||
    draft.type === 'pool-reward' ||
    draft.type === 'airdrop' ||
    draft.type === 'swap' ||
    draft.type === 'fee' ||
    poolWithdrawal;
  const other = draft.type === 'other';
  // Other asks only for a comment, so it shows up front rather than under "More options".
  const commentField = (
    <div className="portfolio-field">
      <label className="portfolio-field__label" htmlFor={`${id}-comment`}>
        Comment
      </label>
      <textarea
        id={`${id}-comment`}
        className="portfolio-input portfolio-textarea"
        placeholder="Optional"
        value={draft.comment}
        onChange={(event) => change({ comment: event.target.value })}
        onBlur={leave('comment')}
        {...invalid('comment')}
      />
      {fieldError('comment', `At most ${MAX_COMMENT_LENGTH} characters`)}
    </div>
  );
  return (
    <form className="transactions-classify" onSubmit={(event) => void submit(event)} noValidate>
      <div className="transactions-drawer__body">
        {children}
        {!operation.account && (
          <p className="portfolio-warn transactions-classify__warn" role="note">
            This address is not in a wallet yet. Choose its wallet first; until then the transaction
            can only be hidden. <Link to="/wallets">Open Wallets</Link>
          </p>
        )}
        <section aria-labelledby={`${id}-question`}>
          <h3 id={`${id}-question`} className="transactions-section">
            What was this transaction?
          </h3>
          <div className="transactions-options" role="group" aria-labelledby={`${id}-question`}>
            {choices(operation).map(([type, label]) => (
              <button
                key={type}
                type="button"
                className={`transactions-option${type === 'transfer' ? ' transactions-option--wide' : ''}`}
                aria-pressed={draft.type === type}
                onClick={() => change({ type })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        {priced && (
          <div className="transactions-subform">
            <div className="portfolio-row">
              <div className="portfolio-field">
                <label className="portfolio-field__label" htmlFor={`${id}-amount`}>
                  {draft.type === 'buy' ? 'You paid' : 'You received'}
                </label>
                <span className="portfolio-affix">
                  <input
                    id={`${id}-amount`}
                    className="portfolio-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={draft.amount}
                    onChange={(event) => change({ amount: event.target.value })}
                    onBlur={leave('amount')}
                    {...invalid('amount')}
                  />
                  <span className="portfolio-affix__suffix">{draft.currency}</span>
                </span>
                {fieldError(
                  'amount',
                  draft.type === 'buy'
                    ? 'Enter the amount you paid'
                    : 'Enter the amount you received',
                )}
              </div>
              <div className="portfolio-field">
                <span className="portfolio-field__label" id={`${id}-currency`}>
                  Currency
                </span>
                <div className="shell-seg" role="radiogroup" aria-labelledby={`${id}-currency`}>
                  {currencies.map((currency) => (
                    <label key={currency}>
                      <input
                        type="radio"
                        name={`${id}-currency`}
                        value={currency}
                        checked={draft.currency === currency}
                        onChange={() => change({ currency, rate: '' })}
                      />
                      {currency}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {rated ? (
              <div className="portfolio-field">
                <label className="portfolio-field__label" htmlFor={`${id}-rate`}>
                  Exchange rate
                </label>
                <span className="portfolio-affix">
                  <input
                    id={`${id}-rate`}
                    className="portfolio-input"
                    inputMode="decimal"
                    placeholder="Bank of Russia rate"
                    value={draft.rate}
                    onChange={(event) => change({ rate: event.target.value })}
                    onBlur={leave('rate')}
                    {...invalid('rate')}
                  />
                  <span className="portfolio-affix__suffix">{draft.currency} per 1 USD</span>
                </span>
                {fieldError('rate', 'Enter a rate above zero, or leave it empty') || (
                  <span className="portfolio-field__hint">
                    Empty means the Bank of Russia rate of {day(operation.occurredAt)}.
                  </span>
                )}
              </div>
            ) : (
              draft.currency !== 'USD' && (
                <span className="portfolio-field__hint">
                  {draft.currency} is counted 1:1 with USD.
                </span>
              )
            )}
          </div>
        )}
        {transfer && (
          <div className="transactions-subform">
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor={`${id}-account`}>
                {legDirection(operation) === 'out' ? 'Sent to' : 'Received from'}
              </label>
              <select
                id={`${id}-account`}
                className="portfolio-input"
                value={draft.account}
                onChange={(event) => change({ account: event.target.value })}
                onBlur={leave('account')}
                {...invalid('account')}
              >
                <option value="">{accounts ? 'Choose your wallet' : 'Loading wallets…'}</option>
                {others.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
                {/* The saved or suggested wallet stays shown while the list loads. */}
                {!accounts && known && <option value={known.id}>{known.name}</option>}
              </select>
              {fieldError('account', 'Choose the other wallet') ||
                (accountsFailed && (
                  <span className="portfolio-field__error">
                    Could not load your wallets. Close this window and try again.
                  </span>
                ))}
            </div>
            <span className="portfolio-field__hint">
              Transfers between your wallets don't change your capital. Only the network fee
              {operation.fee ? ` of ${amount(operation.fee.quantity, operation.fee.asset)}` : ''} is
              counted as a cost.
            </span>
          </div>
        )}
        {swap && (
          <div className="transactions-subform">
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor={`${id}-pair`}>
                {legDirection(operation) === 'out' ? 'Received in exchange' : 'Paid with'}
              </label>
              <select
                id={`${id}-pair`}
                className="portfolio-input"
                value={draft.pair}
                onChange={(event) => change({ pair: event.target.value })}
                onBlur={leave('pair')}
                {...invalid('pair')}
              >
                <option value="">Choose the transaction</option>
                {records.length > 0 ? (
                  <>
                    <optgroup label="Your blockchain transactions">{options(pairs)}</optgroup>
                    <optgroup label="Added by you or from CSV">{options(records)}</optgroup>
                  </>
                ) : (
                  options(pairs)
                )}
              </select>
              {fieldError('pair', 'Choose the transaction on the other side') || (
                <span className="portfolio-field__hint">
                  {recorded
                    ? paidElsewhere
                      ? `The coins move to ${paidElsewhere.name} just before that purchase and pay for it there. Nothing is counted twice.`
                      : 'This transaction is that record: nothing new is added, and the coins are not counted twice.'
                    : 'Transactions in another coin within a week from any of your wallets, or what you added by hand or from CSV for this wallet.'}
                </span>
              )}
            </div>
          </div>
        )}
        {poolDeposit && (
          <div className="transactions-subform">
            <span className="portfolio-field__hint">
              The coins stay yours while they are in the pool: they keep their purchase price and
              count in your balance. This is not a sale and not a withdrawal. Only the network fee
              {operation.fee ? ` of ${amount(operation.fee.quantity, operation.fee.asset)}` : ''} is
              a cost.
            </span>
          </div>
        )}
        {poolWithdrawal && (
          <div className="transactions-subform">
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor={`${id}-deposit`}>
                Returns the deposit
              </label>
              <select
                id={`${id}-deposit`}
                className="portfolio-input"
                value={draft.deposit}
                onChange={(event) => change({ deposit: event.target.value })}
                onBlur={leave('deposit')}
                {...invalid('deposit')}
              >
                <option value="">Choose the pool deposit</option>
                {poolCandidates(operation, operations).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              {fieldError('deposit', 'Choose the pool deposit this withdrawal returns') || (
                <span className="portfolio-field__hint">
                  Your pool deposits of {legAsset(operation).symbol ?? 'this coin'} from this wallet
                  made before it. Classify the deposit as Pool deposit first.
                </span>
              )}
            </div>
            <label className="transactions-toggle">
              <input
                type="checkbox"
                checked={draft.partial}
                onChange={(event) => change({ partial: event.target.checked })}
              />
              Part of the deposit
            </label>
            <span className="portfolio-field__hint">
              {draft.partial
                ? 'The rest is still in the pool: it stays in your balance with its purchase price. Classify the other parts in the order they happened.'
                : 'The last or only withdrawal of this deposit: what is missing from it counts as impermanent loss.'}
            </span>
          </div>
        )}
        {other && (
          <div className="transactions-subform">
            <span className="portfolio-field__hint">
              {legDirection(operation) === 'out'
                ? 'The amount leaves your balance without a sale price and is not a withdrawal. Add a comment so you remember what it was.'
                : 'The amount stays in your balance without a purchase price. Add a comment so you remember what it was.'}
            </span>
            {commentField}
          </div>
        )}
        {draft.type && !priced && !transfer && !other && !poolDeposit && !recorded && (
          <div className="transactions-subform">
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor={`${id}-value`}>
                {poolWithdrawal ? 'Value of the gain' : 'Value at the time'}
                {optional ? ' (optional)' : ''}
              </label>
              <span className="portfolio-affix">
                <input
                  id={`${id}-value`}
                  className="portfolio-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={draft.value}
                  onChange={(event) => change({ value: event.target.value })}
                  onBlur={leave('value')}
                  {...invalid('value')}
                />
                <span className="portfolio-affix__suffix">USD</span>
              </span>
              {fieldError(
                'value',
                optional ? 'Enter a value above zero, or leave it empty' : 'Enter the value in USD',
              ) || (
                <span className="portfolio-field__hint">
                  {swap || draft.type === 'fee'
                    ? `Empty: USDT and USDC count 1:1, other coins at their stored price on ${day(operation.occurredAt)}.`
                    : poolWithdrawal
                      ? `Only what came back above the deposit is income; less is a loss. Empty: USDT and USDC count 1:1, other coins at their stored price on ${day(operation.occurredAt)}.`
                      : draft.type === 'expense' || operation.direction !== 'in'
                        ? `What the coins were worth on ${day(operation.occurredAt)}; it leaves your capital.`
                        : optional
                          ? 'Without a value the coins count in net worth, not in profit.'
                          : `What the coins were worth on ${day(operation.occurredAt)}; it becomes their cost basis.`}
                </span>
              )}
            </div>
          </div>
        )}
        <details className="transactions-more">
          <summary>More options</summary>
          {!other && commentField}
          <label className="transactions-toggle">
            <input
              type="checkbox"
              checked={draft.hidden}
              onChange={(event) => change({ hidden: event.target.checked })}
            />
            Hide from calculations
          </label>
        </details>
        {error && (
          <p className="portfolio-dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="transactions-drawer__foot">
        <span className="transactions-left">{left} left to classify</span>
        <span className="transactions-grow" />
        <button type="button" className="shell-button shell-button--ghost" onClick={onCancel}>
          Later
        </button>
        <button
          type="submit"
          className="shell-button shell-button--primary"
          disabled={!ready || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
