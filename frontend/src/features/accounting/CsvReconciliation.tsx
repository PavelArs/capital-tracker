import type { Instrument } from '@api/accounting.api';
import {
  type CsvDocument,
  type CsvReconciliation,
  type CsvReconciliationField,
  type CsvReferenceColumns,
  csvImportsApi,
} from '@api/csv-imports.api';
import { useEffect, useRef, useState } from 'react';
import { accountingError } from './feedback';

type ReferenceKey = keyof CsvReferenceColumns;
const referenceLabels: Record<ReferenceKey, string> = {
  usdAmount: 'в USD',
  rate: 'Курс',
  currentRate: 'Текущий курс',
  currentValue: 'Текущая стоимость',
  difference: 'Разница',
  returnPercent: 'Доход, %',
};
// Headers of the owner's purchase sheet for each reference column.
const sheetHeaders: Record<ReferenceKey, string> = {
  usdAmount: 'в USD',
  rate: 'Курс',
  currentRate: 'Текущий курс',
  currentValue: 'Текущая стоимость',
  difference: 'Разница',
  returnPercent: 'Доход',
};
const results: Record<CsvReconciliation['rows'][number]['checks'][number]['result'], string> = {
  match: 'совпадает',
  mismatch: 'расходится',
  unreadable: 'не читается',
  unavailable: 'нет текущего курса',
};
const statuses: Record<CsvReconciliation['rows'][number]['status'], string> = {
  imported: 'как импортирована',
  modified: 'исправлена после импорта',
  voided: 'аннулирована',
};
const referenceKeys = Object.keys(referenceLabels) as ReferenceKey[];

export function sheetReferenceColumns(headers: string[]): Record<ReferenceKey, string> {
  return Object.fromEntries(
    referenceKeys.map((key) => {
      const index = headers.indexOf(sheetHeaders[key]);
      return [key, index === -1 ? '' : String(index)];
    }),
  ) as Record<ReferenceKey, string>;
}

/** Calendar date in UTC, as the sheet records it; a non-midnight time is added explicitly. */
function utcDate(value: string): string {
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-');
  const clock = time.slice(0, 5);
  return `${day}.${month}.${year}${clock === '00:00' ? '' : ` ${clock} UTC`}`;
}

export function CsvReconciliationView({
  value,
  instruments,
}: {
  value: CsvReconciliation;
  instruments: Instrument[];
}) {
  const instrumentLabel = (id: string | null) => {
    const instrument = instruments.find((item) => item.id === id);
    if (!instrument) return id ?? '—';
    return `${instrument.name}${instrument.symbol ? ` (${instrument.symbol})` : ''}`;
  };
  const label = (field: CsvReconciliationField) => referenceLabels[field];
  const { totals } = value;
  return (
    <section className="csv-imports__preview" aria-label="Результат сверки">
      <p>
        Совпадает: {totals.matchCount} · расходится: {totals.mismatchCount} · не читается:{' '}
        {totals.unreadableCount} · нет текущего курса: {totals.unavailableCount}
      </p>
      <p>Себестоимость покупок всего: {totals.costUsd} USD</p>
      <p>
        {totals.unrealizedPnlUsd === null
          ? 'Нереализованная прибыль покупок: нет ручной цены хотя бы для одной строки.'
          : `Нереализованная прибыль покупок по последним ручным ценам: ${totals.unrealizedPnlUsd} USD`}{' '}
        Считается по каждой покупке целиком, без учёта последующих продаж.
      </p>
      <div className="manual-table-wrap">
        <table className="manual-table csv-reconciliation" aria-label="Сверка строк с таблицей">
          <thead>
            <tr>
              <th scope="col">Строка</th>
              <th scope="col">Дата</th>
              <th scope="col">Актив</th>
              <th scope="col">Количество</th>
              <th scope="col">Себестоимость, USD</th>
              <th scope="col">Таблица / сервис</th>
              <th scope="col">Последняя ручная цена</th>
              <th scope="col">Стоимость, USD</th>
              <th scope="col">Нереализованная прибыль, USD</th>
              <th scope="col">Доход, %</th>
            </tr>
          </thead>
          <tbody>
            {value.rows.map((row) => (
              <tr key={row.ordinal}>
                <td>
                  {row.ordinal} (строка файла {row.startLine}, {statuses[row.status]})
                </td>
                <td>{row.occurredAt ? utcDate(row.occurredAt) : '—'}</td>
                <td>{row.status === 'voided' ? '—' : instrumentLabel(row.instrumentId)}</td>
                <td>{row.quantity ?? '—'}</td>
                <td>
                  {row.side === 'sell'
                    ? 'продажа — не сверяется с таблицей покупок'
                    : (row.costUsd ?? '—')}
                </td>
                <td className="csv-reconciliation__checks">
                  <ul>
                    {row.checks.map((check) => (
                      <li key={check.field}>
                        {label(check.field)}: {check.sheet} / {check.app ?? '—'} —{' '}
                        {results[check.result]}
                      </li>
                    ))}
                  </ul>
                </td>
                <td>
                  {row.latestPrice
                    ? `${row.latestPrice.priceUsd} на ${utcDate(row.latestPrice.observedAt)}`
                    : 'нет'}
                </td>
                <td>{row.valueUsd ?? '—'}</td>
                <td>{row.unrealizedPnlUsd ?? '—'}</td>
                <td>{row.unrealizedReturnPercent ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CsvReconciliationPanel({
  accountId,
  batchId,
  document,
  instruments,
  journalRevision,
  disabled,
}: {
  accountId: string;
  batchId: string;
  document: CsvDocument;
  instruments: Instrument[];
  journalRevision: number;
  disabled: boolean;
}) {
  const [columns, setColumns] = useState(() => sheetReferenceColumns(document.headers));
  const [value, setValue] = useState<CsvReconciliation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    request.current++;
    setColumns(sheetReferenceColumns(document.headers));
  }, [document]);
  // A new source or a journal change (correction, void) makes any shown result stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on these inputs
  useEffect(() => {
    request.current++;
    setValue(null);
    setError(null);
    setLoading(false);
  }, [document, journalRevision]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function reconcile() {
    const selected: CsvReferenceColumns = {};
    for (const key of referenceKeys) if (columns[key] !== '') selected[key] = Number(columns[key]);
    const used = Object.values(selected);
    if (used.length === 0 || new Set(used).size !== used.length) {
      setError('Выберите хотя бы одну колонку таблицы; каждая колонка — только для одного поля.');
      return;
    }
    const current = ++request.current;
    setLoading(true);
    setError(null);
    setValue(null);
    try {
      const result = await csvImportsApi.reconciliation(accountId, batchId, selected);
      if (current === request.current) setValue(result);
    } catch (failure) {
      if (current === request.current) setError(accountingError(failure, 'сверить партию'));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  return (
    <section
      className="csv-imports__section operation-form"
      aria-labelledby="csv-reconciliation-heading"
    >
      <h3 id="csv-reconciliation-heading">Сверка с таблицей</h3>
      <p className="manual-muted">
        Сервис пересчитывает курс покупки, стоимость, разницу и доход по текущему курсу из самой
        таблицы и сравнивает с её ячейками: значение совпадает, если после округления до знаков
        ячейки получается то же число. Отдельно показана нереализованная прибыль по последней ручной
        цене сервиса. Сверка ничего не записывает.
      </p>
      <div className="operation-form__fields">
        {referenceKeys.map((key) => (
          <label key={key}>
            {`Колонка таблицы: ${referenceLabels[key]}`}
            <select
              value={columns[key]}
              disabled={disabled || loading}
              onChange={(event) => {
                request.current++;
                setValue(null);
                setLoading(false);
                setColumns({ ...columns, [key]: event.target.value });
              }}
            >
              <option value="">Не сравнивать</option>
              {document.headers.map((header, index) => (
                <option key={`${index}:${header}`} value={index}>
                  {index + 1}: {header}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="manual-button manual-button--secondary"
        disabled={disabled || loading}
        onClick={() => void reconcile()}
      >
        Сверить с таблицей
      </button>
      {loading && <p role="status">Сверка…</p>}
      {error && (
        <p role="alert" className="manual-feedback manual-feedback--error">
          {error}
        </p>
      )}
      {value && <CsvReconciliationView value={value} instruments={instruments} />}
    </section>
  );
}
