import {
  brokersApi,
  type TBankImportPreview,
  type TBankImportProblem,
  type TBankOpening,
  type TBankPlanEntry,
  type TBankSplit,
} from '@api/brokers.api';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { dayText, moscowDate } from '@/utils/dates';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import BrokerOpeningForm from './BrokerOpeningForm';
import BrokerSplitForm from './BrokerSplitForm';
import { plural } from './brokers';
import './broker.css';

const actions: [TBankPlanEntry['action'], string][] = [
  ['buy', 'Buys'],
  ['sell', 'Sales'],
  ['deposit', 'Money paid in'],
  ['withdrawal', 'Money paid out'],
  ['income', 'Dividends and coupons'],
  ['fee', 'Fees'],
  ['tax', 'Taxes'],
];

// Why an operation is left out (backend tbank-import-plan PlanSkip).
const skipText: Record<string, string> = {
  unsupported: 'Operation types the app does not record yet',
  transfer: 'Transfers of securities',
  card: 'Settled through a card',
  'outside-dividend': 'Dividends paid to your card require reconciliation',
  'no-amount': 'Moved no money',
  'no-payment': 'Moved units for no money',
  currency: 'In a currency the app does not keep',
  sign: 'Amount of the wrong sign for its kind',
  'no-instrument': 'T-Bank gives no instrument type',
  'currency-exchange': 'Dollars or euros bought with the same currency',
  'no-quantity': 'No quantity above zero',
  fills: 'Fills that do not add up',
  'partial-repayment': 'Bonds paid back in part',
  'not-held': 'Sales of more than the history holds',
  'short-cover': 'Buys that may cover such a sale',
};

const problemText: Record<TBankImportProblem['reason'], string> = {
  'opening-holding': 'A current holding needs matching known-cost opening lots',
  'not-recordable': 'Operations left out moved money or shares',
  'already-imported': 'Already imported into an account',
  'no-rate': 'No Bank of Russia rate for that day',
  amount: 'An amount outside the range the app stores',
  'fee-above-proceeds': 'A sale whose fee is more than it brought',
  'not-held': 'Spends more than the account holds then',
  'before-records': "Before the account's records begin",
  'too-many-rewards': 'More dividends and coupons than the app keeps',
  'too-many-entries': 'More entries than the account keeps',
};

const problemLine = (problem: TBankImportProblem) =>
  problem.reason === 'not-recordable' || problem.reason === 'already-imported'
    ? `${problemText[problem.reason]} (${problem.operationIds.length})`
    : [
        problemText[problem.reason],
        problem.ticker,
        // The server counts days in Moscow time.
        problem.occurredAt && dayText(moscowDate(problem.occurredAt)),
        problem.availableQuantity !== undefined && `available ${problem.availableQuantity}`,
        problem.requiredQuantity !== undefined && `required ${problem.requiredQuantity}`,
        problem.missingQuantity !== undefined && `short ${problem.missingQuantity}`,
      ]
        .filter(Boolean)
        .join(' · ');

const tbankStatus = {
  401: 'Your session has ended. Sign in again.',
  404: 'This account has no T-Bank connection. Close this window and reload the page.',
  422: (said: string | undefined) => said ?? 'T-Bank did not accept the saved token.',
  503: (said: string | undefined) =>
    said ?? 'T-Bank could not be reached. Try again in a few minutes.',
};

const loadFailure = (error: unknown) =>
  requestFailure(error, {
    unreachable: 'Could not reach the server. Try again.',
    status: tbankStatus,
    fallback: 'Could not read the history. Try again.',
  });

const importFailure = (error: unknown) =>
  requestFailure(error, {
    unreachable: 'Could not reach the server. Try again; the same request will not import twice.',
    status: {
      ...tbankStatus,
      409: 'The history or the account changed since this preview. Close this window and open it again.',
    },
    fallback: 'Try again.',
  });

interface Props {
  accountId: string;
  name: string;
  onClose: () => void;
  onImported: () => void;
}

// BROKER-IMPORT-UI: a connected account's T-Bank history, previewed and then written in one
// command. Nothing is recorded until the owner confirms what the preview shows.
export default function ImportHistoryDialog({ accountId, name, onClose, onImported }: Props) {
  const id = useId();
  const toast = useToast();
  const [preview, setPreview] = useState<TBankImportPreview | null>(null);
  const opening = useRef<TBankOpening | undefined>(undefined);
  const [editingOpening, setEditingOpening] = useState(false);
  const split = useRef<TBankSplit | undefined>(undefined);
  const [editingSplit, setEditingSplit] = useState(false);
  // What the owner declared, in the API's argument order.
  const declared = useCallback(
    (): [TBankOpening?, TBankSplit[]?] =>
      split.current ? [opening.current, [split.current]] : opening.current ? [opening.current] : [],
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One request id per previewed history, so a retry finds the import it already wrote.
  const requests = useRef(new Map<string, string>());
  const live = useRef(true);

  const load = useCallback(() => {
    setLoadError(null);
    brokersApi.importPreview(accountId, ...declared()).then(
      (next) => live.current && setPreview(next),
      (caught) => live.current && setLoadError(loadFailure(caught)),
    );
  }, [accountId, declared]);
  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  const reviewOpening = async (value: TBankOpening) => {
    setBusy(true);
    setError(null);
    try {
      const next = await brokersApi.importPreview(
        accountId,
        value,
        ...(split.current ? [[split.current]] : []),
      );
      if (!live.current) return;
      opening.current = value;
      setPreview(next);
      setEditingOpening(false);
    } catch (caught) {
      if (live.current)
        setError(
          requestFailure(caught, {
            unreachable: 'Could not reach the server.',
            status: {
              400: 'Check the opening dates, quantities and known USD costs.',
              409: 'The account changed. Close this window and reload.',
            },
            fallback: 'Could not review opening holdings.',
          }),
        );
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const reviewSplit = async (value: TBankSplit) => {
    setBusy(true);
    setError(null);
    try {
      const next = await brokersApi.importPreview(accountId, opening.current, [value]);
      if (!live.current) return;
      split.current = value;
      setPreview(next);
      setEditingSplit(false);
    } catch (caught) {
      if (live.current)
        setError(
          requestFailure(caught, {
            unreachable: 'Could not reach the server.',
            status: {
              400: 'Check the split: a security of this history, its date, and a whole number of new shares from 2.',
              409: 'The account changed. Close this window and reload.',
            },
            fallback: 'Could not review the split.',
          }),
        );
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview?.canImport || busy) return;
    const hash = preview.previewHash;
    if (!requests.current.has(hash)) requests.current.set(hash, newRequestId());
    setBusy(true);
    setError(null);
    try {
      const receipt = await brokersApi.importHistory(
        accountId,
        requests.current.get(hash) as string,
        hash,
        ...declared(),
      );
      toast.show({
        tone: 'success',
        title: `${name} history imported`,
        detail: `${plural(receipt.trades, 'trade')} and ${plural(receipt.rewards, 'reward')} recorded.`,
      });
      onImported();
    } catch (caught) {
      if (!live.current) return;
      setError(importFailure(caught));
      setBusy(false);
    }
  };

  const counts = preview
    ? actions
        .map(([action, label]) => ({
          label,
          count: preview.entries.filter((entry) => entry.action === action).length,
        }))
        .filter((row) => row.count > 0)
    : [];
  const skipped = new Map<string, number>();
  for (const item of preview?.skipped ?? [])
    skipped.set(item.reason, (skipped.get(item.reason) ?? 0) + 1);
  const blockers = preview
    ? [
        ...(preview.accountHasEntries
          ? ['The account already holds records, which the history would count twice']
          : []),
        ...(preview.fitsTradeLimit
          ? []
          : ['More trades than the account keeps, even combined by month']),
        ...(preview.entries.length === 0 ? ['Nothing in this history to record'] : []),
        ...preview.problems.map(problemLine),
      ]
    : [];
  const count = preview?.entries.length ?? 0;

  return (
    <Modal titleId={`${id}-title`} size="wide" onEscape={busy ? undefined : onClose}>
      <ModalHeader
        titleId={`${id}-title`}
        title="Import history"
        onClose={onClose}
        closeDisabled={busy}
      />
      <ModalBody>
        {loadError ? (
          <Banner
            tone="neg"
            action={
              <Button size="sm" onClick={load}>
                Try again
              </Button>
            }
          >
            {loadError}
          </Banner>
        ) : !preview ? (
          <p className="ui-soft" role="status">
            Reading the T-Bank history…
          </p>
        ) : (
          <>
            <p className="ui-soft">
              {`What the T-Bank history of ${name} would become: ${plural(preview.trades, 'trade')} and ${plural(preview.rewards, 'reward')}. Nothing is recorded until you import it.`}
            </p>
            {counts.length > 0 && (
              <KeyValue label="Entries to record" variant="panel">
                {counts.map((row) => (
                  <KeyValueRow key={row.label} term={row.label}>
                    {row.count}
                  </KeyValueRow>
                ))}
              </KeyValue>
            )}
            {preview.grouping !== 'operation' && (
              <Banner tone="info" role="none">
                {`Trades are combined by Moscow ${preview.grouping} to stay within the account's 1,000 trades.`}
              </Banner>
            )}
            {skipped.size > 0 && (
              <>
                <p className="ui-soft">Not included in this broker account:</p>
                <KeyValue label="Left out">
                  {[...skipped].map(([reason, total]) => (
                    <KeyValueRow key={reason} term={skipText[reason] ?? reason}>
                      {total}
                    </KeyValueRow>
                  ))}
                </KeyValue>
              </>
            )}
            {blockers.length > 0 && (
              <Banner tone="warn" role="none" title="Cannot import yet">
                {preview.problems.some((problem) => problem.reason === 'not-held') && (
                  <p>
                    The imported operations do not establish enough holdings or cash for a sale or
                    payment. This can mean missing earlier records, transfers or corporate actions.
                    Check the broker report before adding opening lots; current holdings alone
                    cannot establish the original purchase dates and costs.
                  </p>
                )}
                <ul className="broker-howto" aria-label="Cannot import yet">
                  {blockers.map((line, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: two problems can read alike.
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </Banner>
            )}
            {preview.skipped.some((item) => item.reason !== 'no-amount' && item.occurredAt) && (
              <details>
                <summary>Operations needing reconciliation</summary>
                <ul className="broker-howto">
                  {preview.skipped
                    .filter((item) => item.reason !== 'no-amount')
                    .map((item) => (
                      <li key={`${item.operationId}:${item.reason}`}>
                        {[
                          item.ticker,
                          item.occurredAt && `ordered ${dayText(moscowDate(item.occurredAt))}`,
                          skipText[item.reason] ?? item.reason,
                          `operation ${item.operationId}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </>
        )}
        {preview &&
          !preview.accountHasEntries &&
          (preview.openingAssets?.length ?? 0) > 0 &&
          !editingOpening &&
          !editingSplit && (
            <div className="ui-toolbar">
              <Button size="sm" disabled={busy} onClick={() => setEditingOpening(true)}>
                {opening.current ? 'Edit opening holdings' : 'Record earlier holdings'}
              </Button>
              {preview.openingAssets?.some((asset) => !asset.asset.startsWith('cash:')) && (
                <Button size="sm" disabled={busy} onClick={() => setEditingSplit(true)}>
                  {split.current ? 'Edit share split' : 'Record a share split'}
                </Button>
              )}
              {split.current && (
                <Banner tone="info">
                  The final import will also save a 1:{split.current.ratio} split of{' '}
                  {preview.openingAssets?.find((asset) => asset.asset === split.current?.asset)
                    ?.label ?? 'this security'}{' '}
                  from {dayText(moscowDate(split.current.effectiveAt))}, for every account that
                  holds it.
                </Banner>
              )}
              {opening.current && (
                <Banner tone="info">
                  The final import will also save {opening.current.lots.length} opening lot(s) with
                  the quantities and USD costs you reviewed.
                </Banner>
              )}
            </div>
          )}
        {editingOpening && preview?.openingAssets && (
          <BrokerOpeningForm
            assets={preview.openingAssets}
            initial={opening.current}
            busy={busy}
            onReview={reviewOpening}
            onCancel={() => setEditingOpening(false)}
          />
        )}
        {editingSplit && preview?.openingAssets && (
          <BrokerSplitForm
            assets={preview.openingAssets}
            initial={split.current}
            busy={busy}
            onReview={reviewSplit}
            onCancel={() => setEditingSplit(false)}
          />
        )}
        {error && <Banner tone="neg">{error}</Banner>}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <span className="ui-grow" />
        {preview && (
          <Button
            variant="primary"
            busy={busy}
            disabled={!preview.canImport || editingOpening || editingSplit}
            onClick={() => void confirm()}
          >
            {busy ? 'Importing…' : `Import ${count === 1 ? '1 entry' : `${count} entries`}`}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
