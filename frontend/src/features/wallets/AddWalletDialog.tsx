import {
  type NewWalletAccount,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { isAxiosError } from 'axios';
import { type FormEvent, Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Chip, ChipGroup } from '@/ui/Chip';
import { Field } from '@/ui/Field';
import { Input } from '@/ui/inputs';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { OptionGrid, OptionTile } from '@/ui/OptionTile';
import { PasswordInput } from '@/ui/PasswordInput';
import AssetIcon from '../shell/AssetIcon';
import { isEvm } from '../shell/evm-networks';
import KindField, { type KindChoice } from './KindField';
import { type NetworkInfo, networkIcon, networks as tracked } from './networks';
import {
  type AddressCheck,
  accountNamed,
  checkAddress,
  checkApiKey,
  type KeyCheck,
  newAccountRequest,
} from './wallets';

export interface WalletAccount {
  accountId: string;
  name: string;
}

type Network = WalletAddress['network'];

const networks = [
  {
    key: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    detail: 'Address or account public key (xpub, zpub)',
  },
  { key: 'ethereum', symbol: 'ETH', name: 'Ethereum', detail: 'One address. ETH and every token' },
  { key: 'base', symbol: 'ETH', name: 'Base', detail: 'The same 0x address. ETH and every token' },
  {
    key: 'arbitrum',
    symbol: 'ETH',
    name: 'Arbitrum One',
    detail: 'The same 0x address. ETH and every token',
  },
  {
    key: 'optimism',
    symbol: 'ETH',
    name: 'OP Mainnet',
    detail: 'The same 0x address. ETH and every token',
  },
  {
    key: 'polygon',
    symbol: 'POL',
    name: 'Polygon',
    detail: 'The same 0x address. POL and every token',
  },
  {
    key: 'bnb',
    symbol: 'BNB',
    name: 'BNB Smart Chain',
    detail: 'The same 0x address. BNB and every token',
  },
  {
    key: 'avalanche',
    symbol: 'AVAX',
    name: 'Avalanche C-Chain',
    detail: 'The same 0x address. AVAX and every token',
  },
  { key: 'solana', symbol: 'SOL', name: 'Solana', detail: 'One address. SOL and every token' },
  { key: 'tron', symbol: 'TRX', name: 'Tron', detail: 'One address. TRX, USDT, USDC and staking' },
  { key: 'stellar', symbol: 'XLM', name: 'Stellar', detail: 'One address. XLM' },
  { key: 'zcash', symbol: 'ZEC', name: 'Zcash', detail: 'One transparent address. ZEC' },
  {
    key: 'bybit',
    symbol: null,
    name: 'Bybit',
    detail: 'Read-only API key. Every coin: trades, deposits and withdrawals',
  },
] as const;

/** The tiles of step 1, blockchains first and the exchange on its own. */
const networkGroups = [
  { title: 'Blockchains', items: networks.filter((item) => item.key !== 'bybit') },
  { title: 'Exchange', items: networks.filter((item) => item.key === 'bybit') },
];
const MAX_LABEL = 40;
const isTracked = (key: string): key is Network => key in tracked;

/** BYBIT-KEY: why Bybit's key was refused, when it is Bybit's to say; null for the common reasons. */
function bybitFailure(error: unknown, status: number): string | null {
  // The server says why Bybit's answer about the key was refused.
  const said = isAxiosError(error)
    ? (error.response?.data as { message?: unknown })?.message
    : null;
  if (status === 422 && typeof said === 'string') return said;
  if (status === 503) return 'Bybit could not be reached. Try again in a few minutes.';
  if (status === 400) return 'This is not a Bybit API key and secret. Copy both again from Bybit.';
  return null;
}

function failure(error: unknown, network: Network, key: boolean): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === undefined)
    return 'Could not reach the server. Try again; the same request will not add the wallet twice.';
  const bybit = network === 'bybit' ? bybitFailure(error, status) : null;
  if (bybit !== null) return bybit;
  if (status === 400)
    return key
      ? 'This is not a valid account public key. Check that it was copied in full.'
      : `This is not a valid ${tracked[network].name} address. Check that it was copied in full.`;
  if (status === 404) return 'That wallet no longer exists. Close this window and reload the page.';
  if (status === 401) return 'Your session has ended. Sign in again.';
  return 'Could not add the wallet. Try again.';
}

/** What a wallet on each network tracks, said on step 2; the other EVM chains share one note. */
const networkNotes: Partial<Record<Network, string>> = {
  ethereum:
    'One Ethereum address holds ETH and tokens. The app tracks ETH and every ERC-20 token on Ethereum mainnet, named as the chain names them. The same address on another chain (Base, Arbitrum One, OP Mainnet, Polygon, BNB Smart Chain or Avalanche) is added as a wallet of its own.',
  solana:
    'Paste the wallet address, not a token account: the app finds its token accounts itself. It tracks SOL and every SPL token on Solana mainnet, named as the chain names them.',
  stellar:
    'Paste the account address that starts with G. The app tracks XLM on the Stellar public network; issued assets such as USDC on Stellar are not read. An exchange deposit address with a memo is not your wallet.',
  zcash:
    'Paste a transparent address that starts with t1 or t3. Shielded balances are private, so the app cannot read them: ZEC moved to a shielded address shows as sent, and ZEC from one shows as received.',
  tron: 'Paste the address that starts with T. The app tracks TRX, USDT and USDC on Tron mainnet and the TRX you staked for energy or bandwidth; other tokens are not read.',
};

function networkNote(network: Network | null): string {
  const note = network === null ? undefined : networkNotes[network];
  if (note) return note;
  if (network !== null && isEvm(network))
    return `Paste the same 0x address you use on Ethereum. The app tracks ${tracked[network].symbol} and every token this address holds on ${tracked[network].name}, named as the chain names them; its other chains are separate wallets.`;
  return 'Hardware wallets like Trezor use a new address for every deposit. Paste the account public key (zpub) from Trezor Suite to track all of them at once.';
}

/** From a wallet's page the address joins that wallet (its name is preset in step 3). */
function dialogTitle(opened: WalletAccount | undefined, network: Network | undefined): string {
  if (!opened) return 'Add wallet';
  return network === 'bybit' ? 'Connect Bybit API' : `Add an address to ${opened.name}`;
}

function submitLabel(step: 1 | 2 | 3, saving: boolean, exchange: boolean): string {
  if (step !== 3) return 'Continue';
  if (saving) return exchange ? 'Checking the key…' : 'Adding…';
  return exchange ? 'Add account' : 'Add wallet';
}

/** wallets-04: the field a refused Continue puts the keyboard on. */
function problemField(exchange: boolean, keyOk: boolean): string {
  if (!exchange) return 'wallet-address';
  return keyOk ? 'bybit-secret' : 'bybit-key';
}

/** WAL-NO-SECRETS: why a pasted value is dropped, when it is a seed phrase or a private key. */
const droppedSecret = (result: AddressCheck | KeyCheck): string | null =>
  !result.ok && result.secret ? result.message : null;

function DroppedSecret({ message }: { message: string }) {
  return (
    <span className="ui-field__error" role="alert">
      {message} It was not saved.
    </span>
  );
}

function SecretHelp({
  dropped,
  error,
  role,
}: {
  dropped: string | null;
  error: string | null;
  role: 'alert' | undefined;
}) {
  if (dropped) return <DroppedSecret message={dropped} />;
  if (error !== null)
    return (
      <span className="ui-field__error" role={role}>
        {error}
      </span>
    );
  return (
    <span className="ui-field__hint">Stored encrypted on the server and never shown again.</span>
  );
}

function AddressHelp({
  dropped,
  error,
  role,
  check,
  isKey,
  existing,
  existingWallet,
  network,
  onOpenExisting,
  onSwitch,
}: {
  dropped: string | null;
  error: string | null;
  role: 'alert' | undefined;
  check: AddressCheck;
  isKey: boolean;
  existing: WalletAddress | undefined;
  existingWallet: string | undefined;
  network: Network | null;
  onOpenExisting: (address: WalletAddress) => void;
  onSwitch: (network: Network) => void;
}) {
  if (dropped) return <DroppedSecret message={dropped} />;
  if (existing)
    return (
      <span className="ui-field__error" role={role}>
        {isKey ? 'This key is already tracked' : 'This address is already tracked'}
        {existingWallet ? ` in ${existingWallet}` : ''}.{' '}
        <Button variant="link" onClick={() => onOpenExisting(existing)}>
          Open it
        </Button>
      </span>
    );
  if (check.ok) return <span className="wallets-ok">{check.kind}</span>;
  // wallets-06: an address of another network offers to switch to it.
  const { switchTo } = check;
  if (error !== null)
    return (
      <span className="ui-field__error" role={role}>
        {error}
        {switchTo && (
          <>
            {' '}
            <Button variant="link" onClick={() => onSwitch(switchTo)}>
              Switch to {tracked[switchTo].name}
            </Button>
          </>
        )}
      </span>
    );
  return (
    <span className="ui-field__hint">
      {network === 'bitcoin'
        ? 'Paste a public address from Receive in your wallet app, or the account public key.'
        : 'Paste the public address. You can find it under Receive in your wallet app.'}
    </span>
  );
}

/** Step 3's summary of what is added: the network and the key's end, or the address. */
function AddSummary({
  network,
  exchange,
  apiKey,
  check,
  isKey,
}: {
  network: string;
  exchange: boolean;
  apiKey: string;
  check: AddressCheck;
  isKey: boolean;
}) {
  return (
    <KeyValue variant="panel">
      <KeyValueRow term="Network">{network}</KeyValueRow>
      {exchange ? (
        <>
          <KeyValueRow term="API key">
            <span className="ui-mono">…{apiKey.trim().slice(-4)}</span>
          </KeyValueRow>
          <KeyValueRow term="Access">Read-only, checked with Bybit when you add it</KeyValueRow>
        </>
      ) : (
        <KeyValueRow term={isKey ? 'Public key' : 'Address'}>
          <span className="ui-mono wallets-break">{check.ok && check.address}</span>
        </KeyValueRow>
      )}
    </KeyValue>
  );
}

/** The pasted address: its check, the tracked one it repeats (WAL-DUP) and that one's wallet. */
function addressFacts(
  network: Network | null,
  input: string,
  addresses: readonly WalletAddress[],
  accounts: readonly WalletAccount[],
) {
  const check = checkAddress(network ?? 'bitcoin', input);
  if (!check.ok) return { check, existing: undefined, existingWallet: undefined, isKey: false };
  const existing = addresses.find(
    (item) => item.network === network && item.address === check.address,
  );
  const existingWallet = existing?.accountId
    ? accounts.find((account) => account.accountId === existing.accountId)?.name
    : undefined;
  // M21: an account public key (xpub, ypub, zpub) stands for every address of the account.
  return { check, existing, existingWallet, isKey: /^[xyz]pub/.test(check.address) };
}

/** Step 2 for Bybit: how to make a read-only key, then the key and its secret. */
function KeyStep({
  apiKey,
  apiSecret,
  keyError,
  secretError,
  dropped,
  role,
  onChange,
  onLeave,
}: {
  apiKey: string;
  apiSecret: string;
  keyError: string | null;
  secretError: string | null;
  dropped: string | null;
  role: 'alert' | undefined;
  onChange: (value: string, part: 'key' | 'secret') => void;
  onLeave: (field: 'key' | 'secret') => () => void;
}) {
  return (
    <>
      <Banner tone="info" role="none">
        <ol className="wallets-howto">
          <li>
            In Bybit open <b>Account → API → Create New Key</b>, choose{' '}
            <b>System-generated API Keys</b> and <b>API Transaction</b>.
          </li>
          <li>
            Set permissions to <b>Read-Only</b> and tick <b>Earn</b> and <b>Exchange History</b>{' '}
            under it, so coins in Earn and converts count. Tick nothing that trades or withdraws.
          </li>
          <li>Bind it to this server's IP address: an unbound key stops working after 90 days.</li>
        </ol>
      </Banner>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor="bybit-key">
          API key
        </label>
        <Input
          id="bybit-key"
          mono
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          aria-invalid={keyError === null ? undefined : true}
          aria-describedby="bybit-key-help"
          onChange={(event) => onChange(event.target.value, 'key')}
          onBlur={onLeave('key')}
        />
        <span id="bybit-key-help">
          {keyError !== null && (
            <span className="ui-field__error" role={role}>
              {keyError}
            </span>
          )}
        </span>
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor="bybit-secret">
          API secret
        </label>
        {/* wallets-14: the secret can be shown to check it was pasted in full; a new step
            draws the field again, hidden. */}
        <PasswordInput
          id="bybit-secret"
          mono
          autoComplete="off"
          spellCheck={false}
          showLabel="Show secret"
          hideLabel="Hide secret"
          value={apiSecret}
          aria-invalid={secretError === null ? undefined : true}
          aria-describedby="bybit-secret-help"
          onChange={(event) => onChange(event.target.value, 'secret')}
          onBlur={onLeave('secret')}
        />
        <span id="bybit-secret-help">
          <SecretHelp dropped={dropped} error={secretError} role={role} />
        </span>
      </div>
      <Banner tone="info" role="none">
        The app checks with Bybit that the key is read-only and refuses one that can trade or
        withdraw. It reads spot trades, deposits and withdrawals of every coin for the last two
        years, the balances Bybit reports, with Earn ticked the coins in Earn and three months of
        their yield, and with Exchange History ticked every convert. Coins Kraken does not list are
        priced from Bybit's own market. P2P purchases are not in the API: add them by hand.
      </Banner>
    </>
  );
}

/** Step 2 for a blockchain: the address or key, what was pasted (children), what it tracks. */
function AddressStep({
  chosen,
  value,
  error,
  existing,
  note,
  onChange,
  onBlur,
  children,
}: {
  chosen: NetworkInfo;
  value: string;
  error: string | null;
  existing: WalletAddress | undefined;
  note: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor="wallet-address">
          {chosen.name} wallet address
        </label>
        <Input
          id="wallet-address"
          mono
          autoComplete="off"
          spellCheck={false}
          placeholder={chosen.placeholder}
          value={value}
          aria-invalid={error !== null || existing ? true : undefined}
          aria-describedby="wallet-address-help"
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        <span id="wallet-address-help">{children}</span>
      </div>
      <Banner tone="info" role="none">
        {note}
      </Banner>
    </>
  );
}

/** Step 3: the wallet that holds what is added, how a new one is held, and a name for it. */
function WalletStep({
  chosen,
  exchange,
  accounts,
  match,
  chosenName,
  walletName,
  kind,
  label,
  onWalletName,
  onKind,
  onLabel,
}: {
  chosen: NetworkInfo;
  exchange: boolean;
  accounts: readonly WalletAccount[];
  match: WalletAccount | undefined;
  chosenName: string;
  walletName: string;
  kind: KindChoice;
  label: string;
  onWalletName: (name: string) => void;
  onKind: (kind: KindChoice) => void;
  onLabel: (label: string) => void;
}) {
  return (
    <>
      <Field
        id="wallet-name"
        label={
          <>
            Wallet <span className="ui-muted">(optional)</span>
          </>
        }
        hint={
          <>
            {match
              ? `The ${exchange ? 'account' : 'address'} joins your wallet ${match.name}.`
              : `A new wallet named ${chosenName} is created.`}{' '}
            Pick one of your wallets to group this {exchange ? 'account' : 'address'} with it, or
            type a new name.
          </>
        }
      >
        {(control) => (
          <Input
            {...control}
            maxLength={120}
            placeholder={chosen.defaultWallet}
            value={walletName}
            onChange={(event) => onWalletName(event.target.value)}
          />
        )}
      </Field>
      {accounts.length > 0 && (
        <ChipGroup label="Your wallets">
          {accounts.map((account) => (
            <Chip
              key={account.accountId}
              pressed={match?.accountId === account.accountId}
              onClick={() => onWalletName(account.name)}
            >
              {account.name}
            </Chip>
          ))}
        </ChipGroup>
      )}
      {!match && <KindField id="wallet-kind" value={kind} onChange={onKind} />}
      <Field
        id="wallet-label"
        label={
          <>
            {exchange ? 'Account name' : 'Address name'}{' '}
            <span className="ui-muted">(optional)</span>
          </>
        }
      >
        {(control) => (
          <Input
            {...control}
            maxLength={MAX_LABEL}
            placeholder={`e.g. ${chosen.labelExample}`}
            value={label}
            onChange={(event) => onLabel(event.target.value)}
          />
        )}
      </Field>
    </>
  );
}

function StepFooter({
  step,
  network,
  saving,
  exchange,
  onClose,
  onBack,
}: {
  step: 1 | 2 | 3;
  network: Network | null;
  saving: boolean;
  exchange: boolean;
  onClose: () => void;
  onBack: () => void;
}) {
  return (
    <ModalFooter>
      {step === 1 ? (
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      ) : (
        <Button variant="ghost" disabled={saving} onClick={onBack}>
          Back
        </Button>
      )}
      {/* Back stands apart at the left; Cancel sits with the main action, as in every dialog. */}
      {step !== 1 && <span className="ui-grow" />}
      <Button type="submit" variant="primary" disabled={(step === 1 && !network) || saving}>
        {submitLabel(step, saving, exchange)}
      </Button>
    </ModalFooter>
  );
}

/** Step 3: the wallet the address joins, or the name and kind of the new wallet it creates. */
function destinationOf(
  opened: WalletAccount | undefined,
  accounts: readonly WalletAccount[],
  walletName: string,
  defaultWallet: string,
  pickedKind: KindChoice | null,
  exchange: boolean,
) {
  const chosenName = walletName.trim() || defaultWallet;
  // The wallet it was opened for while its name stands, else the one the owner names.
  const match = opened && chosenName === opened.name ? opened : accountNamed(accounts, chosenName);
  // W1: while untouched, a Bybit account starts as an exchange.
  const kind: KindChoice = pickedKind ?? (exchange ? 'exchange' : '');
  return { chosenName, match, kind };
}

interface Props {
  accounts: readonly WalletAccount[];
  addresses: readonly WalletAddress[];
  onClose: () => void;
  onAdded: (address: WalletAddress, created: boolean) => void;
  /** Opens a wallet the owner tried to add again (WAL-DUP). */
  onOpenExisting: (address: WalletAddress) => void;
  /**
   * The wallet the address joins unless the owner names another (from a wallet's own page or its
   * Connect Bybit API), by its id: another wallet may have the same name.
   */
  accountId?: string;
  /** Opens on this network's form, as "Connect Bybit API" does (wallets-08). */
  network?: Network;
}

// "Add wallet" from the accepted prototype: network, address, then which wallet holds it.
export default function AddWalletDialog({
  accounts,
  addresses,
  onClose,
  onAdded,
  onOpenExisting,
  accountId,
  network: initialNetwork,
}: Props) {
  const opened = accountId
    ? accounts.find((account) => account.accountId === accountId)
    : undefined;
  const [step, setStep] = useState<1 | 2 | 3>(initialNetwork ? 2 : 1);
  const [network, setNetwork] = useState<Network | null>(initialNetwork ?? null);
  const [input, setInput] = useState('');
  const [tried, setTried] = useState(false);
  // Fields the owner has left: their problems show on blur and clear as soon as the value is fixed.
  const [left, setLeft] = useState<ReadonlySet<'address' | 'key' | 'secret'>>(new Set());
  const leave = (field: 'address' | 'key' | 'secret') => () =>
    setLeft((current) => (current.has(field) ? current : new Set(current).add(field)));
  const [secretMessage, setSecretMessage] = useState<string | null>(null);
  // M22: a Bybit account is read with an API key and secret, kept in memory only until sent.
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [walletName, setWalletName] = useState(opened?.name ?? '');
  const [label, setLabel] = useState('');
  // W1: how a new wallet is held; null while untouched, so a Bybit account starts as an exchange.
  const [pickedKind, setPickedKind] = useState<KindChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One request id per new wallet name and kind, so a retry after a lost answer cannot add it
  // twice and a changed kind is a new request.
  const attempt = useRef<{ key: string; requestId: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  // Each step puts the keyboard on its first field.
  useEffect(() => {
    form.current
      ?.querySelector<HTMLElement>(step === 1 ? '[aria-pressed]' : 'input:not([disabled])')
      ?.focus();
  }, [step]);
  const focusField = (id: string) => form.current?.querySelector<HTMLElement>(`#${id}`)?.focus();

  const chosen = tracked[network ?? 'bitcoin'];
  const exchange = network === 'bybit';
  const keyCheck = checkApiKey(apiKey, 'key');
  const secretCheck = checkApiKey(apiSecret, 'secret');
  const keyReady = keyCheck.ok && secretCheck.ok;
  const { check, existing, existingWallet, isKey } = addressFacts(
    network,
    input,
    addresses,
    accounts,
  );
  const ready = exchange ? keyReady : check.ok;
  // A field's problem shows once Continue was tried or the owner left the field.
  const problem = (result: AddressCheck | KeyCheck, field: 'address' | 'key' | 'secret') =>
    !result.ok && (tried || left.has(field)) ? result.message : null;
  const addressError = problem(check, 'address');
  const keyError = problem(keyCheck, 'key');
  const secretError = problem(secretCheck, 'secret');
  // wallets-04: after a failed Continue a field's problem is said aloud; on leaving a field it is
  // only shown.
  const alertOnTry = tried ? 'alert' : undefined;
  const { chosenName, match, kind } = destinationOf(
    opened,
    accounts,
    walletName,
    chosen.defaultWallet,
    pickedKind,
    exchange,
  );

  // WAL-NO-SECRETS: a seed phrase or private key pasted in a field is dropped from the form at once.
  const change = (set: (value: string) => void, value: string, result: AddressCheck | KeyCheck) => {
    const dropped = droppedSecret(result);
    setSecretMessage(dropped);
    set(dropped === null ? value : '');
  };
  const changeKey = (value: string, part: 'key' | 'secret') =>
    change(part === 'key' ? setApiKey : setApiSecret, value, checkApiKey(value, part));
  const changeAddress = (value: string) =>
    change(setInput, value, checkAddress(network ?? 'bitcoin', value));

  const next = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (step === 1) {
      if (network) setStep(2);
      return;
    }
    if (step === 3) {
      void save();
      return;
    }
    setTried(true);
    if (ready && (exchange || !existing)) setStep(3);
    // wallets-04: the keyboard goes to the field that needs the owner.
    else focusField(problemField(exchange, keyCheck.ok));
  };

  const save = async () => {
    if (!network || !ready) return;
    setSaving(true);
    setError(null);
    try {
      // WAL-INVALID: a new wallet goes with its address in one request, so an address the server
      // refuses leaves no empty wallet behind.
      const destination: { accountId: string } | { newAccount: NewWalletAccount } = match
        ? { accountId: match.accountId }
        : { newAccount: newAccountRequest(attempt, chosenName, kind) };
      const named = label.trim() ? { label: label.trim() } : {};
      const result = await walletAddressesApi.add(
        network === 'bybit'
          ? {
              network,
              apiKey: apiKey.trim(),
              apiSecret: apiSecret.trim(),
              ...destination,
              ...named,
            }
          : { network, address: check.ok ? check.address : '', ...destination, ...named },
      );
      onAdded(result.address, result.created);
    } catch (caught) {
      setError(failure(caught, network, isKey));
      setSaving(false);
    }
  };

  return (
    <Modal
      titleId="add-wallet"
      size="wide"
      onEscape={saving ? undefined : onClose}
      initialFocus={(root) =>
        root.querySelector<HTMLElement>(initialNetwork ? 'input' : '[aria-pressed]')
      }
    >
      <form ref={form} onSubmit={next} noValidate>
        <ModalHeader
          titleId="add-wallet"
          title={dialogTitle(opened, initialNetwork)}
          onClose={onClose}
          closeDisabled={saving}
          steps={{ current: step, total: 3 }}
        />
        <ModalBody>
          {step === 1 && (
            <>
              <p className="ui-soft wallets-text">What do you want to connect?</p>
              {networkGroups.map((group) => (
                <Fragment key={group.title}>
                  <h3 id={`networks-${group.title}`} className="wallets-networks__title">
                    {group.title}
                  </h3>
                  <OptionGrid layout="tile" labelledBy={`networks-${group.title}`}>
                    {group.items.map((item) => (
                      <OptionTile
                        key={item.key}
                        pressed={network === item.key}
                        disabled={!isTracked(item.key)}
                        onClick={() => isTracked(item.key) && setNetwork(item.key)}
                        icon={<AssetIcon {...networkIcon(tracked[item.key])} />}
                        title={item.name}
                        description={item.detail}
                      />
                    ))}
                  </OptionGrid>
                </Fragment>
              ))}
              <Banner tone="info" role="none">
                Read-only. The app never asks for a seed phrase, a private key or an exchange
                password.
              </Banner>
            </>
          )}
          {step === 2 && exchange && (
            <KeyStep
              apiKey={apiKey}
              apiSecret={apiSecret}
              keyError={keyError}
              secretError={secretError}
              dropped={secretMessage}
              role={alertOnTry}
              onChange={changeKey}
              onLeave={leave}
            />
          )}
          {step === 2 && !exchange && (
            <AddressStep
              chosen={chosen}
              value={input}
              error={addressError}
              existing={existing}
              note={networkNote(network)}
              onChange={changeAddress}
              onBlur={leave('address')}
            >
              <AddressHelp
                dropped={secretMessage}
                error={addressError}
                role={alertOnTry}
                check={check}
                isKey={isKey}
                existing={existing}
                existingWallet={existingWallet}
                network={network}
                onOpenExisting={onOpenExisting}
                onSwitch={(to) => {
                  setNetwork(to);
                  setError(null);
                  focusField('wallet-address');
                }}
              />
            </AddressStep>
          )}
          {step === 3 && ready && (
            <>
              <WalletStep
                chosen={chosen}
                exchange={exchange}
                accounts={accounts}
                match={match}
                chosenName={chosenName}
                walletName={walletName}
                kind={kind}
                label={label}
                onWalletName={setWalletName}
                onKind={setPickedKind}
                onLabel={setLabel}
              />
              <AddSummary
                network={chosen.name}
                exchange={exchange}
                apiKey={apiKey}
                check={check}
                isKey={isKey}
              />
            </>
          )}
          {error && <Banner tone="neg">{error}</Banner>}
        </ModalBody>
        <StepFooter
          step={step}
          network={network}
          saving={saving}
          exchange={exchange}
          onClose={onClose}
          onBack={() => {
            setError(null);
            setStep(step === 3 ? 2 : 1);
          }}
        />
      </form>
    </Modal>
  );
}
