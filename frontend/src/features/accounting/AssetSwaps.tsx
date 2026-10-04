import { accountingApi, type Instrument } from '@api/accounting.api';
import {
  assetSwapsApi,
  type SwapPage,
  type SwapReceipt,
  type SwapVersion,
  type SwapVersions,
} from '@api/asset-swaps.api';
import { tradesApi } from '@api/trades.api';
import { useAuth } from '@contexts/AuthContext';
import { isAxiosError } from 'axios';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AssetSwapAllocation } from './AssetSwapAllocation';
import { AssetSwapFields, AssetSwapReview, savedSwapName } from './AssetSwapEvidence';
import { AssetSwapForm } from './AssetSwapForm';
import { accountingError } from './feedback';
import {
  draftFromSwap,
  emptySwapDraft,
  normalizeSwapDraft,
  type ReviewedSwapCommand,
  type SwapDraft,
  type SwapMode,
  type SwapReview,
  swapCommandFor,
} from './swap-draft';
import './TradeJournal.css';
import '@pages/ManualAccounts.css';

type Recovery =
  | {
      phase: 'sending' | 'unknown';
      command: ReviewedSwapCommand;
      draft: SwapDraft;
      target: SwapVersion | null;
    }
  | {
      phase: 'accepted';
      command: ReviewedSwapCommand;
      draft: SwapDraft;
      target: SwapVersion | null;
      receipt: SwapReceipt;
    };

type ReadState = 'loading' | 'ready' | 'error';

const recoveries = new Map<string, Recovery>();
const recoveryListeners = new Set<() => void>();
const recoveryKey = (ownerId: string, accountId: string) => `${ownerId}:${accountId}`;
function retainRecovery(key: string, recovery: Recovery | null) {
  if (recovery) recoveries.set(key, recovery);
  else recoveries.delete(key);
  for (const listener of recoveryListeners) listener();
}
function subscribeRecovery(listener: () => void) {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}
function recoverySnapshot(key: string) {
  return recoveries.get(key) ?? null;
}
function sendCommand(accountId: string, command: ReviewedSwapCommand): Promise<SwapReceipt> {
  if (command.kind === 'create') return assetSwapsApi.create(accountId, command.body);
  if (command.kind === 'correct')
    return assetSwapsApi.correct(accountId, command.swapId, command.body);
  return assetSwapsApi.void(accountId, command.swapId, command.body);
}

async function allInstruments(): Promise<Instrument[]> {
  const found = new Map<string, Instrument>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let index = 0; index < 200; index++) {
    const page = await accountingApi.listInstruments(cursor);
    for (const item of page.items) found.set(item.id, item);
    if (!page.nextCursor) return [...found.values()];
    if (seen.has(page.nextCursor)) throw new Error('Повторился курсор списка активов.');
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error('Список активов слишком велик для этой формы.');
}

function AssetSwapsOwner({
  accountId,
  ownerId,
  journalRevision,
  onChanged,
}: {
  accountId: string;
  ownerId: string;
  journalRevision: number;
  onChanged: () => void;
}) {
  const key = recoveryKey(ownerId, accountId);
  const recovery = useSyncExternalStore(
    subscribeRecovery,
    () => recoverySnapshot(key),
    () => recoverySnapshot(key),
  );
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [catalogRead, setCatalogRead] = useState<ReadState>('loading');
  const [catalogError, setCatalogError] = useState('');
  const [page, setPage] = useState<SwapPage | null>(null);
  const [listRead, setListRead] = useState<ReadState>('loading');
  const [listError, setListError] = useState('');
  const [mode, setMode] = useState<SwapMode>(() => recoverySnapshot(key)?.command.kind ?? 'create');
  const [draft, setDraft] = useState<SwapDraft>(
    () => recoverySnapshot(key)?.draft ?? emptySwapDraft(),
  );
  const [target, setTarget] = useState<SwapVersion | null>(
    () => recoverySnapshot(key)?.target ?? null,
  );
  const [review, setReview] = useState<SwapReview | null>(null);
  const [reviewRead, setReviewRead] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [reviewError, setReviewError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [writing, setWriting] = useState(false);
  const [receipt, setReceipt] = useState<SwapReceipt | null>(() => {
    const saved = recoverySnapshot(key);
    return saved?.phase === 'accepted' ? saved.receipt : null;
  });
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<SwapVersions | null>(null);
  const [historyRead, setHistoryRead] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [historyError, setHistoryError] = useState('');
  const live = useRef(false);
  const writeLock = useRef(false);
  const listGeneration = useRef(0);
  const reviewGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const parentRevision = useRef(journalRevision);
  const callbacks = useRef({ onChanged });
  callbacks.current = { onChanged };

  const sectionHeading = useRef<HTMLHeadingElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const editorAction = useRef<HTMLButtonElement | null>(null);
  const historyAction = useRef<HTMLButtonElement | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    kind: 'editor' | 'history' | 'return-editor' | 'return-history';
    sequence: number;
  }>({ kind: 'editor', sequence: 0 });

  useLayoutEffect(() => {
    if (focusRequest.sequence === 0) return;
    if (focusRequest.kind === 'editor' || focusRequest.kind === 'history') {
      const destination = focusRequest.kind === 'editor' ? editor.current : historyHeading.current;
      destination?.focus({ preventScroll: true });
      destination?.scrollIntoView({ block: 'start' });
      return;
    }
    const origin = focusRequest.kind === 'return-editor' ? editorAction : historyAction;
    const destination = origin.current;
    // The originating history button becomes enabled in this commit after closing.
    if (destination?.isConnected && !destination.disabled) destination.focus();
    else sectionHeading.current?.focus();
    origin.current = null;
  }, [focusRequest]);

  const clearHistory = useCallback(() => {
    historyGeneration.current++;
    setHistoryId(null);
    setHistory(null);
    setHistoryRead('idle');
    setHistoryError('');
  }, []);

  const loadList = useCallback(
    async (releaseAccepted = false) => {
      const generation = ++listGeneration.current;
      reviewGeneration.current++;
      setReview(null);
      setReviewRead('idle');
      setListRead('loading');
      setListError('');
      try {
        const state = await tradesApi.state(accountId);
        if (!state.journal) throw new Error('Сначала начните журнал этого счёта.');
        const result = await assetSwapsApi.list(accountId, state.journal.journalRevision);
        if (!live.current || generation !== listGeneration.current) return false;
        if (result.journalRevision !== state.journal.journalRevision)
          throw new Error('Ревизия журнала изменилась во время чтения. Обновите список.');
        setPage(result);
        setListRead('ready');
        clearHistory();
        if (releaseAccepted) {
          const pending = recoverySnapshot(key);
          if (
            pending?.phase === 'accepted' &&
            result.journalRevision >= pending.receipt.journalRevision
          ) {
            retainRecovery(key, null);
            setReceipt(pending.receipt);
            setMode('create');
            setTarget(null);
            setDraft(emptySwapDraft());
            setReview(null);
            setReviewRead('idle');
            setWriteError('');
            callbacks.current.onChanged();
          } else if (pending?.phase === 'accepted') {
            setListError(
              'Команда принята, но её ревизия ещё не видна. Повторите обновление списка.',
            );
          }
        }
        return true;
      } catch (error) {
        if (!live.current || generation !== listGeneration.current) return false;
        setListRead('error');
        setListError(
          error instanceof Error && !isAxiosError(error)
            ? error.message
            : accountingError(error, 'загрузить обмены'),
        );
        if (isAxiosError(error) && error.response?.status === 409) {
          setPage(null);
          reviewGeneration.current++;
          setReview(null);
          setReviewRead('idle');
          clearHistory();
        }
        return false;
      }
    },
    [accountId, clearHistory, key],
  );

  useEffect(() => {
    live.current = true;
    const catalogRequest = allInstruments();
    void catalogRequest
      .then((items) => {
        if (live.current) {
          setInstruments(items);
          setCatalogRead('ready');
        }
      })
      .catch((error: unknown) => {
        if (!live.current) return;
        setCatalogError(
          error instanceof Error ? error.message : accountingError(error, 'загрузить активы'),
        );
        setCatalogRead('error');
      });
    void loadList(true);
    return () => {
      live.current = false;
      listGeneration.current++;
      reviewGeneration.current++;
      historyGeneration.current++;
    };
  }, [loadList]);

  useEffect(() => {
    if (parentRevision.current === journalRevision) return;
    parentRevision.current = journalRevision;
    reviewGeneration.current++;
    setReview(null);
    setReviewRead('idle');
    setReviewError('Ревизия журнала изменилась. Обновите данные и проверьте команду снова.');
    void loadList(true);
  }, [journalRevision, loadList]);

  function edit(next: SwapDraft) {
    if (recoverySnapshot(key) || writeLock.current) return;
    const inputChange = Object.keys(next).some(
      (field) => next[field as keyof SwapDraft] !== draft[field as keyof SwapDraft],
    );
    setDraft(next);
    setWriteError('');
    if (inputChange) {
      reviewGeneration.current++;
      setReview(null);
      setReviewRead('idle');
      setReviewError('');
      clearHistory();
    }
  }

  async function check(requestedMode: SwapMode, selected: SwapVersion | null) {
    if (recoverySnapshot(key) || writeLock.current || listRead !== 'ready' || !page) return;
    if (requestedMode !== 'void' && !draft.assertExecuted) {
      setReviewRead('error');
      setReviewError('Подтвердите, что запись описывает уже выполненный обмен.');
      return;
    }
    const generation = ++reviewGeneration.current;
    setReview(null);
    setReviewRead('loading');
    setReviewError('');
    try {
      const reviewedDraft = requestedMode === 'void' ? draft : normalizeSwapDraft(draft);
      const state = await tradesApi.state(accountId);
      if (!state.journal) throw new Error('Сначала начните журнал этого счёта.');
      if (state.journal.journalRevision !== page?.journalRevision)
        throw new Error('Журнал изменился. Обновите обмены перед проверкой.');
      let latest: SwapVersion | null = null;
      if (selected) {
        latest = (await assetSwapsApi.versions(accountId, selected.swapId)).items[0] ?? null;
        if (!latest || latest.kind === 'void')
          throw new Error('Запись отсутствует или уже отменена. Обновите список.');
        if (latest.version !== selected.version)
          throw new Error('Версия изменилась. Обновите список и начните исправление заново.');
      }
      if (!live.current || generation !== reviewGeneration.current) return;
      if (latest) setTarget(latest);
      const acceptedReview = {
        journalRevision: state.journal.journalRevision,
        version: latest?.version ?? null,
        draft: reviewedDraft,
      };
      setReview(acceptedReview);
      setReviewRead('ready');
    } catch (error) {
      if (!live.current || generation !== reviewGeneration.current) return;
      setReviewRead('error');
      setReviewError(
        error instanceof Error && !isAxiosError(error)
          ? error.message
          : accountingError(error, 'проверить журнал'),
      );
    }
  }

  async function send(command: ReviewedSwapCommand, retry = false) {
    const existing = recoverySnapshot(key);
    if (
      writeLock.current ||
      (retry && (existing?.phase !== 'unknown' || existing.command !== command)) ||
      (!retry && existing)
    )
      return;
    const frozenDraft =
      retry && existing
        ? existing.draft
        : command.kind === 'void'
          ? draft
          : { ...draftFromSwap(command.body), assertExecuted: true };
    const frozenTarget = retry && existing ? existing.target : target;
    writeLock.current = true;
    setWriting(true);
    setWriteError('');
    retainRecovery(key, {
      phase: 'sending',
      command,
      draft: frozenDraft,
      target: frozenTarget,
    });
    try {
      const saved = await sendCommand(accountId, command);
      retainRecovery(key, {
        phase: 'accepted',
        command,
        draft: frozenDraft,
        target: frozenTarget,
        receipt: saved,
      });
      if (!live.current) return;
      setReceipt(saved);
      setReview(null);
      await loadList(true);
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      const definitive = !retry && [400, 403, 404, 409].includes(status ?? 0);
      retainRecovery(
        key,
        definitive ? null : { phase: 'unknown', command, draft: frozenDraft, target: frozenTarget },
      );
      if (!live.current) return;
      setReview(null);
      setWriteError(
        definitive
          ? `${accountingError(error, 'сохранить запись')} Обновите состояние и проверьте команду снова.`
          : 'Исход запроса неизвестен. Новые записи заблокированы; разрешён только точный повтор исходного запроса.',
      );
    } finally {
      writeLock.current = false;
      if (live.current) setWriting(false);
    }
  }

  function submit() {
    if (
      writeLock.current ||
      recoverySnapshot(key) ||
      !review ||
      review.journalRevision !== page?.journalRevision ||
      reviewRead !== 'ready' ||
      listRead !== 'ready'
    )
      return;
    try {
      const command = swapCommandFor(mode, review, target);
      void send(command);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : 'Проверьте запись.');
    }
  }

  function stage(nextMode: 'correct' | 'void', swap: SwapVersion, trigger: HTMLButtonElement) {
    if (recoverySnapshot(key) || writeLock.current) return;
    setMode(nextMode);
    setTarget(swap);
    setDraft(draftFromSwap(swap));
    setWriteError('');
    reviewGeneration.current++;
    setReview(null);
    setReviewRead('idle');
    setReviewError('');
    clearHistory();
    // Attestation resets on staging, so the user explicitly reviews this target.
    editorAction.current = trigger;
    setFocusRequest((previous) => ({ kind: 'editor', sequence: previous.sequence + 1 }));
  }

  function cancelEdit() {
    reviewGeneration.current++;
    setMode('create');
    setTarget(null);
    setDraft(emptySwapDraft());
    setReview(null);
    setReviewRead('idle');
    setReviewError('');
    setWriteError('');
    setFocusRequest((previous) => ({ kind: 'return-editor', sequence: previous.sequence + 1 }));
  }

  async function loadHistory(
    swapId: string,
    beforeVersion?: number,
    previous?: SwapVersions | null,
  ) {
    const generation = ++historyGeneration.current;
    setHistoryId(swapId);
    setHistoryRead('loading');
    setHistoryError('');
    if (beforeVersion === undefined) setHistory(null);
    try {
      const next = await assetSwapsApi.versions(accountId, swapId, beforeVersion);
      if (!live.current || generation !== historyGeneration.current) return;
      setHistory(
        beforeVersion === undefined || !previous
          ? next
          : {
              ...next,
              items: [...previous.items, ...next.items],
            },
      );
      setHistoryRead('ready');
    } catch (error) {
      if (!live.current || generation !== historyGeneration.current) return;
      setHistoryRead('error');
      setHistoryError(accountingError(error, 'загрузить историю обмены'));
    }
  }

  async function loadMore() {
    if (!page || page.nextOffset === null || listRead === 'loading') return;
    const generation = ++listGeneration.current;
    reviewGeneration.current++;
    setReview(null);
    setReviewRead('idle');
    setListRead('loading');
    setListError('');
    try {
      const next = await assetSwapsApi.list(accountId, page.journalRevision, page.nextOffset);
      if (!live.current || generation !== listGeneration.current) return;
      if (next.journalRevision !== page.journalRevision)
        throw new Error('Ревизия списка изменилась. Обновите обмены.');
      setPage({ ...next, items: [...page.items, ...next.items] });
      setListRead('ready');
    } catch (error) {
      if (!live.current || generation !== listGeneration.current) return;
      setListRead('error');
      setListError(
        error instanceof Error && !isAxiosError(error)
          ? error.message
          : accountingError(error, 'загрузить следующую страницу'),
      );
      if (isAxiosError(error) && error.response?.status === 409) {
        setPage(null);
        reviewGeneration.current++;
        setReview(null);
        setReviewRead('idle');
        clearHistory();
      }
    }
  }

  const blocked = Boolean(recovery) || writing;
  const reviewed =
    review !== null &&
    reviewRead === 'ready' &&
    listRead === 'ready' &&
    review.journalRevision === page?.journalRevision;
  const instrumentName = (id: string) => instruments.find((item) => item.id === id)?.name ?? id;
  const nextBeforeVersion = history?.nextBeforeVersion;

  return (
    <section className="manual-card" aria-label="Обмены активов">
      <h2 ref={sectionHeading} tabIndex={-1} className="operation-focus-target">
        Обмены активов
      </h2>
      <p className="manual-muted">
        Записывайте уже выполненный обмен двух активов внутри этого счёта. Оценка в USD задаётся
        явно; она не создаёт денежного поступления или вывода. Списанная себестоимость комиссии — её
        историческая учётная стоимость, а не рыночная цена.
      </p>
      {recovery && (
        <section className="manual-card" aria-label="Состояние запроса обмена">
          <p>
            {recovery.phase === 'accepted'
              ? 'Команда принята. Обновите список, чтобы подтвердить текущее состояние.'
              : recovery.phase === 'sending'
                ? 'Запрос отправляется. Новые команды заблокированы.'
                : 'Исход запроса неизвестен. Новые записи заблокированы до точного повтора.'}
          </p>
          {recovery.phase === 'accepted' && (
            <button
              type="button"
              className="manual-button"
              disabled={listRead === 'loading'}
              onClick={() => void loadList(true)}
            >
              Обновить обмены
            </button>
          )}
        </section>
      )}
      {receipt && (
        <section className="manual-card" aria-label="Квитанция обмена">
          <h3>Квитанция команды</h3>
          <p>
            Квитанция неизменна. Текущий результат FIFO может измениться после исправления истории.
          </p>
          <dl className="trade-summary">
            <dt>Номер обмена</dt>
            <dd>{receipt.swap.swapId}</dd>
            <dt>Номер запроса</dt>
            <dd>{receipt.swap.requestId}</dd>
            <dt>Версия</dt>
            <dd>{receipt.swap.version}</dd>
            <dt>Ревизия журнала</dt>
            <dd>{receipt.journalRevision}</dd>
            <AssetSwapFields
              draft={draftFromSwap(receipt.swap)}
              instrumentName={savedSwapName(receipt.swap)}
            />
          </dl>
        </section>
      )}
      {catalogError && <p role="alert">{catalogError}</p>}
      {listError && <p role="alert">{listError}</p>}
      <button
        className="manual-button manual-button--secondary"
        type="button"
        disabled={blocked}
        onClick={() => void loadList()}
      >
        Обновить обмены
      </button>
      <div
        ref={editor}
        className="operation-workbench"
        role="region"
        tabIndex={-1}
        aria-label={
          mode === 'correct'
            ? 'Исправление обмена'
            : mode === 'void'
              ? 'Отмена обмена'
              : 'Новый обмен'
        }
      >
        <AssetSwapForm
          draft={draft}
          instruments={instruments}
          mode={mode}
          busy={blocked || catalogRead !== 'ready' || listRead !== 'ready'}
          reviewed={reviewed}
          reviewError={reviewError}
          review={
            review ? (
              <AssetSwapReview
                draft={review.draft}
                journalRevision={review.journalRevision}
                mode={mode}
                targetId={target?.swapId}
                targetVersion={review.version ?? undefined}
                instrumentName={instrumentName}
              />
            ) : undefined
          }
          recovery={
            recovery ? (
              <>
                {recovery.phase === 'unknown' && (
                  <button
                    className="manual-button"
                    type="button"
                    disabled={writing}
                    onClick={() => void send(recovery.command, true)}
                  >
                    Повторить тот же запрос
                  </button>
                )}
                <AssetSwapReview
                  draft={recovery.draft}
                  journalRevision={recovery.command.body.expectedJournalRevision}
                  mode={recovery.command.kind}
                  targetId={
                    recovery.command.kind === 'create' ? undefined : recovery.command.swapId
                  }
                  targetVersion={
                    'expectedVersion' in recovery.command.body
                      ? recovery.command.body.expectedVersion
                      : undefined
                  }
                  instrumentName={instrumentName}
                  requestId={recovery.command.body.requestId}
                  frozen
                />
              </>
            ) : undefined
          }
          onChange={edit}
          onReview={() => void check(mode, target)}
          onSubmit={submit}
          onCancel={target ? cancelEdit : undefined}
        />
      </div>
      {writeError && (
        <p className="manual-feedback manual-feedback--error" role="alert">
          {writeError}
        </p>
      )}
      {listRead === 'loading' && <p>Загружаются обмены…</p>}
      {listRead === 'error' && <p>Не удалось обновить список. Используйте кнопку обновления.</p>}
      {page && listRead === 'ready' && (
        <>
          <p>
            Записей: {page.activeCount}; версий: {page.versionCount}; ревизия журнала:{' '}
            {page.journalRevision}.
          </p>
          {page.items.map((swap) => (
            <article className="manual-card" key={swap.swapId} aria-label={`Обмен ${swap.swapId}`}>
              <h3>
                {swap.outgoingInstrumentName} → {swap.incomingInstrumentName}
              </h3>
              <dl className="trade-summary">
                <dt>Номер обмена</dt>
                <dd>{swap.swapId}</dd>
                <dt>Версия</dt>
                <dd>
                  {swap.version} · {swap.kind === 'void' ? 'Отменено' : 'Активно'}
                </dd>
                <AssetSwapFields draft={draftFromSwap(swap)} instrumentName={savedSwapName(swap)} />
              </dl>
              {swap.kind !== 'void' && (
                <div className="trade-actions">
                  <button
                    className="manual-button manual-button--secondary"
                    type="button"
                    disabled={blocked}
                    onClick={(event) => stage('correct', swap, event.currentTarget)}
                  >
                    Исправить обмен
                  </button>
                  <button
                    className="manual-button manual-button--secondary"
                    type="button"
                    disabled={blocked}
                    onClick={(event) => stage('void', swap, event.currentTarget)}
                  >
                    Отменить обмен
                  </button>
                </div>
              )}
              <AssetSwapAllocation
                key={`${swap.swapId}:${swap.version}:${page.journalRevision}`}
                accountId={accountId}
                swap={swap}
                journalRevision={page.journalRevision}
                disabled={blocked}
              />
              <button
                className="manual-button manual-button--secondary"
                type="button"
                disabled={blocked || (historyId === swap.swapId && historyRead === 'loading')}
                onClick={(event) => {
                  historyAction.current = event.currentTarget;
                  void loadHistory(swap.swapId);
                  setFocusRequest((previous) => ({
                    kind: 'history',
                    sequence: previous.sequence + 1,
                  }));
                }}
              >
                История обмена
              </button>
              {historyId === swap.swapId && (
                <section aria-label="История обмена">
                  <h4 ref={historyHeading} tabIndex={-1} className="operation-focus-target">
                    История обмена
                  </h4>
                  <button
                    className="manual-button manual-button--secondary"
                    type="button"
                    onClick={() => {
                      clearHistory();
                      setFocusRequest((previous) => ({
                        kind: 'return-history',
                        sequence: previous.sequence + 1,
                      }));
                    }}
                  >
                    Закрыть историю
                  </button>
                  {historyError && <p role="alert">{historyError}</p>}
                  {history?.items.map((version) => (
                    <div key={version.version}>
                      <p>
                        Версия {version.version}:{' '}
                        {version.kind === 'create'
                          ? 'Запись'
                          : version.kind === 'correct'
                            ? 'Исправление'
                            : 'Отмена'}
                        .
                      </p>
                      <dl className="trade-summary">
                        <AssetSwapFields
                          draft={draftFromSwap(version)}
                          instrumentName={savedSwapName(version)}
                        />
                      </dl>
                    </div>
                  ))}
                  {nextBeforeVersion !== null && nextBeforeVersion !== undefined && (
                    <button
                      className="manual-button manual-button--secondary"
                      type="button"
                      disabled={historyRead === 'loading'}
                      onClick={() => void loadHistory(swap.swapId, nextBeforeVersion, history)}
                    >
                      Ещё версии
                    </button>
                  )}
                </section>
              )}
            </article>
          ))}
          {page.nextOffset !== null && (
            <button
              className="manual-button manual-button--secondary"
              type="button"
              disabled={blocked}
              onClick={() => void loadMore()}
            >
              Следующие обмены
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function AssetSwaps({
  accountId,
  journalRevision,
  onChanged,
}: {
  accountId: string;
  journalRevision: number;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <AssetSwapsOwner
      key={`${user.id}:${accountId}`}
      accountId={accountId}
      ownerId={user.id}
      journalRevision={journalRevision}
      onChanged={onChanged}
    />
  );
}
