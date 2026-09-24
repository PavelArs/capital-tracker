import {
  type DisplayFxRefreshOutcome,
  type DisplayFxReport,
  displayFxApi,
} from '@api/display-fx.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { toDisplayFxView } from './display-fx-view';
import './DisplayFxPanel.css';

type Loaded = { report: DisplayFxReport; requestedAmount: string };

const outcomeText: Record<DisplayFxRefreshOutcome, string> = {
  collected: 'Новые курсы сохранены.',
  cooldown: 'Сбор пока недоступен. Следующая попытка показана ниже.',
  'in-progress': 'Сбор курсов уже выполняется.',
  disabled: 'Сбор курсов отключён.',
  failed: 'Не удалось получить новые курсы. Последние сохранённые данные не удалены.',
  'rate-limited': 'Поставщик ограничил запросы. Следующая попытка показана ниже.',
  superseded: 'Этот сбор завершился после другой попытки. Показаны данные из базы.',
};

function requestError(error: unknown, action: string): string {
  if (isAxiosError(error)) {
    if (error.response?.status === 400) return 'Проверьте сумму USD и повторите запрос.';
    if (error.response?.status === 401) return 'Сеанс завершён. Войдите снова.';
    if (error.response?.status === 403) return 'Запрос отклонён. Обновите страницу и повторите.';
  }
  return `Не удалось ${action}. Проверьте подключение и сохранённые данные позже.`;
}

export function DisplayFxPanel() {
  const [amount, setAmount] = useState('1');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const currentAmount = useRef(amount);
  const mounted = useRef(false);
  currentAmount.current = amount;

  const fetchSaved = useCallback(
    async (requestedAmount: string, intent: number, clearResult: boolean) => {
      if (clearResult) setLoaded(null);
      setReading(true);
      if (clearResult) setError(null);
      try {
        const report = await displayFxApi.read(requestedAmount);
        if (
          !mounted.current ||
          generation.current !== intent ||
          currentAmount.current !== requestedAmount
        )
          return;
        setLoaded({ report, requestedAmount });
        setEnabled(report.enabled);
        setCollectionBusy(report.collection.inProgress);
      } catch (caught) {
        if (
          !mounted.current ||
          generation.current !== intent ||
          currentAmount.current !== requestedAmount
        )
          return;
        setError(requestError(caught, 'загрузить сохранённые курсы'));
      } finally {
        if (mounted.current && generation.current === intent) setReading(false);
      }
    },
    [],
  );

  useEffect(() => {
    mounted.current = true;
    const intent = ++generation.current;
    void fetchSaved('1', intent, true);
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [fetchSaved]);

  function edit(value: string) {
    generation.current++;
    currentAmount.current = value;
    setAmount(value);
    setLoaded(null);
    setReading(false);
    setNotice(null);
    setError(null);
  }

  function readSaved(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!amount.trim() || reading) return;
    setNotice(null);
    const intent = ++generation.current;
    void fetchSaved(amount, intent, true);
  }

  async function collect() {
    if (collecting || reading || enabled !== true || collectionBusy) return;
    const requestedAmount = currentAmount.current;
    const intent = ++generation.current;
    setCollecting(true);
    setNotice(null);
    setError(null);
    try {
      const { outcome } = await displayFxApi.refresh();
      if (
        !mounted.current ||
        generation.current !== intent ||
        currentAmount.current !== requestedAmount
      )
        return;
      setNotice(outcomeText[outcome]);
    } catch (caught) {
      if (
        !mounted.current ||
        generation.current !== intent ||
        currentAmount.current !== requestedAmount
      )
        return;
      setError(requestError(caught, 'подтвердить результат сбора курсов'));
    } finally {
      if (mounted.current) setCollecting(false);
    }
    if (
      mounted.current &&
      generation.current === intent &&
      currentAmount.current === requestedAmount
    )
      await fetchSaved(requestedAmount, intent, false);
  }

  const report = loaded?.requestedAmount === amount ? loaded.report : null;
  const view = report ? toDisplayFxView(report) : null;
  const providerFailed =
    report?.collection.outcome === 'provider-error' ||
    report?.collection.outcome === 'rate-limited' ||
    report?.collection.outcome === 'invalid-data' ||
    report?.collection.outcome === 'interrupted';

  return (
    <section className="display-fx" aria-label="Пересчёт USD в EUR и RUB">
      <h2>Пересчёт USD в EUR и RUB</h2>
      <p>
        Справочный пересчёт по последним сохранённым суточным курсам. Это не курс сделки и не
        исторический курс на дату операции. Суммы USD в учёте, прибыли и XIRR не меняются.
      </p>
      <form className="display-fx__form" onSubmit={readSaved}>
        <label>
          Сумма в USD
          <input
            type="text"
            value={amount}
            onChange={(event) => edit(event.target.value)}
            required
            inputMode="decimal"
          />
        </label>
        <button type="submit" disabled={reading || !amount.trim()}>
          Рассчитать по сохранённым курсам
        </button>
        <button type="button" disabled={reading || !amount.trim()} onClick={() => readSaved()}>
          Обновить из базы
        </button>
        <button
          type="button"
          disabled={collecting || reading || enabled !== true || collectionBusy}
          onClick={() => void collect()}
        >
          Получить свежие курсы
        </button>
      </form>
      <p>
        Источник: <a href="https://www.exchangerate-api.com">Rates By Exchange Rate API</a>. Курсы
        публикуются раз в сутки и предназначены только для справочного отображения.
      </p>
      {enabled === false && <p>Сбор курсов отключён</p>}
      {reading && <p>Загрузка сохранённых курсов…</p>}
      {collecting && <p>Получение курсов…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {view && report && (
        <div className="display-fx__result">
          <p>{view.statusText}</p>
          {providerFailed && (
            <p>
              Последняя попытка сбора не удалась.{' '}
              {report.observation
                ? 'Показаны ранее сохранённые курсы.'
                : 'Сохранённых курсов пока нет.'}
            </p>
          )}
          {report.collection.nextAttemptAt && (
            <p>
              Следующая попытка не ранее: <span>{report.collection.nextAttemptAt}</span>
            </p>
          )}
          {report.observation && (
            <>
              <p>
                Публикация поставщика UTC: <span>{report.observation.observedAt}</span>
              </p>
              <p>
                Загружено UTC: <span>{report.observation.fetchedAt}</span>
              </p>
              <p>
                Следующее обновление поставщика UTC: <span>{report.observation.nextUpdateAt}</span>
              </p>
              {report.observation.endOfLifeAt && (
                <p>
                  Окончание работы источника UTC: <span>{report.observation.endOfLifeAt}</span>
                </p>
              )}
              <div className="display-fx__table-wrap">
                <table aria-label="Справочный пересчёт">
                  <caption>Справочный пересчёт</caption>
                  <thead>
                    <tr>
                      <th scope="col">Валюта</th>
                      <th scope="col">Курс за 1 USD</th>
                      <th scope="col">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((row) => (
                      <tr key={row.currency}>
                        <td>{row.currency}</td>
                        <td>{row.rate}</td>
                        <td>{row.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
