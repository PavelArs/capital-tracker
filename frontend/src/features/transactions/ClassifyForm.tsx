import {
  announceClassificationChange,
  type ChainClassification,
  type Operation,
  operationsApi,
} from '@api/operations.api';
import { isAxiosError } from 'axios';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { newRequestId } from '../accounting/feedback';
import { dependentOf } from '../portfolio/AddTransactionDialog';
import { decimal, MAX_COMMENT_LENGTH, positive } from '../portfolio/add-transaction';
import { day } from './operation-format';

type ChainType = ChainClassification['type'];
type Currency = Extract<ChainClassification, { currency: string }>['currency'];
const currencies: Currency[] = ['USD', 'USDT', 'USDC', 'EUR', 'RUB'];

// "What was this transaction?" from the accepted prototype, limited to what the coins did:
// what arrives can be bought or received, what leaves can be sold, spent or given.
const incoming: [ChainType, string][] = [
  ['buy', 'Buy'],
  ['income', 'Income'],
  ['reward', 'Reward'],
  ['staking-reward', 'Staking reward'],
  ['airdrop', 'Airdrop'],
  ['gift', 'Gift received'],
];
const outgoing: [ChainType, string][] = [
  ['sell', 'Sell'],
  ['expense', 'Expense'],
  ['gift', 'Gift sent'],
  ['fee', 'Fee'],
];
export function choices(operation: Operation): [ChainType, string][] {
  if (operation.direction === 'in') return incoming;
  if (operation.direction === 'out') return outgoing;
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
  comment: string;
  hidden: boolean;
}

function draftOf(operation: Operation): Draft {
  const saved = operation.classification;
  const value = saved?.value ?? null;
  const priced = value && (value.type === 'buy' || value.type === 'sell') ? value : null;
  const valued = value && !priced && 'valueUsd' in value ? value : null;
  return {
    type: value?.type ?? null,
    amount: priced?.amount ?? '',
    currency: priced?.currency ?? 'USDT',
    rate: priced?.perUsd ?? '',
    value: valued?.valueUsd ?? '',
    comment: saved?.comment ?? '',
    // Changing an answer starts from "included"; hiding is its own button outside this form.
    hidden: false,
  };
}

type Problem = 'amount' | 'rate' | 'value' | 'comment';

function problems(draft: Draft): Set<Problem> {
  const found = new Set<Problem>();
  if (draft.type === 'buy' || draft.type === 'sell') {
    if (!positive(draft.amount)) found.add('amount');
    if ((draft.currency === 'EUR' || draft.currency === 'RUB') && draft.rate.trim())
      if (!positive(draft.rate)) found.add('rate');
  } else if (
    draft.type === 'reward' ||
    draft.type === 'staking-reward' ||
    draft.type === 'airdrop'
  ) {
    if (draft.value.trim() && !positive(draft.value)) found.add('value');
  } else if (draft.type && !positive(draft.value)) found.add('value');
  if ([...draft.comment.trim()].length > MAX_COMMENT_LENGTH) found.add('comment');
  return found;
}

function answer(draft: Draft): ChainClassification | null {
  switch (draft.type) {
    case null:
      return null;
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
  if (status === 422) return 'This type does not fit the direction of the transaction.';
  if (status === 409)
    return 'This could not be saved: it was changed elsewhere, or the account would not hold enough on that date. Close this window, reload and try again.';
  return 'Could not save the classification. Try again.';
}

interface Props {
  operation: Operation;
  /** Shown first: the amount and the raw facts. */
  children: ReactNode;
  /** Other transactions still to classify, for the footer. */
  left: number;
  onSaved: (label: string) => void;
  onCancel: () => void;
}

// CLS-BUY, CLS-RECLASSIFY: the drawer's question for a blockchain transaction. Only the fields
// the chosen type needs appear; the answer is saved as its own version, the raw data untouched.
export default function ClassifyForm({ operation, children, left, onSaved, onCancel }: Props) {
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
      onSaved(draft.type ? typeName(operation, draft.type) : 'hidden');
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
    }
  };

  const priced = draft.type === 'buy' || draft.type === 'sell';
  const rated = draft.currency === 'EUR' || draft.currency === 'RUB';
  const optional =
    draft.type === 'reward' || draft.type === 'staking-reward' || draft.type === 'airdrop';
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
                className="transactions-option"
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
        {draft.type && !priced && (
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
                  {draft.type === 'expense' || draft.type === 'fee' || operation.direction !== 'in'
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
