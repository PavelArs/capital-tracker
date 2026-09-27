import {
  type HistoricalPosition,
  type HistoricalSnapshot,
  historicalAccountingApi,
} from '@api/historical-accounting.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { AssetSwapTotals } from './AssetSwapTotals';
import { accountingError } from './feedback';

type Loaded = {
  snapshot: HistoricalSnapshot;
  items: HistoricalPosition[];
  accountId: string;
  observedRevision: number | null;
};

export function HistoricalAccounting({
  accountId,
  journalRevision,
}: {
  accountId: string;
  journalRevision: number | null;
}) {
  const id = useId();
  const [instant, setInstant] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const current = useRef({ accountId, journalRevision });
  const previous = useRef({ accountId, journalRevision });

  current.current = { accountId, journalRevision };
  useEffect(() => {
    if (
      previous.current.accountId !== accountId ||
      previous.current.journalRevision !== journalRevision
    ) {
      previous.current = { accountId, journalRevision };
      setLoaded(null);
      setLoading(false);
      setError(null);
    }
    return () => {
      request.current++;
    };
  }, [accountId, journalRevision]);

  function edit(value: string) {
    request.current++;
    setInstant(value);
    setLoaded(null);
    setLoading(false);
    setError(null);
  }

  async function fetchSnapshot(at: string, offset: number, revision?: number) {
    const generation = ++request.current;
    const owner = accountId;
    const observedRevision = journalRevision;
    setLoading(true);
    setError(null);
    if (offset === 0) setLoaded(null);
    try {
      const snapshot = await historicalAccountingApi.snapshot(owner, at, offset, revision);
      if (
        generation !== request.current ||
        current.current.accountId !== owner ||
        current.current.journalRevision !== observedRevision
      )
        return;
      if (
        snapshot.accountId !== owner ||
        (offset !== 0 && (snapshot.at !== at || snapshot.journalRevision !== revision))
      ) {
        setLoaded(null);
        setError('Ответ не согласуется с выбранным срезом. Обновите его явно.');
        return;
      }
      setLoaded((previousPage) => ({
        snapshot,
        items:
          offset === 0 || !previousPage
            ? snapshot.items
            : [...previousPage.items, ...snapshot.items],
        accountId: owner,
        observedRevision,
      }));
    } catch (caught) {
      if (generation !== request.current || current.current.accountId !== owner) return;
      if (current.current.journalRevision !== observedRevision) return;
      if (isAxiosError(caught) && caught.response?.status === 409) {
        setLoaded(null);
        setError(
          'Учётный срез устарел или дата вне покрытия. Проверьте дату и явно обновите срез.',
        );
      } else {
        setError(accountingError(caught, 'загрузить учётный срез'));
      }
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!instant.trim() || loading) return;
    void fetchSnapshot(instant, 0);
  }

  const visible =
    loaded?.accountId === accountId && loaded.observedRevision === journalRevision ? loaded : null;
  const snapshot = visible?.snapshot;

  return (
    <section
      className="historical-accounting account-analytics__tool"
      aria-label="Учётный срез на дату"
    >
      <h3>Учётный срез на дату</h3>
      <p className="account-analytics__scope">
        Количество и себестоимость позиций по исправленному журналу. Это не рыночная стоимость или
        доходность.
      </p>
      <form onSubmit={submit} className="historical-accounting__form account-analytics__form">
        <div className="account-analytics__field">
          <label>
            Момент времени (ISO, с часовым поясом)
            <input
              aria-describedby={`${id}-field-0-hint`}
              type="text"
              value={instant}
              onChange={(event) => edit(event.target.value)}
              placeholder="2025-01-02T00:00:00Z"
              required
            />
          </label>
          <small className="account-analytics__hint" id={`${id}-field-0-hint`}>
            Укажите дату и время с часовым поясом. Срез включает операции до выбранного момента UTC
            включительно.
          </small>
        </div>
        <div className="account-analytics__actions">
          <button className="manual-button" type="submit" disabled={loading || !instant.trim()}>
            Показать учётный срез
          </button>
        </div>
      </form>
      <details className="account-analytics__method">
        <summary>Как читать учётный срез</summary>
        <p className="manual-muted">
          Реконструкция по текущему исправленному журналу на выбранный момент UTC. Это не
          наблюдаемый баланс, не рыночная стоимость и не инвестиционная доходность. Периоды до
          границы покрытия не восстановлены; суммы накоплены с начала покрытия, а не за выбранный
          период.
        </p>
      </details>
      {loading && <output>Загрузка учётного среза…</output>}
      {error && (
        <p role="alert" className="manual-feedback manual-feedback--error">
          {error}
        </p>
      )}
      {snapshot && (
        <div className="historical-accounting__results account-analytics__results">
          <p>
            Момент UTC: <span>{snapshot.at}</span>
          </p>
          {visible.items.length === 0 ? (
            <p>На выбранный момент учётных позиций нет.</p>
          ) : (
            <div
              className="historical-accounting__table-wrap account-analytics__table-wrap"
              role="region"
              aria-label="Прокрутка учётных позиций"
              tabIndex={0}
            >
              <table>
                <caption>Позиции на выбранный момент</caption>
                <thead>
                  <tr>
                    <th scope="col">Инструмент</th>
                    <th scope="col">UUID</th>
                    <th scope="col">Количество</th>
                    <th scope="col">Себестоимость, USD</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.items.map((item) => (
                    <tr key={item.instrumentId}>
                      <td>
                        {item.instrumentName}
                        {item.instrumentSymbol ? ` (${item.instrumentSymbol})` : ''}
                      </td>
                      <td>{item.instrumentId}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {snapshot.nextOffset !== null && (
            <button
              type="button"
              className="manual-button manual-button--secondary"
              disabled={loading}
              onClick={() => {
                if (snapshot.nextOffset !== null)
                  void fetchSnapshot(snapshot.at, snapshot.nextOffset, snapshot.journalRevision);
              }}
            >
              Следующая страница
            </button>
          )}
          <dl className="trade-summary">
            <dt>Начальная учётная стоимость, USD</dt>
            <dd>{snapshot.initialCostUsd}</dd>
            <dt>Сумма покупок, USD</dt>
            <dd>{snapshot.summary.grossBuysUsd}</dd>
            <dt>Комиссии покупок, USD</dt>
            <dd>{snapshot.summary.buyFeesUsd}</dd>
            <dt>Сумма продаж, USD</dt>
            <dd>{snapshot.summary.grossSalesUsd}</dd>
            <dt>Комиссии продаж, USD</dt>
            <dd>{snapshot.summary.sellFeesUsd}</dd>
            <dt>Чистая выручка, USD</dt>
            <dd>{snapshot.summary.netSalesUsd}</dd>
            <dt>Списанная себестоимость, USD</dt>
            <dd>
              {snapshot.summary.consumedCostUsd ?? 'Неизвестно'}
              {snapshot.summary.consumedCostUsd === null && snapshot.summary.basisCoverage && (
                <small>
                  Известная часть: {snapshot.summary.basisCoverage.consumed.knownSubtotalUsd} USD;
                  неизвестных частей: {snapshot.summary.basisCoverage.consumed.unknownCount}.
                </small>
              )}
            </dd>
            <dt>Реализованный результат продаж за USD</dt>
            <dd>
              {snapshot.summary.realizedUsd ?? 'Неизвестно'}
              {snapshot.summary.realizedUsd === null && snapshot.summary.basisCoverage && (
                <small>
                  Известная часть: {snapshot.summary.basisCoverage.realized.knownSubtotalUsd} USD;
                  продаж с неполной себестоимостью:{' '}
                  {snapshot.summary.basisCoverage.realized.unknownCount}.
                </small>
              )}
            </dd>
            <dt>Остаточная учётная стоимость, USD</dt>
            <dd>
              {snapshot.summary.remainingCostUsd ?? 'Неизвестно'}
              {snapshot.summary.remainingCostUsd === null && snapshot.summary.basisCoverage && (
                <small>
                  Известная часть: {snapshot.summary.basisCoverage.remaining.knownSubtotalUsd} USD;
                  неизвестных лотов: {snapshot.summary.basisCoverage.remaining.unknownCount}.
                </small>
              )}
            </dd>
          </dl>
          {snapshot.swapSummary && (
            <dl className="trade-summary">
              <AssetSwapTotals summary={snapshot.swapSummary} />
            </dl>
          )}
          {snapshot.rewardSummary && (
            <dl className="trade-summary">
              <dt>Активные вознаграждения на момент UTC</dt>
              <dd>{snapshot.rewardSummary.activeCount}</dd>
              <dt>Заявленная себестоимость вознаграждений, USD</dt>
              <dd>
                {snapshot.rewardSummary.declaredBasisUsd ?? 'Неизвестно'}
                {snapshot.rewardSummary.declaredBasisUsd === null && (
                  <small>
                    Известная часть: {snapshot.rewardSummary.knownBasisSubtotalUsd} USD; неизвестных
                    значений: {snapshot.rewardSummary.unknownBasisCount}.
                  </small>
                )}
              </dd>
              <dt>Заявленный доход от вознаграждений, USD</dt>
              <dd>
                {snapshot.rewardSummary.declaredIncomeUsd ?? 'Неизвестно'}
                {snapshot.rewardSummary.declaredIncomeUsd === null && (
                  <small>
                    Известная часть по уточнённым видам:{' '}
                    {snapshot.rewardSummary.knownIncomeSubtotalUsd} USD; неизвестных значений:{' '}
                    {snapshot.rewardSummary.unknownIncomeCount}; неуточнённых видов:{' '}
                    {snapshot.rewardSummary.unclassifiedCount}.
                  </small>
                )}
              </dd>
            </dl>
          )}
          <div className="account-analytics__evidence">
            <p>Граница покрытия UTC: {snapshot.coverageFrom}</p>
            <p>Ревизия журнала: {snapshot.journalRevision}</p>
            <p>
              Начало:{' '}
              {snapshot.originKind === 'known-cost-carry-in'
                ? 'перенесённые лоты с известной себестоимостью'
                : 'заявленные пустые позиции'}
              .
              {snapshot.openingRevision !== null &&
                ` Ревизия начальных позиций: ${snapshot.openingRevision}.`}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
