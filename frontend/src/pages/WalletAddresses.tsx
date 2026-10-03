import {
  type AddressTransaction,
  type SyncResult,
  type TransactionPage,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { accountingError } from '@features/accounting/feedback';
import { isAxiosError } from 'axios';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import './WalletAddresses.css';

const stateLabels = {
  never: 'Не загружено',
  partial: 'Загружено частично',
  complete: 'Загружено полностью',
} as const;
const directionLabels = {
  in: 'Поступление',
  out: 'Списание',
  self: 'Перевод себе',
} as const;

const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

function syncMessage({ outcome, reason, imported }: SyncResult): string {
  const progress = `Загружено новых: ${imported}.`;
  if (outcome === 'complete') return progress;
  if (outcome === 'partial')
    return `${progress} Остались более ранние транзакции: нажмите «Загрузить транзакции» ещё раз.`;
  if (reason === 'rate_limited')
    return `Провайдер ограничил частоту запросов. ${progress} Повторите позже, загрузка продолжится с того же места.`;
  if (reason === 'invalid_response')
    return `Провайдер вернул некорректные данные, они не сохранены. ${progress} Повторите позже.`;
  return `Провайдер недоступен. ${progress} Повторите позже, загрузка продолжится с того же места.`;
}

function TransactionTable({ address, page }: { address: string; page: TransactionPage }) {
  return (
    <>
      <p className="wallet-missing">
        Без стоимости в USD: {page.missingUsdValueCount} из {page.total}
      </p>
      <div className="wallet-table-scroll">
        <table aria-label={`Транзакции ${address}`}>
          <thead>
            <tr>
              <th scope="col">Дата</th>
              <th scope="col">Тип</th>
              <th scope="col">Изменение, BTC</th>
              <th scope="col">Комиссия сети, BTC</th>
              <th scope="col">Блок</th>
              <th scope="col">Транзакция</th>
              <th scope="col">Стоимость, USD</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((item: AddressTransaction) => (
              <tr key={item.txid}>
                <td>{utc(item.blockTime)}</td>
                <td>{directionLabels[item.direction]}</td>
                <td className="wallet-number">{item.netBtc}</td>
                <td className="wallet-number">{item.direction === 'in' ? '—' : item.feeBtc}</td>
                <td className="wallet-number">{item.blockHeight}</td>
                <td>
                  <code title={item.txid}>{`${item.txid.slice(0, 12)}…`}</code>
                </td>
                <td className="wallet-missing-value">не указана</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AddressCard({
  initial,
  onChange,
}: {
  initial: WalletAddress;
  onChange: (address: WalletAddress) => void;
}) {
  const [address, setAddress] = useState(initial);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState<TransactionPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [readError, setReadError] = useState('');
  const readSequence = useRef(0);

  const loadFirstPage = useCallback(async (id: string) => {
    const sequence = ++readSequence.current;
    setReadError('');
    try {
      const first = await walletAddressesApi.transactions(id);
      if (sequence === readSequence.current) setPage(first);
    } catch (error) {
      if (sequence === readSequence.current)
        setReadError(accountingError(error, 'загрузить транзакции'));
    }
  }, []);

  useEffect(() => {
    if (initial.transactionCount > 0) void loadFirstPage(initial.id);
  }, [initial.id, initial.transactionCount, loadFirstPage]);

  async function sync() {
    setSyncing(true);
    setMessage('');
    try {
      const result = await walletAddressesApi.sync(address.id);
      setAddress(result.address);
      onChange(result.address);
      setMessage(syncMessage(result));
      if (result.address.transactionCount > 0) await loadFirstPage(result.address.id);
    } catch (error) {
      setMessage(
        isAxiosError(error) && error.response?.status === 409
          ? 'Этот адрес уже загружается в другой вкладке. Обновите страницу.'
          : accountingError(error, 'загрузить транзакции'),
      );
    } finally {
      setSyncing(false);
    }
  }

  async function loadMore() {
    if (!page || page.nextOffset === null) return;
    const sequence = ++readSequence.current;
    setLoadingMore(true);
    try {
      const next = await walletAddressesApi.transactions(address.id, page.nextOffset);
      if (sequence === readSequence.current)
        setPage({ ...next, offset: 0, items: [...page.items, ...next.items] });
    } catch (error) {
      if (sequence === readSequence.current)
        setReadError(accountingError(error, 'загрузить транзакции'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="wallet-card" aria-label={`Адрес ${address.address}`}>
      <h2>
        <code>{address.address}</code>
      </h2>
      <p className="wallet-state">
        <span>{stateLabels[address.sync.state]}</span>
        <span>Транзакций: {address.transactionCount}</span>
        {address.sync.completedAt && <span>Обновлено: {utc(address.sync.completedAt)}</span>}
      </p>
      <button type="button" onClick={sync} disabled={syncing}>
        {syncing ? 'Загрузка…' : 'Загрузить транзакции'}
      </button>
      <p role="status" className="wallet-message">
        {message}
      </p>
      {readError && <p role="alert">{readError}</p>}
      {page && page.total > 0 && <TransactionTable address={address.address} page={page} />}
      {page && page.nextOffset !== null && (
        <button
          type="button"
          className="wallet-secondary"
          onClick={loadMore}
          disabled={loadingMore}
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}

export default function WalletAddresses() {
  const [addresses, setAddresses] = useState<WalletAddress[] | null>(null);
  const [listError, setListError] = useState('');
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    let active = true;
    walletAddressesApi
      .list()
      .then((items) => active && setAddresses(items))
      .catch((error) => active && setListError(accountingError(error, 'загрузить адреса')));
    return () => {
      active = false;
    };
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setAddError('');
    try {
      const created = await walletAddressesApi.register(draft.trim());
      setAddresses((current) => [
        ...(current ?? []).filter((item) => item.id !== created.id),
        created,
      ]);
      setDraft('');
    } catch (error) {
      setAddError(
        isAxiosError(error) && error.response?.status === 400
          ? 'Это не адрес Bitcoin mainnet. Проверьте адрес: поддерживаются адреса 1…, 3… и bc1….'
          : accountingError(error, 'добавить адрес'),
      );
    } finally {
      setAdding(false);
    }
  }

  const replace = useCallback((updated: WalletAddress) => {
    setAddresses((current) =>
      (current ?? []).map((item) => (item.id === updated.id ? updated : item)),
    );
  }, []);

  return (
    <div className="wallet-page">
      <header>
        <h1>Адреса кошельков</h1>
        <p>
          Сервис сам загружает подтверждённые транзакции адреса Bitcoin из публичного обозревателя
          блокчейна blockstream.info. Стоимость в USD сеть не знает: у загруженных транзакций она
          остаётся не указанной, а не нулевой.
        </p>
      </header>
      <form className="wallet-card wallet-form" onSubmit={add}>
        <label htmlFor="wallet-address-input">Адрес Bitcoin</label>
        <input
          id="wallet-address-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <button type="submit" disabled={adding}>
          Добавить адрес
        </button>
        {addError && <p role="alert">{addError}</p>}
      </form>
      {listError && <p role="alert">{listError}</p>}
      {addresses === null && !listError && <p role="status">Загрузка адресов…</p>}
      {addresses?.length === 0 && <p>Адресов пока нет.</p>}
      {addresses?.map((item) => (
        <AddressCard key={item.id} initial={item} onChange={replace} />
      ))}
    </div>
  );
}
