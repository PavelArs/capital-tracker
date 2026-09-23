import type { Instrument } from '@api/accounting.api';
import {
  type JournalOrigin,
  type JournalState,
  type TradeCommand,
  type TradeReceipt,
  type TradeVersion,
  type VoidCommand,
  tradesApi,
} from '@api/trades.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type TradeDraft, TradeForm, emptyTradeDraft } from './TradeForm';
import { TradeResults } from './TradeResults';
import { accountingError, newRequestId } from './feedback';
import './TradeJournal.css';

type Operation =
  | { kind: 'initialize'; input: { requestId: string; coverageFrom: string; assertEmpty: true } }
  | { kind: 'create'; input: TradeCommand }
  | { kind: 'correct'; tradeId: string; input: TradeCommand }
  | { kind: 'void'; tradeId: string; input: VoidCommand };
type Retry = { signature: string; operation: Operation };
function errorMessage(error: unknown) {
  if (isAxiosError(error) && error.response?.status === 409)
    return 'Операция не согласуется с журналом. Проверьте актуальную ревизию, границу покрытия, порядок сделок, доступное количество на дату продажи и лимиты. Черновик сохранён.';
  return accountingError(error, 'сохранить журнал');
}

export function TradeJournal({
  accountId,
  instruments,
  openingBusy,
  onEligibility,
}: {
  accountId: string;
  instruments: Instrument[];
  openingBusy: boolean;
  onEligibility: (hasJournal: boolean | null) => void;
}) {
  const [state, setState] = useState<JournalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [coverage, setCoverage] = useState(() => new Date().toISOString());
  const [assertEmpty, setAssertEmpty] = useState(false);
  const [draft, setDraft] = useState<TradeDraft>(emptyTradeDraft);
  const [target, setTarget] = useState<TradeVersion | null>(null);
  const [mode, setMode] = useState<'create' | 'correct' | 'void'>('create');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TradeReceipt | JournalOrigin | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<TradeVersion | null>(null);
  const [hideResults, setHideResults] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const retry = useRef<Retry | null>(null);
  const active = useRef(false);
  const writeLock = useRef(false);
  const sequence = useRef(0);
  const eligibilityRef = useRef(onEligibility);
  eligibilityRef.current = onEligibility;

  const load = useCallback(
    async (reviewTradeId?: string) => {
      const request = ++sequence.current;
      setLoading(true);
      setReviewReady(false);
      eligibilityRef.current(null);
      try {
        const next = await tradesApi.state(accountId);
        const latestTarget = reviewTradeId
          ? ((await tradesApi.versions(accountId, reviewTradeId)).items[0] ?? null)
          : null;
        if (!active.current || request !== sequence.current) return false;
        if (
          latestTarget &&
          (!next.journal || latestTarget.journalRevision > next.journal.journalRevision)
        ) {
          throw new Error('Journal changed during target review');
        }
        setState(next);
        setReviewTarget(latestTarget);
        setReviewReady(true);
        setHideResults(false);
        setEpoch((current) => current + 1);
        eligibilityRef.current(next.journal !== null);
        return true;
      } catch (error) {
        if (active.current && request === sequence.current) {
          setError(accountingError(error, 'загрузить актуальный журнал'));
          eligibilityRef.current(null);
        }
        return false;
      } finally {
        if (active.current && request === sequence.current) setLoading(false);
      }
    },
    [accountId],
  );

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      sequence.current++;
    };
  }, [load]);

  function edit(next: TradeDraft) {
    retry.current = null;
    setDraft(next);
    setError(null);
  }
  function select(trade: TradeVersion, kind: 'correct' | 'void') {
    retry.current = null;
    setTarget(trade);
    setMode(kind);
    setError(null);
    setDraft({
      instrumentId: trade.instrumentId,
      side: trade.side,
      occurredAt: trade.occurredAt,
      orderWithinTimestamp: String(trade.orderWithinTimestamp),
      quantity: trade.quantity,
      grossUsd: trade.grossUsd,
      feeUsd: trade.feeUsd,
    });
    setReviewTarget(null);
    if (needsReview) {
      setReviewed(false);
      setReviewReady(false);
    }
  }
  function cancel() {
    retry.current = null;
    setMode('create');
    setTarget(null);
    setDraft(emptyTradeDraft());
    setReviewTarget(null);
    if (needsReview) {
      setReviewed(false);
      setReviewReady(false);
    }
  }
  function stale() {
    setHideResults(true);
    setEpoch((current) => current + 1);
    setNeedsReview(true);
    setReviewed(false);
    setReviewReady(false);
    setError(
      'Журнал изменился во время чтения. Обновите журнал, чтобы не смешивать результаты разных ревизий.',
    );
  }
  async function refresh() {
    if (writing || writeLock.current) return;
    setError(null);
    setReviewed(false);
    await load(target?.tradeId);
  }

  async function send(operation: Operation) {
    if (writeLock.current || openingBusy) return;
    writeLock.current = true;
    setWriting(true);
    setError(null);
    eligibilityRef.current(null);
    try {
      let accepted: TradeReceipt | JournalOrigin;
      if (operation.kind === 'initialize')
        accepted = await tradesApi.initialize(accountId, operation.input);
      else if (operation.kind === 'create')
        accepted = await tradesApi.create(accountId, operation.input);
      else if (operation.kind === 'correct')
        accepted = await tradesApi.correct(accountId, operation.tradeId, operation.input);
      else accepted = await tradesApi.void(accountId, operation.tradeId, operation.input);
      if (!active.current) return;
      sequence.current++;
      retry.current = null;
      setReceipt(accepted);
      setHideResults(true);
      setEpoch((current) => current + 1);
      // A known successful command is not an unsaved draft, even if its refresh fails.
      setTarget(null);
      setMode('create');
      setDraft(emptyTradeDraft());
      setReviewTarget(null);
      setNeedsReview(true);
      setReviewed(false);
      setReviewReady(false);
      if (await load()) {
        if (!active.current) return;
        setNeedsReview(false);
      } else if (active.current) {
        setError(
          'Запрос сохранён, квитанция показана ниже. Не удалось загрузить текущий журнал. Обновите и проверьте его перед новой записью.',
        );
      }
    } catch (error) {
      if (!active.current) return;
      setError(errorMessage(error));
      if (isAxiosError(error) && error.response?.status === 409) {
        setNeedsReview(true);
        setReviewed(false);
        setReviewReady(false);
        setHideResults(true);
        await load(
          operation.kind === 'correct' || operation.kind === 'void' ? operation.tradeId : undefined,
        );
      } else {
        eligibilityRef.current(state ? state.journal !== null : null);
      }
    } finally {
      writeLock.current = false;
      if (active.current) setWriting(false);
    }
  }

  function initialize(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assertEmpty || !state?.eligible || disabled) return;
    const signature = JSON.stringify({
      kind: 'initialize',
      coverageFrom: coverage,
      assertEmpty: true,
    });
    if (retry.current?.signature !== signature)
      retry.current = {
        signature,
        operation: {
          kind: 'initialize',
          input: { requestId: newRequestId(), coverageFrom: coverage, assertEmpty: true },
        },
      };
    void send(retry.current.operation);
  }
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state?.journal || disabled) return;
    if (
      !/^(0|[1-9][0-9]*)$/.test(draft.orderWithinTimestamp) ||
      Number(draft.orderWithinTimestamp) > 2147483647
    ) {
      setError('Порядок должен быть целым числом от 0 до 2147483647.');
      return;
    }
    if (mode !== 'create' && !target) return;
    const signature = JSON.stringify({ kind: mode, tradeId: target?.tradeId, draft });
    if (retry.current?.signature !== signature) {
      const identity = {
        requestId: newRequestId(),
        expectedJournalRevision: state.journal.journalRevision,
      };
      const input: TradeCommand = {
        ...draft,
        orderWithinTimestamp: Number(draft.orderWithinTimestamp),
        ...identity,
      };
      retry.current = {
        signature,
        operation:
          mode === 'void'
            ? { kind: 'void', tradeId: target!.tradeId, input: identity }
            : mode === 'correct'
              ? { kind: 'correct', tradeId: target!.tradeId, input }
              : { kind: 'create', input },
      };
    }
    void send(retry.current.operation);
  }
  const targetUnavailable =
    needsReview && target !== null && (!reviewTarget || reviewTarget.kind === 'void');
  const disabled =
    writing ||
    openingBusy ||
    loading ||
    !state ||
    (needsReview && (!reviewed || !reviewReady || targetUnavailable));
  const journal = state?.journal;
  return (
    <section className="manual-card trade-journal" aria-labelledby="trade-journal-heading">
      <h2 id="trade-journal-heading">Журнал сделок в USD</h2>
      <p className="manual-muted">
        Журнал доступен только при явно подтверждённом пустом начале, без истории начальных позиций.
        Он не восстанавливает покупки из текущего баланса.
      </p>
      {loading && <p role="status">Загрузка журнала…</p>}
      {error && (
        <p role="alert" className="manual-feedback manual-feedback--error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="manual-button manual-button--secondary"
        disabled={writing || openingBusy || loading}
        onClick={() => void refresh()}
      >
        Обновить журнал
      </button>
      {receipt && (
        <p role="status" className="manual-feedback manual-feedback--success">
          {'trade' in receipt ? (
            <>
              Сохранена квитанция: сделка {receipt.trade.tradeId}, версия {receipt.trade.version},
              ревизия журнала {receipt.journalRevision}.
            </>
          ) : (
            <>Журнал открыт с {receipt.coverageFrom}.</>
          )}{' '}
          Квитанция не заменяет актуальное состояние.
        </p>
      )}
      {needsReview && (
        <section className="manual-conflict" aria-labelledby="trade-conflict-heading">
          <h3 id="trade-conflict-heading">Журнал изменился</h3>
          <p>
            Черновик не отправляется автоматически. Обновите журнал и проверьте текущую ревизию
            перед сохранением.
          </p>
          {journal && <p>Актуальная ревизия журнала: {journal.journalRevision}</p>}
          {reviewTarget && (
            <p>
              Текущая версия выбранной сделки: {reviewTarget.version};{' '}
              {reviewTarget.kind === 'void'
                ? 'аннулирована'
                : reviewTarget.side === 'buy'
                  ? 'покупка'
                  : 'продажа'}
              ; {reviewTarget.quantity}; валовая сумма {reviewTarget.grossUsd} USD; комиссия{' '}
              {reviewTarget.feeUsd} USD; {reviewTarget.occurredAt}, порядок{' '}
              {reviewTarget.orderWithinTimestamp}.
            </p>
          )}
          {targetUnavailable && (
            <p role="alert">
              Выбранная сделка недоступна для изменения. Отмените исправление или аннулирование;
              новая сделка не создаётся автоматически.
            </p>
          )}
          <label className="manual-review-check">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={!reviewReady || loading || writing || targetUnavailable}
              onChange={(event) => {
                setReviewed(event.target.checked);
                if (event.target.checked) retry.current = null;
              }}
            />
            Я проверил актуальную версию журнала и хочу сохранить черновик.
          </label>
        </section>
      )}
      {state &&
        !journal &&
        (state.eligible ? (
          <form onSubmit={initialize} className="manual-form">
            <fieldset disabled={disabled}>
              <legend>Явное пустое начало</legend>
              <label className="manual-field">
                Дата начала журнала (UTC)
                <input
                  type="text"
                  value={coverage}
                  required
                  onChange={(event) => {
                    retry.current = null;
                    setCoverage(event.target.value);
                  }}
                />
              </label>
              <label className="manual-review-check">
                <input
                  type="checkbox"
                  checked={assertEmpty}
                  onChange={(event) => {
                    retry.current = null;
                    setAssertEmpty(event.target.checked);
                  }}
                />
                Позиции были пустыми
              </label>
              <p>
                Подтверждаю пустые позиции в указанный момент и буду записывать все последующие
                относящиеся к журналу сделки.
              </p>
              <button type="submit" className="manual-button" disabled={!assertEmpty}>
                Открыть журнал
              </button>
            </fieldset>
          </form>
        ) : (
          <p>
            У счёта есть история начальных позиций. Перенос таких остатков в FIFO пока не
            поддерживается: общая себестоимость не определяет порядок покупок. Существующие позиции
            сохранены.
          </p>
        ))}
      {journal && (
        <>
          <p>
            Ревизия журнала: {journal.journalRevision}. Граница покрытия UTC: {journal.coverageFrom}
            .
          </p>
          <p className="manual-muted">
            Активных сделок: {journal.activeTradeCount} / {journal.limits.activeTrades},
            неизменяемых версий: {journal.versionCount} / {journal.limits.versions}. Распределение
            себестоимости: 30 десятичных знаков, остаток получает последняя часть лота. Это учётные
            результаты журнала, не рыночная стоимость, не доходность портфеля и не налоговый отчёт.
          </p>
          {mode === 'void' && target ? (
            <form onSubmit={save}>
              <p>
                Аннулировать сделку {target.tradeId}, версия {target.version}? История будет
                пересчитана полностью; операция невозможна, если появится неподдержанная продажа.
              </p>
              <button type="submit" className="manual-button" disabled={disabled}>
                Подтвердить аннулирование
              </button>
              <button
                type="button"
                className="manual-button manual-button--secondary"
                disabled={writing || loading}
                onClick={cancel}
              >
                Отменить аннулирование
              </button>
            </form>
          ) : (
            <TradeForm
              draft={draft}
              onChange={edit}
              onSubmit={save}
              instruments={instruments}
              selected={target}
              disabled={disabled}
              correction={mode === 'correct'}
              onCancel={cancel}
              cancelDisabled={writing || loading}
            />
          )}
          {!hideResults && !loading && (
            <TradeResults
              key={`${accountId}:${journal.journalRevision}:${epoch}`}
              accountId={accountId}
              journal={journal}
              disabled={writing || openingBusy || (needsReview && !reviewed)}
              onCorrect={(trade) => select(trade, 'correct')}
              onVoid={(trade) => select(trade, 'void')}
              onStale={stale}
            />
          )}
        </>
      )}
    </section>
  );
}
