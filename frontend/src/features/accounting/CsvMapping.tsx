import type { Instrument } from '@api/accounting.api';
import type {
  CsvDelimiter,
  CsvDocument,
  CsvField,
  CsvSettings,
  CsvTimestampMode,
} from '@api/csv-imports.api';
import { useId } from 'react';
import './OperationForm.css';
import { csvFields } from './CsvPreview';

export interface InstrumentCatalogControls {
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
}

export interface CsvMappingDraft {
  columns: Record<CsvField, string>;
  instruments: Array<{ source: string; instrumentId: string }>;
  sides: Array<{ source: string; side: 'buy' | 'sell' }>;
  decimalSeparator: '.' | ',';
  timestampMode: CsvTimestampMode;
  fixedOffset: string;
  allRowsBuy: boolean;
  feeIncluded: boolean;
  assertUsd: boolean;
}
// Columns that may stay unmapped; side, fee and order need an explicit statement instead.
const optionalFields: CsvField[] = ['side', 'order', 'feeUsd', 'currency'];
const requiredFields: CsvField[] = ['instrument', 'occurredAt', 'quantity', 'grossUsd'];
// The owner's purchase sheet: Дата, Купил, Количество, Купил за, За количество, в USD, …
const sheetHeaders: Partial<Record<CsvField, string>> = {
  occurredAt: 'Дата',
  instrument: 'Купил',
  quantity: 'Количество',
  grossUsd: 'в USD',
};
export function emptyCsvMapping(): CsvMappingDraft {
  return {
    columns: {
      instrument: '',
      side: '',
      occurredAt: '',
      order: '',
      quantity: '',
      grossUsd: '',
      feeUsd: '',
      currency: '',
    },
    instruments: [],
    sides: [],
    decimalSeparator: '.',
    timestampMode: 'offset',
    fixedOffset: '+00:00',
    allRowsBuy: false,
    feeIncluded: false,
    assertUsd: false,
  };
}
/** Fills only layout choices; instruments and the USD attestation stay explicit. */
export function purchaseSheetMapping(document: CsvDocument): CsvMappingDraft {
  const empty = emptyCsvMapping();
  const columns = { ...empty.columns };
  for (const [field, header] of Object.entries(sheetHeaders) as [CsvField, string][]) {
    const index = document.headers.indexOf(header);
    if (index !== -1) columns[field] = String(index);
  }
  return {
    ...empty,
    columns,
    decimalSeparator: ',',
    timestampMode: 'day-month-year-utc',
    allRowsBuy: true,
    feeIncluded: true,
  };
}
function sourceKeys(document: CsvDocument, index: string): string[] {
  return index === ''
    ? []
    : Array.from(new Set(document.rows.map((row) => row.cells[Number(index)])));
}
export function csvSettings(
  draft: CsvMappingDraft,
  document: CsvDocument,
  delimiter: CsvDelimiter,
): CsvSettings {
  if (!draft.assertUsd) throw new Error('Подтвердите, что валовые суммы и комиссии указаны в USD.');
  if (requiredFields.some((field) => draft.columns[field] === ''))
    throw new Error('Выберите колонки инструмента, даты, количества и суммы USD.');
  const noSide = draft.columns.side === '';
  const noFee = draft.columns.feeUsd === '';
  if (noSide && !draft.allRowsBuy)
    throw new Error('Выберите колонку типа сделки или отметьте, что все строки — покупки.');
  if (noFee && !draft.feeIncluded)
    throw new Error('Выберите колонку комиссии или отметьте, что комиссия включена в сумму.');
  if (draft.columns.order === '' && draft.timestampMode !== 'day-month-year-utc')
    throw new Error('Колонку порядка можно не выбирать только для дат без времени.');
  const selected = Object.values(draft.columns).filter((value) => value !== '');
  if (new Set(selected).size !== selected.length)
    throw new Error('Для каждого поля нужна отдельная колонка.');
  const instruments = sourceKeys(document, draft.columns.instrument).map((source) => {
    const entry = draft.instruments.find((item) => item.source === source);
    if (!entry?.instrumentId)
      throw new Error('Выберите инструмент для каждого исходного значения.');
    return { ...entry };
  });
  const sides = sourceKeys(document, draft.columns.side).map((source) => {
    const entry = draft.sides.find((item) => item.source === source);
    if (!entry) throw new Error('Выберите покупку или продажу для каждого исходного значения.');
    return { ...entry };
  });
  const optional = (field: CsvField) =>
    draft.columns[field] === '' ? {} : { [field]: Number(draft.columns[field]) };
  return {
    format: {
      delimiter,
      decimalSeparator: draft.decimalSeparator,
      timestampMode: draft.timestampMode,
      ...(draft.timestampMode === 'fixed-offset' ? { fixedOffset: draft.fixedOffset } : {}),
    },
    mapping: {
      columns: {
        instrument: Number(draft.columns.instrument),
        ...optional('side'),
        occurredAt: Number(draft.columns.occurredAt),
        ...optional('order'),
        quantity: Number(draft.columns.quantity),
        grossUsd: Number(draft.columns.grossUsd),
        ...optional('feeUsd'),
        ...optional('currency'),
      },
      instruments,
      sides,
      ...(noSide ? { allRowsSide: 'buy' as const } : {}),
    },
    assertUsd: true,
    ...(noFee ? { feeIncludedInGross: true as const } : {}),
  };
}

export function CsvMapping({
  document,
  draft,
  onChange,
  instruments,
  instrumentCatalog,
  disabled,
}: {
  document: CsvDocument;
  draft: CsvMappingDraft;
  onChange: (draft: CsvMappingDraft) => void;
  instruments: Instrument[];
  instrumentCatalog: InstrumentCatalogControls;
  disabled: boolean;
}) {
  const descriptionId = useId();
  const columnDescriptions: Partial<Record<CsvField, string>> = {
    quantity: `${descriptionId}-totals`,
    grossUsd: `${descriptionId}-totals`,
    feeUsd: `${descriptionId}-fee`,
    currency: `${descriptionId}-currency`,
    occurredAt: `${descriptionId}-time`,
    order: `${descriptionId}-time`,
  };
  return (
    <fieldset disabled={disabled} className="csv-mapping operation-form">
      <legend>Сопоставление колонок и значений</legend>
      <section className="operation-form__section">
        <h3>Колонки источника</h3>
        <button
          type="button"
          className="manual-button manual-button--secondary"
          aria-describedby={`${descriptionId}-sheet`}
          onClick={() => onChange(purchaseSheetMapping(document))}
        >
          Заполнить по таблице покупок
        </button>
        <p id={`${descriptionId}-sheet`} className="operation-form__hint">
          Для таблицы с колонками Дата, Купил, Количество, Купил за, За количество, в USD: выбирает
          эти колонки, десятичную запятую и даты без времени, отмечает «все строки — покупки» и
          «комиссия включена». Инструменты и подтверждение USD выберите сами. Колонка «в USD»
          становится себестоимостью, даже если платили в USDT.
        </p>
        <div className="operation-form__fields">
          {(Object.keys(csvFields) as CsvField[]).map((field) => (
            <label key={field}>
              {`Колонка: ${csvFields[field]}`}
              <select
                value={draft.columns[field]}
                aria-describedby={columnDescriptions[field]}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    columns: { ...draft.columns, [field]: event.target.value },
                    ...(field === 'instrument' ? { instruments: [] } : {}),
                    ...(field === 'side' ? { sides: [] } : {}),
                  })
                }
              >
                <option value="">
                  {optionalFields.includes(field) ? 'Не сопоставлена' : 'Выберите колонку'}
                </option>
                {document.headers.map((header, index) => (
                  <option key={`${index}:${header}`} value={index}>
                    {index + 1}: {header}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p id={`${descriptionId}-totals`} className="operation-form__hint">
          Количество и валовая сумма — общий итог сделки, а не цена за единицу.
        </p>
        <p id={`${descriptionId}-fee`} className="operation-form__hint">
          Если колонки комиссии нет, явно отметьте, что комиссия уже включена в сумму USD.
        </p>
        {draft.columns.side === '' && (
          <label className="manual-review-check">
            <input
              type="checkbox"
              checked={draft.allRowsBuy}
              onChange={(event) => onChange({ ...draft, allRowsBuy: event.target.checked })}
            />
            Все строки — покупки
          </label>
        )}
        {draft.columns.feeUsd === '' && (
          <label className="manual-review-check">
            <input
              type="checkbox"
              checked={draft.feeIncluded}
              onChange={(event) => onChange({ ...draft, feeIncluded: event.target.checked })}
            />
            Комиссия уже включена в сумму в USD
          </label>
        )}
        <p id={`${descriptionId}-currency`} className="operation-form__hint">
          Колонку валюты можно не сопоставлять. Если она сопоставлена, каждое значение должно быть
          USD.
        </p>
      </section>
      <section className="operation-form__section">
        <h3>Точные исходные значения инструмента</h3>
        <p className="operation-form__hint">Одинаковые названия не заменяют UUID.</p>
        <div className="operation-form__fields">
          {sourceKeys(document, draft.columns.instrument).map((source) => (
            <label key={source}>
              <span>
                Инструмент для <span className="csv-source-key">{source}</span>
              </span>
              <select
                value={draft.instruments.find((item) => item.source === source)?.instrumentId ?? ''}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    instruments: [
                      ...draft.instruments.filter((item) => item.source !== source),
                      { source, instrumentId: event.target.value },
                    ],
                  })
                }
              >
                <option value="">Выберите принадлежащий вам инструмент</option>
                {instruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.name}
                    {instrument.symbol ? ` (${instrument.symbol})` : ''} · {instrument.id}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {(instrumentCatalog.hasMore || instrumentCatalog.loading || instrumentCatalog.error) && (
          <button
            type="button"
            className="manual-button manual-button--secondary"
            disabled={instrumentCatalog.loading || disabled}
            onClick={instrumentCatalog.onLoadMore}
          >
            {instrumentCatalog.loading
              ? 'Загрузка инструментов…'
              : instrumentCatalog.hasMore
                ? 'Загрузить ещё инструменты для CSV'
                : 'Повторить загрузку инструментов для CSV'}
          </button>
        )}
        {instrumentCatalog.error && <p role="alert">{instrumentCatalog.error}</p>}
      </section>
      <section className="operation-form__section">
        <h3>Точные исходные значения типа сделки</h3>
        <div className="operation-form__fields">
          {sourceKeys(document, draft.columns.side).map((source) => (
            <label key={source}>
              <span>
                Тип сделки для <span className="csv-source-key">{source}</span>
              </span>
              <select
                value={draft.sides.find((item) => item.source === source)?.side ?? ''}
                onChange={(event) => {
                  const side = event.target.value;
                  const sides = draft.sides.filter((item) => item.source !== source);
                  if (side === 'buy' || side === 'sell') sides.push({ source, side });
                  onChange({ ...draft, sides });
                }}
              >
                <option value="">Выберите тип</option>
                <option value="buy">Покупка</option>
                <option value="sell">Продажа</option>
              </select>
            </label>
          ))}
        </div>
      </section>
      <section className="operation-form__section">
        <h3>Интерпретация чисел и времени</h3>
        <div className="operation-form__fields">
          <div className="operation-form__field">
            <label>
              Десятичный разделитель
              <select
                value={draft.decimalSeparator}
                aria-describedby={`${descriptionId}-decimal`}
                onChange={(event) =>
                  onChange({ ...draft, decimalSeparator: event.target.value as '.' | ',' })
                }
              >
                <option value=".">Точка (.)</option>
                <option value=",">Запятая (,)</option>
              </select>
            </label>
            <p id={`${descriptionId}-decimal`} className="operation-form__hint">
              Выберите точку или запятую как десятичный разделитель. Значения будут прочитаны по
              этому правилу без преобразования или форматирования исходного CSV.
            </p>
          </div>
          <label>
            Формат времени
            <select
              value={draft.timestampMode}
              aria-describedby={`${descriptionId}-time`}
              onChange={(event) =>
                onChange({
                  ...draft,
                  timestampMode: event.target.value as CsvTimestampMode,
                })
              }
            >
              <option value="offset">В каждой дате указано смещение или Z</option>
              <option value="fixed-offset">Местное время с общим фиксированным смещением</option>
              <option value="day-month-year-utc">Только дата ДД.ММ.ГГГГ (начало дня по UTC)</option>
            </select>
          </label>
          {draft.timestampMode === 'fixed-offset' && (
            <label>
              Фиксированное смещение UTC
              <input
                aria-describedby={`${descriptionId}-time`}
                value={draft.fixedOffset}
                placeholder="+03:00"
                onChange={(event) => onChange({ ...draft, fixedOffset: event.target.value })}
              />
            </label>
          )}
        </div>
        <p id={`${descriptionId}-time`} className="operation-form__hint">
          Поддерживается дата ISO с секундами и до трёх десятичных знаков. Используйте явное
          смещение или Z в каждой дате либо задайте общее фиксированное смещение. Летнее время не
          угадывается; порядок совпадающих моментов задаётся отдельной колонкой. Дата без времени
          (13.06.2025) записывается как 00:00 UTC этого дня; без колонки порядка строки одной даты
          идут в порядке файла после уже записанных сделок этой даты. Строка, полностью совпадающая
          с уже записанной сделкой, отклоняется как повтор.
        </p>
      </section>
      <label className="manual-review-check">
        <input
          type="checkbox"
          checked={draft.assertUsd}
          onChange={(event) => onChange({ ...draft, assertUsd: event.target.checked })}
        />
        Валовые суммы и комиссии выражены в USD
      </label>
    </fieldset>
  );
}
