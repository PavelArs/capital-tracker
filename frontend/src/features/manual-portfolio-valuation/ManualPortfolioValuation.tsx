import type { AccountSummary } from '@api/accounting.api';
import {
  type ManualPortfolioValuationResponse,
  manualPortfolioValuationApi,
} from '@api/manual-portfolio-valuation.api';
import { accountingError } from '@features/accounting/feedback';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toManualPortfolioView } from './manual-portfolio-view';
import './ManualPortfolioValuation.css';

const selectionLimit = 10;

export function ManualPortfolioValuation({ accounts }: { accounts: AccountSummary[] }) {
  const [selected, setSelected] = useState<AccountSummary[]>([]);
  const [instant, setInstant] = useState('');
  const [report, setReport] = useState<ManualPortfolioValuationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  function invalidate() {
    generation.current++;
    setReport(null);
    setLoading(false);
    setError(null);
  }

  function changeSelection(account: AccountSummary, checked: boolean) {
    invalidate();
    setSelected((current) => {
      if (!checked) return current.filter((item) => item.id !== account.id);
      if (current.some((item) => item.id === account.id) || current.length >= selectionLimit)
        return current;
      return [...current, account];
    });
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!instant.trim() || selected.length === 0) return;
    const intent = ++generation.current;
    const requestedIds = selected.map((account) => account.id).sort();
    setReport(null);
    setLoading(true);
    setError(null);
    try {
      const response = await manualPortfolioValuationApi.preview(instant, requestedIds);
      if (generation.current !== intent) return;
      if (
        response.accountIds.length !== requestedIds.length ||
        response.accountIds.some((id, index) => id !== requestedIds[index])
      ) {
        setError('Ответ не согласуется с выбранными счетами. Выполните новый расчёт.');
        return;
      }
      setReport(response);
    } catch (caught) {
      if (generation.current !== intent) return;
      setError(
        isAxiosError(caught) && caught.response?.status === 409
          ? 'Сохранённая история изменилась или недоступна. Проверьте счета и повторите расчёт.'
          : accountingError(caught, 'рассчитать оценку выбранных счетов'),
      );
    } finally {
      if (generation.current === intent) setLoading(false);
    }
  }

  const view = report ? toManualPortfolioView(report) : null;
  const selectedIds = new Set(selected.map((account) => account.id));

  return (
    <section className="manual-card manual-portfolio" aria-label="Оценка выбранных счетов">
      <h2>Оценка выбранных счетов</h2>
      <p className="manual-muted">
        Только выбранные ручные счета: денежные остатки и подключённые кошельки не включены;
        пересекающиеся владения между счетами не сверяются.
      </p>
      <details className="manual-portfolio__method">
        <summary>Что входит в оценку</summary>
        <p>
          Позиции восстановлены по текущей исправленной истории. Учитываются только сохранённые
          ручные цены USD для инструмента на точный момент оценки. Если история или цена недоступна,
          общий итог не определяется; оценённая часть включает только позиции с известной ценой.
        </p>
      </details>
      <p>
        Выбрано счетов: {selected.length} из {selectionLimit}
      </p>
      {selected.length > 0 && (
        <div className="manual-portfolio__selected">
          <p>Выбранные счета:</p>
          <ul>
            {selected.map((account) => (
              <li key={account.id}>
                <span>{account.name}</span>{' '}
                <button
                  className="manual-link-button"
                  type="button"
                  onClick={() => changeSelection(account, false)}
                  aria-label={`Убрать счет ${account.name}`}
                >
                  Убрать
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="manual-portfolio__choices">
        {accounts.length === 0 ? (
          <p className="manual-muted">Загрузите или создайте счета, чтобы выбрать их для оценки.</p>
        ) : (
          <fieldset>
            <legend>Счета из загруженного каталога</legend>
            {accounts.map((account) => (
              <label key={account.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(account.id)}
                  disabled={!selectedIds.has(account.id) && selected.length >= selectionLimit}
                  onChange={(event) => changeSelection(account, event.target.checked)}
                />
                <span>{`Включить счет ${account.name}`}</span>
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <form className="manual-portfolio__form" onSubmit={(event) => void calculate(event)}>
        <label>
          Момент оценки (UTC)
          <input
            type="text"
            value={instant}
            placeholder="2025-01-04T00:00:00.000Z"
            required
            onChange={(event) => {
              invalidate();
              setInstant(event.target.value);
            }}
          />
        </label>
        <button
          className="manual-button"
          type="submit"
          disabled={!instant.trim() || selected.length === 0}
        >
          Рассчитать оценку
        </button>
      </form>
      {loading && <p role="status">Расчёт оценки…</p>}
      {error && <p role="alert">{error}</p>}
      {report && view && (
        <div className="manual-portfolio__result">
          <h3>{view.statusText}</h3>
          <p className="manual-muted">Момент UTC: {report.at}</p>
          <dl className="manual-portfolio__summary">
            <dt>Оценка выбранных счетов, USD</dt>
            <dd>{view.totalText}</dd>
            <dt>Оценённая часть, USD</dt>
            <dd>{view.subtotalText}</dd>
            <dt>Счетов без истории</dt>
            <dd>{report.unavailableAccountCount}</dd>
            <dt>Позиций без цены</dt>
            <dd>{report.missingPriceCount}</dd>
          </dl>
          <p className="manual-portfolio__scope">
            Только выбранные ручные счета: денежные остатки и подключённые кошельки не включены;
            пересекающиеся владения между счетами не сверяются.
          </p>
          <p className="manual-portfolio__scroll-cue">
            На узком экране таблицы можно прокручивать по горизонтали.
          </p>
          <div
            className="manual-portfolio__table-wrap"
            role="region"
            aria-label="Распределение по инструментам выбранных счетов — прокручиваемая таблица"
            tabIndex={0}
          >
            <table aria-label="Распределение по инструментам выбранных счетов">
              <caption>Распределение по инструментам выбранных счетов</caption>
              <thead>
                <tr>
                  <th scope="col">Инструмент</th>
                  <th className="manual-portfolio__number" scope="col">
                    Количество
                  </th>
                  <th className="manual-portfolio__number" scope="col">
                    Стоимость, USD
                  </th>
                  <th className="manual-portfolio__number" scope="col">
                    Доля, %
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.allocation.map((row) => (
                  <tr key={row.instrumentId}>
                    <th className="manual-portfolio__identity" scope="row">
                      {row.instrumentName}
                      {row.instrumentSymbol && ` ${row.instrumentSymbol}`}
                    </th>
                    <td className="manual-portfolio__number">{row.quantity}</td>
                    <td className="manual-portfolio__number">{row.valueText}</td>
                    <td className="manual-portfolio__number">{row.percentText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            className="manual-portfolio__table-wrap"
            role="region"
            aria-label="Оценка по счетам — прокручиваемая таблица"
            tabIndex={0}
          >
            <table aria-label="Оценка по счетам">
              <caption>Оценка по счетам</caption>
              <thead>
                <tr>
                  <th scope="col">Счет</th>
                  <th scope="col">История и ревизия</th>
                  <th scope="col">Полнота</th>
                  <th className="manual-portfolio__number" scope="col">
                    Оценённая часть, USD
                  </th>
                  <th className="manual-portfolio__number" scope="col">
                    Оценка, USD
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.accountId}>
                    <td className="manual-portfolio__identity">
                      <Link to={`/manual-accounts/${row.accountId}`}>{row.name}</Link>
                    </td>
                    <td>
                      <span>{row.coverageText}</span>
                      {row.coverageFrom && <small>С {row.coverageFrom}</small>}
                      {row.journalRevision !== null && (
                        <small>Ревизия журнала: {row.journalRevision}</small>
                      )}
                    </td>
                    <td>
                      {row.completenessText}
                      <small>Позиций без цены: {row.missingPriceText}</small>
                    </td>
                    <td className="manual-portfolio__number">{row.subtotalText}</td>
                    <td className="manual-portfolio__number">{row.totalText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
