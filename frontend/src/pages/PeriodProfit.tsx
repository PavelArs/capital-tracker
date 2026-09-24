import { type ProfitPreview, periodProfitApi } from '@api/period-profit.api';
import { type TwrPreview, type TwrUnavailableReason, twrPreviewApi } from '@api/twr-preview.api';
import {
  type XirrPreview,
  type XirrUnavailableReason,
  xirrPreviewApi,
} from '@api/xirr-preview.api';
import { useAuth } from '@contexts/AuthContext';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LinkedTwr from './LinkedTwr';
import './PeriodProfit.css';

type PreviewMode = 'profit' | 'xirr' | 'twr';
type PreviewResult =
  | { mode: 'profit'; preview: ProfitPreview }
  | { mode: 'xirr'; preview: XirrPreview }
  | { mode: 'twr'; preview: TwrPreview };

const unavailableReason: Record<XirrUnavailableReason, string> = {
  'insufficient-cash-flows': 'Недостаточно денежных потоков в разные моменты для расчёта XIRR.',
  'one-sided-cash-flows': 'Для расчёта XIRR нужны отрицательный и положительный потоки.',
  'unsupported-pattern': 'Порядок денежных потоков не поддерживается для расчёта XIRR.',
  'too-many-cash-flow-dates': 'Более 64 ненулевых моментов потоков: расчёт XIRR недоступен.',
  'outside-supported-range': 'Ставка за пределами поддерживаемого диапазона.',
  'numerical-failure': 'Не удалось надёжно определить ставку XIRR для этих потоков.',
};

const twrUnavailableReason: Record<TwrUnavailableReason, string> = {
  'missing-flow-boundary-valuations':
    'Для расчёта TWR нужны оценки в моменты промежуточных вводов и выводов.',
  'nonpositive-opening-capital': 'Начальный капитал после потоков должен быть положительным.',
};

function previewError(error: unknown, mode: PreviewMode): string {
  const operation = mode === 'profit' ? 'прибыль' : mode === 'xirr' ? 'XIRR' : 'TWR';
  if (!isAxiosError(error)) return `Не удалось рассчитать ${operation}. Попробуйте ещё раз.`;
  const status = error.response?.status;
  if (status === 400) return 'Проверьте даты, оценки USD и подтверждение.';
  if (status === 409)
    return 'Журнал внешних потоков не создан или период начинается до его границы учёта. Проверьте журнал и даты.';
  if (status === 401) return 'Сеанс завершён. Войдите снова и выполните новый расчёт.';
  if (status === 403) return 'Запрос отклонён. Проверьте сеанс и выполните новый расчёт.';
  if (status === 429)
    return mode === 'xirr'
      ? 'Расчёт XIRR уже выполняется. Попробуйте ещё раз позже.'
      : 'Слишком много запросов. Попробуйте ещё раз позже.';
  if (!error.response) return 'Не удалось получить ответ. Выполните новый расчёт.';
  return `Не удалось рассчитать ${operation}. Выполните новый расчёт.`;
}

function PeriodProfitOwner() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openingValueUsd, setOpeningValueUsd] = useState('');
  const [closingValueUsd, setClosingValueUsd] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);

  const edit = (update: (value: string) => void, value: string) => {
    generation.current++;
    update(value);
    setReviewed(false);
    setResult(null);
    setError('');
    setPending(false);
  };

  const runPreview = async (mode: PreviewMode) => {
    if (!reviewed || pending || !from || !to || openingValueUsd === '' || closingValueUsd === '')
      return;
    const request = ++generation.current;
    const input = { from, to, openingValueUsd, closingValueUsd, assertReviewed: true as const };
    setResult(null);
    setError('');
    setPending(true);
    try {
      if (mode === 'profit') {
        const preview = await periodProfitApi.preview(input);
        if (mounted.current && generation.current === request) setResult({ mode, preview });
      } else if (mode === 'xirr') {
        const preview = await xirrPreviewApi.preview(input);
        if (mounted.current && generation.current === request) setResult({ mode, preview });
      } else {
        const preview = await twrPreviewApi.preview(input);
        if (mounted.current && generation.current === request) setResult({ mode, preview });
      }
    } catch (failure) {
      if (mounted.current && generation.current === request) setError(previewError(failure, mode));
    } finally {
      if (mounted.current && generation.current === request) setPending(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runPreview('profit');
  };

  const canSubmit =
    reviewed &&
    !pending &&
    from !== '' &&
    to !== '' &&
    openingValueUsd !== '' &&
    closingValueUsd !== '';

  return (
    <div className="profit-page">
      <header className="profit-header">
        <h1>Прибыль за период</h1>
        <p>
          Введите две ручные оценки всей стоимости отслеживаемого портфеля в USD. Предпросмотр
          временный: оценки и результат не сохраняются.
        </p>
        <p>
          Прибыль = оценка в конце − оценка в начале − внешние вводы + внешние выводы. Оценка
          вручную; потоки не сверены. Эта формула показывает прибыль, а XIRR отдельно оценивает
          годовую доходность по времени внешних потоков. Ни один расчёт не показывает текущий
          денежный остаток.
        </p>
        <p>
          TWR показывает доходность только за выбранный период, без пересчёта в годовую ставку.
          Расчёт по двум ручным оценкам доступен, только когда внутри периода нет ненулевых внешних
          потоков после объединения потоков в один момент UTC. Иначе нужны оценки на границах этих
          потоков. Потоки точно в начале меняют начальный капитал, а потоки точно в конце не входят
          в период.
        </p>
        <p>
          <Link to="/capital-flows">Проверить журнал внешних потоков и границу учёта</Link>
        </p>
      </header>

      <section className="profit-card" aria-labelledby="profit-input-heading">
        <h2 id="profit-input-heading">Ручные оценки и период</h2>
        <form className="profit-form" onSubmit={(event) => void submit(event)}>
          <div className="profit-field">
            <label htmlFor="profit-from">Начало периода (UTC)</label>
            <input
              id="profit-from"
              value={from}
              onChange={(event) => edit(setFrom, event.target.value)}
              placeholder="2025-01-01T00:00:00.000Z"
              aria-describedby="profit-from-help"
              required
            />
            <small id="profit-from-help">
              Укажите ISO-время с часовым поясом. Оценка в начале берётся непосредственно перед
              всеми потоками в этот момент; потоки точно в начале включаются.
            </small>
          </div>
          <div className="profit-field">
            <label htmlFor="profit-to">Конец периода (UTC)</label>
            <input
              id="profit-to"
              value={to}
              onChange={(event) => edit(setTo, event.target.value)}
              placeholder="2026-01-01T00:00:00.000Z"
              aria-describedby="profit-to-help"
              required
            />
            <small id="profit-to-help">
              Конец не включается. Оценка в конце берётся непосредственно перед потоком точно в этот
              момент.
            </small>
          </div>
          <div className="profit-field">
            <label htmlFor="profit-opening">Оценка в начале, USD</label>
            <input
              id="profit-opening"
              value={openingValueUsd}
              onChange={(event) => edit(setOpeningValueUsd, event.target.value)}
              aria-describedby="profit-from-help profit-amount-help"
              inputMode="decimal"
              required
            />
          </div>
          <div className="profit-field">
            <label htmlFor="profit-closing">Оценка в конце, USD</label>
            <input
              id="profit-closing"
              value={closingValueUsd}
              onChange={(event) => edit(setClosingValueUsd, event.target.value)}
              aria-describedby="profit-to-help profit-amount-help"
              inputMode="decimal"
              required
            />
          </div>
          <p id="profit-amount-help">
            Укажите неотрицательные суммы, включая весь учитываемый капитал и денежные остатки по
            одному разу. Для дробной части используйте точку.
          </p>
          <label className="profit-review">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => {
                generation.current++;
                setReviewed(event.target.checked);
                setResult(null);
                setError('');
                setPending(false);
              }}
            />
            Я проверил оценки и внешние потоки
          </label>
          <div className="profit-actions">
            <button className="profit-button" type="submit" disabled={!canSubmit}>
              Рассчитать прибыль
            </button>
            <button
              className="profit-button"
              type="button"
              disabled={!canSubmit}
              onClick={() => void runPreview('xirr')}
            >
              Рассчитать XIRR
            </button>
            <button
              className="profit-button"
              type="button"
              disabled={!canSubmit}
              onClick={() => void runPreview('twr')}
            >
              Рассчитать TWR
            </button>
          </div>
        </form>
      </section>

      {pending && <output className="profit-message">Расчёт выполняется…</output>}
      {error && (
        <p className="profit-message profit-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="profit-card" aria-label="Результат расчёта">
          <h2>Результат расчёта</h2>
          <p>Оценка вручную. Потоки не сверены. Это временный расчёт для ревизии журнала.</p>
          <p>Ревизия журнала: {result.preview.journalRevision}</p>
          <p>Исправления и аннулирования потоков изменят следующий расчёт за этот период.</p>
          <p>Граница учёта потоков: {result.preview.coverageFrom}</p>
          <dl className="profit-result">
            <dt>Начало периода (UTC)</dt>
            <dd>{result.preview.from}</dd>
            <dt>Конец периода (UTC)</dt>
            <dd>{result.preview.to}</dd>
            <dt>Оценка в начале, USD</dt>
            <dd>{result.preview.openingValueUsd}</dd>
            <dt>Оценка в конце, USD</dt>
            <dd>{result.preview.closingValueUsd}</dd>
            <dt>Вводы, USD</dt>
            <dd>{result.preview.flows.contributionsUsd}</dd>
            <dt>Выводы, USD</dt>
            <dd>{result.preview.flows.withdrawalsUsd}</dd>
            <dt>Чистые вводы, USD</dt>
            <dd>{result.preview.flows.netContributionsUsd}</dd>
            <dt>Количество потоков</dt>
            <dd>{result.preview.flows.flowCount}</dd>
            <dt>Прибыль, USD</dt>
            <dd>{result.preview.profitUsd}</dd>
          </dl>
        </section>
      )}

      {result?.mode === 'xirr' && (
        <section className="profit-card" aria-label="Доходность XIRR">
          <h2>Доходность XIRR</h2>
          <p>
            Приблизительная годовая ставка по ручным оценкам и внешним потокам. Оценка вручную.
            Потоки не сверены. Это годовая ставка, а не прогноз.
          </p>
          <p>
            ACT/365F по времени UTC до миллисекунды. Поддерживаются ставки от −99.9999% до 100000%
            годовых и не более 64 ненулевых моментов денежных потоков после объединения совпадающих
            моментов.
          </p>
          {result.preview.xirr.status === 'available' ? (
            <dl className="profit-result">
              <dt>XIRR, % годовых</dt>
              <dd>{result.preview.xirr.annualPercent}</dd>
            </dl>
          ) : (
            <p>{unavailableReason[result.preview.xirr.reason]}</p>
          )}
          {result.preview.xirr.shortPeriod && (
            <p>Короткий период: годовая ставка не является прогнозом.</p>
          )}
        </section>
      )}

      {result?.mode === 'twr' && (
        <section className="profit-card" aria-label="Доходность TWR">
          <h2>Доходность TWR</h2>
          <p>
            Оценка вручную. Потоки не сверены. Это доходность только за период, без годового
            пересчёта и без прогноза. Совпадающие по времени UTC потоки объединяются точно; при
            ненулевом промежуточном потоке результат недоступен без оценки на его границе.
          </p>
          <p>
            Процент округлён до 10 знаков после запятой; небольшая доходность может отображаться как
            0. Точность результата зависит от ручных оценок.
          </p>
          <dl className="profit-result">
            <dt>Чистый поток в начале, USD</dt>
            <dd>{result.preview.twr.netFlowAtStartUsd}</dd>
            <dt>Начальный капитал после потоков, USD</dt>
            <dd>{result.preview.twr.startingCapitalUsd}</dd>
            <dt>Моменты ненулевых промежуточных потоков</dt>
            <dd>{result.preview.twr.interiorNetFlowDateCount}</dd>
            {result.preview.twr.status === 'available' && (
              <>
                <dt>TWR, % за период</dt>
                <dd>{result.preview.twr.periodPercent}</dd>
              </>
            )}
          </dl>
          {result.preview.twr.status === 'unavailable' && (
            <p>{twrUnavailableReason[result.preview.twr.reason]}</p>
          )}
        </section>
      )}
      <LinkedTwr
        key={`${from}\u0000${to}`}
        from={from}
        to={to}
        openingValueUsd={openingValueUsd}
        closingValueUsd={closingValueUsd}
      />
    </div>
  );
}

export default function PeriodProfit() {
  const { user } = useAuth();
  if (!user) return null;
  return <PeriodProfitOwner key={user.id} />;
}
