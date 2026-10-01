import { currenciesApi } from '@api';
import type { Currency } from '@shared/types';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  runCurrencyVisibilityCommand,
  waitForCurrencyVisibilityCommand,
} from './currency-visibility-requests';
import './CurrencyManager.css';

type List = 'visible' | 'hidden';
type Phase = 'loading' | 'saving' | 'ready' | 'saved' | 'load-error' | 'command-error';
type Lists = Record<List, Currency[]>;

const groups = [
  { type: 'fiat', title: 'Фиатные валюты' },
  { type: 'crypto', title: 'Криптовалюты' },
  { type: 'stablecoin', title: 'Стейблкоины' },
] as const;

async function readLists(): Promise<Lists> {
  // Settle both reads before allowing a retry; never publish a partial pair.
  const [visible, hidden] = await Promise.allSettled([
    currenciesApi.getList(),
    currenciesApi.getHidden(),
  ]);
  if (visible.status === 'rejected') throw visible.reason;
  if (hidden.status === 'rejected') throw hidden.reason;
  return { visible: visible.value, hidden: hidden.value };
}

export default function CurrencyManager() {
  const id = useId();
  const [selected, setSelected] = useState<List>('visible');
  const [lists, setLists] = useState<Lists | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const generation = useRef(0);
  const busy = useRef(false);
  const stopFocusTracking = useRef<(() => void) | null>(null);
  const restoreFocus = useRef<HTMLButtonElement | null>(null);
  const visibleFilter = useRef<HTMLButtonElement>(null);
  const hiddenFilter = useRef<HTMLButtonElement>(null);
  const pending = phase === 'loading' || phase === 'saving';
  const failed = phase === 'load-error' || phase === 'command-error';
  const canChange = phase === 'ready' || phase === 'saved';

  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const current = ++generation.current;
    setPhase('loading');
    try {
      // A previous Settings instance may still own a genuine in-flight command.
      await waitForCurrencyVisibilityCommand();
      if (generation.current !== current) return;
      const next = await readLists();
      if (generation.current !== current) return;
      setLists(next);
      setPhase('ready');
    } catch {
      if (generation.current === current) setPhase('load-error');
    } finally {
      if (generation.current === current) busy.current = false;
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
      busy.current = false;
      stopFocusTracking.current?.();
      restoreFocus.current = null;
    };
  }, [reload]);

  useLayoutEffect(() => {
    const origin = restoreFocus.current;
    if (phase !== 'saved' || !origin) return;
    restoreFocus.current = null;
    if (document.activeElement !== origin && document.activeElement !== document.body) return;
    (selected === 'visible' ? visibleFilter : hiddenFilter).current?.focus();
  }, [phase, selected]);

  const changeVisibility = async (currency: Currency, origin: HTMLButtonElement) => {
    if (busy.current || !canChange || (selected === 'visible' && !currency.isSystem)) return;
    busy.current = true;
    const current = ++generation.current;
    const wasHidden = selected === 'hidden';
    // Capture before disabling: browsers may blur the disabled initiating button.
    let ownsFocus = document.activeElement === origin;
    const trackFocus = (event: FocusEvent) => {
      if (event.target !== origin && event.target !== document.body) ownsFocus = false;
    };
    document.addEventListener('focusin', trackFocus);
    const stopTracking = () => document.removeEventListener('focusin', trackFocus);
    stopFocusTracking.current = stopTracking;
    setPhase('saving');
    try {
      await runCurrencyVisibilityCommand(() =>
        wasHidden ? currenciesApi.show(currency.id) : currenciesApi.hide(currency.id),
      );
      if (generation.current !== current) return;
      const next = await readLists();
      if (generation.current !== current) return;
      if (ownsFocus) restoreFocus.current = origin;
      setLists(next);
      setPhase('saved');
    } catch {
      // A lost response may follow a committed preference. Require fresh reads,
      // never replay the command or claim its failure rolled back the server.
      if (generation.current === current) setPhase('command-error');
    } finally {
      stopTracking();
      if (stopFocusTracking.current === stopTracking) stopFocusTracking.current = null;
      if (generation.current === current) busy.current = false;
    }
  };

  return (
    <section className="currency-visibility" aria-label="Видимость валют">
      <header className="currency-visibility__header">
        <h2>Прежний список валют</h2>
        <p className="currency-visibility__scope">
          Прежний список валют: настройки видимости. Учёт инструментов и справочный пересчёт USD
          ведутся отдельно.
        </p>
        <p className="currency-visibility__scope">
          Видимость записи не определяет поддержку сети. Скрытие не удаляет валюту или историю
          операций.
        </p>
      </header>
      <div className="currency-visibility__toolbar">
        <div className="currency-visibility__filters" role="group" aria-label="Списки валют">
          {(['visible', 'hidden'] as const).map((list) => (
            <button
              key={list}
              type="button"
              id={`${id}-${list}`}
              ref={list === 'visible' ? visibleFilter : hiddenFilter}
              aria-pressed={selected === list}
              aria-controls={`${id}-results`}
              onClick={() => setSelected(list)}
            >
              {list === 'visible' ? 'Показываемые' : 'Скрытые'} ({lists?.[list].length ?? '—'})
            </button>
          ))}
        </div>
        <button type="button" disabled={pending} onClick={() => void reload()}>
          Обновить списки
        </button>
      </div>
      {pending && (
        <p className="currency-visibility__feedback" role="status">
          {phase === 'saving' ? 'Сохраняем настройку видимости…' : 'Загрузка списков…'}
        </p>
      )}
      {failed && (
        <div className="currency-visibility__feedback" role="alert">
          <p>
            {phase === 'load-error'
              ? 'Не удалось загрузить списки валют. Повторите загрузку.'
              : 'Не удалось подтвердить видимость валюты. Обновите списки, прежде чем менять видимость снова.'}
          </p>
          {lists && (
            <p>Показаны последние успешно загруженные списки; видимость могла измениться.</p>
          )}
        </div>
      )}
      {phase === 'saved' && (
        <p className="currency-visibility__feedback" role="status">
          Настройка видимости сохранена. Списки обновлены.
        </p>
      )}
      <div
        className="currency-visibility__results"
        id={`${id}-results`}
        role="region"
        aria-labelledby={`${id}-${selected}`}
        aria-busy={pending}
      >
        {lists && lists[selected].length === 0 && (
          <p className="currency-visibility__empty">
            {selected === 'hidden' ? 'Нет скрытых валют.' : 'Нет показываемых валют.'}
          </p>
        )}
        {lists &&
          groups.map((group) => {
            const rows = lists[selected].filter((currency) => currency.type === group.type);
            if (rows.length === 0) return null;
            return (
              <div className="currency-visibility__group" key={group.type}>
                <div
                  className="currency-visibility__table-wrap"
                  role="region"
                  aria-label={`Прокрутка: ${group.title}`}
                  tabIndex={0}
                >
                  <table>
                    <caption>{group.title}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Код</th>
                        <th scope="col">Название и реквизиты</th>
                        <th scope="col">Символ</th>
                        <th scope="col">Статус в каталоге</th>
                        <th scope="col">Видимость</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((currency) => (
                        <tr key={currency.id}>
                          <th scope="row" className="currency-visibility__code">
                            {currency.code}
                          </th>
                          <td>
                            {currency.name}
                            <details className="currency-visibility__identity">
                              <summary>Реквизиты {currency.code}</summary>
                              <dl>
                                <dt>Идентификатор записи</dt>
                                <dd>{currency.id}</dd>
                                <dt>Сохранённый контракт</dt>
                                <dd>{currency.contractAddress || 'Контракт не указан'}</dd>
                              </dl>
                              <p className="currency-visibility__hint">
                                Запись каталога не подтверждает сеть или работу адаптера.
                              </p>
                            </details>
                          </td>
                          <td>{currency.symbol || '—'}</td>
                          <td>
                            {currency.isActive === undefined
                              ? 'Статус не указан'
                              : currency.isActive
                                ? 'Активна'
                                : 'Неактивна'}
                          </td>
                          <td>
                            <button
                              type="button"
                              disabled={
                                !canChange || (selected === 'visible' && !currency.isSystem)
                              }
                              onClick={(event) =>
                                void changeVisibility(currency, event.currentTarget)
                              }
                            >
                              {selected === 'hidden' ? 'Показать' : 'Скрыть'} {currency.code}
                            </button>
                            {selected === 'visible' && !currency.isSystem && (
                              <p className="currency-visibility__hint">
                                Скрывать можно только системные записи.
                              </p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
      </div>
    </section>
  );
}
