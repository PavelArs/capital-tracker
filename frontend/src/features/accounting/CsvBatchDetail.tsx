import type { CsvDetail, CsvReceipt, CsvRows, CsvState } from '@api/csv-imports.api';
import { CsvSummary, csvFields } from './CsvPreview';
import { paymentText } from './payment';

export const csvStateLabel: Record<CsvState, string> = {
  draft: 'Черновик',
  committed: 'Импортирован',
  'rolled-back': 'Откат выполнен',
};
export function CsvReceiptView({ receipt }: { receipt: CsvReceipt }) {
  return (
    <p role="status">
      Квитанция {receipt.kind === 'confirm' ? 'импорта' : 'отката'}: {receipt.rowCount} записей;
      диапазон ревизий {receipt.firstJournalRevision}–{receipt.lastJournalRevision}; запрос{' '}
      {receipt.requestId}. Это один атомарный запрос. Квитанция не заменяет текущие результаты.
    </p>
  );
}
const reasons = {
  'not-committed': 'Откат доступен только для импортированной партии.',
  'modified-trade': 'Одна из импортированных сделок уже исправлена или аннулирована.',
  'connected-history': 'Операция нарушает историю остатков на связанных счетах.',
  'connected-capacity': 'Недостаточно места в пределах связанных журналов. Операция не записана.',
  'version-cap': 'Для полного отката недостаточно места в пределах 10000 версий.',
  'insufficient-holdings':
    'После удаления партии оставшаяся история содержит продажу без достаточного количества.',
};
export function CsvBatchDetail({
  value,
  rows,
  busy,
  rollbackStale,
  rollbackReviewed,
  onReview,
  onRollback,
  onRows,
}: {
  value: CsvDetail;
  rows: CsvRows | null;
  busy: boolean;
  rollbackStale: boolean;
  rollbackReviewed: boolean;
  onReview: (value: boolean) => void;
  onRollback: () => void;
  onRows: (append: boolean) => void;
}) {
  const settings = value.acceptedSettings;
  // Amount columns hold the paid currency once a non-USD source is set.
  const paidInOther =
    settings?.payment !== undefined || settings?.mapping.columns.currency !== undefined;
  const review = value.rollbackReview;
  return (
    <section className="csv-imports__section" aria-label="Партия CSV">
      <h3>{value.batch.filename}</h3>
      <p>
        Состояние: {csvStateLabel[value.batch.state]}. Сохранено байт: {value.batch.byteLength}.
        Дата: {value.batch.createdAt}.
      </p>
      <details>
        <summary>Идентификаторы партии</summary>
        <p className="manual-muted">
          Идентификатор партии: {value.batch.batchId}. SHA256: {value.batch.sha256}. Оригинал
          хранится приватно.
        </p>
      </details>
      {value.confirmReceipt && <CsvReceiptView receipt={value.confirmReceipt} />}
      {value.rollbackReceipt && <CsvReceiptView receipt={value.rollbackReceipt} />}
      {settings && (
        <details>
          <summary>Сохранённое сопоставление</summary>
          <p>
            Разделитель: {settings.format.delimiter}; десятичный разделитель:{' '}
            {settings.format.decimalSeparator};{' '}
            {settings.format.timestampMode === 'offset'
              ? 'смещение в каждой дате'
              : `фиксированное смещение ${settings.format.fixedOffset}`}
            .{' '}
            {settings.payment
              ? `Валюта оплаты: ${settings.payment.currency}${
                  settings.payment.perUsd
                    ? `, курс ${settings.payment.perUsd} ${settings.payment.currency} за 1 USD`
                    : settings.mapping.columns.rate !== undefined
                      ? ', курс — из колонки файла'
                      : ', курс 1'
                }.`
              : settings.mapping.columns.currency !== undefined
                ? 'Валюта оплаты — из колонки файла.'
                : 'Валовые суммы и комиссии — USD.'}
          </p>
          <ul>
            {Object.entries(settings.mapping.columns).map(([field, index]) => (
              <li key={field}>
                {paidInOther && (field === 'grossUsd' || field === 'feeUsd')
                  ? field === 'grossUsd'
                    ? 'Валовая сумма в валюте оплаты'
                    : 'Комиссия в валюте оплаты'
                  : csvFields[field as keyof typeof csvFields]}
                : колонка {index + 1}
              </li>
            ))}
          </ul>
          <ul>
            {settings.mapping.instruments.map((item) => (
              <li key={item.source}>
                <span className="csv-source-key">{item.source}</span> → {item.instrumentId}
              </li>
            ))}
            {settings.mapping.sides.map((item) => (
              <li key={item.source}>
                <span className="csv-source-key">{item.source}</span> →{' '}
                {item.side === 'buy' ? 'Покупка' : 'Продажа'}
              </li>
            ))}
          </ul>
        </details>
      )}
      {value.batch.state !== 'draft' && (
        <>
          <button
            type="button"
            className="manual-button manual-button--secondary"
            disabled={busy}
            onClick={() => onRows(false)}
          >
            Показать происхождение сделок
          </button>
          {rows && (
            <>
              <div className="manual-table-wrap">
                <table className="manual-table">
                  <caption>Происхождение импортированных сделок</caption>
                  <thead>
                    <tr>
                      <th>Запись / строка</th>
                      <th>Сделка</th>
                      <th>Версия создания</th>
                      <th>Исходная сделка</th>
                      <th>Версия отката</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.items.map((row) => (
                      <tr key={row.ordinal}>
                        <td>
                          {row.ordinal} / {row.startLine}
                        </td>
                        <td>{row.tradeId}</td>
                        <td>
                          {row.createVersion.version} / ревизия {row.createVersion.journalRevision}
                        </td>
                        <td>
                          {row.createVersion.instrumentName} · {row.createVersion.instrumentId}
                          <br />
                          {row.createVersion.side === 'buy' ? 'Покупка' : 'Продажа'};{' '}
                          {row.createVersion.occurredAt}; порядок{' '}
                          {row.createVersion.orderWithinTimestamp}
                          <br />
                          Количество {row.createVersion.quantity}; валовая сумма{' '}
                          {row.createVersion.grossUsd} USD; комиссия {row.createVersion.feeUsd} USD
                          {row.createVersion.payment && (
                            <>
                              <br />
                              {paymentText(row.createVersion.payment)}
                            </>
                          )}
                        </td>
                        <td>
                          {row.rollbackVersion
                            ? `${row.rollbackVersion.version} / ревизия ${row.rollbackVersion.journalRevision}`
                            : 'Нет'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.nextAfterOrdinal !== null && (
                <button
                  type="button"
                  className="manual-button manual-button--secondary"
                  disabled={busy}
                  onClick={() => onRows(true)}
                >
                  Следующие строки происхождения
                </button>
              )}
            </>
          )}
        </>
      )}
      {value.batch.state === 'committed' && (
        <section className="csv-imports__rollback" aria-label="Проверка отката">
          <h4>Откат партии целиком</h4>
          <p>
            Проверена ревизия журнала: {review.journalRevision}. Будут исключены{' '}
            {review.removedTradeCount} сделок и добавлены {review.additionalVersionCount}{' '}
            неизменяемых версий. Исходные данные и история сохранятся. Распределение оставшихся
            лотов FIFO пересчитывается.
          </p>
          <div className="csv-imports__comparison">
            <CsvSummary title="До отката" summary={review.summaryBefore} />
            {review.summaryAfter && (
              <CsvSummary title="После отката" summary={review.summaryAfter} />
            )}
          </div>
          {review.reason && <p>{reasons[review.reason]}</p>}
          {rollbackStale && (
            <p role="alert">Журнал изменился. Обновите состояние CSV перед проверкой отката.</p>
          )}
          <label className="manual-review-check">
            <input
              type="checkbox"
              checked={rollbackReviewed}
              disabled={busy || rollbackStale || !review.eligible}
              onChange={(event) => onReview(event.target.checked)}
            />
            Я проверил последствия отката всей партии
          </label>
          <button
            type="button"
            className="manual-button"
            disabled={busy || rollbackStale || !review.eligible || !rollbackReviewed}
            onClick={onRollback}
          >
            Откатить партию CSV
          </button>
        </section>
      )}
    </section>
  );
}
