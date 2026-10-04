import { type ValuationHistorySeries, valuationHistoryApi } from '@api/valuation-history.api';
import { DateTimeField, utcDay } from '@components/common/DateTimeField';
import { isAxiosError } from 'axios';
import { Chart as ChartJS, Legend, LinearScale, PointElement, Title, Tooltip } from 'chart.js';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Scatter } from 'react-chartjs-2';
import { accountingError } from './feedback';
import { toValuationChartData, valuationChartOptions } from './valuation-chart';

ChartJS.register(LinearScale, PointElement, Tooltip, Legend, Title);

type Loaded = {
  series: ValuationHistorySeries;
  accountId: string;
  observedRevision: number | null;
};

export function ValuationHistory({
  accountId,
  journalRevision,
}: {
  accountId: string;
  journalRevision: number | null;
}) {
  const id = useId();
  const [from, setFrom] = useState(() => utcDay(-7));
  const [to, setTo] = useState(utcDay);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const current = useRef({ accountId, journalRevision });
  const previous = useRef({ accountId, journalRevision });

  current.current = { accountId, journalRevision };
  useEffect(() => {
    if (
      previous.current.accountId !== accountId ||
      previous.current.journalRevision !== journalRevision
    ) {
      previous.current = { accountId, journalRevision };
      generation.current++;
      setLoaded(null);
      setLoading(false);
      setError(null);
    }
    return () => {
      generation.current++;
    };
  }, [accountId, journalRevision]);

  function edit(field: 'from' | 'to', value: string) {
    generation.current++;
    if (field === 'from') setFrom(value);
    else setTo(value);
    setLoaded(null);
    setLoading(false);
    setError(null);
  }

  async function calculate() {
    if (!from.trim() || !to.trim() || loading) return;
    const request = ++generation.current;
    const owner = accountId;
    const observedRevision = journalRevision;
    setLoaded(null);
    setLoading(true);
    setError(null);
    try {
      const series = await valuationHistoryApi.series(owner, from, to);
      if (
        request !== generation.current ||
        current.current.accountId !== owner ||
        current.current.journalRevision !== observedRevision
      )
        return;
      if (series.accountId !== owner) {
        setError('Ответ не согласуется с выбранным счётом. Запросите историю заново.');
        return;
      }
      setLoaded({ series, accountId: owner, observedRevision });
    } catch (caught) {
      if (
        request !== generation.current ||
        current.current.accountId !== owner ||
        current.current.journalRevision !== observedRevision
      )
        return;
      setError(
        isAxiosError(caught) && caught.response?.status === 409
          ? 'Начало периода вне покрытия или учётный срез изменился. Проверьте даты и запросите историю заново.'
          : accountingError(caught, 'показать историю стоимости счёта'),
      );
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void calculate();
  }

  const visible =
    loaded?.accountId === accountId && loaded.observedRevision === journalRevision ? loaded : null;
  const series = visible?.series;
  const chart = series ? toValuationChartData(series.points) : null;
  const hasCompletePoints = (chart?.datasets[0].data.length ?? 0) > 0;

  return (
    <section
      className="valuation-history account-analytics__tool"
      aria-label="История стоимости счёта"
    >
      <h3>История стоимости счёта</h3>
      <p className="account-analytics__scope">
        Стоимость позиций этого счёта: до 30 истекших дней, шаг 24 часа и точный конец. Пробелы не
        заменяются нулём; это не прибыль или доходность.
      </p>
      <form className="valuation-history__form account-analytics__form" onSubmit={submit}>
        <div className="account-analytics__field">
          <DateTimeField
            label="Начало периода"
            timeLabel="Время начала периода, UTC"
            describedBy={`${id}-field-0-hint`}
            value={from}
            onChange={(value) => edit('from', value)}
            required
          />
          <small className="account-analytics__hint" id={`${id}-field-0-hint`}>
            Без времени — 00:00 UTC, расчёт в UTC. До 30 истекших дней; точки каждые 24 часа от
            начала и точный конец.
          </small>
        </div>
        <div className="account-analytics__field">
          <DateTimeField
            label="Конец периода"
            timeLabel="Время конца периода, UTC"
            describedBy={`${id}-field-1-hint`}
            value={to}
            onChange={(value) => edit('to', value)}
            required
          />
          <small className="account-analytics__hint" id={`${id}-field-1-hint`}>
            Без времени — 00:00 UTC, расчёт в UTC. До 30 истекших дней; точки каждые 24 часа от
            начала и точный конец.
          </small>
        </div>
        <div className="account-analytics__actions">
          <button
            className="manual-button"
            type="submit"
            disabled={loading || !from.trim() || !to.trim()}
          >
            Показать историю
          </button>
          {series && (
            <button
              className="manual-button"
              type="button"
              disabled={loading}
              onClick={() => void calculate()}
            >
              Обновить историю
            </button>
          )}
        </div>
      </form>
      <details className="account-analytics__method">
        <summary>Как строится история</summary>
        <p className="manual-muted">
          Период до 30 истекших дней. Точки через каждые 24 часа от начала и точный конец периода;
          это не непрерывная история цен. Только позиции этого счёта и ручные цены USD за единицу на
          точный момент UTC: без переноса цены, интерполяции или внешнего провайдера. Исправления
          журнала и цен пересчитывают прошлые точки после обновления. Денежный остаток, весь
          портфель, прибыль и доходность сюда не входят.
        </p>
      </details>
      {loading && <p>Загрузка истории стоимости…</p>}
      {error && <p role="alert">{error}</p>}
      {series && chart && (
        <div className="valuation-history__results account-analytics__results">
          <p>
            Период UTC: <span>{series.from}</span> — <span>{series.to}</span>
          </p>
          <p>
            График показывает приближённые координаты. Точные суммы приведены в таблице и
            подсказках.
          </p>
          {hasCompletePoints ? (
            <div className="valuation-history__chart">
              <Scatter
                role="img"
                aria-label="График стоимости счёта"
                data={chart}
                options={valuationChartOptions}
              />
            </div>
          ) : (
            <p>Нет полных оценок для графика</p>
          )}
          <div
            className="valuation-history__table-wrap account-analytics__table-wrap"
            role="region"
            aria-label="Прокрутка истории стоимости"
            tabIndex={0}
          >
            <table aria-label="Оценки по датам">
              <caption>Оценки по датам</caption>
              <thead>
                <tr>
                  <th scope="col">Момент UTC</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Стоимость позиций, USD</th>
                  <th scope="col">Оценённая часть, USD</th>
                  <th scope="col">Без цены</th>
                </tr>
              </thead>
              <tbody>
                {series.points.map((point) => (
                  <tr key={point.at}>
                    <td>{point.at}</td>
                    <td>
                      {point.completeness === 'complete' ? 'Полная оценка' : 'Нет полной оценки'}
                    </td>
                    <td>{point.totalValueUsd ?? '—'}</td>
                    <td>{point.pricedSubtotalUsd}</td>
                    <td>{point.missingPriceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="account-analytics__evidence">
            <p>
              Граница покрытия UTC: <span>{series.coverageFrom}</span>
            </p>
            <p>
              Ревизия журнала: <span>{series.journalRevision}</span>
            </p>
            <p>
              Основа: текущая исправленная история;{' '}
              {series.originKind === 'known-cost-carry-in' ? 'перенесённые лоты' : 'пустое начало'}.
              {series.openingRevision !== null && ` Ревизия открытия: ${series.openingRevision}.`}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
