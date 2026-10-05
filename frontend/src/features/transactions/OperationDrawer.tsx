import type { Operation } from '@api/operations.api';
import { type ReactNode, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { DASH, price } from '../portfolio/format';
import {
  amount,
  moment,
  networkName,
  signedAmount,
  sourceLabels,
  statusLabels,
  ticker,
  typeLabel,
  usd,
} from './operation-format';

const sourceDetails: Record<Operation['source'], string> = {
  manual: 'Added by you',
  csv: 'Imported from CSV',
  chain: 'Blockchain',
};

/** Where an operation can be changed today; the new forms come with M9 and M12. */
function editLink(operation: Operation): [string, string] | null {
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

function facts(operation: Operation): [string, ReactNode][] {
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
        operation.estimatedValueUsd !== null && chain.priceObservedAt
          ? `≈ ${usd(operation.estimatedValueUsd)} at the price stored ${moment(chain.priceObservedAt)}`
          : 'No stored price',
      ],
    );
  } else {
    if (operation.counterAccount && operation.account)
      rows.push(['From', operation.account.name], ['To', operation.counterAccount.name]);
    else rows.push(['Account', operation.account?.name ?? 'Whole portfolio']);
    if (operation.counterAsset && operation.counterQuantity)
      rows.push(['Received', amount(operation.counterQuantity, operation.counterAsset, '+')]);
    rows.push(['Value', operation.valueUsd === null ? 'Not recorded' : usd(operation.valueUsd)]);
    if ((operation.type === 'buy' || operation.type === 'sell') && operation.valueUsd !== null)
      rows.push([
        'Price',
        `${price(String(Number(operation.valueUsd) / Number(operation.quantity)), 'USD')} per ${ticker(operation.asset)}`,
      ]);
    if (operation.costBasisUsd !== null) rows.push(['Cost basis', usd(operation.costBasisUsd)]);
    rows.push([
      'Fee',
      operation.feeUsd !== null && Number(operation.feeUsd) !== 0
        ? usd(operation.feeUsd)
        : operation.fee
          ? amount(operation.fee.quantity, operation.fee.asset)
          : 'None',
    ]);
  }
  rows.push(
    ['Status', statusLabels[operation.status]],
    ['Source', sourceDetails[operation.source]],
  );
  if (operation.version !== null) rows.push(['Version', String(operation.version)]);
  return rows;
}

const focusable = 'a[href], button:not([disabled])';

interface Props {
  operation: Operation;
  onClose: () => void;
}

// Side drawer of the accepted prototype, read-only in M8: details and where to change them.
export default function OperationDrawer({ operation, onClose }: Props) {
  const drawer = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab' || !drawer.current) return;
      const items = [...drawer.current.querySelectorAll<HTMLElement>(focusable)];
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

  const link = editLink(operation);
  const needs = operation.status === 'needs-classification';
  const value =
    operation.valueUsd !== null
      ? usd(operation.valueUsd)
      : operation.estimatedValueUsd !== null
        ? `≈ ${usd(operation.estimatedValueUsd)} at the latest stored price`
        : null;
  return (
    <>
      <div className="transactions-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={drawer}
        className="transactions-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-title"
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
              {facts(operation).map(([label, content]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{content}</dd>
                </div>
              ))}
            </dl>
          </section>
          {operation.kind === 'chain' && (
            <p className="transactions-info">
              Blockchain data is stored as received and never edited. Classifying this transaction
              as a buy, a transfer or another type is not available yet.
            </p>
          )}
        </div>
        {link && (
          <div className="transactions-drawer__foot">
            <Link className="shell-button" to={link[0]}>
              {link[1]}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
