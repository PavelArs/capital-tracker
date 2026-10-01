import { type AccountSummary, accountingApi } from '@api/accounting.api';
import { accountingError, newRequestId } from '@features/accounting/feedback';
import { ManualPortfolioValuation } from '@features/manual-portfolio-valuation/ManualPortfolioValuation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './ManualAccounts.css';
import './AccountDirectory.css';

export default function ManualAccounts() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [createdAccount, setCreatedAccount] = useState<AccountSummary | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null);

  const loadAccounts = useCallback(async (nextCursor?: string, append = false) => {
    setLoading(true);
    setListError(null);
    try {
      const page = await accountingApi.listAccounts(nextCursor);
      setAccounts((current) => (append ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (loadError) {
      setListError(accountingError(loadError, 'загрузить счета'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  function closeCreation() {
    setCreating(false);
    createTriggerRef.current?.focus();
  }

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Введите название счета.');
      return;
    }
    const signature = JSON.stringify({ name: cleanName });
    if (retryRef.current?.signature !== signature) {
      retryRef.current = { signature, requestId: newRequestId() };
    }
    const requestId = retryRef.current.requestId;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const created = await accountingApi.createAccount({ requestId, name: cleanName });
      retryRef.current = null;
      setCreatedAccount(created);
      setName('');
      setNotice('Счет создан.');
      await loadAccounts();
      closeCreation();
    } catch (createError) {
      setError(accountingError(createError, 'создать счет'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="manual-page account-directory">
      <header className="manual-page__header">
        <div>
          <h1>Ручные счета</h1>
          <p>Начальные позиции хранятся отдельно от кошельков и данных поставщиков.</p>
        </div>
        <button
          ref={createTriggerRef}
          type="button"
          className="manual-button"
          aria-expanded={creating}
          aria-controls="account-create-panel"
          onClick={() => (creating ? closeCreation() : setCreating(true))}
        >
          Новый счет
        </button>
      </header>

      <section
        id="account-create-panel"
        hidden={!creating}
        className="manual-card account-directory__creator"
        aria-labelledby="manual-account-create-heading"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeCreation();
          }
        }}
      >
        <div className="account-directory__section-heading">
          <h2 id="manual-account-create-heading">Создать пустой счет</h2>
          <button type="button" className="manual-link-button" onClick={closeCreation}>
            Закрыть форму
          </button>
        </div>
        <form className="manual-form manual-account-create" onSubmit={createAccount}>
          <div className="manual-field">
            <label htmlFor="manual-account-name">Название счета</label>
            <input
              id="manual-account-name"
              ref={nameRef}
              name="name"
              maxLength={120}
              required
              autoComplete="off"
              disabled={submitting}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
          </div>
          <button className="manual-button" type="submit" disabled={submitting}>
            {submitting ? 'Создание…' : 'Создать счет'}
          </button>
        </form>
        {error && (
          <p className="manual-feedback manual-feedback--error" role="alert">
            {error}
          </p>
        )}
      </section>
      {notice && (
        <div className="manual-feedback manual-feedback--success" role="status">
          <p>{notice}</p>
          {createdAccount && (
            <p>
              Открыть счет:{' '}
              <Link to={`/manual-accounts/${createdAccount.id}`}>{createdAccount.name}</Link>
            </p>
          )}
        </div>
      )}

      <section className="manual-card" aria-labelledby="manual-account-list-heading">
        <div className="account-directory__section-heading">
          <h2 id="manual-account-list-heading">Счета</h2>
          {!loading && !listError && (
            <p className="account-directory__count">Показано счетов: {accounts.length}</p>
          )}
        </div>
        {listError && (
          <div className="manual-feedback manual-feedback--error" role="alert">
            {listError}{' '}
            <button
              className="manual-link-button"
              type="button"
              onClick={() => void loadAccounts()}
            >
              Загрузить снова
            </button>
          </div>
        )}
        {loading && accounts.length === 0 && <p role="status">Загрузка счетов…</p>}
        {!loading && !listError && accounts.length === 0 && (
          <div className="account-directory__empty">
            <p>Счетов пока нет.</p>
            <p className="manual-muted">
              Создайте счет для учета выполненных операций и начальных позиций.
            </p>
          </div>
        )}
        {accounts.length > 0 && (
          <ul className="manual-account-list">
            {accounts.map((account) => (
              <li key={account.id}>
                <Link to={`/manual-accounts/${account.id}`}>
                  <span className="account-directory__name">{account.name}</span>
                  <span className="manual-account-list__revision">
                    Ревизия {account.currentRevision}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <button
            className="manual-button manual-button--secondary"
            type="button"
            disabled={loading}
            onClick={() => void loadAccounts(cursor, true)}
          >
            {loading ? 'Загрузка…' : 'Показать еще счета'}
          </button>
        )}
      </section>
      <details className="account-directory__valuation">
        <summary>Оценить выбранные счета</summary>
        <ManualPortfolioValuation accounts={accounts} />
      </details>
      <p className="account-directory__scope">
        Оценка использует только выбранные ручные счета и сохраненные цены. Это не стоимость всего
        портфеля.
      </p>
    </div>
  );
}
