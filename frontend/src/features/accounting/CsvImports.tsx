import type { Instrument, UuidPage } from '@api/accounting.api';
import {
  type CsvBatch,
  type CsvConfirm,
  type CsvDelimiter,
  type CsvDetail,
  type CsvInspection,
  type CsvPreviewResult,
  type CsvReceipt,
  type CsvRollback,
  type CsvRows,
  type CsvSettings,
  csvImportsApi,
} from '@api/csv-imports.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CsvBatchDetail, CsvReceiptView, csvStateLabel } from './CsvBatchDetail';
import {
  CsvMapping,
  type CsvMappingDraft,
  type InstrumentCatalogControls,
  csvSettings,
  emptyCsvMapping,
} from './CsvMapping';
import { CsvPreview, CsvSource } from './CsvPreview';
import { CsvReconciliationPanel } from './CsvReconciliation';
import { accountingError, newRequestId } from './feedback';
import './CsvImports.css';

type Operation =
  | { kind: 'upload'; file: File }
  | { kind: 'confirm'; batchId: string; input: CsvConfirm }
  | { kind: 'rollback'; batchId: string; input: CsvRollback };
type Recovery = {
  operation: Operation;
  phase: 'sending' | 'unknown' | 'accepted';
  batchId?: string;
  receipt?: CsvReceipt;
};
// Ephemeral recovery only: route changes must not discard a command or its File.
// Nothing is written to browser storage; a reload still needs ordinary server discovery.
const recoveries = new Map<string, Recovery>();
const listeners = new Set<() => void>();
function retain(account: string, value: Recovery | null) {
  if (value) recoveries.set(account, value);
  else recoveries.delete(account);
  for (const notify of listeners) notify();
}
function message(error: unknown) {
  if (isAxiosError(error) && error.response?.status === 413)
    return 'CSV превышает допустимый размер: 256 КиБ для файла. Выберите поддерживаемый файл.';
  if (isAxiosError(error) && error.response?.status === 415)
    return 'Формат загрузки не поддерживается. Выберите CSV в UTF-8.';
  return accountingError(error, 'обработать импорт CSV');
}

export function CsvImports({
  accountId,
  journalRevision,
  instruments,
  instrumentCatalog,
  parentBusy,
  parentBlocked,
  onBlocked,
  onJournalRefresh,
}: {
  accountId: string;
  journalRevision: number;
  instruments: Instrument[];
  instrumentCatalog: InstrumentCatalogControls;
  parentBusy: boolean;
  parentBlocked: boolean;
  onBlocked: (blocked: boolean) => void;
  onJournalRefresh: () => Promise<boolean>;
}) {
  const initial = recoveries.get(accountId);
  const [recovery, setRecovery] = useState<Recovery | undefined>(initial);
  const [file, setFile] = useState<File | null>(
    initial?.operation.kind === 'upload' ? initial.operation.file : null,
  );
  const [selected, setSelected] = useState<string | null>(
    initial?.batchId ??
      (initial && initial.operation.kind !== 'upload' ? initial.operation.batchId : null),
  );
  const [batches, setBatches] = useState<UuidPage<CsvBatch> | null>(null);
  const [detail, setDetail] = useState<CsvDetail | null>(null);
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',');
  const [inspection, setInspection] = useState<CsvInspection | null>(null);
  const [mapping, setMapping] = useState<CsvMappingDraft>(emptyCsvMapping);
  const [preview, setPreview] = useState<{
    value: CsvPreviewResult;
    settings: CsvSettings;
    generation: number;
  } | null>(null);
  const [rows, setRows] = useState<CsvRows | null>(null);
  const [reading, setReading] = useState(false);
  const [listing, setListing] = useState(false);
  const [rollbackReviewed, setRollbackReviewed] = useState(false);
  const [receipt, setReceipt] = useState<CsvReceipt | null>(initial?.receipt ?? null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(false);
  const generation = useRef(0);
  const listGeneration = useRef(0);
  const selection = useRef(selected);
  const previousRevision = useRef(journalRevision);
  const currentRevision = useRef(journalRevision);
  const callbacks = useRef({ onBlocked, onJournalRefresh, parentBusy, parentBlocked });
  callbacks.current = { onBlocked, onJournalRefresh, parentBusy, parentBlocked };
  selection.current = selected;
  currentRevision.current = journalRevision;

  const list = useCallback(
    async (cursor?: string) => {
      const request = ++listGeneration.current;
      setListing(true);
      try {
        const page = await csvImportsApi.list(accountId, cursor);
        if (live.current && request === listGeneration.current)
          setBatches((current) => ({
            ...page,
            items: cursor ? [...(current?.items ?? []), ...page.items] : page.items,
          }));
      } catch (error) {
        if (live.current && request === listGeneration.current) setError(message(error));
      } finally {
        if (live.current && request === listGeneration.current) setListing(false);
      }
    },
    [accountId],
  );
  useEffect(() => {
    live.current = true;
    const update = () => {
      const value = recoveries.get(accountId);
      setRecovery(value);
      callbacks.current.onBlocked(value !== undefined);
      if (value?.receipt) setReceipt(value.receipt);
    };
    listeners.add(update);
    update();
    void list();
    return () => {
      live.current = false;
      generation.current++;
      listGeneration.current++;
      listeners.delete(update);
      callbacks.current.onBlocked(false);
    };
  }, [accountId, list]);

  useEffect(() => {
    if (previousRevision.current === journalRevision) return;
    previousRevision.current = journalRevision;
    setPreview(null);
    setRollbackReviewed(false);
  }, [journalRevision]);

  function invalidate() {
    generation.current++;
    setReading(false);
    setPreview(null);
    setRollbackReviewed(false);
    setError(null);
  }
  async function loadDetail(batchId: string, accepted?: Recovery, refreshJournal = false) {
    const request = ++generation.current;
    setReading(true);
    setPreview(null);
    setRollbackReviewed(false);
    setRows(null);
    setDetail(null);
    setError(null);
    const needsJournal =
      refreshJournal || (accepted !== undefined && accepted.operation.kind !== 'upload');
    const [batchResult, journalResult] = await Promise.allSettled([
      csvImportsApi.detail(accountId, batchId),
      needsJournal ? callbacks.current.onJournalRefresh() : Promise.resolve(true),
    ]);
    if (!live.current || request !== generation.current || selection.current !== batchId) return;
    setReading(false);
    if (batchResult.status === 'fulfilled') {
      setDetail(batchResult.value);
      // Reconciliation reads the source with the delimiter the batch was accepted with.
      const acceptedDelimiter = batchResult.value.acceptedSettings?.format.delimiter;
      if (acceptedDelimiter && !recoveries.has(accountId)) setDelimiter(acceptedDelimiter);
    }
    const complete =
      batchResult.status === 'fulfilled' &&
      journalResult.status === 'fulfilled' &&
      journalResult.value;
    if (!complete) {
      setError(
        accepted
          ? 'Запрос принят, но текущее состояние партии и журнала ещё не загружено полностью. Повторно отправлять принятую команду не нужно. Обновите состояние перед новой записью.'
          : batchResult.status === 'rejected'
            ? message(batchResult.reason)
            : 'Не удалось обновить журнал.',
      );
      return;
    }
    if (accepted && recoveries.get(accountId) === accepted) retain(accountId, null);
  }
  function chooseBatch(batchId: string) {
    if (recoveries.has(accountId) || callbacks.current.parentBlocked) return;
    invalidate();
    selection.current = batchId;
    setSelected(batchId);
    setInspection(null);
    setMapping(emptyCsvMapping());
    setReceipt(null);
    void loadDetail(batchId);
  }
  function changeDelimiter(next: CsvDelimiter) {
    if (recoveries.has(accountId) || callbacks.current.parentBlocked) return;
    invalidate();
    setDelimiter(next);
    setInspection(null);
    setMapping(emptyCsvMapping());
  }
  function editMapping(next: CsvMappingDraft) {
    if (recoveries.has(accountId) || callbacks.current.parentBlocked) return;
    invalidate();
    setMapping(next);
  }
  async function inspect() {
    if (!selected || recovery || parentBlocked) return;
    const request = ++generation.current;
    setReading(true);
    setError(null);
    setInspection(null);
    setPreview(null);
    setMapping(emptyCsvMapping());
    try {
      const value = await csvImportsApi.inspect(accountId, selected, delimiter);
      if (live.current && request === generation.current) setInspection(value);
    } catch (error) {
      if (live.current && request === generation.current) setError(message(error));
    } finally {
      if (live.current && request === generation.current) setReading(false);
    }
  }
  async function showPreview() {
    if (
      !selected ||
      !inspection?.valid ||
      recovery ||
      parentBlocked ||
      detail?.batch.state !== 'draft'
    )
      return;
    let settings: CsvSettings;
    try {
      settings = csvSettings(mapping, inspection, delimiter);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Проверьте сопоставление.');
      return;
    }
    const request = ++generation.current;
    setReading(true);
    setPreview(null);
    setError(null);
    try {
      const value = await csvImportsApi.preview(accountId, selected, settings);
      if (live.current && request === generation.current) {
        if (value.journalRevision === currentRevision.current)
          setPreview({ value, settings, generation: request });
        else setError('Журнал изменился. Обновите состояние CSV и повторно проверьте импорт.');
      }
    } catch (error) {
      if (live.current && request === generation.current) setError(message(error));
    } finally {
      if (live.current && request === generation.current) setReading(false);
    }
  }
  async function send(operation: Operation, prior?: Recovery) {
    if (callbacks.current.parentBusy || recoveries.get(accountId)?.phase === 'sending') return;
    const previouslyUnknown = prior?.phase === 'unknown';
    const record: Recovery = {
      operation,
      phase: 'sending',
      ...(operation.kind === 'upload' ? {} : { batchId: operation.batchId }),
    };
    callbacks.current.onBlocked(true);
    retain(accountId, record);
    generation.current++;
    setReading(false);
    setError(null);
    setRollbackReviewed(false);
    let accepted: Recovery;
    try {
      if (operation.kind === 'upload') {
        const identity = await csvImportsApi.upload(accountId, operation.file);
        accepted = { operation, phase: 'accepted', batchId: identity.batchId };
      } else {
        const value =
          operation.kind === 'confirm'
            ? await csvImportsApi.confirm(accountId, operation.batchId, operation.input)
            : await csvImportsApi.rollback(accountId, operation.batchId, operation.input);
        accepted = { operation, phase: 'accepted', batchId: operation.batchId, receipt: value };
      }
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      const refused = status !== undefined && status >= 400 && status < 500;
      // Only this original confirm/rollback POST's post-replay 409 resolves prior uncertainty.
      // Upload instead resolves by a successful exact-byte identity response.
      const unknown = previouslyUnknown ? operation.kind === 'upload' || status !== 409 : !refused;
      if (recoveries.get(accountId) === record)
        retain(accountId, unknown ? { ...record, phase: 'unknown' } : null);
      if (live.current) {
        setError(message(error));
        setPreview(null);
        if (!unknown) setDetail(null);
      }
      return;
    }
    if (recoveries.get(accountId) !== record) return;
    retain(accountId, accepted);
    if (!live.current) return;
    selection.current = accepted.batchId!;
    setSelected(accepted.batchId!);
    setPreview(null);
    setInspection(null);
    setMapping(emptyCsvMapping());
    if (accepted.receipt) setReceipt(accepted.receipt);
    await loadDetail(accepted.batchId!, accepted);
    if (live.current) void list();
  }
  function confirm() {
    if (
      !selected ||
      recovery ||
      parentBlocked ||
      reading ||
      !preview?.value.canConfirm ||
      !preview.value.previewHash ||
      preview.generation !== generation.current ||
      preview.value.journalRevision !== currentRevision.current
    )
      return;
    void send({
      kind: 'confirm',
      batchId: selected,
      input: {
        ...preview.settings,
        requestId: newRequestId(),
        expectedJournalRevision: preview.value.journalRevision,
        parserVersion: preview.value.parserVersion,
        previewHash: preview.value.previewHash,
      },
    });
  }
  function rollback() {
    if (
      !selected ||
      recovery ||
      parentBlocked ||
      reading ||
      !rollbackReviewed ||
      !detail?.rollbackReview.eligible ||
      detail.rollbackReview.journalRevision !== currentRevision.current
    )
      return;
    void send({
      kind: 'rollback',
      batchId: selected,
      input: {
        requestId: newRequestId(),
        expectedJournalRevision: detail.rollbackReview.journalRevision,
      },
    });
  }
  async function provenance(append: boolean) {
    if (!selected || reading || recovery) return;
    const request = ++generation.current;
    setReading(true);
    setError(null);
    setPreview(null);
    try {
      const page = await csvImportsApi.rows(
        accountId,
        selected,
        append ? (rows?.nextAfterOrdinal ?? 0) : 0,
        append ? rows?.batchState : undefined,
      );
      if (live.current && request === generation.current)
        setRows((current) => ({
          ...page,
          items: append ? [...(current?.items ?? []), ...page.items] : page.items,
        }));
    } catch (error) {
      if (live.current && request === generation.current) {
        setRows(null);
        setRollbackReviewed(false);
        setError(message(error));
      }
    } finally {
      if (live.current && request === generation.current) setReading(false);
    }
  }
  const locked = recovery !== undefined || parentBlocked;
  const refreshBatch =
    recovery?.batchId ??
    (recovery && recovery.operation.kind !== 'upload' ? recovery.operation.batchId : selected);
  const importStep =
    preview || (detail && detail.batch.state !== 'draft') ? 3 : inspection?.valid ? 2 : 1;
  return (
    <section className="manual-card csv-imports" aria-labelledby="csv-import-heading">
      <h2 id="csv-import-heading">Импорт CSV</h2>
      <ol className="csv-imports__steps" aria-label="Этапы импорта">
        {['Файл', 'Сопоставление', 'Проверка'].map((label, index) => (
          <li key={label} aria-current={importStep === index + 1 ? 'step' : undefined}>
            {label}
          </li>
        ))}
      </ol>
      <p>
        UTF-8, запятая, точка с запятой или табуляция; файл до 256 КиБ, до 100 записей, 32 колонок и
        4096 байт в ячейке. Сначала просмотрите исходные строки и явно укажите смысл колонок.
        Поддерживаются покупки и продажи в USD; таблицу покупок из Excel (дата без времени, без
        колонок типа и комиссии) можно загрузить как есть, сохранив её как «CSV UTF-8» или
        скопировав в текстовый файл с табуляцией.
      </p>
      <p>
        Повтор того же файла не создаёт новых сделок. Изменённые и пересекающиеся выгрузки считаются
        разными файлами: совпадения между ними автоматически не проверяются. Не импортируйте одну
        историю повторно в изменённом виде. Лимиты журнала — 1000 активных сделок и 10000 версий;
        хранится до 256 файлов на счёт, включая откатанные.
      </p>
      {error && (
        <p role="alert" className="manual-feedback manual-feedback--error">
          {error}
        </p>
      )}
      {reading && <p role="status">Загрузка данных CSV…</p>}
      {recovery?.phase === 'sending' && <p role="status">Отправка исходного запроса CSV…</p>}
      {recovery?.phase === 'unknown' && (
        <div className="manual-coverage-warning">
          <p>
            Результат исходного запроса CSV неизвестен. Файл, сопоставление, партия и команда
            сохранены без изменений в этой вкладке. Обновление данных внутри приложения не разрешает
            неизвестный результат. Не перезагружайте страницу целиком до разрешения запроса.
          </p>
          <button
            type="button"
            className="manual-button"
            disabled={parentBusy || reading}
            onClick={() => void send(recovery.operation, recovery)}
          >
            Повторить исходный запрос CSV
          </button>
        </div>
      )}
      {recovery?.phase === 'accepted' && (
        <p role="status">
          Запрос принят. Новые записи заблокированы до успешного обновления партии и журнала.
        </p>
      )}
      {receipt &&
        receipt.requestId !== detail?.confirmReceipt?.requestId &&
        receipt.requestId !== detail?.rollbackReceipt?.requestId && (
          <CsvReceiptView receipt={receipt} />
        )}
      <section className="csv-imports__section" aria-label="Файл и сохранённые партии">
        <h3>Файл и сохранённые партии</h3>
        <p className="manual-muted">
          Загрузка сохраняет источник. Сделки появятся только после проверки и подтверждения.
        </p>
        <label className="manual-field">
          Файл CSV
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            disabled={locked}
            onChange={(event) => {
              if (recoveries.has(accountId) || callbacks.current.parentBlocked) return;
              invalidate();
              setFile(event.target.files?.[0] ?? null);
              selection.current = null;
              setSelected(null);
              setDetail(null);
              setInspection(null);
              setMapping(emptyCsvMapping());
              setRows(null);
              setReceipt(null);
            }}
          />
        </label>
        {file && <p>Выбранный файл: {file.name}</p>}
        <button
          type="button"
          className="manual-button"
          disabled={locked || reading || !file}
          onClick={() => {
            if (file && !recoveries.has(accountId) && !callbacks.current.parentBlocked)
              void send({ kind: 'upload', file });
          }}
        >
          Загрузить CSV
        </button>
        <div className="trade-actions">
          <button
            type="button"
            className="manual-button manual-button--secondary"
            disabled={listing}
            onClick={() => void list()}
          >
            Обновить список импортов
          </button>
          {batches?.nextCursor && (
            <button
              type="button"
              className="manual-button manual-button--secondary"
              disabled={listing}
              onClick={() => void list(batches.nextCursor ?? undefined)}
            >
              Следующие импорты
            </button>
          )}
        </div>
        {batches && (
          <label>
            Сохранённая партия CSV
            <select
              value={selected ?? ''}
              disabled={locked}
              onChange={(event) => {
                if (event.target.value) chooseBatch(event.target.value);
              }}
            >
              <option value="">Выберите партию</option>
              {!batches.items.some((batch) => batch.batchId === selected) && selected && (
                <option value={selected}>{detail?.batch.filename ?? selected}</option>
              )}
              {batches.items.map((batch) => (
                <option key={batch.batchId} value={batch.batchId}>
                  {batch.filename} · {csvStateLabel[batch.state]} · {batch.batchId}
                </option>
              ))}
            </select>
          </label>
        )}
        {refreshBatch && (
          <button
            type="button"
            className="manual-button manual-button--secondary"
            disabled={reading || recovery?.phase === 'sending' || parentBusy}
            onClick={() => {
              selection.current = refreshBatch;
              setSelected(refreshBatch);
              void loadDetail(
                refreshBatch,
                recovery?.phase === 'accepted' ? recovery : undefined,
                true,
              );
            }}
          >
            Обновить состояние CSV
          </button>
        )}
      </section>
      {detail && (
        <CsvBatchDetail
          value={detail}
          rows={rows}
          busy={locked || reading}
          rollbackStale={detail.rollbackReview.journalRevision !== journalRevision}
          rollbackReviewed={rollbackReviewed}
          onReview={setRollbackReviewed}
          onRollback={rollback}
          onRows={(append) => void provenance(append)}
        />
      )}
      {selected && (
        <section className="csv-imports__section" aria-label="Исходный файл">
          <h3>Исходный файл</h3>
          <label>
            Разделитель
            <select
              value={delimiter}
              disabled={locked}
              onChange={(event) => changeDelimiter(event.target.value as CsvDelimiter)}
            >
              <option value=",">Запятая (,)</option>
              <option value=";">Точка с запятой (;)</option>
              <option value={'\t'}>Табуляция</option>
            </select>
          </label>
          <button
            type="button"
            className="manual-button manual-button--secondary"
            disabled={locked || reading}
            onClick={() => void inspect()}
          >
            Просмотреть исходные строки
          </button>
        </section>
      )}
      {inspection && <CsvSource inspection={inspection} />}
      {detail?.batch.state === 'committed' &&
        selected &&
        (!inspection?.valid || delimiter !== detail.acceptedSettings?.format.delimiter) && (
          <p className="manual-muted">
            Чтобы сверить партию с таблицей, просмотрите исходные строки файла с тем же
            разделителем, с которым партия была импортирована.
          </p>
        )}
      {detail?.batch.state === 'committed' &&
        selected &&
        inspection?.valid &&
        // Column numbers must match the server's parse with the accepted delimiter.
        delimiter === detail.acceptedSettings?.format.delimiter && (
          <CsvReconciliationPanel
            accountId={accountId}
            batchId={selected}
            document={inspection}
            instruments={instruments}
            journalRevision={journalRevision}
            disabled={locked || reading}
          />
        )}
      {inspection?.valid && detail?.batch.state === 'draft' && (
        <div className="csv-imports__section">
          <CsvMapping
            document={inspection}
            draft={mapping}
            onChange={editMapping}
            instruments={instruments}
            instrumentCatalog={instrumentCatalog}
            disabled={locked}
          />
          <button
            type="button"
            className="manual-button"
            disabled={locked || reading}
            onClick={() => void showPreview()}
          >
            Проверить импорт
          </button>
        </div>
      )}
      {preview && (
        <div className="csv-imports__section">
          <CsvPreview value={preview.value} />
          <button
            type="button"
            className="manual-button"
            disabled={
              locked ||
              reading ||
              !preview.value.canConfirm ||
              !preview.value.previewHash ||
              preview.generation !== generation.current ||
              preview.value.journalRevision !== journalRevision
            }
            onClick={confirm}
          >
            Подтвердить импорт CSV
          </button>
        </div>
      )}
    </section>
  );
}
