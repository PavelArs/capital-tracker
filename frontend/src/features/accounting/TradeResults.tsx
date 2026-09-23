import {
  type Journal,
  type TradeLot,
  type TradeMatch,
  type TradePage,
  type TradeRealization,
  type TradeVersion,
  type TradeVersions,
  tradesApi,
} from '@api/trades.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { accountingError } from './feedback';

function Instrument({
  trade,
}: { trade: { instrumentName: string; instrumentSymbol: string | null } }) {
  return (
    <>
      {trade.instrumentName}
      {trade.instrumentSymbol ? ` (${trade.instrumentSymbol})` : ''}
    </>
  );
}
function More({
  next,
  disabled,
  onClick,
}: { next: number | null | undefined; disabled: boolean; onClick: () => void }) {
  return next !== null && next !== undefined ? (
    <button
      className="manual-button manual-button--secondary"
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      Показать ещё
    </button>
  ) : null;
}

export function TradeResults({
  accountId,
  journal,
  disabled,
  onCorrect,
  onVoid,
  onStale,
}: {
  accountId: string;
  journal: Journal;
  disabled: boolean;
  onCorrect: (trade: TradeVersion) => void;
  onVoid: (trade: TradeVersion) => void;
  onStale: () => void;
}) {
  const [trades, setTrades] = useState<TradePage<TradeVersion> | null>(null);
  const [lots, setLots] = useState<TradePage<TradeLot> | null>(null);
  const [sales, setSales] = useState<TradePage<TradeRealization> | null>(null);
  const [matches, setMatches] = useState<TradePage<TradeMatch> | null>(null);
  const [versions, setVersions] = useState<TradeVersions | null>(null);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(false);
  const sequence = useRef(0);
  const revision = journal.journalRevision;
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  const failed = useCallback((error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 409) staleRef.current();
    else setError(accountingError(error, 'загрузить результаты журнала'));
  }, []);
  const initial = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const [nextTrades, nextLots, nextSales] = await Promise.all([
        tradesApi.trades(accountId, revision),
        tradesApi.lots(accountId, revision),
        tradesApi.realizations(accountId, revision),
      ]);
      if (!live.current || request !== sequence.current) return;
      setTrades(nextTrades);
      setLots(nextLots);
      setSales(nextSales);
    } catch (error) {
      if (live.current && request === sequence.current) failed(error);
    } finally {
      if (live.current && request === sequence.current) setLoading(false);
    }
  }, [accountId, revision, failed]);
  useEffect(() => {
    live.current = true;
    void initial();
    return () => {
      live.current = false;
      sequence.current++;
    };
  }, [initial]);

  async function more(section: 'trades' | 'lots' | 'sales') {
    const offset =
      section === 'trades'
        ? trades?.nextOffset
        : section === 'lots'
          ? lots?.nextOffset
          : sales?.nextOffset;
    if (offset == null || loading || disabled) return;
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      if (section === 'trades') {
        const value = await tradesApi.trades(accountId, revision, offset);
        if (live.current && request === sequence.current)
          setTrades((current) => ({
            ...value,
            items: [...(current?.items ?? []), ...value.items],
          }));
      } else if (section === 'lots') {
        const value = await tradesApi.lots(accountId, revision, offset);
        if (live.current && request === sequence.current)
          setLots((current) => ({ ...value, items: [...(current?.items ?? []), ...value.items] }));
      } else {
        const value = await tradesApi.realizations(accountId, revision, offset);
        if (live.current && request === sequence.current)
          setSales((current) => ({ ...value, items: [...(current?.items ?? []), ...value.items] }));
      }
    } catch (error) {
      if (live.current && request === sequence.current) failed(error);
    } finally {
      if (live.current && request === sequence.current) setLoading(false);
    }
  }
  async function showMatches(id: string, append = false) {
    if (loading || disabled) return;
    const offset = append ? matches?.nextOffset : 0;
    if (offset == null) return;
    const request = ++sequence.current;
    setSaleId(id);
    if (!append) setMatches(null);
    setLoading(true);
    setError(null);
    try {
      const value = await tradesApi.matches(accountId, id, revision, offset);
      if (live.current && request === sequence.current)
        setMatches((current) => ({
          ...value,
          items: [...(append ? (current?.items ?? []) : []), ...value.items],
        }));
    } catch (error) {
      if (live.current && request === sequence.current) failed(error);
    } finally {
      if (live.current && request === sequence.current) setLoading(false);
    }
  }
  async function showVersions(id: string, append = false) {
    if (loading || disabled) return;
    const before = append ? versions?.nextBeforeVersion : undefined;
    if (before === null) return;
    const request = ++sequence.current;
    setVersionId(id);
    if (!append) setVersions(null);
    setLoading(true);
    setError(null);
    try {
      const value = await tradesApi.versions(accountId, id, before);
      if (live.current && request === sequence.current)
        setVersions((current) => ({
          ...value,
          items: [...(append ? (current?.items ?? []) : []), ...value.items],
        }));
    } catch (error) {
      if (live.current && request === sequence.current) failed(error);
    } finally {
      if (live.current && request === sequence.current) setLoading(false);
    }
  }
  const busy = disabled || loading;
  return (
    <div className="trade-results">
      <section aria-label="Итоги журнала">
        <h3>Итоги журнала</h3>
        <dl className="trade-summary">
          <dt>Сумма покупок, USD</dt>
          <dd>{journal.summary.grossBuysUsd}</dd>
          <dt>Комиссии покупок, USD</dt>
          <dd>{journal.summary.buyFeesUsd}</dd>
          <dt>Сумма продаж, USD</dt>
          <dd>{journal.summary.grossSalesUsd}</dd>
          <dt>Комиссии продаж, USD</dt>
          <dd>{journal.summary.sellFeesUsd}</dd>
          <dt>Чистая выручка, USD</dt>
          <dd>{journal.summary.netSalesUsd}</dd>
          <dt>Списанная себестоимость, USD</dt>
          <dd>{journal.summary.consumedCostUsd}</dd>
          <dt>Реализованный результат по журналу сделок</dt>
          <dd>{journal.summary.realizedUsd}</dd>
          <dt>Остаточная учётная стоимость</dt>
          <dd>{journal.summary.remainingCostUsd}</dd>
        </dl>
      </section>
      {loading && <p role="status">Загрузка результатов…</p>}
      {!loading && trades?.items.length === 0 && <p>В журнале пока нет сделок.</p>}
      {error && (
        <p role="alert" className="manual-feedback manual-feedback--error">
          {error}{' '}
          <button
            type="button"
            className="manual-link-button"
            disabled={busy}
            onClick={() => void initial()}
          >
            Повторить загрузку результатов
          </button>
        </p>
      )}
      <div className="manual-table-wrap">
        <table className="manual-table">
          <caption>Сделки журнала</caption>
          <thead>
            <tr>
              <th>Сделка / версия</th>
              <th>Инструмент</th>
              <th>Время UTC / порядок</th>
              <th>Тип</th>
              <th>Количество</th>
              <th>Валовая сумма, USD</th>
              <th>Комиссия, USD</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {trades?.items.map((trade) => (
              <tr key={trade.tradeId}>
                <td>
                  {trade.tradeId}
                  <br />
                  Версия {trade.version}
                </td>
                <td>
                  <Instrument trade={trade} />
                </td>
                <td>
                  {trade.occurredAt}
                  <br />
                  {trade.orderWithinTimestamp}
                </td>
                <td>
                  {trade.kind === 'void'
                    ? 'Аннулирована'
                    : trade.side === 'buy'
                      ? 'Покупка'
                      : 'Продажа'}
                </td>
                <td>{trade.quantity}</td>
                <td>{trade.grossUsd}</td>
                <td>{trade.feeUsd}</td>
                <td>
                  <div className="trade-actions">
                    {trade.kind !== 'void' && (
                      <>
                        <button type="button" disabled={busy} onClick={() => onCorrect(trade)}>
                          Исправить
                        </button>
                        <button type="button" disabled={busy} onClick={() => onVoid(trade)}>
                          Аннулировать
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void showVersions(trade.tradeId)}
                    >
                      Версии
                    </button>
                    {trade.kind !== 'void' && trade.side === 'sell' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void showMatches(trade.tradeId)}
                      >
                        Распределение FIFO
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <More next={trades?.nextOffset} disabled={busy} onClick={() => void more('trades')} />
      <div className="manual-table-wrap">
        <table className="manual-table">
          <caption>Открытые лоты</caption>
          <thead>
            <tr>
              <th>Покупка / версия</th>
              <th>Инструмент</th>
              <th>Исходное количество</th>
              <th>Исходная стоимость, USD</th>
              <th>Остаток</th>
              <th>Остаточная стоимость, USD</th>
            </tr>
          </thead>
          <tbody>
            {lots?.items.map((lot) => (
              <tr key={lot.buyTradeId}>
                <td>
                  {lot.buyTradeId}
                  <br />
                  Версия {lot.buyVersion}
                </td>
                <td>
                  <Instrument trade={lot} />
                </td>
                <td>{lot.originalQuantity}</td>
                <td>{lot.originalCostUsd}</td>
                <td>{lot.remainingQuantity}</td>
                <td>{lot.remainingCostUsd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <More next={lots?.nextOffset} disabled={busy} onClick={() => void more('lots')} />
      <div className="manual-table-wrap">
        <table className="manual-table">
          <caption>Результаты продаж</caption>
          <thead>
            <tr>
              <th>Продажа / версия</th>
              <th>Инструмент</th>
              <th>Количество</th>
              <th>Чистая сумма, USD</th>
              <th>Себестоимость, USD</th>
              <th>Реализованный результат, USD</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {sales?.items.map((sale) => (
              <tr key={sale.sellTradeId}>
                <td>
                  {sale.sellTradeId}
                  <br />
                  Версия {sale.sellVersion}
                </td>
                <td>
                  <Instrument trade={sale} />
                </td>
                <td>{sale.quantity}</td>
                <td>{sale.netUsd}</td>
                <td>{sale.consumedCostUsd}</td>
                <td>{sale.realizedUsd}</td>
                <td>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void showMatches(sale.sellTradeId)}
                  >
                    Распределение FIFO
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <More next={sales?.nextOffset} disabled={busy} onClick={() => void more('sales')} />
      {saleId && (
        <>
          <p>Продажа: {saleId}</p>
          <div className="manual-table-wrap">
            <table className="manual-table">
              <caption>Распределение FIFO</caption>
              <thead>
                <tr>
                  <th>Продажа / версия</th>
                  <th>Покупка / версия</th>
                  <th>Количество</th>
                  <th>Себестоимость, USD</th>
                </tr>
              </thead>
              <tbody>
                {matches?.items.map((match) => (
                  <tr key={`${match.sellTradeId}:${match.buyTradeId}`}>
                    <td>
                      {match.sellTradeId}
                      <br />
                      Версия {match.sellVersion}
                    </td>
                    <td>
                      {match.buyTradeId}
                      <br />
                      Версия {match.buyVersion}
                    </td>
                    <td>{match.quantity}</td>
                    <td>{match.costUsd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <More
            next={matches?.nextOffset}
            disabled={busy}
            onClick={() => void showMatches(saleId, true)}
          />
        </>
      )}
      {versionId && (
        <>
          <p>История сделки: {versionId}</p>
          <div className="manual-table-wrap">
            <table className="manual-table">
              <caption>Версии сделки</caption>
              <thead>
                <tr>
                  <th>Сделка / версия</th>
                  <th>Ревизия журнала</th>
                  <th>Инструмент</th>
                  <th>Тип / изменение</th>
                  <th>Время UTC / порядок</th>
                  <th>Количество</th>
                  <th>Валовая сумма, USD</th>
                  <th>Комиссия, USD</th>
                </tr>
              </thead>
              <tbody>
                {versions?.items.map((trade) => (
                  <tr key={trade.version}>
                    <td>
                      {trade.tradeId}
                      <br />
                      Версия {trade.version}
                    </td>
                    <td>{trade.journalRevision}</td>
                    <td>
                      <Instrument trade={trade} />
                    </td>
                    <td>
                      {trade.side === 'buy' ? 'Покупка' : 'Продажа'} /{' '}
                      {trade.kind === 'void'
                        ? 'Аннулирование'
                        : trade.kind === 'correct'
                          ? 'Исправление'
                          : 'Создание'}
                    </td>
                    <td>
                      {trade.occurredAt}
                      <br />
                      {trade.orderWithinTimestamp}
                    </td>
                    <td>{trade.quantity}</td>
                    <td>{trade.grossUsd}</td>
                    <td>{trade.feeUsd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <More
            next={versions?.nextBeforeVersion}
            disabled={busy}
            onClick={() => void showVersions(versionId, true)}
          />
        </>
      )}
    </div>
  );
}
