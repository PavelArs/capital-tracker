import { type AccountSummary, type Instrument, accountingApi } from '@api/accounting.api';
import { tradesApi } from '@api/trades.api';
import {
  type AddressTransaction,
  type SyncResult,
  type TransactionPage,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { type TradeDraft, TradeForm, emptyTradeDraft } from '@features/accounting/TradeForm';
import { accountingError, newRequestId } from '@features/accounting/feedback';
import { isAxiosError } from 'axios';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './WalletAddresses.css';

interface Directory {
  accounts: AccountSummary[];
  instruments: Instrument[];
  failed?: boolean;
}

// Lists are paged by id; an owner has a handful of accounts, so read them all (bounded).
async function listAll<T extends { name: string }>(
  read: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const next = await read(cursor);
    items.push(...next.items);
    if (!next.nextCursor) break;
    cursor = next.nextCursor;
  }
  return items.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

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

function TradeCell({
  item,
  accounts,
  onComplete,
}: {
  item: AddressTransaction;
  accounts: AccountSummary[];
  onComplete: (item: AddressTransaction) => void;
}) {
  const trade = item.trade;
  const name = trade && (accounts.find(({ id }) => id === trade.accountId)?.name ?? 'Счёт');
  return (
    <td className="wallet-wrap">
      {trade?.status === 'voided' && <span className="wallet-voided">Сделка отменена · </span>}
      {trade && <Link to={`/manual-accounts/${trade.accountId}`}>{name}</Link>}
      {item.direction === 'in' && trade?.status !== 'active' && (
        <>
          {trade && <br />}
          <button type="button" className="wallet-inline" onClick={() => onComplete(item)}>
            Дополнить
          </button>
        </>
      )}
    </td>
  );
}

function TransactionTable({
  address,
  page,
  accounts,
  onComplete,
}: {
  address: string;
  page: TransactionPage;
  accounts: AccountSummary[];
  onComplete: (item: AddressTransaction) => void;
}) {
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
              <th scope="col" className="wallet-number">
                Изменение, BTC
              </th>
              <th scope="col" className="wallet-number">
                Комиссия сети, BTC
              </th>
              <th scope="col" className="wallet-number">
                Блок
              </th>
              <th scope="col">Транзакция</th>
              <th scope="col">Сделка</th>
              <th scope="col">Стоимость, USD</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((item: AddressTransaction) => (
              <tr key={item.txid}>
                <td className="wallet-wrap">{utc(item.blockTime)}</td>
                <td>{directionLabels[item.direction]}</td>
                <td className="wallet-number">{item.netBtc}</td>
                <td className="wallet-number">{item.direction === 'in' ? '—' : item.feeBtc}</td>
                <td className="wallet-number">{item.blockHeight}</td>
                <td>
                  <code title={item.txid}>{`${item.txid.slice(0, 12)}…`}</code>
                </td>
                <TradeCell item={item} accounts={accounts} onComplete={onComplete} />
                {item.usdValueStatus === 'known' ? (
                  <td>{item.usdValue} USD</td>
                ) : (
                  <td className="wallet-missing-value">не указана</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type JournalTarget = { revision: number } | 'closed' | null;

// Records the purchase behind an incoming transaction through the ordinary trade form;
// the backend writes it to the chosen account's journal and links it to the transaction.
function CompletionForm({
  addressId,
  item,
  directory,
  defaultAccountId,
  onDone,
  onCancel,
}: {
  addressId: string;
  item: AddressTransaction;
  directory: Directory;
  defaultAccountId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const accountFieldId = useId();
  const section = useRef<HTMLElement>(null);
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [journal, setJournal] = useState<JournalTarget>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<TradeDraft>(() => {
    const btc = directory.instruments.filter(({ symbol }) => symbol?.toUpperCase() === 'BTC');
    return {
      ...emptyTradeDraft(),
      instrumentId: btc.length === 1 ? btc[0].id : '',
      side: 'buy',
      quantity: item.netBtc,
      occurredAt: item.blockTime,
    };
  });

  useEffect(() => {
    section.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const journalSequence = useRef(0);
  const pendingJournal = useRef<Promise<JournalTarget>>(Promise.resolve(null));
  const readJournal = useCallback((id: string) => {
    const sequence = ++journalSequence.current;
    setJournal(null);
    const read = async (): Promise<JournalTarget> => {
      if (!id) return null;
      try {
        const state = await tradesApi.state(id);
        const target: JournalTarget = state.journal
          ? { revision: state.journal.journalRevision }
          : 'closed';
        if (sequence === journalSequence.current) setJournal(target);
        return target;
      } catch (reason) {
        if (sequence === journalSequence.current)
          setError(accountingError(reason, 'загрузить журнал счёта'));
        return null;
      }
    };
    pendingJournal.current = read();
  }, []);
  // A retry of the same form keeps its request id, so a lost response replays safely.
  const attempt = useRef<{ key: string; requestId: string } | null>(null);

  useEffect(() => {
    readJournal(accountId);
  }, [accountId, readJournal]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId) return setError('Выберите счёт, в журнал которого записать покупку.');
    setSaving(true);
    setError('');
    try {
      const target = journal ?? (await pendingJournal.current);
      if (target === null || target === 'closed') return;
      const key = JSON.stringify({ accountId, revision: target.revision, draft });
      if (attempt.current?.key !== key) attempt.current = { key, requestId: newRequestId() };
      await walletAddressesApi.complete(addressId, item.txid, {
        accountId,
        trade: {
          requestId: attempt.current.requestId,
          expectedJournalRevision: target.revision,
          ...draft,
          orderWithinTimestamp: Number(draft.orderWithinTimestamp),
        },
      });
      onDone();
    } catch (reason) {
      const status = isAxiosError(reason) ? reason.response?.status : undefined;
      if (status === 422)
        setError('Тип сделки должен быть «Покупка», а количество равно поступившей сумме BTC.');
      else if (status === 409) {
        setError(
          'Сделка не сохранена: дата раньше начала журнала счёта, журнал изменился или транзакция уже дополнена. Проверьте и повторите.',
        );
        readJournal(accountId);
      } else setError(accountingError(reason, 'сохранить сделку'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      ref={section}
      className="wallet-completion"
      aria-label={`Покупка по транзакции ${item.txid.slice(0, 12)}…`}
    >
      <h3>Покупка по транзакции {item.txid.slice(0, 12)}…</h3>
      <p>
        Поступило {item.netBtc} BTC {utc(item.blockTime)}. Укажите, сколько вы заплатили: сделка
        попадёт в журнал выбранного счёта так же, как введённая вручную.
      </p>
      <label htmlFor={accountFieldId}>Счёт</label>
      <select
        id={accountFieldId}
        value={accountId}
        onChange={(event) => {
          setError('');
          setAccountId(event.target.value);
        }}
      >
        <option value="">Выберите счёт</option>
        {directory.accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      {directory.failed && (
        <p role="alert">Не удалось загрузить счета и инструменты. Обновите страницу.</p>
      )}
      {journal === 'closed' && (
        <p role="alert">
          Журнал сделок этого счёта ещё не открыт.{' '}
          <Link to={`/manual-accounts/${accountId}`}>Открыть счёт</Link>
        </p>
      )}
      <TradeForm
        draft={draft}
        onChange={setDraft}
        onSubmit={submit}
        instruments={directory.instruments}
        selected={null}
        disabled={saving}
        lockDraft={false}
        correction={false}
        onCancel={onCancel}
        cancelDisabled={saving}
      />
      {error && <p role="alert">{error}</p>}
      <button type="button" className="wallet-secondary" onClick={onCancel} disabled={saving}>
        Отмена
      </button>
    </section>
  );
}

// The account of this address's latest active completion, or the only account there is.
function defaultAccount(page: TransactionPage, accounts: AccountSummary[]): string {
  const latest = page.items.find(({ trade }) => trade?.status === 'active')?.trade?.accountId;
  if (latest && accounts.some(({ id }) => id === latest)) return latest;
  return accounts.length === 1 ? accounts[0].id : '';
}

function AddressCard({
  initial,
  onChange,
  directory,
}: {
  initial: WalletAddress;
  onChange: (address: WalletAddress) => void;
  directory: Directory;
}) {
  const [address, setAddress] = useState(initial);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState<TransactionPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [readError, setReadError] = useState('');
  const [completing, setCompleting] = useState<AddressTransaction | null>(null);
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

  // The parent passes the latest summary after each sync; reload when the count changes.
  useEffect(() => {
    setAddress(initial);
    if (initial.transactionCount > 0) void loadFirstPage(initial.id);
  }, [initial, loadFirstPage]);

  async function sync() {
    setSyncing(true);
    setMessage('');
    try {
      const result = await walletAddressesApi.sync(address.id);
      onChange(result.address);
      setMessage(syncMessage(result));
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
      if (sequence === readSequence.current) {
        // Offsets shift if another tab synced meanwhile; never show a transaction twice.
        const seen = new Set(page.items.map(({ txid }) => txid));
        setPage({
          ...next,
          offset: 0,
          items: [...page.items, ...next.items.filter(({ txid }) => !seen.has(txid))],
        });
        setReadError('');
      }
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
      {page && page.total > 0 && (
        <TransactionTable
          address={address.address}
          page={page}
          accounts={directory.accounts}
          onComplete={setCompleting}
        />
      )}
      {completing && page && (
        <CompletionForm
          key={completing.txid}
          addressId={address.id}
          item={completing}
          directory={directory}
          defaultAccountId={defaultAccount(page, directory.accounts)}
          onDone={() => {
            setCompleting(null);
            void loadFirstPage(address.id);
          }}
          onCancel={() => setCompleting(null)}
        />
      )}
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
  const [directory, setDirectory] = useState<Directory>({ accounts: [], instruments: [] });

  // Account names for completed rows and the completion form; the page works without them.
  useEffect(() => {
    let active = true;
    Promise.all([listAll(accountingApi.listAccounts), listAll(accountingApi.listInstruments)])
      .then(([accounts, instruments]) => {
        if (active) setDirectory({ accounts, instruments });
      })
      .catch(() => {
        if (active) setDirectory({ accounts: [], instruments: [], failed: true });
      });
    return () => {
      active = false;
    };
  }, []);

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
      setAddresses((current) =>
        current?.some((item) => item.id === created.id)
          ? current.map((item) => (item.id === created.id ? created : item))
          : [...(current ?? []), created],
      );
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
          блокчейна blockstream.info. Стоимость в USD сеть не знает: она остаётся не указанной, а не
          нулевой, пока вы не дополните поступление сделкой покупки в одном из своих счетов.
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
        <AddressCard key={item.id} initial={item} onChange={replace} directory={directory} />
      ))}
    </div>
  );
}
