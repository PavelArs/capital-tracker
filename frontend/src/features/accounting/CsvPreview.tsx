import type { CsvField, CsvInspection, CsvPreviewResult } from '@api/csv-imports.api';
import type { TradeSummary } from '@api/trades.api';
import { paymentText } from './payment';

export const csvFields: Record<CsvField, string> = {
  instrument: 'Инструмент',
  side: 'Тип сделки',
  occurredAt: 'Дата сделки',
  order: 'Порядок в одну дату',
  quantity: 'Количество',
  grossUsd: 'Валовая сумма USD',
  feeUsd: 'Комиссия USD',
  currency: 'Валюта',
  rate: 'Курс к USD',
};
const errors: Record<string, string> = {
  'csv-syntax': 'Нарушен формат кавычек или разделителей.',
  'header-required': 'Нужна строка заголовков.',
  'column-limit': 'Допустимо не более 32 колонок.',
  'cell-limit': 'Ячейка превышает 4096 байт UTF-8.',
  'empty-header': 'Заголовок не может быть пустым.',
  'duplicate-header': 'Заголовки повторяются.',
  'row-width': 'Число ячеек отличается от заголовка.',
  'blank-row': 'Обнаружена пустая запись.',
  'row-limit': 'Допустимо не более 100 записей.',
  'no-data': 'После заголовка нет записей.',
  'instrument-key-unmapped': 'Выберите инструмент для этого исходного значения.',
  'side-key-unmapped': 'Выберите тип сделки для этого исходного значения.',
  'invalid-time': 'Проверьте дату, календарь и явно выбранное смещение времени.',
  'invalid-order': 'Нужно целое число от 0 до 2147483647 без ведущих нулей.',
  'invalid-quantity': 'Нужно положительное точное количество в выбранном формате.',
  'invalid-gross': 'Нужна положительная валовая сумма в выбранном формате.',
  'invalid-fee': 'Укажите точную комиссию, включая явный ноль.',
  'buy-cost-overflow': 'Сумма покупки с комиссией превышает допустимый предел.',
  'invalid-currency': 'Нужен код валюты заглавными буквами, например USD, USDT или RUB.',
  'invalid-rate':
    'Нужен положительный курс: сколько единиц валюты за 1 USD. Для USD — пусто или 1.',
  'missing-rate': 'Укажите курс для этой валюты: только USDT и USDC считаются по 1.',
  'converted-gross-zero': 'После пересчёта в USD сумма округляется до нуля.',
  'column-out-of-range': 'Выбранной колонки нет в файле.',
  'unused-instrument-key': 'Сопоставление содержит отсутствующее значение инструмента.',
  'unused-side-key': 'Сопоставление содержит отсутствующий тип сделки.',
  'before-coverage': 'Сделка раньше границы покрытия журнала.',
  'duplicate-chronology': 'Дата и порядок совпадают с другой сделкой.',
  'active-trade-cap': 'Превышен предел 1000 активных сделок.',
  'connected-history': 'Операция нарушает историю остатков на связанных счетах.',
  'connected-capacity': 'Недостаточно места в пределах связанных журналов. Операция не записана.',
  'version-cap': 'Превышен предел 10000 версий.',
  'insufficient-holdings': 'На дату продажи недостаточно ранее купленного количества.',
};
export const csvError = (code: string) =>
  errors[code] ?? 'Данные не прошли проверку. Проверьте исходный файл и сопоставление.';
const summaryLabels = {
  grossBuysUsd: 'Покупки без комиссий',
  buyFeesUsd: 'Комиссии покупок',
  grossSalesUsd: 'Продажи до комиссий',
  sellFeesUsd: 'Комиссии продаж',
  netSalesUsd: 'Чистые продажи',
  consumedCostUsd: 'Списанная себестоимость',
  realizedUsd: 'Реализованный результат',
  remainingCostUsd: 'Остаточная себестоимость',
} as const;
export function CsvSummary({ title, summary }: { title: string; summary: TradeSummary }) {
  return (
    <section aria-label={title}>
      <h4>{title}</h4>
      <dl className="trade-summary">
        {(Object.keys(summaryLabels) as Array<keyof typeof summaryLabels>).map((key) => {
          const coverage =
            key === 'consumedCostUsd'
              ? summary.basisCoverage?.consumed
              : key === 'realizedUsd'
                ? summary.basisCoverage?.realized
                : key === 'remainingCostUsd'
                  ? summary.basisCoverage?.remaining
                  : undefined;
          return (
            <div className="csv-summary-line" key={key}>
              <dt>{summaryLabels[key]}, USD</dt>
              <dd>
                {summary[key] ?? 'Неизвестно'}
                {summary[key] === null && coverage && (
                  <small>
                    Известная часть: {coverage.knownSubtotalUsd} USD; неизвестных частей:{' '}
                    {coverage.unknownCount}.
                  </small>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
export function CsvSource({ inspection }: { inspection: CsvInspection }) {
  if (!inspection.valid)
    return (
      <p role="alert">
        {csvError(inspection.error.code)}{' '}
        {inspection.error.line !== null && `Строка: ${inspection.error.line}.`}{' '}
        {inspection.error.column !== null && `Колонка: ${inspection.error.column}.`} Допустимая
        часть файла отдельно не принимается.
      </p>
    );
  return (
    <div className="manual-table-wrap">
      <table className="manual-table csv-literal">
        <caption>Исходные строки</caption>
        <thead>
          <tr>
            <th>Запись</th>
            <th>Строка файла</th>
            {inspection.headers.map((header, index) => (
              <th key={`${index}:${header}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {inspection.rows.map((row) => (
            <tr key={row.ordinal}>
              <td>{row.ordinal}</td>
              <td>{row.startLine}</td>
              {row.cells.map((cell, index) => (
                <td key={`${row.ordinal}:${index}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function CsvPreview({ value }: { value: CsvPreviewResult }) {
  return (
    <section className="csv-imports__preview" aria-label="Предпросмотр импорта">
      <h3>Предпросмотр импорта</h3>
      <p>
        Проверена ревизия журнала: {value.journalRevision}. Суммы ниже — учётные результаты
        записанных сделок.
      </p>
      <div className="csv-imports__comparison">
        <CsvSummary title="До импорта" summary={value.summaryBefore} />
        {value.candidateSummary ? (
          <CsvSummary title="После импорта" summary={value.candidateSummary} />
        ) : (
          <p role="alert">
            Импорт пока невозможен. Результат по отдельным допустимым строкам не рассчитывается.
          </p>
        )}
      </div>
      {value.batchErrors.length > 0 && (
        <ul>
          {value.batchErrors.map((error) => (
            <li key={error.code}>
              {csvError(error.code)} {error.line !== null && `Строка: ${error.line}.`}
            </li>
          ))}
        </ul>
      )}
      {value.rowErrors.length > 0 && (
        <ul aria-label="Ошибки строк">
          {value.rowErrors.map((error) => (
            <li key={`${error.ordinal}:${error.field}`}>
              Запись {error.ordinal}, {csvFields[error.field]}: {csvError(error.code)}
            </li>
          ))}
        </ul>
      )}
      <p>
        Неиспользуемые колонки:{' '}
        {value.ignoredColumns.length === 0
          ? 'нет'
          : value.ignoredColumns
              .map((column) => `${column.index + 1}: ${column.header}`)
              .join('; ')}
        .
      </p>
      <div className="manual-table-wrap">
        <table className="manual-table">
          <caption>Сделки перед импортом</caption>
          <thead>
            <tr>
              <th>Запись / строка</th>
              <th>Инструмент UUID</th>
              <th>Тип</th>
              <th>Время UTC / порядок</th>
              <th>Количество</th>
              <th>Валовая сумма USD</th>
              <th>Комиссия USD</th>
            </tr>
          </thead>
          <tbody>
            {value.rows.map((row) => (
              <tr key={row.ordinal}>
                <td>
                  {row.ordinal} / {row.startLine}
                </td>
                {row.execution ? (
                  <>
                    <td>{row.execution.instrumentId}</td>
                    <td>{row.execution.side === 'buy' ? 'Покупка' : 'Продажа'}</td>
                    <td>
                      {row.execution.occurredAt} / {row.execution.orderWithinTimestamp}
                    </td>
                    <td>{row.execution.quantity}</td>
                    <td>
                      {row.execution.grossUsd}
                      {row.payment && (
                        <>
                          <br />
                          <small>{paymentText(row.payment)}</small>
                        </>
                      )}
                    </td>
                    <td>{row.execution.feeUsd}</td>
                  </>
                ) : (
                  <td colSpan={6}>Запись содержит ошибки</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
