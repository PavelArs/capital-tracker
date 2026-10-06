import { accountingApi } from '@api/accounting.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { newRequestId } from '../accounting/feedback';
import AssetIcon from '../shell/AssetIcon';
import { networks as tracked } from './networks';
import { accountNamed, checkAddress } from './wallets';

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
    detail: 'One public address. Account keys (xpub, zpub) come later',
  },
  { key: 'ethereum', symbol: 'ETH', name: 'Ethereum', detail: 'One address. ETH, USDT and USDC' },
  { key: 'solana', symbol: 'SOL', name: 'Solana', detail: 'Coming soon' },
  { key: 'bybit', symbol: null, name: 'Bybit', detail: 'Read-only API key. Coming soon' },
] as const;
const MAX_LABEL = 40;
const isTracked = (key: string): key is Network => key in tracked;
// Tab order inside the modal: every enabled control.
const focusable = 'button:not([disabled]), input:not([disabled])';

function failure(error: unknown, network: Network): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === undefined)
    return 'Could not reach the server. Try again; the same request will not add the wallet twice.';
  if (status === 400)
    return `This is not a valid ${tracked[network].name} address. Check that it was copied in full.`;
  if (status === 404) return 'That wallet no longer exists. Close this window and reload the page.';
  if (status === 401) return 'Your session has ended. Sign in again.';
  return 'Could not add the wallet. Try again.';
}

interface Props {
  accounts: readonly WalletAccount[];
  addresses: readonly WalletAddress[];
  onClose: () => void;
  onAdded: (address: WalletAddress, created: boolean) => void;
  /** Opens a wallet the owner tried to add again (WAL-DUP). */
  onOpenExisting: (address: WalletAddress) => void;
  /** The wallet the address joins unless the owner picks another (from a wallet's own page). */
  wallet?: string;
}

// "Add wallet" from the accepted prototype: network, address, then which wallet holds it.
export default function AddWalletDialog({
  accounts,
  addresses,
  onClose,
  onAdded,
  onOpenExisting,
  wallet,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [network, setNetwork] = useState<Network | null>(null);
  const [input, setInput] = useState('');
  const [tried, setTried] = useState(false);
  const [secretMessage, setSecretMessage] = useState<string | null>(null);
  const [walletName, setWalletName] = useState(wallet ?? '');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One request id per new wallet name, so a retry after a lost answer cannot add it twice.
  const attempt = useRef<{ name: string; requestId: string } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const busy = useRef(false);
  busy.current = saving;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy.current) close.current();
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>(focusable)];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  // Each step puts the keyboard on its first field.
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>(step === 1 ? '[aria-pressed]' : 'input:not([disabled])')
      ?.focus();
  }, [step]);

  const chosen = tracked[network ?? 'bitcoin'];
  const check = checkAddress(network ?? 'bitcoin', input);
  const existing = check.ok
    ? addresses.find((item) => item.network === network && item.address === check.address)
    : undefined;
  const existingWallet = existing?.accountId
    ? accounts.find((account) => account.accountId === existing.accountId)?.name
    : undefined;
  const showError = !check.ok && (tried || input.trim().length > 20);
  const chosenName = walletName.trim() || chosen.defaultWallet;
  const match = accountNamed(accounts, chosenName);

  const changeAddress = (value: string) => {
    // WAL-NO-SECRETS: a seed phrase or private key is dropped from the form at once.
    const next = checkAddress(network ?? 'bitcoin', value);
    if (!next.ok && next.secret) {
      setInput('');
      setSecretMessage(next.message);
      return;
    }
    setSecretMessage(null);
    setInput(value);
  };

  const next = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (step === 1) {
      if (network) setStep(2);
      return;
    }
    if (step === 2) {
      setTried(true);
      if (check.ok && !existing) setStep(3);
      return;
    }
    void save();
  };

  const save = async () => {
    if (!check.ok || !network) return;
    setSaving(true);
    setError(null);
    try {
      let accountId = match?.accountId;
      if (!accountId) {
        if (attempt.current?.name !== chosenName)
          attempt.current = { name: chosenName, requestId: newRequestId() };
        accountId = (
          await accountingApi.createAccount({
            requestId: attempt.current.requestId,
            name: chosenName,
          })
        ).id;
      }
      const result = await walletAddressesApi.add({
        network,
        address: check.address,
        accountId,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      onAdded(result.address, result.created);
    } catch (caught) {
      setError(failure(caught, network));
      setSaving(false);
    }
  };

  return (
    <div className="portfolio-scrim">
      <div
        ref={dialog}
        className="portfolio-dialog portfolio-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-wallet"
      >
        <form onSubmit={next} noValidate>
          <div className="portfolio-dialog__head">
            <h2 id="add-wallet">Add wallet</h2>
          </div>
          <div className="wallets-steps" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map((item) => (
              <i key={item} className={step >= item ? 'wallets-steps__on' : undefined} />
            ))}
            <span>Step {step} of 3</span>
          </div>
          <div className="portfolio-dialog__body">
            {step === 1 && (
              <>
                <p className="wallets-soft">What do you want to connect?</p>
                <div className="wallets-networks">
                  {networks.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="wallets-network"
                      aria-pressed={network === item.key}
                      disabled={!isTracked(item.key)}
                      onClick={() => isTracked(item.key) && setNetwork(item.key)}
                    >
                      <AssetIcon
                        symbol={item.symbol}
                        name={item.name}
                        assetType={item.symbol ? 'crypto' : 'manual'}
                      />
                      <b>{item.name}</b>
                      <small>{item.detail}</small>
                    </button>
                  ))}
                </div>
                <p className="wallets-note">
                  Read-only. The app never asks for a seed phrase, a private key or an exchange
                  password.
                </p>
              </>
            )}
            {step === 2 && (
              <>
                <div className="portfolio-field">
                  <label className="portfolio-field__label" htmlFor="wallet-address">
                    {chosen.name} wallet address
                  </label>
                  <input
                    id="wallet-address"
                    className="portfolio-input wallets-mono"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={chosen.placeholder}
                    value={input}
                    aria-invalid={showError || existing ? true : undefined}
                    aria-describedby="wallet-address-help"
                    onChange={(event) => changeAddress(event.target.value)}
                  />
                  <span id="wallet-address-help">
                    {secretMessage ? (
                      <span className="portfolio-field__error" role="alert">
                        {secretMessage} It was not saved.
                      </span>
                    ) : existing ? (
                      <span className="portfolio-field__error">
                        This address is already tracked
                        {existingWallet ? ` in ${existingWallet}` : ''}.{' '}
                        <button
                          type="button"
                          className="portfolio-link"
                          onClick={() => onOpenExisting(existing)}
                        >
                          Open it
                        </button>
                      </span>
                    ) : check.ok ? (
                      <span className="wallets-ok">{check.kind}</span>
                    ) : showError ? (
                      <span className="portfolio-field__error">{check.message}</span>
                    ) : (
                      <span className="portfolio-field__hint">
                        Paste the public address. You can find it under Receive in your wallet app.
                      </span>
                    )}
                  </span>
                </div>
                {network === 'ethereum' ? (
                  <p className="wallets-note">
                    One Ethereum address holds ETH and tokens. The app tracks ETH, USDT and USDC on
                    Ethereum mainnet; other tokens and networks such as Arbitrum are not read.
                  </p>
                ) : (
                  <p className="wallets-note">
                    Hardware wallets like Trezor use a new address for every deposit. Tracking all
                    of them through the account public key comes later; until then add each address
                    you received coins on.
                  </p>
                )}
              </>
            )}
            {step === 3 && check.ok && (
              <>
                <div className="portfolio-field">
                  <label className="portfolio-field__label" htmlFor="wallet-name">
                    Wallet <span className="wallets-muted">(optional)</span>
                  </label>
                  <input
                    id="wallet-name"
                    className="portfolio-input"
                    maxLength={120}
                    placeholder={chosen.defaultWallet}
                    value={walletName}
                    onChange={(event) => setWalletName(event.target.value)}
                  />
                  <span className="portfolio-field__hint">
                    {match
                      ? `The address joins your wallet ${match.name}.`
                      : `A new wallet named ${chosenName} is created.`}{' '}
                    Pick one of your wallets to group this address with it, or type a new name.
                  </span>
                </div>
                {accounts.length > 0 && (
                  <div className="portfolio-chips" role="group" aria-label="Your wallets">
                    {accounts.map((account) => (
                      <button
                        key={account.accountId}
                        type="button"
                        className="portfolio-chip"
                        aria-pressed={match?.accountId === account.accountId}
                        onClick={() => setWalletName(account.name)}
                      >
                        {account.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="portfolio-field">
                  <label className="portfolio-field__label" htmlFor="wallet-label">
                    Address name <span className="wallets-muted">(optional)</span>
                  </label>
                  <input
                    id="wallet-label"
                    className="portfolio-input"
                    maxLength={MAX_LABEL}
                    placeholder={`e.g. ${chosen.labelExample}`}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </div>
                <dl className="wallets-summary">
                  <div>
                    <dt>Network</dt>
                    <dd>{chosen.name}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd className="wallets-mono">{check.address}</dd>
                  </div>
                </dl>
              </>
            )}
            {error && (
              <p className="portfolio-dialog__error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="portfolio-dialog__foot">
            {step === 1 ? (
              <button type="button" className="shell-button shell-button--ghost" onClick={onClose}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="shell-button shell-button--ghost"
                disabled={saving}
                onClick={() => {
                  setError(null);
                  setStep(step === 3 ? 2 : 1);
                }}
              >
                Back
              </button>
            )}
            <span className="wallets-grow" />
            <button
              type="submit"
              className="shell-button shell-button--primary"
              disabled={(step === 1 && !network) || saving}
            >
              {step === 3 ? (saving ? 'Adding…' : 'Add wallet') : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
