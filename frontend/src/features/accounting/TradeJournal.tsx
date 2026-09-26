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
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AccountOperations, type OperationWorkflow } from './AccountOperations';
import { type AccountSection, AccountWorkspace } from './AccountWorkspace';
import { AssetRewards } from './AssetRewards';
import { AssetSwaps } from './AssetSwaps';
import { CarryIn } from './CarryIn';
import { CsvImports } from './CsvImports';
import { HistoricalAccounting } from './HistoricalAccounting';
import { HistoricalValuation } from './HistoricalValuation';
import { type TradeDraft, TradeForm, emptyTradeDraft } from './TradeForm';
import { TradeResults } from './TradeResults';
import { ValuationHistory } from './ValuationHistory';
import { accountingError, newRequestId } from './feedback';
import './TradeJournal.css';

type Operation =
  | { kind: 'initialize'; input: { requestId: string; coverageFrom: string; assertEmpty: true } }
  | { kind: 'create'; input: TradeCommand }
  | { kind: 'correct'; tradeId: string; input: TradeCommand }
  | { kind: 'void'; tradeId: string; input: VoidCommand };
type Retry = { signature: string; operation: Operation; ambiguous: boolean };
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
  section,
  onSectionChange,
  openingDetails,
}: {
  accountId: string;
  instruments: Instrument[];
  openingBusy: boolean;
  onEligibility: (hasJournal: boolean | null) => void;
  section: AccountSection;
  onSectionChange: (section: AccountSection) => void;
  openingDetails: ReactNode;
}) {
  const [workflow, setWorkflow] = useState<OperationWorkflow>('trades');
  const [state, setState] = useState<JournalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [csvBlocked, setCsvBlocked] = useState(false);
  const csvLock = useRef(false);
  const [carryInBlocked, setCarryInBlocked] = useState(false);
  const carryInLock = useRef(false);
  const knownJournal = useRef<boolean | null>(null);
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
    async (reviewTradeId?: string, selectedVersion?: number) => {
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
        if (
          latestTarget &&
          selectedVersion !== undefined &&
          latestTarget.version !== selectedVersion
        ) {
          setNeedsReview(true);
          setReviewed(false);
        }
        setState(next);
        setReviewTarget(latestTarget);
        setReviewReady(true);
        setHideResults(false);
        setEpoch((current) => current + 1);
        knownJournal.current = next.journal !== null;
        eligibilityRef.current(carryInLock.current ? null : knownJournal.current);
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

  const csvSelection = useRef({ target, load });
  csvSelection.current = { target, load };
  const blockForCsv = useCallback((blocked: boolean) => {
    csvLock.current = blocked;
    setCsvBlocked(blocked);
  }, []);
  const blockForCarryIn = useCallback((blocked: boolean) => {
    if (carryInLock.current === blocked) return;
    carryInLock.current = blocked;
    setCarryInBlocked(blocked);
    const uncertainOrigin =
      retry.current?.ambiguous && retry.current.operation.kind === 'initialize';
    eligibilityRef.current(
      blocked || writeLock.current || uncertainOrigin ? null : knownJournal.current,
    );
  }, []);
  const refreshAfterExternalWrite = useCallback(async () => {
    setHideResults(true);
    setReviewed(false);
    setReviewReady(false);
    const selected = csvSelection.current;
    const loaded = await selected.load(selected.target?.tradeId, selected.target?.version);
    // Preserve any existing review requirement and the original selected version.
    if (!loaded) setNeedsReview(true);
    return loaded;
  }, []);

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      sequence.current++;
    };
  }, [load]);

  function edit(next: TradeDraft) {
    if (retry.current?.ambiguous || writeLock.current || csvLock.current || carryInLock.current)
      return;
    retry.current = null;
    setDraft(next);
    setError(null);
  }
  function select(trade: TradeVersion, kind: 'correct' | 'void') {
    if (retry.current?.ambiguous || writeLock.current || csvLock.current || carryInLock.current)
      return;
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
    if (retry.current?.ambiguous || writeLock.current || csvLock.current || carryInLock.current)
      return;
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
    if (writing || writeLock.current || csvLock.current) return;
    setError(null);
    setReviewed(false);
    await load(target?.tradeId, target?.version);
  }

  async function send(operation: Operation) {
    if (writeLock.current || openingBusy || csvLock.current || carryInLock.current) return;
    const previouslyAmbiguous = retry.current?.ambiguous === true;
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
      const status = isAxiosError(error) ? error.response?.status : undefined;
      // Only this exact POST's application 409 resolves a prior unknown outcome:
      // current guards emit 401/403/429, and the service checks the saved receipt
      // before mutable conflicts. Parser/proxy 400 or visibility 404 do not prove
      // whether the earlier attempt committed. Journal reads are handled by load;
      // the client's current CSRF preflight has no 409 outcome.
      const refused = status !== undefined && status >= 400 && status < 500;
      const ambiguousResult = previouslyAmbiguous ? status !== 409 : !refused;
      if (retry.current) retry.current.ambiguous = ambiguousResult;
      setError(errorMessage(error));
      if (isAxiosError(error) && error.response?.status === 409) {
        setNeedsReview(true);
        setReviewed(false);
        setReviewReady(false);
        setHideResults(true);
        await load(
          operation.kind === 'correct' || operation.kind === 'void' ? operation.tradeId : undefined,
          target?.version,
        );
      } else {
        eligibilityRef.current(
          ambiguousResult && operation.kind === 'initialize'
            ? null
            : state
              ? state.journal !== null
              : null,
        );
      }
    } finally {
      writeLock.current = false;
      if (active.current) setWriting(false);
    }
  }

  function initialize(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assertEmpty || !state?.eligible || disabled) return;
    if (retry.current?.ambiguous) {
      void send(retry.current.operation);
      return;
    }
    const signature = JSON.stringify({
      kind: 'initialize',
      coverageFrom: coverage,
      assertEmpty: true,
    });
    if (retry.current?.signature !== signature)
      retry.current = {
        signature,
        ambiguous: false,
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
    if (retry.current?.ambiguous) {
      void send(retry.current.operation);
      return;
    }
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
        ambiguous: false,
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
  const ambiguous = retry.current?.ambiguous === true;
  const targetUnavailable =
    needsReview && target !== null && (!reviewTarget || reviewTarget.kind === 'void');
  const manualDisabled =
    writing ||
    openingBusy ||
    loading ||
    !state ||
    (needsReview && (!reviewed || !reviewReady || targetUnavailable));
  const disabled = manualDisabled || csvBlocked || carryInBlocked;
  const journal = state?.journal;
  return (
    <section className="manual-card trade-journal" aria-labelledby="trade-journal-heading">
      <header className="trade-journal__header">
        <h2 id="trade-journal-heading">Журнал сделок в USD</h2>
        <button
          type="button"
          className="manual-button manual-button--secondary"
          disabled={writing || openingBusy || loading || csvBlocked}
          onClick={() => void refresh()}
        >
          Обновить журнал
        </button>
      </header>

      {loading && <p role="status">Загрузка журнала…</p>}
      {error && (
        <p role="alert" className="manual-feedback manual-feedback--error">
          {error}
        </p>
      )}

      {ambiguous && (
        <div className="manual-coverage-warning">
          <p>
            Результат исходного запроса неизвестен. Пока он не разрешён, черновик и цель изменения
            заблокированы. Обновление и подтверждение просмотра не меняют исходный запрос.
          </p>
          <button
            type="button"
            className="manual-button"
            disabled={writing || openingBusy || loading || csvBlocked || carryInBlocked}
            onClick={() => {
              if (retry.current?.ambiguous) void send(retry.current.operation);
            }}
          >
            Повторить исходный запрос
          </button>
        </div>
      )}
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
              ; инструмент {reviewTarget.instrumentName}
              {reviewTarget.instrumentSymbol ? ` (${reviewTarget.instrumentSymbol})` : ''}, UUID{' '}
              {reviewTarget.instrumentId}; количество {reviewTarget.quantity}; валовая сумма{' '}
              {reviewTarget.grossUsd} USD; комиссия {reviewTarget.feeUsd} USD;{' '}
              {reviewTarget.occurredAt}, порядок {reviewTarget.orderWithinTimestamp}.
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
              disabled={
                !reviewReady ||
                loading ||
                writing ||
                targetUnavailable ||
                csvBlocked ||
                carryInBlocked
              }
              onChange={(event) => {
                setReviewed(event.target.checked);
                if (event.target.checked && !retry.current?.ambiguous) retry.current = null;
              }}
            />
            Я проверил актуальную версию журнала и хочу сохранить черновик.
          </label>
        </section>
      )}
      <AccountWorkspace
        section={section}
        onSelect={onSectionChange}
        operations={
          <>
            <p className="manual-muted">
              Журнал требует явно подтверждённого пустого начала либо проверенных начальных лотов.
              Общий баланс не восстанавливает историю покупок автоматически.
            </p>
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
                        disabled={ambiguous}
                        required
                        onChange={(event) => {
                          if (retry.current?.ambiguous) return;
                          retry.current = null;
                          setCoverage(event.target.value);
                        }}
                      />
                    </label>
                    <label className="manual-review-check">
                      <input
                        type="checkbox"
                        checked={assertEmpty}
                        disabled={ambiguous}
                        onChange={(event) => {
                          if (retry.current?.ambiguous) return;
                          retry.current = null;
                          setAssertEmpty(event.target.checked);
                        }}
                      />
                      Позиции были пустыми
                    </label>
                    <p>
                      Подтверждаю пустые позиции в указанный момент и буду записывать все
                      последующие относящиеся к журналу сделки.
                    </p>
                    <button type="submit" className="manual-button" disabled={!assertEmpty}>
                      Открыть журнал
                    </button>
                  </fieldset>
                </form>
              ) : (
                <p>
                  У счёта есть история начальных позиций. Для открытия журнала требуется отдельно
                  проверить исходные лоты с известной себестоимостью. Существующие позиции
                  сохранены.
                </p>
              ))}
            {journal && (
              <>
                <p>
                  Ревизия журнала: {journal.journalRevision}. Граница покрытия UTC:{' '}
                  {journal.coverageFrom}.
                </p>
                <p className="manual-muted">
                  Активных сделок: {journal.activeTradeCount} / {journal.limits.activeTrades},
                  неизменяемых версий: {journal.versionCount} / {journal.limits.versions}.
                  Распределение себестоимости: 30 десятичных знаков, остаток получает последняя
                  часть лота. Это учётные результаты журнала, не рыночная стоимость, не доходность
                  портфеля и не налоговый отчёт.
                </p>
                <AccountOperations
                  selected={workflow}
                  onSelect={setWorkflow}
                  trades={
                    mode === 'void' && target ? (
                      <form onSubmit={save}>
                        <p>
                          Аннулировать сделку {target.tradeId}, версия {target.version}? История
                          будет пересчитана полностью; операция невозможна, если появится
                          неподдержанная продажа.
                        </p>
                        <button type="submit" className="manual-button" disabled={disabled}>
                          Подтвердить аннулирование
                        </button>
                        <button
                          type="button"
                          className="manual-button manual-button--secondary"
                          disabled={writing || loading || ambiguous || csvBlocked || carryInBlocked}
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
                        disabled={
                          disabled || (ambiguous && retry.current?.operation.kind === 'initialize')
                        }
                        lockDraft={ambiguous}
                        correction={mode === 'correct'}
                        onCancel={cancel}
                        cancelDisabled={
                          writing || loading || ambiguous || csvBlocked || carryInBlocked
                        }
                      />
                    )
                  }
                  swaps={
                    <AssetSwaps
                      accountId={accountId}
                      journalRevision={journal.journalRevision}
                      onChanged={() => void refreshAfterExternalWrite()}
                    />
                  }
                  rewards={
                    <AssetRewards
                      accountId={accountId}
                      journalRevision={journal.journalRevision}
                      onChanged={() => void refreshAfterExternalWrite()}
                    />
                  }
                  imports={
                    <CsvImports
                      key={accountId}
                      accountId={accountId}
                      journalRevision={journal.journalRevision}
                      instruments={instruments}
                      parentBusy={writing || openingBusy || ambiguous || carryInBlocked}
                      parentBlocked={manualDisabled || ambiguous || carryInBlocked}
                      onBlocked={blockForCsv}
                      onJournalRefresh={refreshAfterExternalWrite}
                    />
                  }
                />
                {!hideResults && !loading && (
                  <TradeResults
                    key={`${accountId}:${journal.journalRevision}:${epoch}`}
                    accountId={accountId}
                    journal={journal}
                    disabled={writing || openingBusy || (needsReview && !reviewed)}
                    mutationDisabled={ambiguous || csvBlocked || carryInBlocked}
                    onCorrect={(trade) => {
                      select(trade, 'correct');
                      setWorkflow('trades');
                    }}
                    onVoid={(trade) => {
                      select(trade, 'void');
                      setWorkflow('trades');
                    }}
                    onStale={stale}
                  />
                )}
              </>
            )}
          </>
        }
        analytics={
          <>
            <HistoricalAccounting
              accountId={accountId}
              journalRevision={journal?.journalRevision ?? null}
            />
            <HistoricalValuation
              accountId={accountId}
              journalRevision={journal?.journalRevision ?? null}
            />
            <ValuationHistory
              accountId={accountId}
              journalRevision={journal?.journalRevision ?? null}
            />
          </>
        }
        setup={
          <>
            <CarryIn
              key={accountId}
              accountId={accountId}
              hasJournal={state ? state.journal !== null : null}
              parentBusy={writing || openingBusy || ambiguous || csvBlocked}
              parentBlocked={manualDisabled || ambiguous || csvBlocked}
              onBlocked={blockForCarryIn}
              onJournalRefresh={refreshAfterExternalWrite}
            />
            {openingDetails}
          </>
        }
      />
    </section>
  );
}
