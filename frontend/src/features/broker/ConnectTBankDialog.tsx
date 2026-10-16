import { brokersApi, type TBankAccountOption, type TBankConnection } from '@api/brokers.api';
import { type FormEvent, useId, useRef, useState } from 'react';
import Modal from '@/ui/Modal';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import CloseButton from '../shell/CloseButton';
import { Icon } from '../shell/icons';
import './broker.css';

const MAX_NAME = 120;
// The most accounts one command connects, as the server checks.
const MAX_PICKS = 20;
// The token T-Bank shows once: letters, digits and . _ - only, as the server also checks.
const tokenShape = /^[0-9A-Za-z._-]{20,200}$/;

const defaultName = (account: TBankAccountOption) =>
  `T-Bank ${account.name.trim() || 'account'}`.slice(0, MAX_NAME);

const failure = (error: unknown, step: 'check' | 'connect') =>
  requestFailure(error, {
    unreachable: `Could not reach the server. ${step === 'connect' ? 'Try again; the same request will not connect an account twice.' : 'Try again.'}`,
    status: {
      400: 'Check the token and the names, then try again.',
      401: 'Your session has ended. Sign in again.',
      409: (said) =>
        said?.includes('already connected')
          ? 'One of these T-Bank accounts is already connected. Close this window and reload the page.'
          : 'This conflicts with what is saved. Close this window, reload the page and try again.',
      422: (said) => said ?? 'T-Bank did not accept this token.',
      503: 'T-Bank could not be reached. Try again in a few minutes.',
    },
    fallback: 'Try again.',
  });

interface Props {
  onClose: () => void;
  /** Accounts were made and connected: Brokers shows them. */
  onConnected: () => void;
}

interface Pick {
  checked: boolean;
  name: string;
}

// "Connect T-Bank" (BROKER-SETUP): paste one read-only token, see the open T-Bank accounts it
// reaches, and the app makes a broker account for each one picked, connected to its account. The
// token is held only in this window until it is sent; the server keeps it encrypted.
export default function ConnectTBankDialog({ onClose, onConnected }: Props) {
  const id = useId();
  const [token, setToken] = useState('');
  const [shown, setShown] = useState(false);
  const [accounts, setAccounts] = useState<TBankAccountOption[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [done, setDone] = useState<TBankConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  // A request id per T-Bank account and name, so a retry finds the account it already made.
  const requests = useRef(new Map<string, string>());
  const first = useRef<HTMLInputElement>(null);
  const trimmed = token.trim();
  const tokenOk = tokenShape.test(trimmed);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!tokenOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = await brokersApi.tbankAccounts(trimmed);
      setAccounts(found);
      // Past the limit the rest stay unchecked, to be connected in a second go.
      let free = MAX_PICKS;
      setPicks(
        Object.fromEntries(
          found.map((account) => {
            const checked = !account.connected && free > 0;
            if (checked) free -= 1;
            return [account.id, { checked, name: defaultName(account) }];
          }),
        ),
      );
    } catch (caught) {
      setError(failure(caught, 'check'));
    }
    setBusy(false);
  };

  const chosen = (accounts ?? []).filter((account) => picks[account.id]?.checked);
  const nameProblem = chosen.some((account) => {
    const name = picks[account.id].name.trim();
    return name === '' || name.length > MAX_NAME;
  });

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || chosen.length === 0 || nameProblem) return;
    setBusy(true);
    setError(null);
    try {
      const connections = await brokersApi.connectTBank(
        trimmed,
        chosen.map((account) => {
          const name = picks[account.id].name.trim();
          const key = `${account.id}\n${name}`;
          if (!requests.current.has(key)) requests.current.set(key, newRequestId());
          return {
            brokerAccountId: account.id,
            requestId: requests.current.get(key) as string,
            name,
          };
        }),
      );
      // The token is not needed any more: drop it from this window.
      setToken('');
      setDone(connections);
    } catch (caught) {
      setError(failure(caught, 'connect'));
    }
    setBusy(false);
  };

  const change = (account: string, changes: Partial<Pick>) =>
    setPicks((current) => ({ ...current, [account]: { ...current[account], ...changes } }));
  const available = (accounts ?? []).filter((account) => !account.connected);

  return (
    <Modal
      titleId={`${id}-title`}
      size="wide"
      onEscape={busy ? undefined : done ? onConnected : onClose}
      initialFocus={() => first.current}
    >
      <form
        onSubmit={done ? (event) => event.preventDefault() : accounts ? connect : check}
        noValidate
      >
        <div className="ui-modal__head">
          <h2 id={`${id}-title`}>Connect T-Bank</h2>
          <CloseButton onClick={done ? onConnected : onClose} disabled={busy} />
        </div>
        <div className="ui-modal__body">
          {done ? (
            <>
              <p className="ui-banner ui-banner--pos" role="status">
                {done.length === 1 ? 'Connected 1 account.' : `Connected ${done.length} accounts.`}
              </p>
              <ul className="broker-connected">
                {done.map((item) => (
                  <li key={item.accountId}>
                    <Icon name="briefcase" className="shell-icon" />
                    {item.name}
                  </li>
                ))}
              </ul>
              <p className="ui-modal__info" role="note">
                Each account now reads T-Bank with your token. Their trades and holdings are not
                loaded into the records yet, so they show as empty until that step is added.
              </p>
            </>
          ) : accounts === null ? (
            <>
              <ol className="broker-howto">
                <li>
                  In T-Bank Investments open <b>Settings → Tokens</b> and create a token with{' '}
                  <b>Read-only</b> access to <b>all accounts</b>.
                </li>
                <li>Copy it and paste it here. T-Bank shows it only once.</li>
              </ol>
              <div className="ui-field">
                <label className="ui-field__label" htmlFor={`${id}-token`}>
                  T-Bank token
                </label>
                <div className="broker-secret">
                  <input
                    id={`${id}-token`}
                    ref={first}
                    type={shown ? 'text' : 'password'}
                    className="ui-input broker-mono"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    disabled={busy}
                    aria-invalid={tried && !tokenOk ? true : undefined}
                    aria-describedby={`${id}-token-help`}
                    onChange={(event) => setToken(event.target.value)}
                  />
                  <button
                    type="button"
                    className="broker-secret__toggle"
                    aria-label={shown ? 'Hide token' : 'Show token'}
                    aria-controls={`${id}-token`}
                    onClick={() => setShown((value) => !value)}
                  >
                    <Icon name={shown ? 'eyeOff' : 'eye'} className="shell-icon" />
                  </button>
                </div>
                <span id={`${id}-token-help`}>
                  {tried && !tokenOk ? (
                    <span className="ui-field__error" role="alert">
                      This does not look like a T-Bank token. Copy it again in full.
                    </span>
                  ) : (
                    <span className="ui-field__hint">
                      Stored encrypted on the server and never shown again.
                    </span>
                  )}
                </span>
              </div>
              <p className="broker-note">
                The app checks with T-Bank that the token cannot trade and refuses one that can. It
                only reads.
              </p>
            </>
          ) : (
            <>
              <p className="broker-note">
                {available.length === 0
                  ? 'Every open account this token reaches is already connected.'
                  : 'Pick the accounts to read. Each becomes a broker account here, and you can rename it.'}
              </p>
              {chosen.length >= MAX_PICKS && (
                <p className="broker-note" role="status">
                  {MAX_PICKS} accounts is the most to connect at once. Connect the rest afterwards
                  with the same token.
                </p>
              )}
              <ul className="broker-picks">
                {accounts.map((account) => {
                  const pick = picks[account.id];
                  return (
                    <li key={account.id} className="broker-pick">
                      <label className="broker-toggle">
                        <input
                          type="checkbox"
                          checked={pick.checked}
                          disabled={
                            busy ||
                            account.connected ||
                            (!pick.checked && chosen.length >= MAX_PICKS)
                          }
                          onChange={(event) =>
                            change(account.id, { checked: event.target.checked })
                          }
                        />
                        <span>
                          {account.name || 'T-Bank account'}
                          {account.connected && <small> · already connected</small>}
                          {account.investBox && <small> · Invest Box, no holdings given</small>}
                        </span>
                      </label>
                      {pick.checked && (
                        <input
                          className="ui-input"
                          aria-label={`Name of ${account.name || 'T-Bank account'} here`}
                          maxLength={MAX_NAME}
                          autoComplete="off"
                          value={pick.name}
                          disabled={busy}
                          aria-invalid={pick.name.trim() === '' ? true : undefined}
                          onChange={(event) => change(account.id, { name: event.target.value })}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {error && (
            <p className="ui-banner ui-banner--neg" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ui-modal__foot">
          {done ? (
            <button
              type="button"
              className="shell-button shell-button--primary"
              onClick={onConnected}
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                className="shell-button shell-button--ghost"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="shell-button shell-button--primary"
                disabled={busy || (accounts !== null && (chosen.length === 0 || nameProblem))}
              >
                {accounts === null
                  ? 'Check token'
                  : chosen.length > 1
                    ? `Connect ${chosen.length} accounts`
                    : 'Connect account'}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
