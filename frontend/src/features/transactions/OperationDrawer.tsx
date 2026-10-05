import { assetRewardsApi } from '@api/asset-rewards.api';
import type { Operation } from '@api/operations.api';
import { ownedTransfersApi } from '@api/owned-transfers.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { type TradeVersion, tradesApi } from '@api/trades.api';
import { isAxiosError } from 'axios';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { newRequestId } from '../accounting/feedback';
import { dependentOf } from '../portfolio/AddTransactionDialog';
import { entryKind } from '../portfolio/add-transaction';
import { DASH, money, price, quantity } from '../portfolio/format';
import {
  amount,
  day,
  moment,
  networkName,
  placeLabel,
  signedAmount,
  sourceLabels,
  statusLabels,
  ticker,
  typeLabel,
} from './operation-format';

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

/** Where other operations can be changed today; their forms come with M9 and M12. */
function editLink(operation: Operation): [string, string] | null {
  if (editable(operation)) return null;
  if (operation.kind === 'chain') return ['/wallet-addresses', 'Open wallet addresses'];
  if (operation.kind === 'transfer') return ['/owned-transfers', 'Open transfers'];
  if (operation.kind === 'flow') return ['/capital-flows', 'Open deposits and withdrawals'];
  return operation.account
    ? [`/manual-accounts/${operation.account.id}`, `Open in ${operation.account.name}`]
    : null;
}

function title(operation: Operation): string {
  const label = operation.type ? typeLabel(operation) : `${typeLabel(operation)} transaction`;
  return `${label} · ${ticker(operation.asset)}`;
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

function facts(operation: Operation, currency: AccountingCurrency): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [['Date', moment(operation.occurredAt)]];
  const { wallet, chain } = operation;
  if (wallet && chain) {
    rows.push(
      ['Network', networkName(wallet)],
      [
        'Wallet',
        <span key="wallet" className="transactions-mono">
          {wallet.address}
        </span>,
      ],
      [
        'Transaction',
        <span key="txid" className="transactions-mono">
          {chain.txid}
        </span>,
      ],
      ['Block', new Intl.NumberFormat('en-US').format(chain.blockHeight)],
      [
        'Network fee',
        operation.fee ? amount(operation.fee.quantity, operation.fee.asset) : 'Paid by sender',
      ],
      [
        'Estimated value',
        operation.estimatedValue !== null && chain.priceObservedAt
          ? `≈ ${money(operation.estimatedValue, currency)} at the price stored ${moment(chain.priceObservedAt)}`
          : operation.estimatedValueUsd !== null
            ? 'No Bank of Russia rate for today'
            : 'No stored price',
      ],
    );
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
    ['Status', statusLabels[operation.status]],
    ['Source', sourceDetails[operation.source]],
  );
  return rows;
}

const focusable = 'a[href], button:not([disabled])';

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
  | { step: 'blocked'; dependent: string; account: string };

interface Props {
  operation: Operation;
  /** The list's quote currency, which the operation's amounts are in. */
  currency?: AccountingCurrency;
  /** The whole list, to name the operation that depends on this one. */
  operations?: Operation[];
  onClose: () => void;
  onEdit?: (operation: Operation) => void;
  onDeleted?: () => void;
}

// Side drawer of the accepted prototype: details, history, and Edit and Delete for trades.
export default function OperationDrawer({
  operation,
  currency = 'USD',
  operations = [],
  onClose,
  onEdit,
  onDeleted,
}: Props) {
  const drawer = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [history, setHistory] = useState<TradeVersion[] | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const dismiss = useRef<() => void>(() => undefined);
  dismiss.current = () => {
    if (confirm?.step === 'deleting') return;
    if (confirm) {
      setConfirm(null);
      deleteButton.current?.focus();
    } else close.current();
  };
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss.current();
      const scope = modal.current ?? drawer.current;
      if (event.key !== 'Tab' || !scope) return;
      const items = [...scope.querySelectorAll<HTMLElement>(focusable)];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);
  const step = confirm?.step;
  useEffect(() => {
    if (step) modal.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
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

  // Deleting voids the operation: its history keeps every version, the void included
  // (OPS-DELETE).
  const remove = async () => {
    if (!changeable) return;
    setConfirm({ step: 'deleting' });
    const revision = async (accountId: string) =>
      (await tradesApi.state(accountId)).journal?.journalRevision ?? 0;
    const [kind, id] = [operation.kind, operation.id.slice(operation.id.indexOf(':') + 1)];
    const expectedVersion = operation.version ?? 0;
    try {
      if (kind === 'transfer') {
        const [from, to] = await Promise.all([
          revision(changeable.id),
          revision(operation.counterAccount?.id ?? changeable.id),
        ]);
        await ownedTransfersApi.void(id, {
          requestId: newRequestId(),
          expectedVersion,
          expectedFromJournalRevision: from,
          expectedToJournalRevision: to,
        });
      } else if (kind === 'reward')
        await assetRewardsApi.void(changeable.id, id, {
          requestId: newRequestId(),
          expectedJournalRevision: await revision(changeable.id),
          expectedVersion,
        });
      else
        await tradesApi.void(changeable.id, tradeId, {
          requestId: newRequestId(),
          expectedJournalRevision: await revision(changeable.id),
        });
      onDeleted?.();
    } catch (error) {
      const dependent = dependentOf(error);
      if (dependent) {
        const found = operations.find((item) => item.id === dependent.operationId);
        setConfirm({
          step: 'blocked',
          dependent: found
            ? describe(found)
            : `A later transaction on ${day(dependent.occurredAt)}`,
          // A transfer's coins may be spent in the account they went to.
          account:
            operation.counterAccount?.id === dependent.accountId
              ? operation.counterAccount.name
              : (operation.account?.name ?? 'the account'),
        });
        return;
      }
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setConfirm({
        step: 'ask',
        error:
          status === undefined
            ? 'Could not reach the server. Nothing was deleted; try again.'
            : status === 409
              ? 'This transaction was changed elsewhere. Close this window, reload and try again.'
              : 'Could not delete the transaction. Try again.',
      });
    }
  };

  const link = editLink(operation);
  const needs = operation.status === 'needs-classification';
  const value =
    operation.value !== null
      ? money(operation.value, currency)
      : operation.estimatedValue !== null
        ? `≈ ${money(operation.estimatedValue, currency)} at the latest stored price`
        : null;
  const purchase = operation.type === 'buy';
  return (
    <>
      <div className="transactions-scrim" aria-hidden="true" onClick={() => dismiss.current()} />
      <div
        ref={drawer}
        className="transactions-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-title"
        aria-hidden={confirm ? true : undefined}
      >
        <div className="transactions-drawer__head">
          <h2 id="operation-title">{title(operation)}</h2>
          <button
            ref={closeButton}
            type="button"
            className="shell-button shell-button--ghost"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="transactions-drawer__body">
          <div className="transactions-hero">
            <span className={`transactions-badge${needs ? ' transactions-badge--warn' : ''}`}>
              {needs
                ? statusLabels[operation.status]
                : `${sourceLabels[operation.source]} · ${typeLabel(operation)}`}
            </span>
            <span className="transactions-hero__amount">{signedAmount(operation)}</span>
            {operation.counterAsset && operation.counterQuantity && (
              <span className="transactions-hero__amount">
                {amount(operation.counterQuantity, operation.counterAsset, '+')}
              </span>
            )}
            <span className="transactions-hero__value">{value ?? `Value ${DASH}`}</span>
          </div>
          <section aria-label="Details">
            <dl className="transactions-facts">
              {facts(operation, currency).map(([label, content]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{content}</dd>
                </div>
              ))}
            </dl>
          </section>
          {trade && history && history.length > 1 && (
            <section aria-labelledby="operation-history">
              <h3 id="operation-history" className="transactions-section">
                History
              </h3>
              <ol className="transactions-history">
                {history.map((version) => (
                  <li key={version.version}>
                    <span>
                      {versionLabels[version.kind]} {moment(version.createdAt)}
                    </span>
                    <span className="transactions-muted">
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
          {operation.kind === 'chain' && (
            <p className="transactions-info">
              Blockchain data is stored as received and never edited. Classifying this transaction
              as a buy, a transfer or another type is not available yet.
            </p>
          )}
        </div>
        {changeable ? (
          <div className="transactions-drawer__foot">
            <button
              ref={deleteButton}
              type="button"
              className="shell-button shell-button--ghost transactions-delete"
              onClick={() => setConfirm({ step: 'ask', error: null })}
            >
              Delete
            </button>
            <span className="transactions-grow" />
            <button
              type="button"
              className="shell-button shell-button--secondary"
              onClick={() => onEdit?.(operation)}
            >
              Edit
            </button>
          </div>
        ) : (
          link && (
            <div className="transactions-drawer__foot">
              <Link className="shell-button" to={link[0]}>
                {link[1]}
              </Link>
            </div>
          )
        )}
      </div>
      {confirm && (
        <div className="portfolio-scrim transactions-confirm">
          <div
            ref={modal}
            className="portfolio-dialog portfolio-dialog--narrow"
            role={confirm.step === 'blocked' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="operation-confirm-title"
            aria-describedby="operation-confirm-text"
          >
            <div className="portfolio-dialog__head">
              <h2 id="operation-confirm-title">
                {confirm.step === 'blocked'
                  ? `This ${purchase ? 'purchase' : 'transaction'} can't be deleted`
                  : 'Delete this transaction?'}
              </h2>
            </div>
            <div className="portfolio-dialog__body">
              <p id="operation-confirm-text" className="transactions-confirm__text">
                {confirm.step === 'blocked'
                  ? `${confirm.dependent} spends these ${ticker(operation.asset)}. Without this ${purchase ? 'purchase' : 'transaction'} ${confirm.account} would not hold enough. Delete or change that transaction first.`
                  : `${describe(operation)} will be removed. Balances, cost basis and the portfolio history will be recalculated without it.`}
              </p>
              {confirm.step === 'ask' && confirm.error && (
                <p className="portfolio-dialog__error" role="alert">
                  {confirm.error}
                </p>
              )}
            </div>
            <div className="portfolio-dialog__foot">
              {confirm.step === 'blocked' ? (
                <button
                  type="button"
                  className="shell-button shell-button--primary"
                  onClick={() => dismiss.current()}
                >
                  OK
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="shell-button shell-button--ghost"
                    disabled={confirm.step === 'deleting'}
                    onClick={() => dismiss.current()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="shell-button shell-button--danger"
                    disabled={confirm.step === 'deleting'}
                    onClick={() => void remove()}
                  >
                    {confirm.step === 'deleting' ? 'Deleting…' : 'Delete transaction'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
