import { type Instrument, accountingApi } from '@api/accounting.api';
import {
  type RewardCategory,
  type RewardCommand,
  type RewardPage,
  type RewardReceipt,
  type RewardVersion,
  type RewardVersions,
  assetRewardsApi,
} from '@api/asset-rewards.api';
import { tradesApi } from '@api/trades.api';
import { useAuth } from '@contexts/AuthContext';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { accountingError, newRequestId } from './feedback';
import './TradeJournal.css';
import '@pages/ManualAccounts.css';

type Mode = 'create' | 'correct' | 'void';
type RewardDraft = {
  instrumentId: string;
  category: RewardCategory;
  occurredAt: string;
  orderWithinTimestamp: string;
  quantity: string;
  basisKnown: boolean;
  acquisitionBasisUsd: string;
  incomeKnown: boolean;
  incomeValueUsd: string;
  assertReward: boolean;
};
type Command =
  | { kind: 'create'; body: RewardCommand }
  | {
      kind: 'correct';
      rewardId: string;
      body: RewardCommand & { expectedVersion: number };
    }
  | {
      kind: 'void';
      rewardId: string;
      body: {
        requestId: string;
        expectedJournalRevision: number;
        expectedVersion: number;
      };
    };
type Recovery =
  | { phase: 'sending' | 'unknown'; command: Command }
  | { phase: 'accepted'; command: Command; receipt: RewardReceipt };
type Review = { journalRevision: number; version: number | null };
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

const emptyDraft = (): RewardDraft => ({
  instrumentId: '',
  category: 'unclassified',
  occurredAt: new Date().toISOString(),
  orderWithinTimestamp: '0',
  quantity: '',
  basisKnown: false,
  acquisitionBasisUsd: '',
  incomeKnown: false,
  incomeValueUsd: '',
  assertReward: false,
});

function draftFromReward(reward: RewardVersion): RewardDraft {
  return {
    instrumentId: reward.instrumentId,
    category: reward.category,
    occurredAt: reward.occurredAt,
    orderWithinTimestamp: String(reward.orderWithinTimestamp),
    quantity: reward.quantity,
    basisKnown: reward.acquisitionBasisUsd !== null,
    acquisitionBasisUsd: reward.acquisitionBasisUsd ?? '',
    incomeKnown: reward.incomeValueUsd !== null,
    incomeValueUsd: reward.incomeValueUsd ?? '',
    assertReward: false,
  };
}

function decimalValid(value: string, positive: boolean): boolean {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,30}))?$/.exec(value);
  return Boolean(match && match[1].length <= 48 && (!positive || /[1-9]/.test(value)));
}

function commandFor(
  mode: Mode,
  draft: RewardDraft,
  review: Review,
  target: RewardVersion | null,
): Command {
  if (mode === 'void') {
    if (!target || review.version !== target.version)
      throw new Error('Текущая версия не проверена.');
    return {
      kind: 'void',
      rewardId: target.rewardId,
      body: {
        requestId: newRequestId(),
        expectedJournalRevision: review.journalRevision,
        expectedVersion: target.version,
      },
    };
  }
  if (
    !draft.assertReward ||
    !draft.instrumentId ||
    !decimalValid(draft.quantity, true) ||
    (draft.basisKnown && !decimalValid(draft.acquisitionBasisUsd, false)) ||
    (draft.incomeKnown && !decimalValid(draft.incomeValueUsd, false)) ||
    !/^\d+$/.test(draft.orderWithinTimestamp) ||
    Number(draft.orderWithinTimestamp) > 2147483647 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|[+-]\d{2}:\d{2})$/.test(draft.occurredAt) ||
    !Number.isFinite(Date.parse(draft.occurredAt))
  )
    throw new Error(
      'Проверьте актив, количество, время и известные суммы. Пустая сумма не равна нулю.',
    );
  const body: RewardCommand = {
    requestId: newRequestId(),
    expectedJournalRevision: review.journalRevision,
    assertReward: true,
    instrumentId: draft.instrumentId,
    category: draft.category,
    occurredAt: new Date(Date.parse(draft.occurredAt)).toISOString(),
    orderWithinTimestamp: Number(draft.orderWithinTimestamp),
    quantity: draft.quantity,
    acquisitionBasisUsd: draft.basisKnown ? draft.acquisitionBasisUsd : null,
    incomeValueUsd: draft.incomeKnown ? draft.incomeValueUsd : null,
  };
  if (mode === 'create') return { kind: 'create', body };
  if (!target || review.version !== target.version) throw new Error('Текущая версия не проверена.');
  return {
    kind: 'correct',
    rewardId: target.rewardId,
    body: { ...body, expectedVersion: target.version },
  };
}

function sendCommand(accountId: string, command: Command): Promise<RewardReceipt> {
  if (command.kind === 'create') return assetRewardsApi.create(accountId, command.body);
  if (command.kind === 'correct')
    return assetRewardsApi.correct(accountId, command.rewardId, command.body);
  return assetRewardsApi.void(accountId, command.rewardId, command.body);
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

function AssetRewardsOwner({
  accountId,
  ownerId,
  onChanged,
}: {
  accountId: string;
  ownerId: string;
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
  const [page, setPage] = useState<RewardPage | null>(null);
  const [listRead, setListRead] = useState<ReadState>('loading');
  const [listError, setListError] = useState('');
  const [mode, setMode] = useState<Mode>('create');
  const [draft, setDraft] = useState<RewardDraft>(() => emptyDraft());
  const [target, setTarget] = useState<RewardVersion | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewRead, setReviewRead] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [reviewError, setReviewError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [writing, setWriting] = useState(false);
  const [receipt, setReceipt] = useState<RewardReceipt | null>(() => {
    const saved = recoverySnapshot(key);
    return saved?.phase === 'accepted' ? saved.receipt : null;
  });
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<RewardVersions | null>(null);
  const [historyRead, setHistoryRead] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [historyError, setHistoryError] = useState('');
  const live = useRef(false);
  const writeLock = useRef(false);
  const listGeneration = useRef(0);
  const reviewGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const callbacks = useRef({ onChanged });
  callbacks.current = { onChanged };

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
      setListRead('loading');
      setListError('');
      try {
        const state = await tradesApi.state(accountId);
        if (!state.journal) throw new Error('Сначала начните журнал этого счёта.');
        const result = await assetRewardsApi.list(accountId, state.journal.journalRevision);
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
            setDraft(emptyDraft());
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
            : accountingError(error, 'загрузить вознаграждения'),
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

  function edit(next: RewardDraft) {
    if (recoverySnapshot(key) || writeLock.current) return;
    const inputChange = Object.keys(next).some(
      (field) => next[field as keyof RewardDraft] !== draft[field as keyof RewardDraft],
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

  async function check(requestedMode: Mode, selected: RewardVersion | null) {
    if (recoverySnapshot(key) || writeLock.current || listRead !== 'ready' || !page) return;
    if (requestedMode !== 'void' && !draft.assertReward) {
      setReviewRead('error');
      setReviewError('Подтвердите, что запись описывает уже полученное вознаграждение.');
      return;
    }
    const generation = ++reviewGeneration.current;
    setReview(null);
    setReviewRead('loading');
    setReviewError('');
    try {
      const state = await tradesApi.state(accountId);
      if (!state.journal) throw new Error('Сначала начните журнал этого счёта.');
      if (state.journal.journalRevision !== page?.journalRevision)
        throw new Error('Журнал изменился. Обновите вознаграждения перед проверкой.');
      let latest: RewardVersion | null = null;
      if (selected) {
        latest = (await assetRewardsApi.versions(accountId, selected.rewardId)).items[0] ?? null;
        if (!latest || latest.kind === 'void')
          throw new Error('Запись отсутствует или уже отменена. Обновите список.');
        if (latest.version !== selected.version)
          throw new Error('Версия изменилась. Обновите список и начните исправление заново.');
      }
      if (!live.current || generation !== reviewGeneration.current) return;
      if (latest) setTarget(latest);
      setReview({
        journalRevision: state.journal.journalRevision,
        version: latest?.version ?? null,
      });
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

  async function send(command: Command, retry = false) {
    const existing = recoverySnapshot(key);
    if (
      writeLock.current ||
      (retry && (existing?.phase !== 'unknown' || existing.command !== command)) ||
      (!retry && existing)
    )
      return;
    writeLock.current = true;
    setWriting(true);
    setWriteError('');
    retainRecovery(key, { phase: 'sending', command });
    try {
      const saved = await sendCommand(accountId, command);
      retainRecovery(key, { phase: 'accepted', command, receipt: saved });
      if (!live.current) return;
      setReceipt(saved);
      setReview(null);
      await loadList(true);
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      const definitive = !retry && [400, 403, 404, 409].includes(status ?? 0);
      retainRecovery(key, definitive ? null : { phase: 'unknown', command });
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
      reviewRead !== 'ready' ||
      listRead !== 'ready'
    )
      return;
    try {
      const command = commandFor(mode, draft, review, target);
      void send(command);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : 'Проверьте запись.');
    }
  }

  async function stage(nextMode: 'correct' | 'void', reward: RewardVersion) {
    if (recoverySnapshot(key) || writeLock.current) return;
    setMode(nextMode);
    setTarget(reward);
    setDraft(draftFromReward(reward));
    setWriteError('');
    reviewGeneration.current++;
    setReview(null);
    setReviewRead('idle');
    setReviewError('');
    clearHistory();
    // Attestation resets on staging, so the user explicitly reviews this target.
  }

  async function loadHistory(
    rewardId: string,
    beforeVersion?: number,
    previous?: RewardVersions | null,
  ) {
    const generation = ++historyGeneration.current;
    setHistoryId(rewardId);
    setHistoryRead('loading');
    setHistoryError('');
    if (beforeVersion === undefined) setHistory(null);
    try {
      const next = await assetRewardsApi.versions(accountId, rewardId, beforeVersion);
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
      setHistoryError(accountingError(error, 'загрузить историю вознаграждения'));
    }
  }

  async function loadMore() {
    if (!page || page.nextOffset === null || listRead === 'loading') return;
    const generation = ++listGeneration.current;
    setListRead('loading');
    setListError('');
    try {
      const next = await assetRewardsApi.list(accountId, page.journalRevision, page.nextOffset);
      if (!live.current || generation !== listGeneration.current) return;
      if (next.journalRevision !== page.journalRevision)
        throw new Error('Ревизия списка изменилась. Обновите вознаграждения.');
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
        setReview(null);
        setReviewRead('idle');
        clearHistory();
      }
    }
  }

  const blocked = Boolean(recovery) || writing;
  const reviewed = review !== null && reviewRead === 'ready' && listRead === 'ready';
  const instrumentName = (id: string) => instruments.find((item) => item.id === id)?.name ?? id;
  const nextBeforeVersion = history?.nextBeforeVersion;

  return (
    <section className="manual-card" aria-label="Вознаграждения">
      <h2>Вознаграждения</h2>
      <p className="manual-muted">
        Записывайте актив, уже полученный как вознаграждение. Это не покупка, перевод или внешний
        ввод. Неизвестная себестоимость и неизвестный доход остаются неизвестными; оценка актива
        задаётся отдельно.
      </p>

      {recovery && (
        <section className="manual-card" aria-label="Состояние запроса вознаграждения">
          {recovery.phase === 'accepted' ? (
            <p>Команда принята. Обновите список, чтобы подтвердить текущее состояние.</p>
          ) : (
            <p>Исход запроса неизвестен. Новые записи заблокированы до точного повтора.</p>
          )}
          {recovery.phase === 'accepted' && (
            <button
              className="manual-button manual-button--secondary"
              type="button"
              disabled={listRead === 'loading'}
              onClick={() => void loadList(true)}
            >
              Обновить вознаграждения
            </button>
          )}
        </section>
      )}

      {receipt && (
        <section className="manual-card" aria-label="Квитанция вознаграждения">
          <h3>Квитанция команды</h3>
          <p>
            Квитанция неизменна и не описывает текущую себестоимость после последующих исправлений.
          </p>
          <dl className="trade-summary">
            <dt>Номер вознаграждения</dt>
            <dd>{receipt.reward.rewardId}</dd>
            <dt>Версия</dt>
            <dd>{receipt.reward.version}</dd>
            <dt>Ревизия журнала</dt>
            <dd>{receipt.journalRevision}</dd>
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
        Обновить вознаграждения
      </button>

      <form
        className="manual-form"
        aria-label="Редактор вознаграждения"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {recovery?.phase === 'unknown' && (
          <button
            className="manual-button"
            type="button"
            disabled={writing}
            onClick={() => void send(recovery.command, true)}
          >
            Повторить тот же запрос
          </button>
        )}
        <fieldset
          className="manual-position"
          disabled={blocked || catalogRead !== 'ready' || mode === 'void'}
        >
          <legend>
            {mode === 'create'
              ? 'Новое вознаграждение'
              : mode === 'correct'
                ? 'Исправление вознаграждения'
                : 'Отмена вознаграждения'}
          </legend>
          {target && (
            <p>
              Вознаграждение {target.rewardId}, версия {target.version}; актив и время получения
              неизменны.
            </p>
          )}
          <div className="manual-form-grid">
            <label>
              Актив вознаграждения
              <select
                required
                value={draft.instrumentId}
                onChange={(event) => edit({ ...draft, instrumentId: event.target.value })}
              >
                <option value="">Выберите актив</option>
                {instruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.name}
                    {instrument.symbol ? ` (${instrument.symbol})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Категория вознаграждения
              <select
                value={draft.category}
                onChange={(event) =>
                  edit({
                    ...draft,
                    category: event.target.value as RewardCategory,
                  })
                }
              >
                <option value="staking">Стейкинг</option>
                <option value="airdrop">Аирдроп</option>
                <option value="other">Другой доход</option>
                <option value="unclassified">Вид вознаграждения не уточнён</option>
              </select>
            </label>
            <label>
              Момент получения (ISO с часовым поясом)
              <input
                type="text"
                required
                value={draft.occurredAt}
                onChange={(event) => edit({ ...draft, occurredAt: event.target.value })}
              />
            </label>
            <label>
              Порядок в моменте
              <input
                inputMode="numeric"
                required
                value={draft.orderWithinTimestamp}
                onChange={(event) => edit({ ...draft, orderWithinTimestamp: event.target.value })}
              />
            </label>
            <label>
              Полученное количество
              <input
                inputMode="decimal"
                required
                value={draft.quantity}
                onChange={(event) => edit({ ...draft, quantity: event.target.value })}
              />
            </label>
            <label>
              Себестоимость вознаграждения
              <select
                value={draft.basisKnown ? 'known' : 'unknown'}
                onChange={(event) =>
                  edit({
                    ...draft,
                    basisKnown: event.target.value === 'known',
                    acquisitionBasisUsd:
                      event.target.value === 'known' ? draft.acquisitionBasisUsd : '',
                  })
                }
              >
                <option value="unknown">Неизвестна</option>
                <option value="known">Известна</option>
              </select>
            </label>
            {draft.basisKnown && (
              <label>
                Сумма себестоимости, USD
                <input
                  inputMode="decimal"
                  required
                  value={draft.acquisitionBasisUsd}
                  onChange={(event) => edit({ ...draft, acquisitionBasisUsd: event.target.value })}
                />
              </label>
            )}
            <label>
              Доход от вознаграждения
              <select
                value={draft.incomeKnown ? 'known' : 'unknown'}
                onChange={(event) =>
                  edit({
                    ...draft,
                    incomeKnown: event.target.value === 'known',
                    incomeValueUsd: event.target.value === 'known' ? draft.incomeValueUsd : '',
                  })
                }
              >
                <option value="unknown">Неизвестен</option>
                <option value="known">Известен</option>
              </select>
            </label>
            {draft.incomeKnown && (
              <label>
                Сумма дохода, USD
                <input
                  inputMode="decimal"
                  required
                  value={draft.incomeValueUsd}
                  onChange={(event) => edit({ ...draft, incomeValueUsd: event.target.value })}
                />
              </label>
            )}
          </div>
          <label className="manual-review-check">
            <input
              type="checkbox"
              checked={draft.assertReward}
              onChange={(event) => edit({ ...draft, assertReward: event.target.checked })}
            />
            Подтверждаю: это уже полученное вознаграждение, а не покупка, перевод или взнос.
          </label>
        </fieldset>
        <p className="manual-muted">
          Неизвестные суммы не становятся нулём. Нулевая сумма возможна только как явное известное
          значение; категория «Вид вознаграждения не уточнён» требует последующей проверки.
        </p>
        {target?.category === 'unclassified' && (
          <p className="manual-feedback">Вид вознаграждения не уточнён</p>
        )}
        {target && mode !== 'create' && (
          <p>
            Актив: {instrumentName(target.instrumentId)}; получено {target.occurredAt}.
          </p>
        )}
        {review && (
          <section className="manual-card" aria-label="Проверка вознаграждения">
            <h3>Проверка вознаграждения</h3>
            <dl className="trade-summary">
              <dt>Ревизия журнала</dt>
              <dd>{review.journalRevision}</dd>
              {review.version !== null && (
                <>
                  <dt>Версия записи</dt>
                  <dd>{review.version}</dd>
                </>
              )}
            </dl>
          </section>
        )}
        {reviewError && (
          <p className="manual-feedback manual-feedback--error" role="alert">
            {reviewError}
          </p>
        )}
        <button
          className="manual-button manual-button--secondary"
          type="button"
          disabled={blocked || listRead !== 'ready' || catalogRead !== 'ready'}
          onClick={() => void check(mode, target)}
        >
          {mode === 'create'
            ? 'Проверить вознаграждение'
            : mode === 'correct'
              ? 'Проверить исправление'
              : 'Проверить отмену'}
        </button>
        <button
          className="manual-button"
          type="submit"
          disabled={blocked || !reviewed || (mode !== 'void' && !draft.assertReward)}
        >
          {mode === 'create'
            ? 'Записать вознаграждение'
            : mode === 'correct'
              ? 'Записать исправление'
              : 'Отменить вознаграждение'}
        </button>
        {target && (
          <button
            className="manual-button manual-button--secondary"
            type="button"
            disabled={blocked}
            onClick={() => {
              setMode('create');
              setTarget(null);
              setDraft(emptyDraft());
              setReview(null);
              setReviewRead('idle');
              setReviewError('');
            }}
          >
            Отменить редактирование
          </button>
        )}
      </form>

      {writeError && (
        <p className="manual-feedback manual-feedback--error" role="alert">
          {writeError}
        </p>
      )}
      {listRead === 'loading' && <p>Загружаются вознаграждения…</p>}
      {listRead === 'error' && <p>Не удалось обновить список. Используйте кнопку обновления.</p>}
      {page && listRead === 'ready' && (
        <>
          <p>
            Записей: {page.activeCount}; версий: {page.versionCount}; ревизия журнала:{' '}
            {page.journalRevision}.
          </p>
          {page.items.map((reward) => (
            <article
              className="manual-card"
              key={reward.rewardId}
              aria-label={`Вознаграждение ${reward.rewardId}`}
            >
              <h3>
                {instrumentName(reward.instrumentId)} ·{' '}
                {reward.category === 'staking'
                  ? 'Стейкинг'
                  : reward.category === 'airdrop'
                    ? 'Аирдроп'
                    : reward.category === 'other'
                      ? 'Другой доход'
                      : 'Вид вознаграждения не уточнён'}
              </h3>
              <dl className="trade-summary">
                <dt>Количество</dt>
                <dd>{reward.quantity}</dd>
                <dt>Получено</dt>
                <dd>{reward.occurredAt}</dd>
                <dt>Версия</dt>
                <dd>
                  {reward.version} · {reward.kind === 'void' ? 'Отменено' : 'Активно'}
                </dd>
                <dt>Себестоимость</dt>
                <dd data-testid="reward-basis">{reward.acquisitionBasisUsd ?? 'Неизвестна'}</dd>
                <dt>Заявленный доход</dt>
                <dd data-testid="reward-income">{reward.incomeValueUsd ?? 'Неизвестен'}</dd>
                <dt>Категория</dt>
                <dd data-testid="reward-category">
                  {reward.category === 'staking'
                    ? 'Стейкинг'
                    : reward.category === 'airdrop'
                      ? 'Аирдроп'
                      : reward.category === 'other'
                        ? 'Другой доход'
                        : 'Вид вознаграждения не уточнён'}
                </dd>
              </dl>
              {reward.kind !== 'void' && (
                <div className="trade-actions">
                  <button
                    className="manual-button manual-button--secondary"
                    type="button"
                    disabled={blocked}
                    onClick={() => void stage('correct', reward)}
                  >
                    Исправить вознаграждение
                  </button>
                  <button
                    className="manual-button manual-button--secondary"
                    type="button"
                    disabled={blocked}
                    onClick={() => void stage('void', reward)}
                  >
                    Отменить вознаграждение
                  </button>
                </div>
              )}
              <button
                className="manual-button manual-button--secondary"
                type="button"
                disabled={blocked || (historyId === reward.rewardId && historyRead === 'loading')}
                onClick={() => void loadHistory(reward.rewardId)}
              >
                История вознаграждения
              </button>
              {historyId === reward.rewardId && (
                <section aria-label="История вознаграждения">
                  {historyError && <p role="alert">{historyError}</p>}
                  {history?.items.map((version) => (
                    <p key={version.version}>
                      Версия {version.version}: {version.kind}, {version.occurredAt}, количество{' '}
                      {version.quantity}; себестоимость{' '}
                      {version.acquisitionBasisUsd ?? 'Неизвестна'}; доход{' '}
                      {version.incomeValueUsd ?? 'Неизвестен'}.
                    </p>
                  ))}
                  {nextBeforeVersion !== null && nextBeforeVersion !== undefined && (
                    <button
                      className="manual-button manual-button--secondary"
                      type="button"
                      disabled={historyRead === 'loading'}
                      onClick={() => void loadHistory(reward.rewardId, nextBeforeVersion, history)}
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
              Следующие вознаграждения
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function AssetRewards({
  accountId,
  onChanged,
}: { accountId: string; onChanged: () => void }) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <AssetRewardsOwner
      key={`${user.id}:${accountId}`}
      accountId={accountId}
      ownerId={user.id}
      onChanged={onChanged}
    />
  );
}

export default AssetRewards;
