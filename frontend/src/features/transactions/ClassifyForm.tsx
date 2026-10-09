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
} from './operation-format';

type ChainType = ChainClassification['type'];
type Currency = Extract<ChainClassification, { currency: string }>['currency'];
const currencies: Currency[] = ['USD', 'USDT', 'USDC', 'EUR', 'RUB'];

// "What was this transaction?" from the accepted prototype, limited to what the coins did:
// what arrives can be bought or received, what leaves can be sold, spent or given, and either
// can move between the owner's own wallets (M13). Other is a movement nobody can name yet.
// A swap pairs a receipt with a payment in another coin, from any of the wallets (CLS-SWAP).
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
  ['other', 'Other'],
];
const outgoing: [ChainType, string][] = [
  TRANSFER,
  ['sell', 'Sell'],
  SWAP,
  ['expense', 'Expense'],
  ['gift', 'Gift sent'],
  ['fee', 'Fee'],
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
  /** Swap only: the transaction on the other side, as "address id|txid". */
  pair: string;
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
  // XFER-AUTO: the owner's other address in the same transaction suggests a transfer.
  const suggested = !value && operation.counterWallet && operation.counterAccount;
  return {
    type: value?.type ?? (suggested ? 'transfer' : null),
    amount: priced?.amount ?? '',
    currency: priced?.currency ?? 'USDT',
    rate: priced?.perUsd ?? '',
    value: valued?.valueUsd ?? '',
    account: moved?.accountId ?? operation.counterAccount?.id ?? '',
    pair: swapped ? `${swapped.with.addressId}|${swapped.with.txid}` : '',
    comment: saved?.comment ?? '',
    // Changing an answer starts from "included"; hiding is its own button outside this form.
    hidden: false,
  };
}

const WEEK_MS = 7 * 86_400_000;
const unpaired = new Set(['transfer', 'swap', 'stake', 'unstake']);
/** The coin this leg moved: a swap row lists what was paid first. */
const legAsset = (operation: Operation) =>
  operation.type === 'swap' && operation.counterAsset ? operation.counterAsset : operation.asset;
const pairKey = (operation: Operation) =>
  operation.wallet && operation.chain ? `${operation.wallet.id}|${operation.chain.txid}` : '';
const addressText = (wallet: NonNullable<Operation['wallet']>) =>
  `${networkName(wallet)} ${wallet.label ?? shortAddress(wallet.address)}`;

/**
 * CLS-SWAP: the owner's blockchain transactions that can be the other side of this one, from
 * any wallet: moving the other way, another coin, within a week, nearest first. A saved pair
 * stays a choice though the list shows it inside the swap.
 */
export function swapCandidates(operation: Operation, operations: Operation[]): [string, string][] {
  const leg = legDirection(operation);
  const coin = assetKey(legAsset(operation));
  const at = Date.parse(operation.occurredAt);
  const found = operations
    .filter(
      (item) =>
        item.kind === 'chain' &&
        item.id !== operation.id &&
        pairKey(item) !== '' &&
        legDirection(item) === (leg === 'in' ? 'out' : 'in') &&
        !(item.type && unpaired.has(item.type)) &&
        assetKey(item.asset) !== coin &&
        Math.abs(Date.parse(item.occurredAt) - at) <= WEEK_MS,
    )
    .sort(
      (a, b) => Math.abs(Date.parse(a.occurredAt) - at) - Math.abs(Date.parse(b.occurredAt) - at),
    )
    .map((item): [string, string] => [
      pairKey(item),
      [
        `${day(item.occurredAt)}, ${rowTime(item)}`,
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

type Problem = 'amount' | 'rate' | 'value' | 'account' | 'pair' | 'comment';

function problems(draft: Draft): Set<Problem> {
  const found = new Set<Problem>();
  if (draft.type === 'transfer') {
    if (!draft.account) found.add('account');
  } else if (draft.type === 'swap') {
    if (!draft.pair) found.add('pair');
    if (draft.value.trim() && !positive(draft.value)) found.add('value');
  } else if (draft.type === 'buy' || draft.type === 'sell') {
    if (!positive(draft.amount)) found.add('amount');
    if ((draft.currency === 'EUR' || draft.currency === 'RUB') && draft.rate.trim())
      if (!positive(draft.rate)) found.add('rate');
  } else if (
    draft.type === 'reward' ||
    draft.type === 'staking-reward' ||
    draft.type === 'airdrop'
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
    case 'airdrop':
      return { type: draft.type, valueUsd: draft.value.trim() ? decimal(draft.value) : null };
    case 'other':
      return { type: 'other' };
    default:
      return { type: draft.type, valueUsd: decimal(draft.value)! };
  }
}

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
  if (status === 422) return 'This type does not fit the direction of the transaction.';
  if (status === 409)
    return 'This could not be saved: it was changed elsewhere, or the account would not hold enough on that date. Close this window, reload and try again.';
  return 'Could not save the classification. Try again.';
}

interface Props {
  operation: Operation;
  /** The whole list, for the other side of a swap. */
  operations?: Operation[];
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
  const shows = (problem: Problem) => tried && found.has(problem);
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

  const priced = draft.type === 'buy' || draft.type === 'sell';
  const rated = draft.currency === 'EUR' || draft.currency === 'RUB';
  const optional =
    draft.type === 'reward' ||
    draft.type === 'staking-reward' ||
    draft.type === 'airdrop' ||
    draft.type === 'swap';
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
                {...invalid('pair')}
              >
                <option value="">Choose the transaction</option>
                {swapCandidates(operation, operations).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              {fieldError('pair', 'Choose the transaction on the other side') || (
                <span className="portfolio-field__hint">
                  Transactions in another coin within a week, from any of your wallets.
                </span>
              )}
            </div>
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
        {draft.type && !priced && !transfer && !other && (
          <div className="transactions-subform">
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor={`${id}-value`}>
                Value at the time{optional ? ' (optional)' : ''}
              </label>
              <span className="portfolio-affix">
                <input
                  id={`${id}-value`}
                  className="portfolio-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={draft.value}
                  onChange={(event) => change({ value: event.target.value })}
                  {...invalid('value')}
                />
                <span className="portfolio-affix__suffix">USD</span>
              </span>
              {fieldError(
                'value',
                optional ? 'Enter a value above zero, or leave it empty' : 'Enter the value in USD',
              ) || (
                <span className="portfolio-field__hint">
                  {swap
                    ? `Empty: USDT and USDC count 1:1, other coins at their stored price on ${day(operation.occurredAt)}.`
                    : draft.type === 'expense' ||
                        draft.type === 'fee' ||
                        operation.direction !== 'in'
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
