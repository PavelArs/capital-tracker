import type { Opening } from '@api/accounting.api';
import type { CarryInLots, CarryInPreview } from '@api/carry-in.api';

const issueLabels: Record<CarryInPreview['issues'][number]['code'], string> = {
  'acquisition-after-coverage': 'Приобретение позже границы начала учета',
  'extra-instrument': 'Инструмента нет в начальных позициях',
  'missing-instrument': 'Для инструмента не указаны начальные лоты',
  'quantity-mismatch': 'Количество не совпадает с начальными позициями',
  'cost-mismatch': 'Себестоимость не совпадает с начальными позициями',
};

export function CarryInOpening({ opening }: { opening: Opening }) {
  return (
    <section aria-label="Исходные начальные позиции">
      <h3>Исходные начальные позиции</h3>
      <p>
        Ревизия {opening.revision}. Граница покрытия UTC: {opening.asOf}.
      </p>
      <p className="manual-muted">
        Это сохранённые данные на начало учета, а не дополнительный текущий остаток. Текущие позиции
        после открытия журнала рассчитываются в FIFO.
      </p>
      <div className="manual-table-wrap">
        <table className="manual-table">
          <caption>Позиции для сверки начальных лотов</caption>
          <thead>
            <tr>
              <th>Инструмент / UUID</th>
              <th>Количество</th>
              <th>Себестоимость, USD</th>
            </tr>
          </thead>
          <tbody>
            {opening.positions.map((position) => (
              <tr key={position.instrumentId}>
                <td style={{ whiteSpace: 'pre-wrap' }}>
                  {position.instrumentName}
                  {position.instrumentSymbol ? ` (${position.instrumentSymbol})` : ''}
                  <br />
                  {position.instrumentId}
                </td>
                <td>{position.quantity}</td>
                <td>{position.costStatus === 'unknown' ? 'Неизвестна' : position.totalCostUsd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CarryInPreviewView({ preview }: { preview: CarryInPreview }) {
  return (
    <section aria-label="Проверка начальных лотов">
      <h3>Проверка начальных лотов</h3>
      <p>
        Ревизия начальных позиций: {preview.openingRevision}. Граница покрытия UTC:{' '}
        {preview.coverageFrom}.
      </p>
      <p>Начальная учётная стоимость, USD: {preview.carryInCostUsd}</p>
      {preview.canInitialize ? (
        <p role="status">
          Начальные лоты точно совпадают с сохранёнными позициями. Проверьте исходные данные перед
          подтверждением.
        </p>
      ) : (
        <div role="alert">
          <p>Начальные лоты не согласуются с сохранёнными позициями. Журнал не будет открыт.</p>
          <ul>
            {preview.issues.map((issue) => (
              <li key={`${issue.code}:${issue.instrumentId}:${issue.ordinal}`}>
                {issueLabels[issue.code]}
                {issue.ordinal === null ? '' : `: лот ${issue.ordinal}`}
                {issue.instrumentId === null ? '' : `; UUID ${issue.instrumentId}`}.
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="manual-table-wrap">
        <table className="manual-table">
          <caption>Сверка количества и себестоимости</caption>
          <thead>
            <tr>
              <th>Инструмент / UUID</th>
              <th>Количество в позициях</th>
              <th>Количество в лотах</th>
              <th>Стоимость в позициях, USD</th>
              <th>Стоимость в лотах, USD</th>
            </tr>
          </thead>
          <tbody>
            {preview.reconciliation.map((row) => (
              <tr key={row.instrumentId}>
                <td style={{ whiteSpace: 'pre-wrap' }}>
                  {row.instrumentName}
                  {row.instrumentSymbol ? ` (${row.instrumentSymbol})` : ''}
                  <br />
                  {row.instrumentId}
                </td>
                <td>{row.openingQuantity ?? 'Нет позиции'}</td>
                <td>{row.carriedQuantity}</td>
                <td>{row.openingCostUsd ?? 'Нет позиции'}</td>
                <td>{row.carriedCostUsd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="manual-table-wrap">
        <table className="manual-table">
          <caption>Исходные данные и прежнее списание лотов</caption>
          <thead>
            <tr>
              <th>Лот / инструмент</th>
              <th>Приобретение UTC / порядок</th>
              <th>Исходное количество</th>
              <th>Исходная стоимость, USD</th>
              <th>Количество на начало учета</th>
              <th>Ранее выбыло</th>
              <th>Ранее списано, USD</th>
              <th>Переносимая стоимость, USD</th>
            </tr>
          </thead>
          <tbody>
            {preview.lots.map((lot) => (
              <tr key={lot.ordinal}>
                <td style={{ whiteSpace: 'pre-wrap' }}>
                  Лот {lot.ordinal}
                  <br />
                  {lot.instrumentName}
                  {lot.instrumentSymbol ? ` (${lot.instrumentSymbol})` : ''}
                  <br />
                  {lot.instrumentId}
                </td>
                <td>
                  {lot.acquiredAt}
                  <br />
                  {lot.orderWithinTimestamp}
                </td>
                <td>{lot.originalQuantity}</td>
                <td>{lot.originalCostUsd}</td>
                <td>{lot.remainingQuantity}</td>
                <td>{lot.priorDisposedQuantity}</td>
                <td>{lot.priorAllocatedCostUsd}</td>
                <td>{lot.carriedCostUsd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="manual-muted">
        Сверка проверяет точное совпадение сумм, но не подтверждает достоверность истории
        приобретений. Прежние списания не являются прибылью или продажами этого журнала.
      </p>
    </section>
  );
}

export function CarryInEvidence({
  lots,
  busy,
  onMore,
}: {
  lots: CarryInLots;
  busy: boolean;
  onMore: () => void;
}) {
  return (
    <section aria-label="Сохранённые начальные лоты">
      <h3>Сохранённые начальные лоты</h3>
      <p>
        Исходная ревизия позиций: {lots.openingRevision}. Эти данные неизменяемы и включают
        полностью использованные лоты. Текущие остатки показаны отдельно в журнале.
      </p>
      <div className="manual-table-wrap">
        <table className="manual-table">
          <caption>Происхождение начальных лотов</caption>
          <thead>
            <tr>
              <th>Лот / UUID</th>
              <th>Инструмент / UUID</th>
              <th>Приобретение UTC / порядок</th>
              <th>Исходное количество</th>
              <th>Исходная стоимость, USD</th>
              <th>Количество на начало учета</th>
              <th>Ранее выбыло</th>
              <th>Ранее списано, USD</th>
              <th>Стоимость на начало учета, USD</th>
            </tr>
          </thead>
          <tbody>
            {lots.items.map((lot) => (
              <tr key={lot.lotId}>
                <td>
                  Лот {lot.ordinal}
                  <br />
                  {lot.lotId}
                </td>
                <td style={{ whiteSpace: 'pre-wrap' }}>
                  {lot.instrumentName}
                  {lot.instrumentSymbol ? ` (${lot.instrumentSymbol})` : ''}
                  <br />
                  {lot.instrumentId}
                </td>
                <td>
                  {lot.acquiredAt}
                  <br />
                  {lot.orderWithinTimestamp}
                </td>
                <td>{lot.originalQuantity}</td>
                <td>{lot.originalCostUsd}</td>
                <td>{lot.carriedQuantity}</td>
                <td>{lot.priorDisposedQuantity}</td>
                <td>{lot.priorAllocatedCostUsd}</td>
                <td>{lot.carriedCostUsd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lots.nextAfterOrdinal !== null && (
        <button
          type="button"
          className="manual-button manual-button--secondary"
          disabled={busy}
          onClick={onMore}
        >
          Показать ещё начальные лоты
        </button>
      )}
    </section>
  );
}
