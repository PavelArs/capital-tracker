import {
  type CarryInInitialization,
  type CarryInLots,
  type CarryInOrigin,
  type CarryInPreview,
  type CarryInPreviewInput,
  type CarryInState,
  carryInApi,
} from '@api/carry-in.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CarryInEvidence, CarryInOpening, CarryInPreviewView } from './CarryInEvidence';
import { accountingError, newRequestId } from './feedback';

type LotDraft = {
  key: string;
  instrumentId: string;
  acquiredAt: string;
  orderWithinTimestamp: string;
  originalQuantity: string;
  originalCostUsd: string;
  remainingQuantity: string;
};
function emptyLot(): LotDraft {
  return {
    key: newRequestId(),
    instrumentId: '',
    acquiredAt: '',
    orderWithinTimestamp: '0',
    originalQuantity: '',
    originalCostUsd: '',
    remainingQuantity: '',
  };
}
type Recovery = {
  input: CarryInInitialization;
  phase: 'sending' | 'unknown' | 'accepted';
  receipt?: CarryInOrigin;
};
// Keep the complete operation through SPA navigation/authentication, never in browser storage.
// Full document reload ends this recovery lifetime; normal server discovery remains available.
const recoveries = new Map<string, Recovery>();
const listeners = new Set<() => void>();
function retain(accountId: string, recovery: Recovery | null) {
  if (recovery) recoveries.set(accountId, recovery);
  else recoveries.delete(accountId);
  for (const notify of listeners) notify();
}
function message(error: unknown): string {
  if (isAxiosError(error) && error.response?.status === 409)
    return 'Начальные позиции или состояние журнала изменились либо лоты не согласуются с позициями. Обновите исходные данные и повторно проверьте лоты. Черновик не отправляется автоматически.';
  if (isAxiosError(error) && error.response?.status === 413)
    return 'Запрос превышает допустимые 100 КиБ. Сократите запись значений; допускается не более 100 лотов.';
  return accountingError(error, 'обработать начальные лоты');
}

export function CarryIn({
  accountId,
  hasJournal,
  parentBusy,
  parentBlocked,
  onBlocked,
  onJournalRefresh,
}: {
  accountId: string;
  hasJournal: boolean | null;
  parentBusy: boolean;
  parentBlocked: boolean;
  onBlocked: (blocked: boolean) => void;
  onJournalRefresh: () => Promise<boolean>;
}) {
  const [state, setState] = useState<CarryInState | null>(null);
  const [draft, setDraft] = useState<LotDraft[]>(
    () =>
      recoveries.get(accountId)?.input.lots.map((lot) => ({
        ...lot,
        key: newRequestId(),
        orderWithinTimestamp: String(lot.orderWithinTimestamp),
      })) ?? [emptyLot()],
  );
  const [preview, setPreview] = useState<{
    value: CarryInPreview;
    input: CarryInPreviewInput;
    generation: number;
  } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [lots, setLots] = useState<CarryInLots | null>(null);
  const [recovery, setRecovery] = useState(() => recoveries.get(accountId));
  const [receipt, setReceipt] = useState<CarryInOrigin | null>(
    () => recoveries.get(accountId)?.receipt ?? null,
  );
  const [reading, setReading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(false);
  const generation = useRef(0);
  const currentState = useRef(state);
  const currentHasJournal = useRef(hasJournal);
  const callbacks = useRef({ parentBusy, parentBlocked, onBlocked, onJournalRefresh });
  callbacks.current = { parentBusy, parentBlocked, onBlocked, onJournalRefresh };
  currentState.current = state;
  currentHasJournal.current = hasJournal;

  const refresh = useCallback(
    async (refreshJournal = true) => {
      const request = ++generation.current;
      const accepted = recoveries.get(accountId);
      setReading(true);
      setPreview(null);
      setReviewed(false);
      setError(null);
      try {
        const next = await carryInApi.state(accountId);
        const [evidence, journal] = await Promise.allSettled([
          next.origin ? carryInApi.lots(accountId) : Promise.resolve(null),
          refreshJournal ? callbacks.current.onJournalRefresh() : Promise.resolve(true),
        ]);
        if (!live.current || request !== generation.current) return;
        setState(next);
        currentState.current = next;
        setLots(evidence.status === 'fulfilled' ? evidence.value : null);
        const acceptedOriginMissing =
          accepted?.phase === 'accepted' && next.origin?.requestId !== accepted.receipt?.requestId;
        if (
          evidence.status === 'rejected' ||
          journal.status === 'rejected' ||
          !journal.value ||
          acceptedOriginMissing
        ) {
          setError(
            accepted?.phase === 'accepted'
              ? 'Инициализация принята, квитанция сохранена. Не удалось полностью обновить начальные лоты и текущий журнал. Обновите состояние перед новой записью; повторять принятую команду не нужно.'
              : 'Не удалось полностью загрузить начальные лоты и текущий журнал. Повторите обновление.',
          );
          return;
        }
        if (accepted?.phase === 'accepted' && recoveries.get(accountId) === accepted)
          retain(accountId, null);
      } catch (error) {
        if (live.current && request === generation.current)
          setError(
            accepted?.phase === 'accepted'
              ? 'Инициализация принята, квитанция сохранена. Текущее состояние ещё не загружено. Обновите состояние перед новой записью; повторять принятую команду не нужно.'
              : message(error),
          );
      } finally {
        if (live.current && request === generation.current) setReading(false);
      }
    },
    [accountId],
  );

  useEffect(() => {
    live.current = true;
    const update = () => {
      const next = recoveries.get(accountId);
      setRecovery(next);
      callbacks.current.onBlocked(next !== undefined);
      if (next?.receipt) setReceipt(next.receipt);
    };
    listeners.add(update);
    update();
    // Initial discovery must not reset an existing manual correction's review state.
    void refresh(recoveries.get(accountId)?.phase === 'accepted');
    return () => {
      live.current = false;
      generation.current++;
      listeners.delete(update);
      callbacks.current.onBlocked(false);
    };
  }, [accountId, refresh]);

  useEffect(() => {
    if (hasJournal !== true) return;
    // A read may discover the original successful initialization while its response
    // is still unknown. Invalidate first-submit consent, but never discard recovery.
    setPreview(null);
    setReviewed(false);
  }, [hasJournal]);

  function edit(next: LotDraft[]) {
    if (recoveries.has(accountId) || callbacks.current.parentBlocked) return;
    generation.current++;
    setReading(false);
    setDraft(next);
    setPreview(null);
    setReviewed(false);
    setError(null);
  }
  async function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !state?.eligible ||
      !state.opening ||
      hasJournal !== false ||
      recovery ||
      reading ||
      parentBlocked
    )
      return;
    if (
      draft.some(
        (lot) =>
          !/^(0|[1-9][0-9]*)$/.test(lot.orderWithinTimestamp) ||
          Number(lot.orderWithinTimestamp) > 2147483647,
      )
    ) {
      setError('Порядок должен быть целым числом от 0 до 2147483647.');
      return;
    }
    const input: CarryInPreviewInput = {
      expectedOpeningRevision: state.opening.revision,
      lots: draft.map(({ key: _key, ...lot }) => ({
        ...lot,
        orderWithinTimestamp: Number(lot.orderWithinTimestamp),
      })),
    };
    const request = ++generation.current;
    setReading(true);
    setPreview(null);
    setReviewed(false);
    setError(null);
    try {
      const value = await carryInApi.preview(accountId, input);
      if (
        live.current &&
        request === generation.current &&
        currentHasJournal.current === false &&
        value.openingRevision === input.expectedOpeningRevision &&
        currentState.current?.opening?.revision === input.expectedOpeningRevision
      )
        setPreview({ value, input, generation: request });
    } catch (error) {
      if (live.current && request === generation.current) setError(message(error));
    } finally {
      if (live.current && request === generation.current) setReading(false);
    }
  }
  async function send(input: CarryInInitialization, prior?: Recovery) {
    if (callbacks.current.parentBusy || recoveries.get(accountId)?.phase === 'sending') return;
    const record: Recovery = { input, phase: 'sending' };
    callbacks.current.onBlocked(true);
    retain(accountId, record);
    generation.current++;
    setReading(false);
    setPreview(null);
    setReviewed(false);
    setError(null);
    let accepted: Recovery;
    try {
      const value = await carryInApi.initialize(accountId, input);
      accepted = { input, phase: 'accepted', receipt: value };
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      const refused = status !== undefined && status >= 400 && status < 500;
      // A previous unknown outcome survives all reads and pre-controller refusals.
      // Only this original POST's post-replay409 or accepted receipt resolves it.
      const unknown = prior?.phase === 'unknown' ? status !== 409 : !refused;
      if (recoveries.get(accountId) === record)
        retain(accountId, unknown ? { ...record, phase: 'unknown' } : null);
      if (live.current) setError(message(error));
      return;
    }
    if (recoveries.get(accountId) !== record) return;
    retain(accountId, accepted);
    if (!live.current) return;
    setReceipt(accepted.receipt!);
    await refresh();
  }
  function initialize() {
    if (
      recovery ||
      reading ||
      parentBlocked ||
      !reviewed ||
      !state?.eligible ||
      hasJournal !== false ||
      !preview?.value.canInitialize ||
      preview.generation !== generation.current ||
      preview.input.expectedOpeningRevision !== state.opening?.revision
    )
      return;
    void send({ ...preview.input, requestId: newRequestId(), assertReviewed: true });
  }
  async function more() {
    const cursor = lots?.nextAfterOrdinal;
    if (cursor == null || reading || parentBusy || recovery?.phase === 'sending') return;
    const request = ++generation.current;
    setReading(true);
    setError(null);
    try {
      const page = await carryInApi.lots(accountId, cursor);
      if (live.current && request === generation.current)
        setLots((current) =>
          current && current.openingRevision === page.openingRevision
            ? { ...page, items: [...current.items, ...page.items] }
            : page,
        );
    } catch (error) {
      if (live.current && request === generation.current) setError(message(error));
    } finally {
      if (live.current && request === generation.current) setReading(false);
    }
  }

  if (
    !reading &&
    !error &&
    !recovery &&
    state &&
    !state.origin &&
    (state.ineligibilityReason === 'already-initialized' ||
      state.ineligibilityReason === 'no-current-opening')
  )
    return null;
  const locked = recovery !== undefined || parentBlocked;
  const busy = reading || parentBusy || recovery?.phase === 'sending';
  return (
    <section className="manual-card" aria-labelledby="carry-in-heading">
      <h3 id="carry-in-heading">Начальные лоты FIFO</h3>
      <p>
        Укажите достоверные исходные приобретения для сохранённых начальных позиций. Общая
        себестоимость сама по себе не определяет покупки и их порядок.
      </p>
      <p className="manual-coverage-warning">
        После открытия журнала начальные лоты пока нельзя изменить или удалить, даже если все сделки
        аннулированы. Исправления последующих сделок доступны. Не подтверждайте неподтверждённую
        историю.
      </p>
      {reading && <p role="status">Загрузка начальных лотов…</p>}
      {error && (
        <p role="alert" className="manual-feedback manual-feedback--error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="manual-button manual-button--secondary"
        disabled={busy}
        onClick={() => void refresh()}
      >
        Обновить начальные лоты
      </button>
      {receipt && (
        <p role="status" className="manual-feedback manual-feedback--success">
          Сохранена квитанция инициализации {receipt.requestId}. Ревизия начальных позиций:{' '}
          {receipt.openingRevision}; лотов: {receipt.lotCount}; начальная учётная стоимость, USD:{' '}
          {receipt.carryInCostUsd}. Квитанция не заменяет текущий журнал.
        </p>
      )}
      {recovery?.phase === 'unknown' && (
        <div className="manual-coverage-warning">
          <p>
            Результат исходной инициализации неизвестен. Исходные лоты, ключ запроса и ревизия{' '}
            {recovery.input.expectedOpeningRevision} сохранены; изменения и новые записи
            заблокированы. Обновление данных не заменяет исходную команду.
          </p>
          <button
            type="button"
            className="manual-button"
            disabled={busy}
            onClick={() => void send(recovery.input, recovery)}
          >
            Повторить исходную инициализацию
          </button>
        </div>
      )}
      {recovery?.phase === 'accepted' && (
        <p role="alert">
          Инициализация принята. До успешного обновления начальных лотов и текущего журнала новые
          записи заблокированы.
        </p>
      )}
      {state?.opening && <CarryInOpening opening={state.opening} />}
      {state?.ineligibilityReason === 'unknown-cost' && (
        <p role="note" className="manual-coverage-warning">
          В начальных позициях есть неизвестная себестоимость. Перенос в FIFO и продажи этих
          остатков пока недоступны. Неизвестная стоимость не считается нулевой; сохранённые позиции
          доступны без изменений.
        </p>
      )}
      {state?.eligible && hasJournal === false && (
        <form onSubmit={check} className="manual-form">
          <p>
            От 1 до 100 лотов. Исходная стоимость включает прежние комиссии приобретения один раз.
            Количество на начало учета может быть меньше исходного. Суммы должны точно совпасть с
            сохранёнными позициями по каждому UUID.
          </p>
          {draft.map((lot, index) => (
            <fieldset key={lot.key} className="manual-position" disabled={locked}>
              <legend>Лот {index + 1}</legend>
              <div className="manual-form-grid">
                <label>
                  Инструмент
                  <select
                    required
                    value={lot.instrumentId}
                    onChange={(event) =>
                      edit(
                        draft.map((row) =>
                          row.key === lot.key ? { ...row, instrumentId: event.target.value } : row,
                        ),
                      )
                    }
                  >
                    <option value="">Выберите инструмент</option>
                    {state.opening?.positions.map((position) => (
                      <option key={position.instrumentId} value={position.instrumentId}>
                        {position.instrumentName}
                        {position.instrumentSymbol ? ` (${position.instrumentSymbol})` : ''} —{' '}
                        {position.instrumentId}
                      </option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    ['acquiredAt', 'Дата и время приобретения (UTC)'],
                    ['orderWithinTimestamp', 'Порядок в этот момент'],
                    ['originalQuantity', 'Исходное количество'],
                    ['originalCostUsd', 'Исходная стоимость, USD'],
                    ['remainingQuantity', 'Количество на начало учета'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field}>
                    {label}
                    <input
                      type="text"
                      required
                      autoComplete="off"
                      inputMode={
                        field === 'acquiredAt'
                          ? 'text'
                          : field === 'orderWithinTimestamp'
                            ? 'numeric'
                            : 'decimal'
                      }
                      value={lot[field]}
                      placeholder={field === 'acquiredAt' ? '2025-01-01T12:30:00.000Z' : undefined}
                      onChange={(event) =>
                        edit(
                          draft.map((row) =>
                            row.key === lot.key ? { ...row, [field]: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="manual-button manual-button--secondary"
                disabled={draft.length === 1}
                onClick={() => edit(draft.filter((row) => row.key !== lot.key))}
              >
                Удалить лот {index + 1}
              </button>
            </fieldset>
          ))}
          <p className="manual-muted">
            Время укажите явно с часовым поясом, например 2025-01-01T12:30:00.000Z. Оно не может
            быть позже границы покрытия. Порядок различает все лоты с одинаковым временем, в том
            числе разных инструментов.
          </p>
          <button
            type="button"
            className="manual-button manual-button--secondary"
            disabled={locked || draft.length >= 100}
            onClick={() => edit([...draft, emptyLot()])}
          >
            Добавить лот
          </button>
          <button type="submit" className="manual-button" disabled={locked || reading}>
            Проверить начальные лоты
          </button>
        </form>
      )}
      {preview && <CarryInPreviewView preview={preview.value} />}
      {state?.eligible && hasJournal === false && (
        <div>
          <label className="manual-review-check">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={locked || reading || !preview?.value.canInitialize}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            Подтверждаю исходные данные лотов и понимаю, что начальные лоты пока нельзя изменить.
          </label>
          <button
            type="button"
            className="manual-button"
            disabled={locked || reading || !reviewed || !preview?.value.canInitialize}
            onClick={initialize}
          >
            Начать журнал с начальными лотами
          </button>
        </div>
      )}
      {lots && <CarryInEvidence lots={lots} busy={busy} onMore={() => void more()} />}
      <p className="manual-muted">
        Неизвестная команда сохраняется при обновлении данных внутри приложения, переходах и
        повторном входе. Полная перезагрузка страницы, закрытие вкладки или браузера удаляет
        локальное восстановление. Принятые сервером данные остаются доступны.
      </p>
    </section>
  );
}
