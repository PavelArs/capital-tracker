import {
  type HistoricalValuationSnapshot,
  historicalValuationApi,
} from '@api/historical-valuation.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { accountingError } from './feedback';
import './HistoricalValuation.css';

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
  const [instant, setInstant] = useState('');
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
    <section className="historical-valuation" aria-label="Оценка счёта на дату">
      <h3>Оценка счёта на дату</h3>
      <form className="historical-valuation__form" onSubmit={submit}>
        <label>
          Момент оценки (ISO)
          <input
            type="text"
            value={instant}
            onChange={(event) => edit(event.target.value)}
            placeholder="2025-01-04T00:00:00.000Z"
            required
          />
        </label>
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
      </form>
      <p className="manual-muted">
        Только позиции этого счёта по текущему исправленному журналу. Ручные цены USD за единицу
        применяются только при точном совпадении момента UTC. Нет переноса предыдущей цены,
        интерполяции или цены по символу. Результат не включает денежный остаток, весь портфель,
        прибыль или доходность; исправления могут пересчитать прошлую оценку.
      </p>
      {loading && <p>Расчёт стоимости…</p>}
      {error && <p role="alert">{error}</p>}
      {snapshot && (
        <div className="historical-valuation__results">
          <p>
            Момент оценки UTC: <span>{snapshot.at}</span>
          </p>
          <p>
            Граница покрытия UTC: <span>{snapshot.coverageFrom}</span>
          </p>
          <p>
            Ревизия журнала: <span>{snapshot.journalRevision}</span>
          </p>
          <p>
            Основа: текущая исправленная история;{' '}
            {snapshot.originKind === 'known-cost-carry-in' ? 'перенесённые лоты' : 'пустое начало'}.
            {snapshot.openingRevision !== null && ` Ревизия открытия: ${snapshot.openingRevision}.`}
          </p>
          <p>Источник цены: вручную, USD за единицу; только точный момент.</p>
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
          {snapshot.items.length === 0 ? (
            <p>На этот момент позиций нет. Стоимость позиций: 0 USD.</p>
          ) : (
            <div className="historical-valuation__table-wrap">
              <table aria-label="Оценка позиций">
                <caption>Оценка позиций</caption>
                <thead>
                  <tr>
                    <th scope="col">Инструмент</th>
                    <th scope="col">Количество</th>
                    <th scope="col">Себестоимость, USD</th>
                    <th scope="col">Цена за единицу, USD</th>
                    <th scope="col">Стоимость, USD</th>
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
                      <td>{item.costUsd}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
