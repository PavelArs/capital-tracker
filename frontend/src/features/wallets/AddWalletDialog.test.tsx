import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddWalletDialog from './AddWalletDialog';

// Synthetic ids, names, addresses and keys only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = id(10);
const btc = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const fresh = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const zpub =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const apiKey = 'SyntheticKey0001';
const apiSecret = 'SyntheticSecret000000000000001';

const tracked = (n: number, changes: Partial<WalletAddress>): WalletAddress => ({
  id: id(20 + n),
  network: 'bitcoin',
  address: btc,
  accountId: trust,
  label: 'Trust Wallet BTC',
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: 3,
  chainBalance: '0.01000000',
  balances: null,
  sync: {
    state: 'complete',
    completedAt: '2026-10-05T12:00:00.000Z',
    status: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextRunAt: null,
    errorMessage: null,
  },
  ...changes,
});

const accounts = [
  { accountId: trust, name: 'Trust Wallet' },
  { accountId: id(11), name: 'Cold storage' },
];

const failure = (status?: number, data?: unknown) =>
  Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: status === undefined ? undefined : { status, data },
  });

function setup(props: Partial<Parameters<typeof AddWalletDialog>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onAdded: vi.fn(), onOpenExisting: vi.fn() };
  render(<AddWalletDialog accounts={accounts} addresses={[]} {...handlers} {...props} />);
  return { ...handlers, dialog: screen.getByRole('dialog'), user: userEvent.setup() };
}

const help = () => document.getElementById('wallet-address-help');

async function pick(
  { dialog, user }: { dialog: HTMLElement; user: ReturnType<typeof userEvent.setup> },
  network: RegExp,
) {
  await user.click(within(dialog).getByRole('button', { name: network }));
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
}

async function typeAddress(
  { dialog, user }: { dialog: HTMLElement; user: ReturnType<typeof userEvent.setup> },
  value: string,
) {
  const field = within(dialog).getByLabelText('Bitcoin wallet address');
  await user.click(field);
  await user.paste(value);
}

async function typeKey({
  dialog,
  user,
}: {
  dialog: HTMLElement;
  user: ReturnType<typeof userEvent.setup>;
}) {
  await user.type(within(dialog).getByLabelText('API key'), apiKey);
  await user.type(within(dialog).getByLabelText('API secret'), apiSecret);
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
});

describe('WAL-ADD: the Add wallet dialog', () => {
  it('is titled for a new wallet, for a wallet it was opened from and for its Bybit key', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Add wallet' })).toBeInTheDocument();
    cleanup();
    setup({ accountId: trust });
    expect(screen.getByRole('dialog', { name: 'Add an address to Trust Wallet' })).toBeVisible();
    cleanup();
    setup({ accountId: trust, network: 'bybit' });
    expect(screen.getByRole('dialog', { name: 'Connect Bybit API' })).toBeVisible();
    cleanup();
    setup({ accountId: id(99) });
    expect(screen.getByRole('dialog', { name: 'Add wallet' })).toBeInTheDocument();
  });

  it('waits for a network on step 1 and closes with Cancel', async () => {
    const view = setup();
    const { dialog, user } = view;
    expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Back' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(view.onClose).toHaveBeenCalledOnce();
  });

  it.each([
    [
      /^Bitcoin/,
      'Bitcoin',
      'Hardware wallets like Trezor use a new address for every deposit. Paste the account public key (zpub) from Trezor Suite to track all of them at once.',
      'Paste a public address from Receive in your wallet app, or the account public key.',
    ],
    [
      /^Ethereum/,
      'Ethereum',
      'One Ethereum address holds ETH and tokens. The app tracks ETH and every ERC-20 token on Ethereum mainnet, named as the chain names them. The same address on another chain (Base, Arbitrum One, OP Mainnet, Polygon, BNB Smart Chain or Avalanche) is added as a wallet of its own.',
      'Paste the public address. You can find it under Receive in your wallet app.',
    ],
    [
      /^Base/,
      'Base',
      'Paste the same 0x address you use on Ethereum. The app tracks ETH and every token this address holds on Base, named as the chain names them; its other chains are separate wallets.',
      'Paste the public address. You can find it under Receive in your wallet app.',
    ],
    [
      /^Polygon/,
      'Polygon',
      'Paste the same 0x address you use on Ethereum. The app tracks POL and every token this address holds on Polygon, named as the chain names them; its other chains are separate wallets.',
      'Paste the public address. You can find it under Receive in your wallet app.',
    ],
    [
      /^Solana/,
      'Solana',
      'Paste the wallet address, not a token account: the app finds its token accounts itself. It tracks SOL and every SPL token on Solana mainnet, named as the chain names them.',
      'Paste the public address. You can find it under Receive in your wallet app.',
    ],
    [
      /^Stellar/,
      'Stellar',
      'Paste the account address that starts with G. The app tracks XLM on the Stellar public network; issued assets such as USDC on Stellar are not read. An exchange deposit address with a memo is not your wallet.',
      'Paste the public address. You can find it under Receive in your wallet app.',
    ],
    [
      /^Zcash/,
      'Zcash',
      'Paste a transparent address that starts with t1 or t3. Shielded balances are private, so the app cannot read them: ZEC moved to a shielded address shows as sent, and ZEC from one shows as received.',
      'Paste the public address. You can find it under Receive in your wallet app.',
    ],
    [
      /^Tron/,
      'Tron',
      'Paste the address that starts with T. The app tracks TRX, USDT and USDC on Tron mainnet and the TRX you staked for energy or bandwidth; other tokens are not read.',
      'Paste the public address. You can find it under Receive in your wallet app.',
    ],
  ])('explains what %s tracks on step 2', async (tile, name, note, hint) => {
    const view = setup();
    await pick(view, tile);
    expect(within(view.dialog).getByLabelText(`${name} wallet address`)).toHaveFocus();
    expect(view.dialog).toHaveTextContent(note);
    expect(help()).toHaveTextContent(hint);
    expect(help()?.querySelector('.ui-field__hint')).not.toBeNull();
  });

  it('WAL-DUP names the wallet that already tracks an address or a key, and opens it', async () => {
    const owned = tracked(1, {});
    const loose = tracked(2, { address: zpub, accountId: null });
    const view = setup({ addresses: [owned, loose] });
    const { dialog, user } = view;
    await pick(view, /^Bitcoin/);
    await typeAddress(view, btc);
    const field = within(dialog).getByLabelText('Bitcoin wallet address');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(help()).toHaveTextContent('This address is already tracked in Trust Wallet. Open it');
    expect(within(help() as HTMLElement).queryByRole('alert')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).queryByLabelText('Wallet (optional)')).toBeNull();
    expect(field).toHaveFocus();
    expect(within(help() as HTMLElement).getByRole('alert')).toHaveTextContent(
      'This address is already tracked in Trust Wallet.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Open it' }));
    expect(view.onOpenExisting).toHaveBeenCalledWith(owned);
    await user.clear(field);
    await user.paste(zpub);
    expect(help()).toHaveTextContent('This key is already tracked. Open it');
  });

  it('says what kind of address was pasted', async () => {
    const view = setup();
    await pick(view, /^Bitcoin/);
    await typeAddress(view, btc);
    expect(help()?.querySelector('.wallets-ok')).toHaveTextContent('Native SegWit address');
    expect(within(view.dialog).getByLabelText('Bitcoin wallet address')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('joins an address to a chosen wallet or a new one on step 3, and goes back step by step', async () => {
    const view = setup();
    const { dialog, user } = view;
    await pick(view, /^Bitcoin/);
    await typeAddress(view, btc);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const name = within(dialog).getByLabelText('Wallet (optional)');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('placeholder', 'Bitcoin wallet');
    expect(dialog).toHaveTextContent(
      'A new wallet named Bitcoin wallet is created. Pick one of your wallets to group this address with it, or type a new name.',
    );
    expect(within(dialog).getByLabelText('How you hold it (optional)')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Address name (optional)')).toHaveAttribute(
      'placeholder',
      'e.g. Savings BTC',
    );
    expect(dialog).toHaveTextContent(`NetworkBitcoinAddress${btc}`);
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    expect(within(dialog).getByRole('button', { name: 'Trust Wallet' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(dialog).toHaveTextContent(
      'The address joins your wallet Trust Wallet. Pick one of your wallets to group this address with it, or type a new name.',
    );
    expect(within(dialog).queryByLabelText('How you hold it (optional)')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add wallet' })).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByLabelText('Bitcoin wallet address')).toHaveValue(btc);
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('button', { name: /^Bitcoin/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows a key as a public key on step 3', async () => {
    const view = setup();
    await pick(view, /^Bitcoin/);
    await typeAddress(view, zpub);
    await view.user.click(within(view.dialog).getByRole('button', { name: 'Continue' }));
    expect(view.dialog).toHaveTextContent(`Public key${zpub}`);
  });

  it('BYBIT-KEY names an account on step 3 and shows only the end of the key', async () => {
    const view = setup({ accountId: trust, network: 'bybit' });
    const { dialog, user } = view;
    expect(within(dialog).getByLabelText('API key')).toHaveFocus();
    expect(document.getElementById('bybit-secret-help')).toHaveTextContent(
      'Stored encrypted on the server and never shown again.',
    );
    await typeKey(view);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByLabelText('Wallet (optional)')).toHaveValue('Trust Wallet');
    expect(dialog).toHaveTextContent(
      'The account joins your wallet Trust Wallet. Pick one of your wallets to group this account with it, or type a new name.',
    );
    expect(within(dialog).getByLabelText('Account name (optional)')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      'NetworkBybitAPI key…0001AccessRead-only, checked with Bybit when you add it',
    );
    expect(within(dialog).getByRole('button', { name: 'Add account' })).toBeEnabled();
  });

  it('says what it is doing while it adds an address or checks a key', async () => {
    vi.spyOn(walletAddressesApi, 'add').mockReturnValue(new Promise(() => undefined));
    let view = setup();
    await pick(view, /^Bitcoin/);
    await typeAddress(view, fresh);
    await view.user.click(within(view.dialog).getByRole('button', { name: 'Continue' }));
    await view.user.click(within(view.dialog).getByRole('button', { name: 'Add wallet' }));
    expect(within(view.dialog).getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(within(view.dialog).getByRole('button', { name: 'Back' })).toBeDisabled();
    cleanup();

    view = setup({ network: 'bybit' });
    await typeKey(view);
    await view.user.click(within(view.dialog).getByRole('button', { name: 'Continue' }));
    await view.user.click(within(view.dialog).getByRole('button', { name: 'Add account' }));
    expect(within(view.dialog).getByRole('button', { name: 'Checking the key…' })).toBeDisabled();
  });

  it.each([
    [
      'no answer',
      failure(),
      btc,
      'Could not reach the server. Try again; the same request will not add the wallet twice.',
    ],
    [
      'a refused address',
      failure(400),
      fresh,
      'This is not a valid Bitcoin address. Check that it was copied in full.',
    ],
    [
      'a refused key',
      failure(400),
      zpub,
      'This is not a valid account public key. Check that it was copied in full.',
    ],
    [
      'a missing wallet',
      failure(404),
      fresh,
      'That wallet no longer exists. Close this window and reload the page.',
    ],
    ['an ended session', failure(401), fresh, 'Your session has ended. Sign in again.'],
    ['any other status', failure(500), fresh, 'Could not add the wallet. Try again.'],
    [
      'a plain error',
      new Error('boom'),
      fresh,
      'Could not reach the server. Try again; the same request will not add the wallet twice.',
    ],
  ])('says why an address was not added: %s', async (_case, error, address, message) => {
    vi.spyOn(walletAddressesApi, 'add').mockRejectedValue(error);
    const view = setup();
    await pick(view, /^Bitcoin/);
    await typeAddress(view, address);
    await view.user.click(within(view.dialog).getByRole('button', { name: 'Continue' }));
    await view.user.click(within(view.dialog).getByRole('button', { name: 'Add wallet' }));
    expect(await within(view.dialog).findByRole('alert')).toHaveTextContent(message);
    expect(within(view.dialog).getByRole('button', { name: 'Add wallet' })).toBeEnabled();
    expect(view.onAdded).not.toHaveBeenCalled();
  });

  it.each([
    [
      'no answer',
      failure(),
      'Could not reach the server. Try again; the same request will not add the wallet twice.',
    ],
    ['Bybit unreachable', failure(503), 'Bybit could not be reached. Try again in a few minutes.'],
    [
      'not a key',
      failure(400),
      'This is not a Bybit API key and secret. Copy both again from Bybit.',
    ],
    [
      'a refusal without a reason',
      failure(422, { message: 7 }),
      'Could not add the wallet. Try again.',
    ],
    [
      'a missing wallet',
      failure(404),
      'That wallet no longer exists. Close this window and reload the page.',
    ],
    ['an ended session', failure(401), 'Your session has ended. Sign in again.'],
  ])('says why a Bybit key was not added: %s', async (_case, error, message) => {
    vi.spyOn(walletAddressesApi, 'add').mockRejectedValue(error);
    const view = setup({ network: 'bybit' });
    await typeKey(view);
    await view.user.click(within(view.dialog).getByRole('button', { name: 'Continue' }));
    await view.user.click(within(view.dialog).getByRole('button', { name: 'Add account' }));
    expect(await within(view.dialog).findByRole('alert')).toHaveTextContent(message);
    expect(within(view.dialog).getByRole('button', { name: 'Add account' })).toBeEnabled();
  });

  it('sends a named address to the chosen wallet and reports what was added', async () => {
    const added = tracked(3, { address: fresh, label: 'Savings' });
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockResolvedValue({ created: false, address: added });
    const view = setup();
    const { dialog, user } = view;
    await pick(view, /^Bitcoin/);
    await typeAddress(view, fresh);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cold storage' }));
    await user.type(within(dialog).getByLabelText('Address name (optional)'), ' Savings ');
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    expect(add).toHaveBeenCalledWith({
      network: 'bitcoin',
      address: fresh,
      accountId: id(11),
      label: 'Savings',
    });
    expect(view.onAdded).toHaveBeenCalledWith(added, false);
  });
});
