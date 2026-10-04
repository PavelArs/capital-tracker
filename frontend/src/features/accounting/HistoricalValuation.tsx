import {
  type HistoricalValuationSnapshot,
  historicalValuationApi,
} from '@api/historical-valuation.api';
import { DateTimeField, utcDay } from '@components/common/DateTimeField';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { accountingError } from './feedback';

type Position = HistoricalValuationSnapshot['items'][number];

function unrealizedGap(snapshot: HistoricalValuationSnapshot) {
  const reasons = [
    snapshot.missingPriceCount > 0 && `нет точной цены для ${snapshot.missingPriceCount} позиций`,
    snapshot.unknownCostCount > 0 &&
      `неизвестна себестоимость ${snapshot.unknownCostCount} позиций`,
  ].filter(Boolean);
  return `Нереализованная прибыль недоступна: ${reasons.join('; ')}.`;
}

function unrealizedCell(item: Position) {
  if (item.unrealizedPnlUsd !== null) return item.unrealizedPnlUsd;
  return item.price === null ? 'Нужна точная цена' : 'Неизвестна себестоимость';
}

const percent = (value: string | null) => (value === null ? '—' : `${value} %`);

type Loaded = {
  snapshot: HistoricalValuationSnapshot;
  accountId: string;
  observedRevision: number | null;
};

export function HistoricalValuation({
  accountId,
  journalRevision,
}: {
  accountId: string;
  journalRevision: number | null;
}) {
  const id = useId();
  const [instant, setInstant] = useState(utcDay);
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

  function edit(value: string) {
    generation.current++;
    setInstant(value);
    setLoaded(null);
    setLoading(false);
    setError(null);
  }

  async function calculate() {
    if (!instant.trim() || loading) return;
    const request = ++generation.current;
    const owner = accountId;
    const observedRevision = journalRevision;
    setLoaded(null);
    setLoading(true);
    setError(null);
    try {
      const snapshot = await historicalValuationApi.snapshot(owner, instant);
      if (
        request !== generation.current ||
        current.current.accountId !== owner ||
        current.current.journalRevision !== observedRevision
      )
        return;
      if (snapshot.accountId !== owner) {
        setError('Ответ не согласуется с выбранным счётом. Рассчитайте стоимость заново.');
        return;
      }
      setLoaded({ snapshot, accountId: owner, observedRevision });
    } catch (caught) {
      if (
        request !== generation.current ||
        current.current.accountId !== owner ||
        current.current.journalRevision !== observedRevision
      )
        return;
      setError(
        isAxiosError(caught) && caught.response?.status === 409
          ? 'Дата вне покрытия или учётный срез изменился. Проверьте дату и выполните новый расчёт.'
          : accountingError(caught, 'рассчитать стоимость счёта'),
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
  const snapshot = visible?.snapshot;

  return (
    <section
      className="historical-valuation account-analytics__tool"
      aria-label="Оценка счёта на дату"
    >
      <h3>Оценка счёта на дату</h3>
      <p className="account-analytics__scope">
        Стоимость только позиций этого счёта по точным ручным ценам. Денежный остаток и весь
        портфель не включены.
      </p>
      <form className="historical-valuation__form account-analytics__form" onSubmit={submit}>
        <div className="account-analytics__field">
          <DateTimeField
            label="Дата оценки"
            timeLabel="Время оценки, UTC"
            describedBy={`${id}-field-0-hint`}
            value={instant}
            onChange={edit}
            required
          />
          <small className="account-analytics__hint" id={`${id}-field-0-hint`}>
            Без времени оценка считается на 00:00 UTC. Ручная цена должна точно совпадать с
            выбранными датой и временем UTC.
          </small>
        </div>
        <div className="account-analytics__actions">
          <button className="manual-button" type="submit" disabled={loading || !instant.trim()}>
            Рассчитать стоимость
          </button>
          {snapshot && (
            <button
              className="manual-button"
              type="button"
              disabled={loading}
              onClick={() => void calculate()}
            >
              Обновить оценку
            </button>
          )}
        </div>
      </form>
      <details className="account-analytics__method">
        <summary>Как устроена оценка</summary>
        <p className="manual-muted">
          Только позиции этого счёта по текущему исправленному журналу. Ручные цены USD за единицу
          применяются только при точном совпадении момента UTC. Нет переноса предыдущей цены,
          интерполяции или цены по символу. Нереализованная прибыль равна стоимости минус оставшаяся
          себестоимость FIFO; доход в процентах округляется до сотых. Результат не включает денежный
          остаток и весь портфель; исправления могут пересчитать прошлую оценку.
        </p>
      </details>
      {loading && <p>Расчёт стоимости…</p>}
      {error && <p role="alert">{error}</p>}
      {snapshot && (
        <div className="historical-valuation__results account-analytics__results">
          <p>
            Момент оценки UTC: <span>{snapshot.at}</span>
          </p>
          {snapshot.completeness === 'complete' ? (
            <dl>
              <dt>Стоимость позиций, USD</dt>
              <dd>{snapshot.totalValueUsd}</dd>
            </dl>
          ) : (
            <>
              <p>
                <strong>Итого недоступно</strong>: нет точной цены для {snapshot.missingPriceCount}{' '}
                позиций.
              </p>
              <dl>
                <dt>Оценённая часть, USD</dt>
                <dd>{snapshot.pricedSubtotalUsd}</dd>
              </dl>
            </>
          )}
          {snapshot.unrealizedPnlUsd === null ? (
            <p>{unrealizedGap(snapshot)}</p>
          ) : (
            <dl>
              <dt>Нереализованная прибыль, USD</dt>
              <dd>{snapshot.unrealizedPnlUsd}</dd>
              <dt>Доход, %</dt>
              <dd>{percent(snapshot.unrealizedReturnPercent)}</dd>
            </dl>
          )}
          {snapshot.items.length === 0 ? (
            <p>На этот момент позиций нет. Стоимость позиций: 0 USD.</p>
          ) : (
            <div
              className="historical-valuation__table-wrap account-analytics__table-wrap"
              role="region"
              aria-label="Прокрутка оценки позиций"
              tabIndex={0}
            >
              <table aria-label="Оценка позиций">
                <caption>Оценка позиций</caption>
                <thead>
                  <tr>
                    <th scope="col">Инструмент</th>
                    <th scope="col">Количество</th>
                    <th scope="col">Себестоимость, USD</th>
                    <th scope="col">Цена за единицу, USD</th>
                    <th scope="col">Стоимость, USD</th>
                    <th scope="col">Нереализованная прибыль, USD</th>
                    <th scope="col">Доход, %</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.items.map((item) => (
                    <tr key={item.instrumentId}>
                      <td>
                        {item.instrumentName}
                        {item.instrumentSymbol ? ` (${item.instrumentSymbol})` : ''}
                        <small>{item.instrumentId}</small>
                      </td>
                      <td>{item.quantity}</td>
                      <td>
                        {item.costUsd ?? 'Неизвестно'}
                        {item.costUsd === null && item.knownCostSubtotalUsd !== undefined && (
                          <small>
                            Известная часть: {item.knownCostSubtotalUsd} USD; количество с
                            неизвестной себестоимостью: {item.unknownCostQuantity}.
                          </small>
                        )}
                      </td>
                      <td>
                        {item.price ? (
                          <>
                            <span>{item.price.priceUsd}</span>
                            <small>
                              Ручная цена на {item.price.observedAt}, ревизия {item.price.revision}
                            </small>
                          </>
                        ) : (
                          'Нет точной цены'
                        )}
                      </td>
                      <td>{item.valueUsd ?? '—'}</td>
                      <td>{unrealizedCell(item)}</td>
                      <td>{percent(item.unrealizedReturnPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="account-analytics__evidence">
            <p>
              Граница покрытия UTC: <span>{snapshot.coverageFrom}</span>
            </p>
            <p>
              Ревизия журнала: <span>{snapshot.journalRevision}</span>
            </p>
            <p>
              Основа: текущая исправленная история;{' '}
              {snapshot.originKind === 'known-cost-carry-in'
                ? 'перенесённые лоты'
                : 'пустое начало'}
              .
              {snapshot.openingRevision !== null &&
                ` Ревизия открытия: ${snapshot.openingRevision}.`}
            </p>
            <p>Источник цены: вручную, USD за единицу; только точный момент.</p>
          </div>
        </div>
      )}
    </section>
  );
}
