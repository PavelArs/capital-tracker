import { type Instrument, accountingApi } from '@api/accounting.api';
import {
  type PriceBook,
  type PriceHistory,
  type PriceReceipt,
  type SetPriceCommand,
  type VoidPriceCommand,
  manualPricesApi,
} from '@api/manual-prices.api';
import { useAuth } from '@contexts/AuthContext';
import { accountingError, newRequestId } from '@features/accounting/feedback';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import './ManualPrices.css';

type PriceCommand =
  | { instrumentId: string; kind: 'set'; body: SetPriceCommand }
  | { instrumentId: string; kind: 'void'; body: VoidPriceCommand };
type Recovery =
  | { phase: 'sending' | 'unknown'; command: PriceCommand }
  | { phase: 'accepted'; command: PriceCommand; receipt: PriceReceipt };
type ReadState = 'idle' | 'loading' | 'ready' | 'error';

const recoveryByOwner = new Map<string, Recovery>();
const recoveryListeners = new Set<() => void>();
const recoveryFor = (ownerId: string) => recoveryByOwner.get(ownerId) ?? null;
function retainRecovery(ownerId: string, recovery: Recovery | null) {
  if (recovery) recoveryByOwner.set(ownerId, recovery);
  else recoveryByOwner.delete(ownerId);
  for (const notify of recoveryListeners) notify();
}
function subscribeRecovery(notify: () => void) {
  recoveryListeners.add(notify);
  return () => recoveryListeners.delete(notify);
}

function priceError(error: unknown, action: string): string {
  if (isAxiosError(error) && error.response?.status === 409)
    return 'Цены изменились. Загрузите актуальные данные и проверьте команду заново.';
  return accountingError(error, action);
}

function ManualPricesOwner({ ownerId }: { ownerId: string }) {
  const recovery = useSyncExternalStore(subscribeRecovery, () => recoveryFor(ownerId));
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [catalogRead, setCatalogRead] = useState<ReadState>('idle');
  const [catalogError, setCatalogError] = useState('');
  const [instrumentId, setInstrumentId] = useState(
    () => recoveryFor(ownerId)?.command.instrumentId ?? '',
  );
  const selectedInstrument = useRef(instrumentId);
  const [book, setBook] = useState<PriceBook | null>(null);
  const [bookRead, setBookRead] = useState<ReadState>('idle');
  const [bookError, setBookError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [observedAt, setObservedAt] = useState('');
  const [priceUsd, setPriceUsd] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [stagedVoidAt, setStagedVoidAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [commandError, setCommandError] = useState('');
  const [receipt, setReceipt] = useState<PriceReceipt | null>(null);
  const [historyAt, setHistoryAt] = useState<string | null>(null);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyRead, setHistoryRead] = useState<ReadState>('idle');
  const [historyError, setHistoryError] = useState('');
  const live = useRef(false);
  const catalogGeneration = useRef(0);
  const bookGeneration = useRef(0);
  const historyGeneration = useRef(0);

  const loadInstruments = useCallback(async (cursor?: string) => {
    const generation = ++catalogGeneration.current;
    setCatalogRead('loading');
    setCatalogError('');
    try {
      const page = await accountingApi.listInstruments(cursor);
      if (!live.current || generation !== catalogGeneration.current) return;
      setInstruments((previous) => {
        if (!cursor) return page.items;
        const unique = new Map([...previous, ...page.items].map((item) => [item.id, item]));
        return [...unique.values()];
      });
      setNextCursor(page.nextCursor);
      setCatalogRead('ready');
    } catch (error) {
      if (!live.current || generation !== catalogGeneration.current) return;
      setCatalogRead('error');
      setCatalogError(accountingError(error, 'загрузить инструменты'));
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void loadInstruments();
    return () => {
      live.current = false;
      catalogGeneration.current++;
      bookGeneration.current++;
      historyGeneration.current++;
    };
  }, [loadInstruments]);

  const clearHistory = () => {
    historyGeneration.current++;
    setHistoryAt(null);
    setHistory(null);
    setHistoryRead('idle');
    setHistoryError('');
  };

  const selectInstrument = (id: string) => {
    selectedInstrument.current = id;
    bookGeneration.current++;
    clearHistory();
    setInstrumentId(id);
    setBook(null);
    setBookRead('idle');
    setBookError('');
    setNeedsRefresh(false);
    setObservedAt('');
    setPriceUsd('');
    setReviewed(false);
    setStagedVoidAt(null);
    setReceipt(null);
    setCommandError('');
  };

  const editForm = (update: (value: string) => void, value: string) => {
    if (bookRead === 'loading') {
      bookGeneration.current++;
      setBook(null);
      setBookRead('idle');
      setBookError('');
    }
    clearHistory();
    update(value);
    setReviewed(false);
  };

  const loadPrices = async (offset = 0, previous = book, releaseAccepted = false) => {
    const target = instrumentId;
    if (!target || (offset > 0 && !previous)) return;
    const generation = ++bookGeneration.current;
    setBookRead('loading');
    setBookError('');
    if (offset === 0) {
      setBook(null);
      clearHistory();
    }
    try {
      const page = await manualPricesApi.list(
        target,
        offset,
        offset > 0 ? previous?.currentRevision : undefined,
      );
      if (
        !live.current ||
        generation !== bookGeneration.current ||
        selectedInstrument.current !== target
      )
        return;
      setBook(
        offset === 0 || !previous ? page : { ...page, items: [...previous.items, ...page.items] },
      );
      setBookRead('ready');
      setNeedsRefresh(false);
      setReviewed(false);
      setStagedVoidAt(null);
      const pending = recoveryFor(ownerId);
      if (
        releaseAccepted &&
        pending?.phase === 'accepted' &&
        pending.command.instrumentId === target &&
        page.currentRevision >= pending.receipt.revision
      )
        retainRecovery(ownerId, null);
    } catch (error) {
      if (
        !live.current ||
        generation !== bookGeneration.current ||
        selectedInstrument.current !== target
      )
        return;
      setBookRead('error');
      setBookError(priceError(error, 'загрузить цены'));
      if (isAxiosError(error) && error.response?.status === 409) {
        setBook(null);
        setNeedsRefresh(true);
        setReviewed(false);
        setStagedVoidAt(null);
        clearHistory();
      }
    }
  };

  const showHistory = async (at: string, beforeRevision?: number, previous = history) => {
    const target = instrumentId;
    if (!target) return;
    const generation = ++historyGeneration.current;
    setHistoryAt(at);
    setHistoryRead('loading');
    setHistoryError('');
    if (beforeRevision === undefined) setHistory(null);
    try {
      const page = await manualPricesApi.history(target, at, beforeRevision);
      if (
        !live.current ||
        generation !== historyGeneration.current ||
        selectedInstrument.current !== target
      )
        return;
      setHistory(
        beforeRevision !== undefined &&
          previous?.instrumentId === target &&
          previous.observedAt === at
          ? { ...page, items: [...previous.items, ...page.items] }
          : page,
      );
      setHistoryRead('ready');
    } catch (error) {
      if (
        !live.current ||
        generation !== historyGeneration.current ||
        selectedInstrument.current !== target
      )
        return;
      setHistoryRead('error');
      setHistoryError(accountingError(error, 'загрузить историю цены'));
    }
  };

  const send = (command: PriceCommand) =>
    command.kind === 'set'
      ? manualPricesApi.set(command.instrumentId, command.body)
      : manualPricesApi.void(command.instrumentId, command.body);

  const runCommand = async (command: PriceCommand, retry = false) => {
    if (!retry && (recoveryFor(ownerId) || !book || bookRead !== 'ready' || needsRefresh)) return;
    const priorUnknown = retry && recoveryFor(ownerId)?.phase === 'unknown';
    retainRecovery(ownerId, { phase: 'sending', command });
    setSaving(true);
    setCommandError('');
    try {
      const accepted = await send(command);
      retainRecovery(ownerId, { phase: 'accepted', command, receipt: accepted });
      if (!live.current || selectedInstrument.current !== command.instrumentId) return;
      setReceipt(accepted);
      setReviewed(false);
      setStagedVoidAt(null);
      setSaving(false);
      await loadPrices(0, undefined, true);
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      const definitiveFirstFailure = !priorUnknown && [400, 403, 404, 409].includes(status ?? 0);
      retainRecovery(ownerId, definitiveFirstFailure ? null : { phase: 'unknown', command });
      if (!live.current || selectedInstrument.current !== command.instrumentId) return;
      if (status === 409 && definitiveFirstFailure) {
        bookGeneration.current++;
        setBook(null);
        setBookRead('idle');
        setNeedsRefresh(true);
        setReviewed(false);
        setStagedVoidAt(null);
        clearHistory();
      }
      setCommandError(
        definitiveFirstFailure
          ? `${priceError(error, 'сохранить цену')} Загрузите цены и проверьте данные.`
          : 'Исход команды неизвестен. Новые изменения заблокированы; повторите только исходную команду.',
      );
    } finally {
      if (live.current) setSaving(false);
    }
  };

  const retry = recovery?.phase === 'unknown' && recovery.command.instrumentId === instrumentId;
  const retrySet = retry && recovery.command.kind === 'set';
  const retryVoid = retry && recovery.command.kind === 'void';
  const canEdit = !saving && !recovery && bookRead === 'ready' && !needsRefresh;
  const canSave =
    retrySet || (canEdit && !stagedVoidAt && reviewed && observedAt !== '' && priceUsd !== '');
  const canVoid = retryVoid || (canEdit && stagedVoidAt !== null && reviewed);
  const visibleReceipt = recovery?.phase === 'accepted' ? recovery.receipt : receipt;
  const voidAt =
    stagedVoidAt ??
    (retryVoid && recovery?.phase === 'unknown' ? recovery.command.body.observedAt : null);

  return (
    <div className="prices-page">
      <header>
        <h1>Ручные цены инструментов</h1>
        <p>
          Это отдельные, не сверенные вручную заявленные цены USD за единицу инструмента. Они не
          подтверждают непрерывное покрытие, текущую оценку портфеля или себестоимость. Символы не
          устанавливают тождество актива: выбирайте инструмент по имени и UUID.
        </p>
      </header>

      <section className="prices-card" aria-label="Выбор инструмента">
        <label htmlFor="prices-instrument">Инструмент</label>
        <select
          id="prices-instrument"
          value={instrumentId}
          disabled={saving}
          onChange={(event) => selectInstrument(event.target.value)}
        >
          <option value="">Выберите инструмент</option>
          {instrumentId && !instruments.some((item) => item.id === instrumentId) && (
            <option value={instrumentId}>{instrumentId}</option>
          )}
          {instruments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} {item.symbol ? `(${item.symbol}) ` : ''}— {item.id}
            </option>
          ))}
        </select>
        <div className="prices-actions">
          <button
            type="button"
            disabled={!instrumentId || saving || bookRead === 'loading'}
            onClick={() => void loadPrices(0, undefined, true)}
          >
            Загрузить цены
          </button>
          {nextCursor && (
            <button
              type="button"
              disabled={catalogRead === 'loading'}
              onClick={() => void loadInstruments(nextCursor)}
            >
              Загрузить ещё инструменты
            </button>
          )}
        </div>
        {catalogRead === 'loading' && <p>Загрузка инструментов…</p>}
        {catalogError && <p role="alert">{catalogError}</p>}
        {catalogRead === 'ready' && instruments.length === 0 && <p>Инструментов нет.</p>}
      </section>

      {recovery?.phase === 'unknown' && (
        <p className="prices-notice" role="alert">
          Исход отправки неизвестен. Сохранена исходная команда для точного повтора; новые изменения
          заблокированы. Выберите её инструмент и повторите прежнее действие явно.
        </p>
      )}
      {recovery?.phase === 'accepted' && (
        <p className="prices-notice" role="status">
          Команда сохранена. Новые изменения заблокированы до успешного обновления цен этого
          инструмента. Нажмите «Загрузить цены».
        </p>
      )}
      {visibleReceipt && (
        <p role="status">
          Сохранена команда {visibleReceipt.kind === 'void' ? 'исключения' : 'цены'}, ревизия{' '}
          {visibleReceipt.revision}, инструмент {visibleReceipt.instrumentId}. UUID запроса:{' '}
          {visibleReceipt.requestId}.
        </p>
      )}
      {commandError && <p role="alert">{commandError}</p>}

      <section className="prices-card" aria-label="Сохранённые цены">
        <h2>Сохранённые цены</h2>
        {!instrumentId && <p>Выберите инструмент, затем загрузите его цены.</p>}
        {instrumentId && bookRead === 'idle' && <p>Нажмите «Загрузить цены».</p>}
        {bookRead === 'loading' && <p>Загрузка цен…</p>}
        {bookError && <p role="alert">{bookError}</p>}
        {bookRead === 'ready' && book && (
          <>
            <p>Ревизия цен инструмента: {book.currentRevision}</p>
            {book.items.length === 0 ? (
              <p>Сохранённых цен нет.</p>
            ) : (
              <div className="prices-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Дата цены (UTC)</th>
                      <th>Цена за единицу, USD</th>
                      <th>Источник</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {book.items.map((item) => (
                      <tr key={item.observedAt}>
                        <td>{item.observedAt}</td>
                        <td>{item.priceUsd}</td>
                        <td>Ручная</td>
                        <td className="prices-row-actions">
                          <button type="button" onClick={() => void showHistory(item.observedAt)}>
                            История
                          </button>
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              clearHistory();
                              setStagedVoidAt(item.observedAt);
                              setReviewed(false);
                              setCommandError('');
                            }}
                          >
                            Исключить цену
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {book.nextOffset !== null && (
              <button type="button" onClick={() => void loadPrices(book.nextOffset!, book)}>
                Загрузить ещё цены
              </button>
            )}
          </>
        )}
      </section>

      {historyAt && (
        <section className="prices-card" aria-label="История цены">
          <h2>История цены</h2>
          <p>Момент UTC: {historyAt}</p>
          {historyRead === 'loading' && <p>Загрузка истории…</p>}
          {historyError && <p role="alert">{historyError}</p>}
          {historyRead === 'ready' && history && (
            <>
              {history.items.length === 0 ? (
                <p>Версий для этого момента нет.</p>
              ) : (
                <ul className="prices-history">
                  {history.items.map((item) => (
                    <li key={item.revision}>
                      Ревизия {item.revision}: {item.kind === 'void' ? 'Исключена' : item.priceUsd}{' '}
                      {item.kind === 'set' && 'USD за единицу'} — {item.createdAt}
                    </li>
                  ))}
                </ul>
              )}
              {history.nextBeforeRevision !== null && (
                <button
                  type="button"
                  onClick={() =>
                    void showHistory(historyAt, history.nextBeforeRevision ?? undefined, history)
                  }
                >
                  Загрузить ещё версии
                </button>
              )}
            </>
          )}
        </section>
      )}

      <section className="prices-card" aria-label="Редактирование цены">
        <h2>Сохранить или исправить цену</h2>
        <p>
          Повторная запись для того же момента исправляет цену и сохраняет прежние версии. Для
          ошибочной даты сначала исключите старый момент, затем сохраните новый. Ноль означает
          заявленную нулевую цену, а не отсутствие данных.
        </p>
        {voidAt && (
          <p className="prices-notice">
            Подготовлено исключение цены на {voidAt}. Оно сохранит историю и уберёт этот момент из
            действующих цен. Проверьте инструмент и подтвердите действие заново.
          </p>
        )}
        <div className="prices-fields">
          <label htmlFor="prices-at">Дата цены (UTC)</label>
          <input
            id="prices-at"
            value={observedAt}
            placeholder="2025-01-01T00:00:00.000Z"
            disabled={saving || Boolean(recovery) || stagedVoidAt !== null}
            onChange={(event) => editForm(setObservedAt, event.target.value)}
          />
          <label htmlFor="prices-value">Цена за единицу, USD</label>
          <input
            id="prices-value"
            value={priceUsd}
            inputMode="decimal"
            disabled={saving || Boolean(recovery) || stagedVoidAt !== null}
            onChange={(event) => editForm(setPriceUsd, event.target.value)}
          />
        </div>
        <label className="prices-review">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={saving || Boolean(recovery)}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          Я проверил инструмент, дату и цену
        </label>
        <div className="prices-actions">
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              if (retrySet && recovery?.phase === 'unknown') {
                void runCommand(recovery.command, true);
                return;
              }
              if (!book) return;
              void runCommand({
                instrumentId,
                kind: 'set',
                body: {
                  requestId: newRequestId(),
                  expectedRevision: book.currentRevision,
                  observedAt,
                  priceUsd,
                  assertReviewed: true,
                },
              });
            }}
          >
            Сохранить цену
          </button>
          {voidAt && (
            <button
              type="button"
              disabled={!canVoid}
              onClick={() => {
                if (retryVoid && recovery?.phase === 'unknown') {
                  void runCommand(recovery.command, true);
                  return;
                }
                if (!book || !voidAt) return;
                void runCommand({
                  instrumentId,
                  kind: 'void',
                  body: {
                    requestId: newRequestId(),
                    expectedRevision: book.currentRevision,
                    observedAt: voidAt,
                    assertReviewed: true,
                  },
                });
              }}
            >
              Подтвердить исключение
            </button>
          )}
          {stagedVoidAt && !recovery && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                clearHistory();
                setStagedVoidAt(null);
                setReviewed(false);
              }}
            >
              Отменить исключение
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export default function ManualPrices() {
  const { user } = useAuth();
  if (!user) return null;
  return <ManualPricesOwner key={user.id} ownerId={user.id} />;
}
