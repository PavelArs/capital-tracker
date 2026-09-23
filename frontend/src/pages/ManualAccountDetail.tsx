import {
  type AccountDetail as AccountDetailData,
  type Instrument,
  type Opening,
  type Position,
  accountingApi,
} from '@api/accounting.api';
import { TradeJournal } from '@features/accounting/TradeJournal';
import { accountingError, newRequestId } from '@features/accounting/feedback';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import './ManualAccountDetail.css';

type PositionDraft = {
  key: string;
  instrumentId: string;
  quantity: string;
  costStatus: 'known' | 'unknown';
  totalCostUsd: string;
};

type InstrumentPage = { items: Instrument[]; nextCursor: string | null };
type RetryKey = { signature: string; requestId: string };

function mergeInstruments(current: Instrument[], incoming: Instrument[]): Instrument[] {
  const byId = new Map(current.map((instrument) => [instrument.id, instrument]));
  for (const instrument of incoming) byId.set(instrument.id, instrument);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function asDraft(position: Position): PositionDraft {
  return {
    key: newRequestId(),
    instrumentId: position.instrumentId,
    quantity: position.quantity,
    costStatus: position.costStatus,
    totalCostUsd: position.totalCostUsd ?? '',
  };
}

function defaultAsOf(): string {
  return new Date().toISOString();
}

function InstrumentLabel({ position }: { position: Position }) {
  return (
    <>
      {position.instrumentName}
      {position.instrumentSymbol ? ` (${position.instrumentSymbol})` : ''}
    </>
  );
}

function PositionsTable({ caption, positions }: { caption: string; positions: Position[] }) {
  return (
    <div className="manual-table-wrap">
      <table className="manual-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Инструмент</th>
            <th scope="col">Количество</th>
            <th scope="col">Общая себестоимость, USD</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.instrumentId}>
              <td>
                <InstrumentLabel position={position} />
              </td>
              <td className="manual-exact-value">{position.quantity}</td>
              <td>{position.costStatus === 'unknown' ? 'Неизвестна' : position.totalCostUsd}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {positions.length === 0 && <p className="manual-muted">В этой версии нет позиций.</p>}
    </div>
  );
}

export default function ManualAccountDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountDetailData | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [instrumentCursor, setInstrumentCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Opening[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [draft, setDraft] = useState<PositionDraft[]>([]);
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [instrumentName, setInstrumentName] = useState('');
  const [instrumentSymbol, setInstrumentSymbol] = useState('');
  const [journalGuard, setJournalGuard] = useState<{
    accountId: string;
    openingRevision: number;
    hasJournal: boolean | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [instrumentsLoading, setInstrumentsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingInstrument, setCreatingInstrument] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instrumentError, setInstrumentError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflictOpening, setConflictOpening] = useState<AccountDetailData | null>(null);
  const [conflictPending, setConflictPending] = useState(false);
  const [conflictReviewed, setConflictReviewed] = useState(false);
  const initialAccountRef = useRef<string | null>(null);
  const historyRequestRef = useRef(0);
  const openingRetryRef = useRef<RetryKey | null>(null);
  const instrumentRetryRef = useRef<RetryKey | null>(null);
  const routeRef = useRef({ id, generation: 0 });
  if (routeRef.current.id !== id) {
    routeRef.current = { id, generation: routeRef.current.generation + 1 };
  }
  const routeGeneration = routeRef.current.generation;
  const isCurrentRoute = useCallback(
    () => routeRef.current.id === id && routeRef.current.generation === routeGeneration,
    [id, routeGeneration],
  );

  const openingRevision = account?.currentRevision ?? 0;
  const handleJournalEligibility = useCallback(
    (hasJournal: boolean | null) => {
      if (isCurrentRoute()) setJournalGuard({ accountId: id, openingRevision, hasJournal });
    },
    [id, openingRevision, isCurrentRoute],
  );
  const journalStatus =
    journalGuard?.accountId === id && journalGuard.openingRevision === openingRevision
      ? journalGuard.hasJournal
      : null;
  const openingBlocked = journalStatus !== false;

  const instrumentById = useMemo(() => {
    const map = new Map(instruments.map((instrument) => [instrument.id, instrument]));
    const currentPositions = account?.currentOpening?.positions ?? [];
    for (const position of currentPositions) {
      if (!map.has(position.instrumentId)) {
        map.set(position.instrumentId, {
          id: position.instrumentId,
          name: position.instrumentName,
          symbol: position.instrumentSymbol,
          namespace: 'manual',
          createdAt: '',
        });
      }
    }
    return map;
  }, [account?.currentOpening?.positions, instruments]);

  const loadAccount = useCallback(
    async (asReview = false) => {
      setLoading(true);
      if (!asReview) setError(null);
      try {
        const value = await accountingApi.getAccount(id);
        if (!isCurrentRoute()) return;
        if (asReview) {
          setConflictOpening(value);
          setConflictReviewed(false);
        } else {
          setAccount(value);
          if (initialAccountRef.current !== id) {
            initialAccountRef.current = id;
            setDraft(
              value.currentOpening?.positions.map(asDraft) ?? [
                {
                  key: newRequestId(),
                  instrumentId: '',
                  quantity: '',
                  costStatus: 'known',
                  totalCostUsd: '',
                },
              ],
            );
            setAsOf(value.currentOpening?.asOf ?? defaultAsOf());
          }
        }
      } catch (loadError) {
        if (!isCurrentRoute()) return;
        setError(accountingError(loadError, 'загрузить счет'));
      } finally {
        if (isCurrentRoute()) setLoading(false);
      }
    },
    [id, isCurrentRoute],
  );

  const loadInstruments = useCallback(
    async (cursor?: string, append = false) => {
      setInstrumentsLoading(true);
      setInstrumentError(null);
      try {
        const page: InstrumentPage = await accountingApi.listInstruments(cursor);
        if (!isCurrentRoute()) return;
        setInstruments((current) => mergeInstruments(append ? current : [], page.items));
        setInstrumentCursor(page.nextCursor);
      } catch (loadError) {
        if (!isCurrentRoute()) return;
        setInstrumentError(accountingError(loadError, 'загрузить инструменты'));
      } finally {
        if (isCurrentRoute()) setInstrumentsLoading(false);
      }
    },
    [isCurrentRoute],
  );

  const loadHistory = useCallback(
    async (beforeRevision?: number, append = false, preserveExisting = false) => {
      const requestVersion = ++historyRequestRef.current;
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const page = await accountingApi.listOpenings(id, beforeRevision);
        if (!isCurrentRoute() || requestVersion !== historyRequestRef.current) return;
        setHistory((current) => {
          const byRevision = new Map(
            (append || preserveExisting ? current : []).map((opening) => [
              opening.revision,
              opening,
            ]),
          );
          for (const opening of page.items) byRevision.set(opening.revision, opening);
          return [...byRevision.values()].sort((left, right) => right.revision - left.revision);
        });
        setHistoryCursor(typeof page.nextCursor === 'number' ? page.nextCursor : null);
      } catch (loadError) {
        if (!isCurrentRoute() || requestVersion !== historyRequestRef.current) return;
        setHistoryError(accountingError(loadError, 'загрузить историю'));
      } finally {
        if (isCurrentRoute() && requestVersion === historyRequestRef.current) {
          setHistoryLoading(false);
        }
      }
    },
    [id, isCurrentRoute],
  );

  useEffect(() => {
    historyRequestRef.current++;
    initialAccountRef.current = null;
    setAccount(null);
    setHistory([]);
    setHistoryCursor(null);
    setInstruments([]);
    setInstrumentCursor(null);
    setDraft([]);
    setLoading(true);
    setInstrumentsLoading(true);
    setHistoryLoading(true);
    setSaving(false);
    setCreatingInstrument(false);
    setError(null);
    setInstrumentError(null);
    setHistoryError(null);
    setNotice(null);
    setConflictOpening(null);
    setConflictPending(false);
    setConflictReviewed(false);
    openingRetryRef.current = null;
    instrumentRetryRef.current = null;
    void loadAccount();
    void loadInstruments();
    void loadHistory();
  }, [loadAccount, loadHistory, loadInstruments]);

  function updateDraft(index: number, update: Partial<PositionDraft>) {
    setDraft((current) =>
      current.map((position, positionIndex) =>
        positionIndex === index ? { ...position, ...update } : position,
      ),
    );
    setError(null);
    setNotice(null);
  }

  async function createInstrument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = instrumentName.trim();
    const symbol = instrumentSymbol.trim();
    if (!name) {
      setInstrumentError('Введите название инструмента.');
      return;
    }
    const input = { name, ...(symbol ? { symbol } : {}) };
    const signature = JSON.stringify(input);
    if (instrumentRetryRef.current?.signature !== signature) {
      instrumentRetryRef.current = { signature, requestId: newRequestId() };
    }
    setCreatingInstrument(true);
    setInstrumentError(null);
    try {
      const instrument = await accountingApi.createInstrument({
        ...input,
        requestId: instrumentRetryRef.current.requestId,
      });
      if (!isCurrentRoute()) return;
      instrumentRetryRef.current = null;
      setInstruments((current) => mergeInstruments(current, [instrument]));
      setInstrumentName('');
      setInstrumentSymbol('');
      setNotice('Инструмент создан и добавлен в список.');
    } catch (createError) {
      if (!isCurrentRoute()) return;
      setInstrumentError(accountingError(createError, 'создать инструмент'));
    } finally {
      if (isCurrentRoute()) setCreatingInstrument(false);
    }
  }

  async function saveOpening(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || account.id !== id || openingBlocked) return;
    if (draft.length < 1 || draft.length > 100) {
      setError('Добавьте от 1 до 100 позиций.');
      return;
    }
    if (draft.some((position) => !position.instrumentId || !position.quantity.trim())) {
      setError('Выберите инструмент и укажите количество для каждой позиции.');
      return;
    }
    if (
      draft.some((position) => position.costStatus === 'known' && !position.totalCostUsd.trim())
    ) {
      setError('Укажите известную себестоимость или выберите «Неизвестна».');
      return;
    }
    const positions = draft.map((position) => ({
      instrumentId: position.instrumentId,
      quantity: position.quantity,
      costStatus: position.costStatus,
      totalCostUsd: position.costStatus === 'known' ? position.totalCostUsd : null,
    }));
    const expectedRevision =
      conflictPending && conflictReviewed && conflictOpening
        ? conflictOpening.currentRevision
        : account.currentRevision;
    const inputWithoutId = { expectedRevision, asOf: asOf.trim(), positions };
    const signature = JSON.stringify(inputWithoutId);
    if (openingRetryRef.current?.signature !== signature) {
      openingRetryRef.current = { signature, requestId: newRequestId() };
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const receipt = await accountingApi.saveOpening(id, {
        ...inputWithoutId,
        requestId: openingRetryRef.current.requestId,
      });
      if (!isCurrentRoute()) return;
      historyRequestRef.current++;
      openingRetryRef.current = null;
      setHistory((current) =>
        [receipt, ...current.filter((item) => item.revision !== receipt.revision)].sort(
          (left, right) => right.revision - left.revision,
        ),
      );
      let latestAccount: AccountDetailData;
      try {
        latestAccount = await accountingApi.getAccount(id);
      } catch {
        if (!isCurrentRoute()) return;
        setConflictPending(true);
        setConflictOpening(null);
        setConflictReviewed(false);
        setError(
          `Сохранена ревизия ${receipt.revision}, но не удалось загрузить текущую версию. Нажмите «Загрузить актуальную версию».`,
        );
        return;
      }
      if (!isCurrentRoute()) return;
      setConflictOpening(null);
      setConflictPending(false);
      setConflictReviewed(false);
      setAccount(latestAccount);
      setDraft(latestAccount.currentOpening?.positions.map(asDraft) ?? []);
      setAsOf(latestAccount.currentOpening?.asOf ?? defaultAsOf());
      await loadHistory(undefined, false, true);
      if (!isCurrentRoute()) return;
      setNotice(
        receipt.revision === latestAccount.currentRevision
          ? 'Начальные позиции сохранены. Предыдущие версии остаются в истории.'
          : `Запрос сохранил ревизию ${receipt.revision}; текущая версия уже ${latestAccount.currentRevision}. Показана актуальная версия.`,
      );
    } catch (saveError) {
      if (!isCurrentRoute()) return;
      setError(accountingError(saveError, 'сохранить начальные позиции'));
      if (isConflict(saveError)) {
        setConflictPending(true);
        setConflictOpening(null);
        setConflictReviewed(false);
        await loadAccount(true);
      }
    } finally {
      if (isCurrentRoute()) setSaving(false);
    }
  }

  const selectedPositions = account?.currentOpening?.positions ?? [];
  const conflictPositions = conflictOpening?.currentOpening?.positions ?? [];

  return (
    <div className="manual-page manual-detail-page">
      <p className="manual-back-link">
        <Link to="/manual-accounts">← Ручные счета</Link>
      </p>
      {loading && account?.id !== id && <p role="status">Загрузка счета…</p>}
      {error && account?.id !== id && (
        <p className="manual-feedback manual-feedback--error" role="alert">
          {error}
        </p>
      )}
      {account?.id === id && (
        <>
          <header className="manual-page__header">
            <h1>{account.name}</h1>
            <p>Текущая ревизия: {account.currentRevision} (начальные позиции)</p>
          </header>

          <div className="manual-coverage-warning" role="note">
            Дата начала учета обозначает границу покрытия. История до этой даты не восстановлена;
            дата не является датой покупки или внесения средств.
          </div>

          {error && (
            <p className="manual-feedback manual-feedback--error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="manual-feedback manual-feedback--success" role="status">
              {notice}
            </p>
          )}

          {conflictPending && (
            <section
              className="manual-card manual-conflict"
              aria-labelledby="manual-conflict-heading"
            >
              <h2 id="manual-conflict-heading">Счет изменился</h2>
              <p>
                Черновик сохранен на странице. Загрузите и проверьте последнюю версию перед
                сохранением.
              </p>
              <button
                className="manual-button manual-button--secondary"
                type="button"
                disabled={loading}
                onClick={() => {
                  setError(null);
                  void loadAccount(true);
                }}
              >
                {loading ? 'Загрузка…' : 'Загрузить актуальную версию'}
              </button>
              {conflictOpening?.id === id && (
                <>
                  <p>Актуальная ревизия: {conflictOpening.currentRevision}</p>
                  <PositionsTable
                    caption="Текущие позиции на сервере"
                    positions={conflictPositions}
                  />
                  <label className="manual-review-check">
                    <input
                      type="checkbox"
                      checked={conflictReviewed}
                      disabled={saving}
                      onChange={(event) => setConflictReviewed(event.target.checked)}
                    />
                    Я проверил актуальную версию и хочу заменить ее сохраненным черновиком.
                  </label>
                </>
              )}
            </section>
          )}

          <TradeJournal
            key={`${id}:${account.currentRevision}`}
            accountId={id}
            instruments={instruments}
            openingBusy={saving}
            onEligibility={handleJournalEligibility}
          />
          {journalStatus === true ? (
            <p className="manual-coverage-warning">
              Начальные позиции нельзя заменять после открытия журнала сделок. Пустое начало
              остаётся основой журнала даже после аннулирования всех сделок.
            </p>
          ) : (
            <section className="manual-card" aria-labelledby="manual-opening-heading">
              <h2 id="manual-opening-heading">Начальные позиции</h2>
              <p className="manual-muted">
                Сохранение заменяет весь текущий список позиций и создает новую ревизию.
              </p>
              {openingBlocked && (
                <p role="status">
                  Ожидается проверка состояния журнала перед сохранением начальных позиций.
                </p>
              )}
              <form className="manual-form" onSubmit={saveOpening}>
                <fieldset
                  disabled={saving || openingBlocked}
                  style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
                >
                  <div className="manual-field manual-date-field">
                    <label htmlFor="manual-as-of">Дата и время начала учета (UTC)</label>
                    <input
                      id="manual-as-of"
                      name="asOf"
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      disabled={saving}
                      placeholder="2026-09-22T12:30:00.000Z"
                      value={asOf}
                      onChange={(event) => {
                        setAsOf(event.target.value);
                        setError(null);
                      }}
                    />
                    <small>
                      Укажите точное время с часовым поясом UTC, например 2026-09-22T12:30:00.000Z.
                    </small>
                  </div>

                  <div className="manual-position-list">
                    {draft.map((position, index) => {
                      const selected = instrumentById.get(position.instrumentId);
                      return (
                        <fieldset className="manual-position" key={position.key}>
                          <legend>Позиция {index + 1}</legend>
                          <div className="manual-position__grid">
                            <div className="manual-field">
                              <label htmlFor={`position-instrument-${index}`}>Инструмент</label>
                              <select
                                id={`position-instrument-${index}`}
                                disabled={saving}
                                value={position.instrumentId}
                                onChange={(event) =>
                                  updateDraft(index, { instrumentId: event.target.value })
                                }
                              >
                                <option value="">Выберите инструмент</option>
                                {selected &&
                                  !instruments.some((item) => item.id === selected.id) && (
                                    <option value={selected.id}>
                                      {selected.name}
                                      {selected.symbol ? ` (${selected.symbol})` : ''}
                                    </option>
                                  )}
                                {instruments.map((instrument) => (
                                  <option key={instrument.id} value={instrument.id}>
                                    {instrument.name}
                                    {instrument.symbol ? ` (${instrument.symbol})` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="manual-field">
                              <label htmlFor={`position-quantity-${index}`}>Количество</label>
                              <input
                                id={`position-quantity-${index}`}
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                disabled={saving}
                                value={position.quantity}
                                onChange={(event) =>
                                  updateDraft(index, { quantity: event.target.value })
                                }
                              />
                            </div>
                            <div className="manual-field">
                              <label htmlFor={`position-cost-status-${index}`}>Себестоимость</label>
                              <select
                                id={`position-cost-status-${index}`}
                                disabled={saving}
                                value={position.costStatus}
                                onChange={(event) =>
                                  updateDraft(index, {
                                    costStatus: event.target.value as PositionDraft['costStatus'],
                                  })
                                }
                              >
                                <option value="known">Известна</option>
                                <option value="unknown">Неизвестна</option>
                              </select>
                            </div>
                            {position.costStatus === 'known' && (
                              <div className="manual-field">
                                <label htmlFor={`position-cost-${index}`}>
                                  Общая себестоимость, USD
                                </label>
                                <input
                                  id={`position-cost-${index}`}
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  disabled={saving}
                                  value={position.totalCostUsd}
                                  onChange={(event) =>
                                    updateDraft(index, { totalCostUsd: event.target.value })
                                  }
                                />
                              </div>
                            )}
                          </div>
                          <button
                            className="manual-button manual-button--danger"
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              setDraft((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              )
                            }
                          >
                            Удалить позицию
                          </button>
                        </fieldset>
                      );
                    })}
                  </div>
                  <div className="manual-actions">
                    <button
                      className="manual-button manual-button--secondary"
                      type="button"
                      disabled={saving || draft.length >= 100}
                      onClick={() =>
                        setDraft((current) => [
                          ...current,
                          {
                            key: newRequestId(),
                            instrumentId: '',
                            quantity: '',
                            costStatus: 'known',
                            totalCostUsd: '',
                          },
                        ])
                      }
                    >
                      Добавить позицию
                    </button>
                    <button
                      className="manual-button"
                      type="submit"
                      disabled={saving || (conflictPending && !conflictReviewed)}
                    >
                      {saving ? 'Сохранение…' : 'Сохранить начальные позиции'}
                    </button>
                  </div>
                </fieldset>
              </form>
              {instruments.length === 0 && !instrumentsLoading && (
                <p className="manual-muted">
                  Сначала создайте инструмент ниже или загрузите следующую страницу списка.
                </p>
              )}
            </section>
          )}

          <section className="manual-card" aria-labelledby="manual-instrument-heading">
            <h2 id="manual-instrument-heading">Инструменты</h2>
            <form className="manual-form manual-instrument-create" onSubmit={createInstrument}>
              <div className="manual-field">
                <label htmlFor="manual-instrument-name">Название инструмента</label>
                <input
                  id="manual-instrument-name"
                  maxLength={120}
                  required
                  disabled={creatingInstrument}
                  autoComplete="off"
                  value={instrumentName}
                  onChange={(event) => setInstrumentName(event.target.value)}
                />
              </div>
              <div className="manual-field">
                <label htmlFor="manual-instrument-symbol">Символ (необязательно)</label>
                <input
                  id="manual-instrument-symbol"
                  maxLength={32}
                  disabled={creatingInstrument}
                  autoComplete="off"
                  value={instrumentSymbol}
                  onChange={(event) => setInstrumentSymbol(event.target.value)}
                />
              </div>
              <button className="manual-button" type="submit" disabled={creatingInstrument}>
                {creatingInstrument ? 'Создание…' : 'Создать инструмент'}
              </button>
            </form>
            {instrumentError && (
              <p className="manual-feedback manual-feedback--error" role="alert">
                {instrumentError}
              </p>
            )}
            <p className="manual-muted">
              Инструменты с одинаковыми символами остаются отдельными ручными идентификаторами.
            </p>
            {instrumentCursor && (
              <button
                className="manual-button manual-button--secondary"
                type="button"
                disabled={instrumentsLoading}
                onClick={() => void loadInstruments(instrumentCursor, true)}
              >
                {instrumentsLoading ? 'Загрузка…' : 'Показать еще инструменты'}
              </button>
            )}
            {instrumentError && !instrumentCursor && (
              <button
                className="manual-link-button"
                type="button"
                onClick={() => void loadInstruments()}
              >
                Загрузить инструменты снова
              </button>
            )}
          </section>

          <section className="manual-card" aria-labelledby="manual-current-heading">
            <h2 id="manual-current-heading">Текущие позиции</h2>
            {account.currentOpening ? (
              <>
                <p>
                  Ревизия {account.currentOpening.revision}; граница покрытия:{' '}
                  <time dateTime={account.currentOpening.asOf}>{account.currentOpening.asOf}</time>.
                </p>
                <PositionsTable caption="Текущие позиции" positions={selectedPositions} />
              </>
            ) : (
              <p className="manual-muted">
                Начальные позиции еще не сохранены. Текущая ревизия: 0.
              </p>
            )}
          </section>

          <section className="manual-card" aria-labelledby="manual-history-heading">
            <h2 id="manual-history-heading">История исправлений</h2>
            {historyError && (
              <p className="manual-feedback manual-feedback--error" role="alert">
                {historyError}{' '}
                <button
                  className="manual-link-button"
                  type="button"
                  onClick={() => void loadHistory()}
                >
                  Загрузить снова
                </button>
              </p>
            )}
            {history.length === 0 && !historyLoading && !historyError && (
              <p className="manual-muted">Сохраненных версий пока нет.</p>
            )}
            <div className="manual-history-list">
              {history.map((opening) => (
                <article className="manual-history-entry" key={opening.revision}>
                  <h3>Ревизия {opening.revision}</h3>
                  <p>
                    Граница покрытия: <time dateTime={opening.asOf}>{opening.asOf}</time>
                  </p>
                  <p>
                    Сохранено: <time dateTime={opening.createdAt}>{opening.createdAt}</time>
                  </p>
                  <PositionsTable
                    caption={`Позиции ревизии ${opening.revision}`}
                    positions={opening.positions}
                  />
                </article>
              ))}
            </div>
            {historyCursor !== null && (
              <button
                className="manual-button manual-button--secondary"
                type="button"
                disabled={historyLoading}
                onClick={() => void loadHistory(historyCursor, true)}
              >
                {historyLoading ? 'Загрузка…' : 'Следующие изменения'}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response &&
    error.response.status === 409
  );
}
