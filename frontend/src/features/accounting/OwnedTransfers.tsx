import { type AccountSummary, type Instrument, accountingApi } from '@api/accounting.api';
import {
  type TransferAllocation,
  type TransferCorrectionCommand,
  type TransferCreateCommand,
  type TransferPage,
  type TransferReceipt,
  type TransferVersion,
  type TransferVersions,
  type TransferVoidCommand,
  ownedTransfersApi,
} from '@api/owned-transfers.api';
import { tradesApi } from '@api/trades.api';
import { useAuth } from '@contexts/AuthContext';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import './TradeJournal.css';
import { OwnedTransferForm, type TransferDraft } from './OwnedTransferForm';
import { accountingError, newRequestId } from './feedback';
import '@pages/ManualAccounts.css';

type Mode = 'create' | 'correct' | 'void';
type ReadState = 'idle' | 'loading' | 'ready' | 'error';
type Command =
  | { kind: 'create'; body: TransferCreateCommand }
  | { kind: 'correct'; transferId: string; body: TransferCorrectionCommand }
  | { kind: 'void'; transferId: string; body: TransferVoidCommand };
type Recovery =
  | { phase: 'sending' | 'unknown'; command: Command; draft: TransferDraft }
  | { phase: 'accepted'; command: Command; draft: TransferDraft; receipt: TransferReceipt };
type Review = {
  fromAccountId: string;
  toAccountId: string;
  fromRevision: number;
  toRevision: number;
  version: number | null;
};

const recoveryByOwner = new Map<string, Recovery>();
const recoveryListeners = new Set<() => void>();
const recoveryFor = (ownerId: string) => recoveryByOwner.get(ownerId) ?? null;
function retainRecovery(ownerId: string, value: Recovery | null) {
  if (value) recoveryByOwner.set(ownerId, value);
  else recoveryByOwner.delete(ownerId);
  for (const notify of recoveryListeners) notify();
}
function subscribeRecovery(notify: () => void) {
  recoveryListeners.add(notify);
  return () => recoveryListeners.delete(notify);
}

const emptyDraft = (): TransferDraft => ({
  fromAccountId: '',
  toAccountId: '',
  instrumentId: '',
  quantity: '',
  occurredAt: '',
  orderWithinTimestamp: '0',
  feeInstrumentId: '',
  feeQuantity: '0',
  assertInternal: false,
});

function draftFromVersion(version: TransferVersion): TransferDraft {
  return {
    fromAccountId: version.fromAccountId,
    toAccountId: version.toAccountId,
    instrumentId: version.instrumentId,
    quantity: version.quantity,
    occurredAt: version.occurredAt,
    orderWithinTimestamp: String(version.orderWithinTimestamp),
    feeInstrumentId: version.feeInstrumentId ?? '',
    feeQuantity: version.feeQuantity,
    assertInternal: false,
  };
}

function decimalValid(value: string, positive: boolean): boolean {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,30}))?$/.exec(value);
  return Boolean(match && match[1].length <= 48 && (!positive || /[1-9]/.test(value)));
}

function commandFromDraft(
  mode: Mode,
  draft: TransferDraft,
  review: Review,
  target: TransferVersion | null,
): Command {
  if (mode === 'void') {
    if (!target || review.version !== target.version)
      throw new Error('Текущая версия не проверена.');
    return {
      kind: 'void',
      transferId: target.transferId,
      body: {
        requestId: newRequestId(),
        expectedVersion: target.version,
        expectedFromJournalRevision: review.fromRevision,
        expectedToJournalRevision: review.toRevision,
      },
    };
  }
  if (
    !draft.assertInternal ||
    !draft.fromAccountId ||
    !draft.toAccountId ||
    draft.fromAccountId === draft.toAccountId ||
    !draft.instrumentId ||
    !decimalValid(draft.quantity, true) ||
    !decimalValid(draft.feeQuantity, false) ||
    (/[1-9]/.test(draft.feeQuantity) ? !draft.feeInstrumentId : Boolean(draft.feeInstrumentId)) ||
    !/^\d+$/.test(draft.orderWithinTimestamp) ||
    Number(draft.orderWithinTimestamp) > 2147483647 ||
    !draft.occurredAt
  )
    throw new Error('Проверьте счета, активы, количество, комиссию и время перевода.');
  if (review.fromAccountId !== draft.fromAccountId || review.toAccountId !== draft.toAccountId)
    throw new Error('Счета изменились. Проверьте их ещё раз.');
  const movement = {
    requestId: newRequestId(),
    expectedFromJournalRevision: review.fromRevision,
    expectedToJournalRevision: review.toRevision,
    assertInternal: true as const,
    instrumentId: draft.instrumentId,
    occurredAt: draft.occurredAt,
    orderWithinTimestamp: Number(draft.orderWithinTimestamp),
    quantity: draft.quantity,
    feeInstrumentId: draft.feeInstrumentId || null,
    feeQuantity: draft.feeQuantity,
  };
  if (mode === 'create')
    return {
      kind: 'create',
      body: { ...movement, fromAccountId: draft.fromAccountId, toAccountId: draft.toAccountId },
    };
  if (!target || review.version !== target.version) throw new Error('Текущая версия не проверена.');
  return {
    kind: 'correct',
    transferId: target.transferId,
    body: { ...movement, expectedVersion: target.version },
  };
}

function sendCommand(command: Command): Promise<TransferReceipt> {
  if (command.kind === 'create') return ownedTransfersApi.create(command.body);
  if (command.kind === 'correct')
    return ownedTransfersApi.correct(command.transferId, command.body);
  return ownedTransfersApi.void(command.transferId, command.body);
}

async function allCatalog<T extends { id: string }>(
  page: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const found = new Map<string, T>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let count = 0; count < 200; count++) {
    const next = await page(cursor);
    for (const item of next.items) found.set(item.id, item);
    if (!next.nextCursor) return [...found.values()];
    if (cursors.has(next.nextCursor)) throw new Error('Повторился курсор каталога.');
    cursors.add(next.nextCursor);
    cursor = next.nextCursor;
  }
  throw new Error('Каталог слишком велик для этого экрана.');
}

function OwnedTransfersOwner({ ownerId }: { ownerId: string }) {
  const recovery = useSyncExternalStore(subscribeRecovery, () => recoveryFor(ownerId));
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [catalogRead, setCatalogRead] = useState<ReadState>('loading');
  const [catalogError, setCatalogError] = useState('');
  const [list, setList] = useState<TransferPage | null>(null);
  const [listRead, setListRead] = useState<ReadState>('loading');
  const [listError, setListError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [mode, setMode] = useState<Mode>(() => recoveryFor(ownerId)?.command.kind ?? 'create');
  const [draft, setDraft] = useState<TransferDraft>(
    () => recoveryFor(ownerId)?.draft ?? emptyDraft(),
  );
  const [target, setTarget] = useState<TransferVersion | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewRead, setReviewRead] = useState<ReadState>('idle');
  const [reviewError, setReviewError] = useState('');
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [receipt, setReceipt] = useState<TransferReceipt | null>(() => {
    const saved = recoveryFor(ownerId);
    return saved?.phase === 'accepted' ? saved.receipt : null;
  });
  const [allocationId, setAllocationId] = useState<string | null>(null);
  const [allocation, setAllocation] = useState<TransferAllocation | null>(null);
  const [allocationRead, setAllocationRead] = useState<ReadState>('idle');
  const [allocationError, setAllocationError] = useState('');
  const [versionId, setVersionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<TransferVersions | null>(null);
  const [versionsRead, setVersionsRead] = useState<ReadState>('idle');
  const [versionsError, setVersionsError] = useState('');
  const live = useRef(false);
  const writeLock = useRef(false);
  const catalogGeneration = useRef(0);
  const listGeneration = useRef(0);
  const reviewGeneration = useRef(0);
  const allocationGeneration = useRef(0);
  const versionGeneration = useRef(0);

  const clearDetailReads = useCallback(() => {
    allocationGeneration.current++;
    versionGeneration.current++;
    setAllocationId(null);
    setAllocation(null);
    setAllocationRead('idle');
    setAllocationError('');
    setVersionId(null);
    setVersions(null);
    setVersionsRead('idle');
    setVersionsError('');
  }, []);

  const loadCatalog = useCallback(async () => {
    const generation = ++catalogGeneration.current;
    setCatalogRead('loading');
    setCatalogError('');
    try {
      const [nextAccounts, nextInstruments] = await Promise.all([
        allCatalog(accountingApi.listAccounts),
        allCatalog(accountingApi.listInstruments),
      ]);
      if (!live.current || generation !== catalogGeneration.current) return;
      setAccounts(nextAccounts);
      setInstruments(nextInstruments);
      setCatalogRead('ready');
    } catch (error) {
      if (!live.current || generation !== catalogGeneration.current) return;
      setCatalogRead('error');
      setCatalogError(accountingError(error, 'загрузить счета и активы'));
    }
  }, []);

  const loadList = useCallback(
    async (offset = 0, previous?: TransferPage | null, releaseAccepted = false) => {
      if (offset > 0 && !previous) return;
      const generation = ++listGeneration.current;
      setListRead('loading');
      setListError('');
      if (offset === 0) {
        reviewGeneration.current++;
        setReview(null);
        setReviewRead('idle');
        setList(null);
        clearDetailReads();
      }
      try {
        const page = await ownedTransfersApi.list(
          offset > 0 ? previous?.journalRevision : undefined,
          offset,
        );
        if (!live.current || generation !== listGeneration.current) return;
        setList(
          offset === 0 || !previous ? page : { ...page, items: [...previous.items, ...page.items] },
        );
        setListRead('ready');
        setNeedsRefresh(false);
        if (releaseAccepted) {
          const pending = recoveryFor(ownerId);
          if (
            pending?.phase === 'accepted' &&
            page.journalRevision >= pending.receipt.journalRevision
          ) {
            retainRecovery(ownerId, null);
            setMode('create');
            setDraft(emptyDraft());
            setTarget(null);
            setReview(null);
            setReviewRead('idle');
            setWriteError('');
          } else if (pending?.phase === 'accepted') {
            setListError('Сохранённая команда ещё не видна в списке. Обновите переводы ещё раз.');
          }
        }
      } catch (error) {
        if (!live.current || generation !== listGeneration.current) return;
        setListRead('error');
        setListError(accountingError(error, 'загрузить переводы'));
        if (isAxiosError(error) && error.response?.status === 409) {
          setList(null);
          setNeedsRefresh(true);
          setReview(null);
          clearDetailReads();
        }
      }
    },
    [clearDetailReads, ownerId],
  );

  useEffect(() => {
    live.current = true;
    void loadCatalog();
    void loadList(0, null, true);
    return () => {
      live.current = false;
      catalogGeneration.current++;
      listGeneration.current++;
      reviewGeneration.current++;
      allocationGeneration.current++;
      versionGeneration.current++;
    };
  }, [loadCatalog, loadList]);

  const editDraft = (next: TransferDraft) => {
    if (recoveryFor(ownerId)) return;
    const economicChange = Object.keys(next).some(
      (key) =>
        key !== 'assertInternal' &&
        next[key as keyof TransferDraft] !== draft[key as keyof TransferDraft],
    );
    setDraft(next);
    setWriteError('');
    if (economicChange) {
      reviewGeneration.current++;
      setReview(null);
      setReviewRead('idle');
      setReviewError('');
      clearDetailReads();
    }
  };

  const readReview = async (
    requestedMode: Mode,
    candidate: TransferDraft,
    selected: TransferVersion | null,
    restage = false,
  ) => {
    if (recoveryFor(ownerId) || writeLock.current) return;
    if (needsRefresh) {
      setReviewRead('error');
      setReviewError('Сначала обновите список переводов, затем проверьте счета.');
      return;
    }
    const generation = ++reviewGeneration.current;
    setReview(null);
    setReviewRead('loading');
    setReviewError('');
    try {
      const latest = selected
        ? (await ownedTransfersApi.versions(selected.transferId)).items[0]
        : null;
      if (selected && !latest) throw new Error('Перевод не найден. Обновите список.');
      const fromId = latest?.fromAccountId ?? candidate.fromAccountId;
      const toId = latest?.toAccountId ?? candidate.toAccountId;
      if (!fromId || !toId || fromId === toId) throw new Error('Выберите два разных счёта.');
      const [from, to] = await Promise.all([tradesApi.state(fromId), tradesApi.state(toId)]);
      if (!live.current || generation !== reviewGeneration.current) return;
      if (from.accountId !== fromId || to.accountId !== toId || !from.journal || !to.journal)
        throw new Error('Оба счёта должны иметь начатые журналы с известной себестоимостью.');
      if (latest && selected && latest.version !== selected.version && !restage) {
        setTarget(latest);
        setReviewRead('error');
        setReviewError('Версия перевода изменилась. Начните исправление или отмену заново.');
        setNeedsRefresh(true);
        return;
      }
      if (restage && latest) {
        setTarget(latest);
        setDraft(draftFromVersion(latest));
      }
      setReview({
        fromAccountId: fromId,
        toAccountId: toId,
        fromRevision: from.journal.journalRevision,
        toRevision: to.journal.journalRevision,
        version: latest?.version ?? null,
      });
      setReviewRead('ready');
      setNeedsRefresh(false);
      if (requestedMode === 'void') setDraft((current) => ({ ...current, assertInternal: false }));
    } catch (error) {
      if (!live.current || generation !== reviewGeneration.current) return;
      setReviewRead('error');
      setReviewError(
        error instanceof Error && !isAxiosError(error)
          ? error.message
          : accountingError(error, 'проверить счета'),
      );
    }
  };

  const stage = (nextMode: 'correct' | 'void', version: TransferVersion) => {
    if (recoveryFor(ownerId) || writeLock.current || needsRefresh) return;
    setMode(nextMode);
    setTarget(version);
    const nextDraft = draftFromVersion(version);
    setDraft(nextDraft);
    setWriteError('');
    void readReview(nextMode, nextDraft, version, true);
  };

  const cancelEdit = () => {
    reviewGeneration.current++;
    setMode('create');
    setTarget(null);
    setDraft(emptyDraft());
    setReview(null);
    setReviewRead('idle');
    setReviewError('');
    setWriteError('');
  };

  const runCommand = async (command: Command, retry = false) => {
    const previous = recoveryFor(ownerId);
    if (
      writeLock.current ||
      (retry && (previous?.phase !== 'unknown' || previous.command !== command)) ||
      (!retry && previous)
    )
      return;
    const wasUnknown = retry && previous?.phase === 'unknown';
    const frozenDraft = retry && previous ? previous.draft : { ...draft };
    writeLock.current = true;
    setWriting(true);
    setWriteError('');
    retainRecovery(ownerId, { phase: 'sending', command, draft: frozenDraft });
    try {
      const saved = await sendCommand(command);
      retainRecovery(ownerId, { phase: 'accepted', command, draft: frozenDraft, receipt: saved });
      if (!live.current) return;
      setReceipt(saved);
      setReview(null);
      clearDetailReads();
      await loadList(0, null, true);
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      const definitive = !wasUnknown && [400, 403, 404, 409].includes(status ?? 0);
      retainRecovery(
        ownerId,
        definitive ? null : { phase: 'unknown', command, draft: frozenDraft },
      );
      if (!live.current) return;
      setReview(null);
      setNeedsRefresh(definitive);
      setWriteError(
        definitive
          ? `${accountingError(error, 'сохранить перевод')} Обновите состояние и проверьте команду снова.`
          : 'Исход команды неизвестен. Новые записи заблокированы; повторите только исходный запрос.',
      );
    } finally {
      writeLock.current = false;
      if (live.current) setWriting(false);
    }
  };

  const submit = () => {
    if (
      writeLock.current ||
      recoveryFor(ownerId) ||
      !review ||
      reviewRead !== 'ready' ||
      needsRefresh ||
      listRead !== 'ready'
    )
      return;
    try {
      const command = commandFromDraft(mode, draft, review, target);
      void runCommand(command);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : 'Проверьте данные перевода.');
    }
  };

  const loadAllocation = async (id: string, offset = 0, previous?: TransferAllocation | null) => {
    if (offset > 0 && (!previous || allocationId !== id)) return;
    const generation = ++allocationGeneration.current;
    setAllocationId(id);
    setAllocationRead('loading');
    setAllocationError('');
    if (offset === 0) setAllocation(null);
    try {
      const page = await ownedTransfersApi.allocation(
        id,
        offset > 0 ? previous?.fromJournalRevision : undefined,
        offset > 0 ? previous?.toJournalRevision : undefined,
        offset,
      );
      if (!live.current || generation !== allocationGeneration.current) return;
      setAllocation(
        offset === 0 || !previous ? page : { ...page, items: [...previous.items, ...page.items] },
      );
      setAllocationRead('ready');
    } catch (error) {
      if (!live.current || generation !== allocationGeneration.current) return;
      setAllocationRead('error');
      setAllocationError(accountingError(error, 'загрузить текущий разбор лотов'));
      if (isAxiosError(error) && error.response?.status === 409) {
        setAllocation(null);
        setReview(null);
        setNeedsRefresh(true);
      }
    }
  };

  const loadVersions = async (
    id: string,
    beforeVersion?: number,
    previous?: TransferVersions | null,
  ) => {
    const generation = ++versionGeneration.current;
    setVersionId(id);
    setVersionsRead('loading');
    setVersionsError('');
    if (beforeVersion === undefined) setVersions(null);
    try {
      const page = await ownedTransfersApi.versions(id, beforeVersion);
      if (!live.current || generation !== versionGeneration.current) return;
      setVersions(
        beforeVersion === undefined || !previous
          ? page
          : { ...page, items: [...previous.items, ...page.items] },
      );
      setVersionsRead('ready');
    } catch (error) {
      if (!live.current || generation !== versionGeneration.current) return;
      setVersionsRead('error');
      setVersionsError(accountingError(error, 'загрузить версии перевода'));
    }
  };

  const blocked = Boolean(recovery) || writing;
  const reviewed =
    review !== null && reviewRead === 'ready' && !needsRefresh && listRead === 'ready';
  return (
    <div className="manual-page trade-journal">
      <header className="manual-page__header">
        <h1>Переводы между своими счетами</h1>
        <p>
          Запись уже совершённого перемещения. Эта форма не отправляет средства и не создаёт внешний
          ввод или вывод USD.
        </p>
      </header>

      {recovery && (
        <section className="manual-card" aria-label="Сохранённый запрос">
          {recovery.phase === 'accepted' ? (
            <p>
              Команда принята; обновление списка не завершено. Новые записи ждут успешного
              обновления.
            </p>
          ) : (
            <p>
              Исход запроса неизвестен. Новые записи заблокированы. Сохранён исходный номер запроса
              и все поля.
            </p>
          )}
          <p>Номер запроса: {recovery.command.body.requestId}</p>
          {recovery.phase === 'unknown' && (
            <button
              className="manual-button"
              type="button"
              disabled={writing}
              onClick={() => void runCommand(recovery.command, true)}
            >
              Повторить тот же запрос
            </button>
          )}
          {recovery.phase === 'accepted' && (
            <button
              className="manual-button manual-button--secondary"
              type="button"
              disabled={listRead === 'loading'}
              onClick={() => void loadList(0, null, true)}
            >
              Обновить переводы
            </button>
          )}
        </section>
      )}

      {receipt && (
        <section className="manual-card" aria-label="Сохранённое подтверждение">
          <h2>Сохранённое подтверждение</h2>
          <p>Это неизменяемая квитанция команды, а не текущий разбор лотов.</p>
          <dl className="trade-summary">
            <dt>Номер перевода</dt>
            <dd>{receipt.transfer.transferId}</dd>
            <dt>Версия</dt>
            <dd>{receipt.transfer.version}</dd>
            <dt>Количество получателю</dt>
            <dd>{receipt.transfer.quantity}</dd>
            <dt>Ревизия команды</dt>
            <dd>{receipt.journalRevision}</dd>
          </dl>
        </section>
      )}

      <section className="manual-card" aria-label="Команда перевода">
        <h2>
          {mode === 'create'
            ? 'Новый перевод'
            : mode === 'correct'
              ? 'Исправление перевода'
              : 'Отмена перевода'}
        </h2>
        {target && (
          <p>
            Перевод {target.transferId}, версия {target.version}. Пара счетов закреплена за
            переводом.
          </p>
        )}
        {catalogError && (
          <p className="manual-feedback manual-feedback--error" role="alert">
            {catalogError}
          </p>
        )}
        {catalogRead === 'loading' && <p>Загрузка счетов и активов…</p>}
        {catalogRead === 'error' && (
          <button
            type="button"
            className="manual-button manual-button--secondary"
            onClick={() => void loadCatalog()}
          >
            Загрузить справочники снова
          </button>
        )}
        <OwnedTransferForm
          draft={draft}
          accounts={accounts}
          instruments={instruments}
          mode={mode}
          busy={blocked || reviewRead === 'loading' || catalogRead !== 'ready'}
          reviewed={reviewed}
          review={
            review && (
              <p>
                Проверены ревизии счетов: {review.fromRevision} и {review.toRevision}
                {review.version !== null ? `; версия перевода: ${review.version}` : ''}.
              </p>
            )
          }
          onChange={editDraft}
          onReview={() => void readReview(mode, draft, target)}
          onSubmit={submit}
          onCancel={mode === 'create' ? undefined : cancelEdit}
        />
        {reviewError && (
          <p className="manual-feedback manual-feedback--error" role="alert">
            {reviewError}
          </p>
        )}
        {needsRefresh && (
          <p className="manual-feedback manual-feedback--error">
            Состояние изменилось. Обновите список и проверьте счета заново.
          </p>
        )}
        {writeError && (
          <p className="manual-feedback manual-feedback--error" role="alert">
            {writeError}
          </p>
        )}
      </section>

      <section className="manual-card" aria-label="Сохранённые переводы">
        <h2>Сохранённые переводы</h2>
        <button
          type="button"
          className="manual-button manual-button--secondary"
          disabled={listRead === 'loading'}
          onClick={() => void loadList(0, null, true)}
        >
          Обновить список
        </button>
        {listRead === 'loading' && <p>Загрузка переводов…</p>}
        {listError && (
          <p className="manual-feedback manual-feedback--error" role="alert">
            {listError}
          </p>
        )}
        {list && (
          <>
            <p>
              Ревизия журнала переводов: {list.journalRevision}. Активных переводов:{' '}
              {list.activeCount}.
            </p>
            {list.items.length === 0 && <p>Переводов пока нет.</p>}
            {list.items.map((version) => (
              <article
                className="manual-card"
                aria-label={`Перевод ${version.transferId}`}
                key={version.transferId}
              >
                <h3>Перевод {version.transferId}</h3>
                <p>
                  {version.kind === 'void'
                    ? 'Отменён'
                    : `${version.quantity} ${version.instrumentName}${version.instrumentSymbol ? ` (${version.instrumentSymbol})` : ''}`}
                </p>
                <p>
                  <Link to={`/manual-accounts/${version.fromAccountId}`}>
                    {accounts.find((account) => account.id === version.fromAccountId)?.name ??
                      version.fromAccountId}
                  </Link>
                  {' → '}
                  <Link to={`/manual-accounts/${version.toAccountId}`}>
                    {accounts.find((account) => account.id === version.toAccountId)?.name ??
                      version.toAccountId}
                  </Link>
                </p>
                <p>
                  Версия {version.version}; время {version.occurredAt}; порядок{' '}
                  {version.orderWithinTimestamp}.
                </p>
                <div className="trade-actions">
                  {version.kind !== 'void' && (
                    <>
                      <button
                        type="button"
                        className="manual-button manual-button--secondary"
                        disabled={blocked || needsRefresh}
                        onClick={() => stage('correct', version)}
                      >
                        Исправить
                      </button>
                      <button
                        type="button"
                        className="manual-button manual-button--secondary"
                        disabled={blocked || needsRefresh}
                        onClick={() => stage('void', version)}
                      >
                        Отменить перевод
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="manual-button manual-button--secondary"
                    onClick={() => void loadAllocation(version.transferId)}
                  >
                    Показать разбор лотов
                  </button>
                  <button
                    type="button"
                    className="manual-button manual-button--secondary"
                    onClick={() => void loadVersions(version.transferId)}
                  >
                    Показать версии
                  </button>
                </div>
                {allocationId === version.transferId && (
                  <section aria-label="Текущий разбор лотов">
                    <h4>Текущий разбор лотов</h4>
                    {allocationRead === 'loading' && <p>Загрузка разбора…</p>}
                    {allocationError && (
                      <p className="manual-feedback manual-feedback--error" role="alert">
                        {allocationError}
                      </p>
                    )}
                    {allocation && (
                      <>
                        <p>
                          Текущая версия {allocation.version}; ревизии счетов{' '}
                          {allocation.fromJournalRevision} и {allocation.toJournalRevision}.
                        </p>
                        <dl className="trade-summary">
                          <dt>Себестоимость переданного актива, USD</dt>
                          <dd>{allocation.principalBasisUsd}</dd>
                          <dt>Списанная себестоимость комиссии, USD</dt>
                          <dd>{allocation.feeConsumedBasisUsd}</dd>
                        </dl>
                        {allocation.items.length === 0 && (
                          <p>В текущем переводе нет распределённых лотов.</p>
                        )}
                        <ol>
                          {allocation.items.map((item, index) => (
                            <li
                              key={`${item.kind}-${item.origin.accountId}-${item.intervalStart}-${item.intervalEnd}-${index}`}
                            >
                              {item.kind === 'principal' ? 'Получателю' : 'Комиссия'}:{' '}
                              {item.quantity}; себестоимость {item.costUsd} USD; исходный счёт{' '}
                              {item.origin.accountId}, приобретение {item.origin.acquiredAt},
                              интервал [{item.intervalStart}, {item.intervalEnd}).
                            </li>
                          ))}
                        </ol>
                        {allocation.nextOffset !== null && (
                          <button
                            type="button"
                            className="manual-button manual-button--secondary"
                            disabled={allocationRead === 'loading'}
                            onClick={() =>
                              void loadAllocation(
                                version.transferId,
                                allocation.nextOffset!,
                                allocation,
                              )
                            }
                          >
                            Следующая страница разбора
                          </button>
                        )}
                      </>
                    )}
                  </section>
                )}
                {versionId === version.transferId && (
                  <section aria-label="Версии перевода">
                    <h4>Версии перевода</h4>
                    {versionsRead === 'loading' && <p>Загрузка версий…</p>}
                    {versionsError && (
                      <p className="manual-feedback manual-feedback--error" role="alert">
                        {versionsError}
                      </p>
                    )}
                    {versions && (
                      <>
                        <ol>
                          {versions.items.map((entry) => (
                            <li key={entry.version}>
                              Версия {entry.version}:{' '}
                              {entry.kind === 'void' ? 'Отменён' : entry.quantity};{' '}
                              {entry.occurredAt}; запрос {entry.requestId}.
                            </li>
                          ))}
                        </ol>
                        {versions.nextBeforeVersion !== null && (
                          <button
                            type="button"
                            className="manual-button manual-button--secondary"
                            disabled={versionsRead === 'loading'}
                            onClick={() =>
                              void loadVersions(
                                version.transferId,
                                versions.nextBeforeVersion!,
                                versions,
                              )
                            }
                          >
                            Ещё версии
                          </button>
                        )}
                      </>
                    )}
                  </section>
                )}
              </article>
            ))}
            {list.nextOffset !== null && (
              <button
                type="button"
                className="manual-button manual-button--secondary"
                disabled={listRead === 'loading'}
                onClick={() => void loadList(list.nextOffset!, list)}
              >
                Следующие переводы
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function OwnedTransfers() {
  const { user } = useAuth();
  if (!user) return null;
  return <OwnedTransfersOwner key={user.id} ownerId={user.id} />;
}

export default OwnedTransfers;
