import { brokersApi, type TBankAccountOption } from '@api/brokers.api';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Input } from '@/ui/inputs';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { OptionGrid, OptionTile } from '@/ui/OptionTile';
import { PasswordInput } from '@/ui/PasswordInput';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import { Icon } from '../shell/icons';
import AddBrokerDialog, { DiscardBrokerAccount } from './AddBrokerDialog';
import type { BrokerEntry } from './broker';
import './broker.css';

const MAX_NAME = 120;
// The most accounts one command connects, as the server checks.
const MAX_PICKS = 20;
// The token T-Bank shows once: letters, digits and . _ - only, as the server also checks.
const tokenShape = /^[0-9A-Za-z._-]{20,200}$/;

const accountName = (account: TBankAccountOption) => account.name.trim() || 'T-Bank account';
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

type Broker = 'tbank' | 'manual';
type Step = 'choose' | 'token' | 'accounts' | 'manual';

interface Pick {
  checked: boolean;
  name: string;
}

interface Props {
  onClose: () => void;
  /** Accounts were added; `focus` names one of them, for the Brokers page to bring into view. */
  onAdded: (focus?: string) => void;
  /** Opens the history import for an account just connected. */
  onImport?: (account: { accountId: string; name: string }) => void;
}

const typedIn = (draft: BrokerEntry) =>
  !!draft.broker.trim() ||
  !!draft.cash.trim() ||
  draft.positions.some((position) =>
    [position.ticker, position.quantity, position.price].some((part) => part.trim()),
  );

const stepNumbers: Record<Exclude<Step, 'manual'>, number> = { choose: 1, token: 2, accounts: 3 };

/** The submit button's words for the step: continue, or connect the accounts chosen. */
function submitLabel(step: Step, busy: boolean, chosen: number): string {
  if (step !== 'accounts') return busy ? 'Checking…' : 'Continue';
  if (chosen === 0) return 'Connect';
  return busy ? 'Connecting…' : `Connect ${chosen} account${chosen === 1 ? '' : 's'}`;
}

/** Step 1: T-Bank or another broker. */
function ChooseStep({
  broker,
  onBroker,
}: {
  broker: Broker | null;
  onBroker: (broker: Broker) => void;
}) {
  return (
    <>
      <p className="ui-soft">Which broker do you want to add?</p>
      <OptionGrid layout="tile" label="Broker">
        <OptionTile
          pressed={broker === 'tbank'}
          onClick={() => onBroker('tbank')}
          icon={
            <span className="broker-tile-icon broker-tile-icon--tbank" aria-hidden="true">
              <Icon name="briefcase" />
            </span>
          }
          title="T-Bank"
          description="Connects with a read-only token"
        />
        <OptionTile
          pressed={broker === 'manual'}
          onClick={() => onBroker('manual')}
          icon={
            <span className="broker-tile-icon" aria-hidden="true">
              <Icon name="edit" />
            </span>
          }
          title="Another broker"
          description="Enter positions by hand"
        />
      </OptionGrid>
      <Banner tone="info" icon="shield" role="none">
        Read-only. The app never places orders and never asks for a broker password.
      </Banner>
    </>
  );
}

/** Step 2: how to make a read-only T-Bank token, and the field for it. */
function TokenStep({
  id,
  token,
  tokenError,
  busy,
  onToken,
}: {
  id: string;
  token: string;
  tokenError: string | null;
  busy: boolean;
  onToken: (token: string) => void;
}) {
  return (
    <>
      <Banner tone="info" role="none">
        <ol className="broker-howto">
          <li>In T-Bank Investments open Settings → Tokens.</li>
          <li>
            Create a token with <b>Read-only</b> access to all accounts.
          </li>
          <li>Paste it below. T-Bank shows it only once.</li>
        </ol>
      </Banner>
      <Field
        id={`${id}-token`}
        label="T-Bank token"
        hint="Only read-only tokens are accepted. A token that can place orders is refused. Stored encrypted."
        error={tokenError}
        liveError
      >
        {(control) => (
          <PasswordInput
            {...control}
            mono
            autoComplete="off"
            spellCheck={false}
            showLabel="Show token"
            hideLabel="Hide token"
            value={token}
            disabled={busy}
            onChange={(event) => onToken(event.target.value)}
          />
        )}
      </Field>
    </>
  );
}

/** Step 3: the T-Bank accounts the token reaches, to choose and name. */
function AccountsStep({
  accounts,
  picks,
  chosen,
  busy,
  onChange,
}: {
  accounts: TBankAccountOption[];
  picks: Record<string, Pick>;
  /** How many accounts are chosen. */
  chosen: number;
  busy: boolean;
  onChange: (account: string, changes: Partial<Pick>) => void;
}) {
  const available = accounts.filter((account) => !account.connected);
  return (
    <>
      <p className="ui-soft">
        {available.length === 0
          ? 'Every open account this token reaches is already connected.'
          : `The token gives access to ${accounts.length === 1 ? '1 T-Bank account' : `${accounts.length} T-Bank accounts`}. Choose the ones to track and rename them if you like.`}
      </p>
      {chosen >= MAX_PICKS && (
        <p className="ui-soft" role="status">
          {MAX_PICKS} accounts is the most to connect at once. Connect the rest afterwards with the
          same token.
        </p>
      )}
      <ul className="broker-picks">
        {accounts.map((account) => {
          const pick = picks[account.id];
          const on = pick.checked && !account.connected;
          const note = account.connected ? 'Already connected' : null;
          return (
            <li
              key={account.id}
              className={`broker-pick${account.connected ? ' broker-pick--off' : ''}`}
            >
              <label className="broker-pick__check">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy || account.connected || (!on && chosen >= MAX_PICKS)}
                  onChange={(event) => onChange(account.id, { checked: event.target.checked })}
                />
                <span>
                  <b>{accountName(account)}</b>
                  {note && <small> · {note}</small>}
                </span>
              </label>
              <Input
                aria-label={`Name for ${accountName(account)}`}
                maxLength={MAX_NAME}
                autoComplete="off"
                value={account.connected ? accountName(account) : pick.name}
                disabled={busy || !on}
                aria-invalid={on && pick.name.trim() === '' ? true : undefined}
                onChange={(event) => onChange(account.id, { name: event.target.value })}
              />
            </li>
          );
        })}
      </ul>
      <Banner tone="info" icon="clock" role="none">
        The accounts appear empty at first. Positions and cash arrive with the history import.
      </Banner>
    </>
  );
}

// BROKER-ADD-FLOW: the one "Add broker account" dialog, shaped like Add wallet. Step 1 chooses the
// broker: T-Bank reads its accounts with one read-only token (BROKER-SETUP), and any other broker
// opens the positions editor. The token is held only in this dialog until it is sent, and goes
// with it; the server keeps it encrypted.
export default function AddBrokerAccountDialog({ onClose, onAdded, onImport }: Props) {
  const id = useId();
  const toast = useToast();
  const [step, setStep] = useState<Step>('choose');
  const [broker, setBroker] = useState<Broker | null>(null);
  const [draft, setDraft] = useState<BrokerEntry | undefined>(undefined);
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<TBankAccountOption[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // A request id per T-Bank account and name, so a retry finds the account it already made.
  const requests = useRef(new Map<string, string>());
  const form = useRef<HTMLFormElement>(null);
  const trimmed = token.trim();

  // Each step puts the keyboard on its first choice or field.
  useEffect(() => {
    if (step === 'manual') return;
    const root = form.current;
    const target =
      step === 'choose'
        ? (root?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
          root?.querySelector<HTMLElement>('[aria-pressed]'))
        : root?.querySelector<HTMLElement>('input:not([disabled])');
    target?.focus();
  }, [step]);

  // What was typed in the positions editor before going back counts as half-filled too.
  const drafted = !!draft && typedIn(draft);
  const close = () => {
    if (busy) return;
    if (drafted || (broker === 'tbank' && (trimmed || step === 'accounts'))) setDiscarding(true);
    else onClose();
  };

  const check = async () => {
    if (!tokenShape.test(trimmed)) {
      setTokenError('This does not look like a T-Bank token. Copy it again in full.');
      return;
    }
    setBusy(true);
    setTokenError(null);
    try {
      const found = await brokersApi.tbankAccounts(trimmed);
      // Picks made before going back stay; past the limit the rest stay unchecked, to be
      // connected in a second go.
      let free = MAX_PICKS;
      const next: Record<string, Pick> = {};
      for (const account of found) {
        const before = picks[account.id];
        const checked = !account.connected && free > 0 && (before ? before.checked : true);
        if (checked) free -= 1;
        next[account.id] = { checked, name: before?.name ?? defaultName(account) };
      }
      setAccounts(found);
      setPicks(next);
      // A connect that failed before is answered again from this check.
      setError(null);
      setStep('accounts');
    } catch (caught) {
      setTokenError(failure(caught, 'check'));
    }
    setBusy(false);
  };

  const chosen = (accounts ?? []).filter(
    (account) => !account.connected && picks[account.id]?.checked,
  );
  const nameProblem = chosen.some((account) => {
    const name = picks[account.id].name.trim();
    return name === '' || name.length > MAX_NAME;
  });

  const connect = async () => {
    if (chosen.length === 0 || nameProblem) return;
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
      // The token is not needed any more: drop it with the dialog.
      setToken('');
      const [only] = connections.length === 1 ? connections : [];
      toast.show({
        tone: 'success',
        title: only ? `${only.name} added` : `${connections.length} T-Bank accounts connected`,
        detail: only
          ? 'Positions arrive with the history import.'
          : "Import each account's history from its card.",
        ...(only && onImport
          ? {
              action: {
                label: 'Import history now',
                onClick: () => onImport({ accountId: only.accountId, name: only.name }),
              },
            }
          : {}),
      });
      onAdded(connections[0]?.accountId);
    } catch (caught) {
      setError(failure(caught, 'connect'));
      setBusy(false);
    }
  };

  const next = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (step === 'choose') {
      if (broker) setStep(broker === 'tbank' ? 'token' : 'manual');
    } else if (step === 'token') void check();
    else if (step === 'accounts') void connect();
  };
  const back = () => setStep(step === 'accounts' ? 'token' : 'choose');
  const change = (account: string, changes: Partial<Pick>) =>
    setPicks((current) => ({ ...current, [account]: { ...current[account], ...changes } }));

  if (step === 'manual')
    return (
      <AddBrokerDialog
        steps={{ current: 2, total: 2 }}
        initialEntry={draft}
        onBack={(entry) => {
          setDraft(entry);
          setStep('choose');
        }}
        onClose={onClose}
        onAdded={(name, account) => {
          if (name) toast.show({ tone: 'success', title: `${name} added` });
          onAdded(account);
        }}
      />
    );

  const label = submitLabel(step, busy, chosen.length);
  return (
    <>
      <Modal
        titleId={`${id}-title`}
        size="wide"
        onEscape={busy ? undefined : close}
        initialFocus={(root) => root.querySelector<HTMLElement>('[aria-pressed]')}
      >
        <form ref={form} onSubmit={next} noValidate>
          <ModalHeader
            titleId={`${id}-title`}
            title="Add broker account"
            onClose={close}
            closeDisabled={busy}
            steps={{
              current: stepNumbers[step],
              total: broker === 'manual' ? 2 : 3,
            }}
          />
          <ModalBody>
            {step === 'choose' && <ChooseStep broker={broker} onBroker={setBroker} />}
            {step === 'token' && (
              <TokenStep
                id={id}
                token={token}
                tokenError={tokenError}
                busy={busy}
                onToken={(value) => {
                  setToken(value);
                  setTokenError(null);
                }}
              />
            )}
            {step === 'accounts' && accounts && (
              <AccountsStep
                accounts={accounts}
                picks={picks}
                chosen={chosen.length}
                busy={busy}
                onChange={change}
              />
            )}
            {error && step !== 'choose' && <Banner tone="neg">{error}</Banner>}
          </ModalBody>
          <ModalFooter>
            {step === 'choose' ? (
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
            ) : (
              <>
                <Button variant="ghost" disabled={busy} onClick={back}>
                  Back
                </Button>
                <span className="ui-grow" />
              </>
            )}
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={
                (step === 'choose' && !broker) ||
                (step === 'accounts' && (chosen.length === 0 || nameProblem))
              }
            >
              {label}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
      {discarding && (
        <DiscardBrokerAccount onKeep={() => setDiscarding(false)} onDiscard={onClose} />
      )}
    </>
  );
}
