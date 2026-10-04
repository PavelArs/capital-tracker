import {
  type BasisCoverage,
  type Journal,
  type JournalLot,
  type JournalMatch,
  type RewardCurrentLot,
  type RewardMatch,
  type SwapCurrentLot,
  type SwapMatch,
  type TradePage,
  type TradeRealization,
  type TradeVersion,
  type TradeVersions,
  type TransferCurrentLot,
  type TransferMatch,
  type TransferOrigin,
  tradesApi,
} from '@api/trades.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetSwapTotals } from './AssetSwapTotals';
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

function isCarryInLot(lot: JournalLot): lot is Extract<JournalLot, { sourceKind: 'carry-in' }> {
  return 'sourceKind' in lot && lot.sourceKind === 'carry-in';
}
function isTransferLot(lot: JournalLot): lot is TransferCurrentLot {
  return 'sourceKind' in lot && lot.sourceKind === 'transfer';
}
function isAcquisitionLot(lot: JournalLot): lot is RewardCurrentLot | SwapCurrentLot {
  return 'sourceKind' in lot && (lot.sourceKind === 'reward' || lot.sourceKind === 'swap');
}
function isCarryInMatch(
  match: JournalMatch,
): match is Extract<JournalMatch, { sourceKind: 'carry-in' }> {
  return 'sourceKind' in match && match.sourceKind === 'carry-in';
}
function isTransferMatch(match: JournalMatch): match is TransferMatch {
  return 'sourceKind' in match && match.sourceKind === 'transfer';
}
function isAcquisitionMatch(match: JournalMatch): match is RewardMatch | SwapMatch {
  return 'sourceKind' in match && (match.sourceKind === 'reward' || match.sourceKind === 'swap');
}
function originIdentity(origin: TransferOrigin) {
  return origin.kind === 'trade'
    ? `${origin.tradeId}:v${origin.version}`
    : origin.kind === 'carry-in'
      ? `${origin.lotId}:r${origin.openingRevision}:o${origin.ordinal}`
      : origin.kind === 'reward'
        ? `${origin.rewardId}:v${origin.version}`
        : `${origin.swapId}:v${origin.version}`;
}
function transferFragmentKey(value: {
  origin: TransferOrigin;
  arrival: { transferId: string; version: number };
  intervalStart: string;
  intervalEnd: string;
}) {
  return [
    value.origin.accountId,
    value.origin.kind,
    originIdentity(value.origin),
    value.arrival.transferId,
    value.arrival.version,
    value.intervalStart,
    value.intervalEnd,
  ].join(':');
}
function OriginFragment({
  origin,
  arrival,
  intervalStart,
  intervalEnd,
}: {
  origin: TransferOrigin;
  arrival?: { transferId: string; version: number };
  intervalStart: string;
  intervalEnd: string;
}) {
  return (
    <>
      Исходный счёт {origin.accountId}
      <br />
      {origin.kind === 'trade' ? (
        <>
          Сделка {origin.tradeId}, версия {origin.version}
        </>
      ) : origin.kind === 'carry-in' ? (
        <>
          Начальный лот {origin.lotId}, ревизия позиций {origin.openingRevision}, лот{' '}
          {origin.ordinal}
        </>
      ) : origin.kind === 'reward' ? (
        <>
          Вознаграждение {origin.rewardId}, версия {origin.version}
        </>
      ) : (
        <>
          Обмен {origin.swapId}, версия {origin.version}
        </>
      )}
      <br />
      Приобретено {origin.acquiredAt}, порядок {origin.orderWithinTimestamp}
      <br />
      {arrival && (
        <>
          Получено переводом {arrival.transferId}, версия {arrival.version}
          <br />
        </>
      )}
      Интервал исходного лота: {intervalStart}–{intervalEnd}
    </>
  );
}

function Cost({ value, coverage }: { value: string | null; coverage?: BasisCoverage }) {
  return (
    <>
      {value ?? 'Неизвестно'}
      {value === null && coverage && (
        <small>
          Известная часть: {coverage.knownSubtotalUsd} USD; неизвестных частей:{' '}
          {coverage.unknownCount}.
        </small>
      )}
    </>
  );
}

export function TradeResults({
  accountId,
  journal,
  disabled,
  mutationDisabled,
  onCorrect,
  onVoid,
  onStale,
}: {
  accountId: string;
  journal: Journal;
  disabled: boolean;
  mutationDisabled: boolean;
  onCorrect: (trade: TradeVersion, trigger: HTMLButtonElement) => void;
  onVoid: (trade: TradeVersion, trigger: HTMLButtonElement) => void;
  onStale: () => void;
}) {
  const [trades, setTrades] = useState<TradePage<TradeVersion> | null>(null);
  const [lots, setLots] = useState<TradePage<JournalLot> | null>(null);
  const [sales, setSales] = useState<TradePage<TradeRealization> | null>(null);
  const [matches, setMatches] = useState<TradePage<JournalMatch> | null>(null);
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
          {journal.originKind === 'known-cost-carry-in' && (
            <>
              <dt>Начальная учётная стоимость, USD</dt>
              <dd>{journal.carryInCostUsd}</dd>
            </>
          )}
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
          <dd>
            <Cost
              value={journal.summary.consumedCostUsd}
              coverage={journal.summary.basisCoverage?.consumed}
            />
          </dd>
          <dt>Реализованный результат продаж за USD</dt>
          <dd>
            <Cost
              value={journal.summary.realizedUsd}
              coverage={journal.summary.basisCoverage?.realized}
            />
          </dd>
          <dt>Остаточная учётная стоимость</dt>
          <dd>
            <Cost
              value={journal.summary.remainingCostUsd}
              coverage={journal.summary.basisCoverage?.remaining}
            />
          </dd>
          {journal.transferSummary && (
            <>
              <dt>Полученная себестоимость переводов, USD</dt>
              <dd>
                <Cost
                  value={journal.transferSummary.receivedBasisUsd}
                  coverage={journal.transferSummary.basisCoverage?.received}
                />
              </dd>
              <dt>Отправленная себестоимость переводов, USD</dt>
              <dd>
                <Cost
                  value={journal.transferSummary.sentBasisUsd}
                  coverage={journal.transferSummary.basisCoverage?.sent}
                />
              </dd>
              <dt>Учётная стоимость комиссий переводов, USD</dt>
              <dd>
                <Cost
                  value={journal.transferSummary.feeConsumedBasisUsd}
                  coverage={journal.transferSummary.basisCoverage?.fee}
                />
              </dd>
              {journal.transferSummary.fees.map((fee) => (
                <div key={fee.instrumentId}>
                  <dt>
                    Комиссия перевода: {fee.instrumentName}
                    {fee.instrumentSymbol ? ` (${fee.instrumentSymbol})` : ''}
                  </dt>
                  <dd>
                    {fee.quantity}; учётная стоимость{' '}
                    {fee.consumedBasisUsd === null ? 'Неизвестно' : `${fee.consumedBasisUsd} USD`}
                    {fee.consumedBasisUsd === null && fee.knownBasisSubtotalUsd !== undefined && (
                      <small>
                        Известная часть: {fee.knownBasisSubtotalUsd} USD; количество с неизвестной
                        себестоимостью: {fee.unknownCostQuantity}.
                      </small>
                    )}
                  </dd>
                </div>
              ))}
            </>
          )}
          {journal.swapSummary && <AssetSwapTotals summary={journal.swapSummary} />}
          {journal.rewardSummary && (
            <>
              <dt>Активные вознаграждения</dt>
              <dd>{journal.rewardSummary.activeCount}</dd>
              <dt>Заявленная себестоимость вознаграждений, USD</dt>
              <dd>
                {journal.rewardSummary.declaredBasisUsd ?? 'Неизвестно'}
                {journal.rewardSummary.declaredBasisUsd === null && (
                  <small>
                    Известная часть: {journal.rewardSummary.knownBasisSubtotalUsd} USD; неизвестных
                    значений: {journal.rewardSummary.unknownBasisCount}.
                  </small>
                )}
              </dd>
              <dt>Заявленный доход от вознаграждений, USD</dt>
              <dd>
                {journal.rewardSummary.declaredIncomeUsd ?? 'Неизвестно'}
                {journal.rewardSummary.declaredIncomeUsd === null && (
                  <small>
                    Известная часть по уточнённым видам:{' '}
                    {journal.rewardSummary.knownIncomeSubtotalUsd} USD; неизвестных значений:{' '}
                    {journal.rewardSummary.unknownIncomeCount}; неуточнённых видов:{' '}
                    {journal.rewardSummary.unclassifiedCount}.
                  </small>
                )}
              </dd>
            </>
          )}
          {journal.revisionBudget && (
            <>
              <dt>Сохранённые версии сделок</dt>
              <dd>{journal.versionCount}</dd>
              <dt>Использованные ревизии журнала</dt>
              <dd>
                {journal.revisionBudget.used} / {journal.revisionBudget.limit}
              </dd>
            </>
          )}
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
              <th>Сумма сделки, USD</th>
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
                        <button
                          type="button"
                          disabled={busy || mutationDisabled}
                          onClick={(event) => onCorrect(trade, event.currentTarget)}
                        >
                          Исправить
                        </button>
                        <button
                          type="button"
                          disabled={busy || mutationDisabled}
                          onClick={(event) => onVoid(trade, event.currentTarget)}
                        >
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
              <th>
                {journal.originKind === 'known-cost-carry-in' ||
                lots?.items.some((lot) => isTransferLot(lot) || isAcquisitionLot(lot))
                  ? 'Источник лота'
                  : 'Покупка / версия'}
              </th>
              <th>Инструмент</th>
              <th>Исходное количество</th>
              <th>Исходная стоимость, USD</th>
              <th>Остаток</th>
              <th>Остаточная стоимость, USD</th>
            </tr>
          </thead>
          <tbody>
            {lots?.items.map((lot) => (
              <tr
                key={
                  isTransferLot(lot)
                    ? `transfer:${transferFragmentKey(lot)}`
                    : isAcquisitionLot(lot)
                      ? `${lot.sourceKind}:${originIdentity(lot.origin)}:${lot.intervalStart}:${lot.intervalEnd}`
                      : isCarryInLot(lot)
                        ? `carry-in:${lot.lotId}`
                        : `buy:${lot.buyTradeId}`
                }
              >
                <td>
                  {isTransferLot(lot) ? (
                    <OriginFragment
                      origin={lot.origin}
                      arrival={lot.arrival}
                      intervalStart={lot.intervalStart}
                      intervalEnd={lot.intervalEnd}
                    />
                  ) : isAcquisitionLot(lot) ? (
                    <OriginFragment
                      origin={lot.origin}
                      intervalStart={lot.intervalStart}
                      intervalEnd={lot.intervalEnd}
                    />
                  ) : isCarryInLot(lot) ? (
                    <>
                      Начальный лот {lot.ordinal}
                      <br />
                      {lot.lotId}
                      <br />
                      Ревизия позиций {lot.openingRevision}
                      <br />
                      {lot.acquiredAt}, порядок {lot.orderWithinTimestamp}
                      <br />
                      На начало учета: {lot.carriedQuantity}; стоимость {lot.carriedCostUsd} USD
                    </>
                  ) : (
                    <>
                      {lot.buyTradeId}
                      <br />
                      Версия {lot.buyVersion}
                    </>
                  )}
                </td>
                <td>
                  <Instrument trade={lot} />
                </td>
                <td>
                  {isTransferLot(lot) || isAcquisitionLot(lot)
                    ? lot.origin.originalQuantity
                    : lot.originalQuantity}
                </td>
                <td>
                  {(isTransferLot(lot) || isAcquisitionLot(lot)
                    ? lot.origin.originalCostUsd
                    : lot.originalCostUsd) ?? 'Неизвестно'}
                </td>
                <td>{lot.remainingQuantity}</td>
                <td>{lot.remainingCostUsd ?? 'Неизвестно'}</td>
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
                <td>
                  {sale.consumedCostUsd ?? 'Неизвестно'}
                  {sale.basisCoverage && (
                    <small>
                      Известная часть: {sale.basisCoverage.knownConsumedCostUsd} USD; неизвестных
                      лотов: {sale.basisCoverage.unknownMatchCount}.
                    </small>
                  )}
                </td>
                <td>{sale.realizedUsd ?? 'Неизвестно'}</td>
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
                  <th>
                    {journal.originKind === 'known-cost-carry-in' ||
                    matches?.items.some(
                      (match) => isTransferMatch(match) || isAcquisitionMatch(match),
                    )
                      ? 'Источник лота'
                      : 'Покупка / версия'}
                  </th>
                  <th>Количество</th>
                  <th>Себестоимость, USD</th>
                </tr>
              </thead>
              <tbody>
                {matches?.items.map((match) => (
                  <tr
                    key={
                      isTransferMatch(match)
                        ? `${match.sellTradeId}:transfer:${transferFragmentKey(match)}`
                        : isAcquisitionMatch(match)
                          ? `${match.sellTradeId}:${match.sourceKind}:${originIdentity(match.origin)}:${match.intervalStart}:${match.intervalEnd}`
                          : isCarryInMatch(match)
                            ? `${match.sellTradeId}:carry-in:${match.lotId}`
                            : `${match.sellTradeId}:buy:${match.buyTradeId}`
                    }
                  >
                    <td>
                      {match.sellTradeId}
                      <br />
                      Версия {match.sellVersion}
                    </td>
                    <td>
                      {isTransferMatch(match) ? (
                        <OriginFragment
                          origin={match.origin}
                          arrival={match.arrival}
                          intervalStart={match.intervalStart}
                          intervalEnd={match.intervalEnd}
                        />
                      ) : isAcquisitionMatch(match) ? (
                        <OriginFragment
                          origin={match.origin}
                          intervalStart={match.intervalStart}
                          intervalEnd={match.intervalEnd}
                        />
                      ) : isCarryInMatch(match) ? (
                        <>
                          Начальный лот {match.ordinal}
                          <br />
                          {match.lotId}
                          <br />
                          Ревизия позиций {match.openingRevision}
                        </>
                      ) : (
                        <>
                          {match.buyTradeId}
                          <br />
                          Версия {match.buyVersion}
                        </>
                      )}
                    </td>
                    <td>{match.quantity}</td>
                    <td>{match.costUsd ?? 'Неизвестно'}</td>
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
                  <th>Сумма сделки, USD</th>
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
