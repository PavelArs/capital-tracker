import {
  type LinkedTwrPreview,
  type LinkedTwrResult,
  type TwrBoundaryPlan,
  linkedTwrApi,
} from '@api/linked-twr.api';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

interface Props {
  from: string;
  to: string;
  openingValueUsd: string;
  closingValueUsd: string;
}

const unavailableReason: Record<NonNullable<LinkedTwrResult['reason']>, string> = {
  'too-many-boundaries': 'Более 32 моментов потоков: связанный TWR недоступен.',
  'missing-flow-boundary-valuations':
    'Для расчёта TWR нужны оценки в моменты промежуточных вводов и выводов.',
  'nonpositive-opening-capital': 'Начальный капитал после потоков должен быть положительным.',
  'nonpositive-subperiod-capital': 'Капитал после одного из потоков должен быть положительным.',
};

function requestError(error: unknown): string {
  if (!isAxiosError(error)) return 'Не удалось выполнить расчёт. Попробуйте ещё раз.';
  if (error.response?.status === 400) return 'Проверьте даты, оценки USD и подтверждение.';
  if (error.response?.status === 409)
    return 'Журнал внешних потоков изменился или период вне границы учёта. Загрузите моменты потоков снова.';
  if (error.response?.status === 401) return 'Сеанс завершён. Войдите снова.';
  if (error.response?.status === 403) return 'Запрос отклонён. Проверьте сеанс.';
  if (!error.response) return 'Не удалось получить ответ. Повторите действие явно.';
  return 'Не удалось выполнить расчёт. Попробуйте ещё раз.';
}

export default function LinkedTwr({ from, to, openingValueUsd, closingValueUsd }: Props) {
  const [plan, setPlan] = useState<TwrBoundaryPlan | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LinkedTwrPreview | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const valuations = `${openingValueUsd}\u0000${closingValueUsd}`;
  const currentValuations = useRef(valuations);
  const previousValuations = useRef(valuations);
  currentValuations.current = valuations;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);

  useEffect(() => {
    if (previousValuations.current === valuations) return;
    previousValuations.current = valuations;
    generation.current++;
    setReviewed(false);
    setResult(null);
    setError('');
    setPending(false);
  }, [valuations]);

  const invalidate = () => {
    generation.current++;
    setReviewed(false);
    setResult(null);
    setError('');
    setPending(false);
  };

  const loadPlan = async () => {
    if (pending || !from || !to) return;
    const request = ++generation.current;
    setPlan(null);
    setValues({});
    setReviewed(false);
    setResult(null);
    setError('');
    setPending(true);
    try {
      const next = await linkedTwrApi.boundaries(from, to);
      if (mounted.current && generation.current === request) setPlan(next);
    } catch (failure) {
      if (mounted.current && generation.current === request) setError(requestError(failure));
    } finally {
      if (mounted.current && generation.current === request) setPending(false);
    }
  };

  const calculate = async () => {
    if (
      pending ||
      plan?.status !== 'ready' ||
      !reviewed ||
      openingValueUsd === '' ||
      closingValueUsd === '' ||
      plan.boundaries.some(({ at }) => values[at] === undefined || values[at] === '')
    )
      return;
    const request = ++generation.current;
    const submittedValuations = currentValuations.current;
    setResult(null);
    setError('');
    setPending(true);
    try {
      const preview = await linkedTwrApi.preview({
        from,
        to,
        openingValueUsd,
        closingValueUsd,
        assertReviewed: true,
        expectedJournalRevision: plan.journalRevision,
        boundaryValuations: plan.boundaries.map(({ at }) => ({ at, valueBeforeUsd: values[at] })),
      });
      if (
        mounted.current &&
        generation.current === request &&
        currentValuations.current === submittedValuations
      )
        setResult(preview);
    } catch (failure) {
      if (mounted.current && generation.current === request) {
        setError(requestError(failure));
        if (isAxiosError(failure) && failure.response?.status === 409) {
          setPlan(null);
          setValues({});
          setReviewed(false);
        }
      }
    } finally {
      if (mounted.current && generation.current === request) setPending(false);
    }
  };

  const ready =
    plan?.status === 'ready' &&
    reviewed &&
    !pending &&
    openingValueUsd !== '' &&
    closingValueUsd !== '' &&
    plan.boundaries.every(({ at }) => values[at] !== undefined && values[at] !== '');

  return (
    <>
      <section className="profit-card" aria-label="TWR с промежуточными оценками">
        <h2>TWR с промежуточными оценками</h2>
        <p>
          Оценка вручную. Потоки не сверены. Укажите стоимость всего портфеля в USD, включая
          денежные остатки, непосредственно перед каждым ненулевым внешним потоком. Потоки в один
          момент UTC объединяются. Поддерживаются не более 32 таких моментов внутри периода.
        </p>
        <p>
          Доходность относится только к выбранному периоду, не пересчитывается в годовую ставку и
          округляется после связывания всех частей периода. Данные и результат не сохраняются.
        </p>
        <button
          className="profit-button"
          type="button"
          disabled={pending || !from || !to}
          onClick={() => void loadPlan()}
        >
          Загрузить моменты потоков
        </button>
        {plan && (
          <>
            <p>Ревизия журнала: {plan.journalRevision}</p>
            <p>Чистый поток в начале, USD: {plan.netFlowAtStartUsd}</p>
            <p>Ненулевых промежуточных моментов: {plan.interiorNetFlowDateCount}</p>
            {plan.status === 'unavailable' ? (
              <p>{unavailableReason['too-many-boundaries']}</p>
            ) : (
              <div className="profit-form">
                {plan.boundaries.map(({ at, netFlowUsd }) => (
                  <div className="profit-field" key={at}>
                    <label htmlFor={`linked-twr-${at}`}>Оценка перед потоком {at}, USD</label>
                    <input
                      id={`linked-twr-${at}`}
                      inputMode="decimal"
                      value={values[at] ?? ''}
                      onChange={(event) => {
                        const value = event.target.value;
                        invalidate();
                        setValues((current) => ({ ...current, [at]: value }));
                      }}
                    />
                    <small>Чистый поток в этот момент, USD: {netFlowUsd}</small>
                  </div>
                ))}
                {plan.boundaries.length === 0 && (
                  <p>Промежуточных ненулевых потоков нет. Дополнительные оценки не требуются.</p>
                )}
              </div>
            )}
          </>
        )}
        <label className="profit-review">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={plan?.status !== 'ready'}
            onChange={(event) => {
              generation.current++;
              setReviewed(event.target.checked);
              setResult(null);
              setError('');
              setPending(false);
            }}
          />
          Я проверил промежуточные оценки и потоки
        </label>
        <button
          className="profit-button"
          type="button"
          disabled={!ready}
          onClick={() => void calculate()}
        >
          Рассчитать связанный TWR
        </button>
        {pending && <output className="profit-message">Расчёт выполняется…</output>}
        {error && (
          <p className="profit-message profit-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="profit-card" aria-label="Результат связанного TWR">
          <h2>Результат связанного TWR</h2>
          <p>Оценка вручную. Потоки не сверены. Это временный расчёт за период.</p>
          <p>Ревизия журнала: {result.journalRevision}</p>
          <p>Граница учёта потоков: {result.coverageFrom}</p>
          <dl className="profit-result">
            <dt>Прибыль, USD</dt>
            <dd>{result.profitUsd}</dd>
            <dt>Чистый поток в начале, USD</dt>
            <dd>{result.linkedTwr.netFlowAtStartUsd}</dd>
            <dt>Начальный капитал после потоков, USD</dt>
            <dd>{result.linkedTwr.startingCapitalUsd}</dd>
            <dt>Ненулевых промежуточных моментов</dt>
            <dd>{result.linkedTwr.interiorNetFlowDateCount}</dd>
            {result.linkedTwr.status === 'available' && (
              <>
                <dt>TWR, % за период</dt>
                <dd>{result.linkedTwr.periodPercent}</dd>
              </>
            )}
          </dl>
          {result.linkedTwr.status === 'unavailable' && (
            <p>{unavailableReason[result.linkedTwr.reason]}</p>
          )}
          {result.linkedTwr.boundaries.length > 0 && (
            <div className="linked-twr-table-wrap">
              <table className="linked-twr-table">
                <caption>Оценки и потоки по моментам UTC</caption>
                <thead>
                  <tr>
                    <th scope="col">Момент UTC</th>
                    <th scope="col">Поток, USD</th>
                    <th scope="col">До потока, USD</th>
                    <th scope="col">После потока, USD</th>
                  </tr>
                </thead>
                <tbody>
                  {result.linkedTwr.boundaries.map((boundary) => (
                    <tr key={boundary.at}>
                      <td>{boundary.at}</td>
                      <td>{boundary.netFlowUsd}</td>
                      <td>{boundary.valueBeforeUsd ?? '—'}</td>
                      <td>{boundary.valueAfterUsd ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
