import { type ProfitPreview, periodProfitApi } from '@api/period-profit.api';
import { useAuth } from '@contexts/AuthContext';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './PeriodProfit.css';

function previewError(error: unknown): string {
  if (!isAxiosError(error)) return 'Не удалось рассчитать прибыль. Попробуйте ещё раз.';
  const status = error.response?.status;
  if (status === 400) return 'Проверьте даты, оценки USD и подтверждение.';
  if (status === 409)
    return 'Журнал внешних потоков не создан или период начинается до его границы учёта. Проверьте журнал и даты.';
  if (status === 401) return 'Сеанс завершён. Войдите снова и выполните новый расчёт.';
  if (status === 403) return 'Запрос отклонён. Проверьте сеанс и выполните новый расчёт.';
  if (!error.response) return 'Не удалось получить ответ. Выполните новый расчёт.';
  return 'Не удалось рассчитать прибыль. Выполните новый расчёт.';
}

function PeriodProfitOwner() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openingValueUsd, setOpeningValueUsd] = useState('');
  const [closingValueUsd, setClosingValueUsd] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ProfitPreview | null>(null);
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewed || pending || !from || !to || openingValueUsd === '' || closingValueUsd === '')
      return;
    const request = ++generation.current;
    const input = { from, to, openingValueUsd, closingValueUsd, assertReviewed: true as const };
    setResult(null);
    setError('');
    setPending(true);
    try {
      const preview = await periodProfitApi.preview(input);
      if (mounted.current && generation.current === request) setResult(preview);
    } catch (failure) {
      if (mounted.current && generation.current === request) setError(previewError(failure));
    } finally {
      if (mounted.current && generation.current === request) setPending(false);
    }
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
          вручную; потоки не сверены. Это не расчёт доходности или текущего денежного остатка.
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
              inputMode="decimal"
              required
            />
          </div>
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
          <button className="profit-button" type="submit" disabled={!canSubmit}>
            Рассчитать прибыль
          </button>
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
          <p>Ревизия журнала: {result.journalRevision}</p>
          <p>Граница учёта потоков: {result.coverageFrom}</p>
          <dl className="profit-result">
            <dt>Начало периода (UTC)</dt>
            <dd>{result.from}</dd>
            <dt>Конец периода (UTC)</dt>
            <dd>{result.to}</dd>
            <dt>Оценка в начале, USD</dt>
            <dd>{result.openingValueUsd}</dd>
            <dt>Оценка в конце, USD</dt>
            <dd>{result.closingValueUsd}</dd>
            <dt>Вводы, USD</dt>
            <dd>{result.flows.contributionsUsd}</dd>
            <dt>Выводы, USD</dt>
            <dd>{result.flows.withdrawalsUsd}</dd>
            <dt>Чистые вводы, USD</dt>
            <dd>{result.flows.netContributionsUsd}</dd>
            <dt>Количество потоков</dt>
            <dd>{result.flows.flowCount}</dd>
            <dt>Прибыль, USD</dt>
            <dd>{result.profitUsd}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}

export default function PeriodProfit() {
  const { user } = useAuth();
  if (!user) return null;
  return <PeriodProfitOwner key={user.id} />;
}
