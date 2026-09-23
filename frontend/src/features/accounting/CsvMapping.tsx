import { type Instrument, accountingApi } from '@api/accounting.api';
import type { CsvDocument, CsvField, CsvSettings } from '@api/csv-imports.api';
import { useEffect, useRef, useState } from 'react';
import { csvFields } from './CsvPreview';
import { accountingError } from './feedback';

export interface CsvMappingDraft {
  columns: Record<CsvField, string>;
  instruments: Array<{ source: string; instrumentId: string }>;
  sides: Array<{ source: string; side: 'buy' | 'sell' }>;
  decimalSeparator: '.' | ',';
  timestampMode: 'offset' | 'fixed-offset';
  fixedOffset: string;
  assertUsd: boolean;
}
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
    assertUsd: false,
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
  delimiter: ',' | ';',
): CsvSettings {
  const fields = (Object.keys(csvFields) as CsvField[]).filter((field) => field !== 'currency');
  if (!draft.assertUsd) throw new Error('Подтвердите, что валовые суммы и комиссии указаны в USD.');
  if (fields.some((field) => draft.columns[field] === ''))
    throw new Error('Выберите каждую обязательную колонку, включая комиссию и порядок.');
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
        side: Number(draft.columns.side),
        occurredAt: Number(draft.columns.occurredAt),
        order: Number(draft.columns.order),
        quantity: Number(draft.columns.quantity),
        grossUsd: Number(draft.columns.grossUsd),
        feeUsd: Number(draft.columns.feeUsd),
        ...(draft.columns.currency === '' ? {} : { currency: Number(draft.columns.currency) }),
      },
      instruments,
      sides,
    },
    assertUsd: true,
  };
}

export function CsvMapping({
  document,
  draft,
  onChange,
  instruments,
  disabled,
}: {
  document: CsvDocument;
  draft: CsvMappingDraft;
  onChange: (draft: CsvMappingDraft) => void;
  instruments: Instrument[];
  disabled: boolean;
}) {
  const [choices, setChoices] = useState(instruments);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    setChoices((current) =>
      Array.from(new Map([...current, ...instruments].map((item) => [item.id, item])).values()),
    );
  }, [instruments]);
  async function more() {
    if (loading || disabled || cursor === null) return;
    setLoading(true);
    setError(null);
    try {
      const page = await accountingApi.listInstruments(cursor);
      if (!live.current) return;
      setChoices((current) =>
        Array.from(new Map([...current, ...page.items].map((item) => [item.id, item])).values()),
      );
      setCursor(page.nextCursor);
    } catch (error) {
      if (live.current) setError(accountingError(error, 'загрузить инструменты'));
    } finally {
      if (live.current) setLoading(false);
    }
  }
  return (
    <fieldset disabled={disabled} className="csv-mapping">
      <legend>Сопоставление колонок и значений</legend>
      <p>
        Количество и валовая сумма — итоги сделки, не цена одной единицы. Комиссия обязательна: ноль
        должен быть записан явно. Одинаковые названия не заменяют UUID.
      </p>
      <div className="manual-form-grid">
        {(Object.keys(csvFields) as CsvField[]).map((field) => (
          <label key={field}>
            {`Колонка: ${csvFields[field]}`}
            <select
              value={draft.columns[field]}
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
                {field === 'currency' ? 'Не сопоставлена' : 'Выберите колонку'}
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
      <div className="manual-form-grid">
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
              {choices.map((instrument) => (
                <option key={instrument.id} value={instrument.id}>
                  {instrument.name}
                  {instrument.symbol ? ` (${instrument.symbol})` : ''} · {instrument.id}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {cursor !== null && (
        <button
          type="button"
          className="manual-button manual-button--secondary"
          disabled={loading || disabled}
          onClick={() => void more()}
        >
          {loading ? 'Загрузка инструментов…' : 'Загрузить ещё инструменты для CSV'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="manual-form-grid">
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
      <div className="manual-form-grid">
        <label>
          Десятичный разделитель
          <select
            value={draft.decimalSeparator}
            onChange={(event) =>
              onChange({ ...draft, decimalSeparator: event.target.value as '.' | ',' })
            }
          >
            <option value=".">Точка (.)</option>
            <option value=",">Запятая (,)</option>
          </select>
        </label>
        <label>
          Формат времени
          <select
            value={draft.timestampMode}
            onChange={(event) =>
              onChange({ ...draft, timestampMode: event.target.value as 'offset' | 'fixed-offset' })
            }
          >
            <option value="offset">В каждой дате указано смещение или Z</option>
            <option value="fixed-offset">Местное время с общим фиксированным смещением</option>
          </select>
        </label>
        {draft.timestampMode === 'fixed-offset' && (
          <label>
            Фиксированное смещение UTC
            <input
              value={draft.fixedOffset}
              placeholder="+03:00"
              onChange={(event) => onChange({ ...draft, fixedOffset: event.target.value })}
            />
          </label>
        )}
      </div>
      <p>
        Поддерживается ISO-дата с секундами и до трёх десятичных знаков. Летнее время не
        угадывается; порядок совпадающих моментов задаётся отдельной колонкой.
      </p>
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
