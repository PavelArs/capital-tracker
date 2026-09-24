import { type AccountSummary, accountingApi } from '@api/accounting.api';
import { accountingError, newRequestId } from '@features/accounting/feedback';
import { ManualPortfolioValuation } from '@features/manual-portfolio-valuation/ManualPortfolioValuation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './ManualAccounts.css';

export default function ManualAccounts() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [createdAccount, setCreatedAccount] = useState<AccountSummary | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [name, setName] = useState('');
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
    } catch (createError) {
      setError(accountingError(createError, 'создать счет'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="manual-page">
      <header className="manual-page__header">
        <div>
          <h1>Ручные счета</h1>
          <p>Начальные позиции хранятся отдельно от кошельков и данных поставщиков.</p>
        </div>
      </header>

      <section className="manual-card" aria-labelledby="manual-account-create-heading">
        <h2 id="manual-account-create-heading">Создать пустой счет</h2>
        <form className="manual-form manual-account-create" onSubmit={createAccount}>
          <div className="manual-field">
            <label htmlFor="manual-account-name">Название счета</label>
            <input
              id="manual-account-name"
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
      </section>

      <section className="manual-card" aria-labelledby="manual-account-list-heading">
        <h2 id="manual-account-list-heading">Счета</h2>
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
          <p className="manual-muted">Счетов пока нет.</p>
        )}
        {accounts.length > 0 && (
          <ul className="manual-account-list">
            {accounts.map((account) => (
              <li key={account.id}>
                <Link to={`/manual-accounts/${account.id}`}>
                  <span>{account.name}</span>
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
      <ManualPortfolioValuation accounts={accounts} />
    </div>
  );
}
