import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import type { WalletAddress } from '@api/wallet-addresses.api';

// Exact decimal arithmetic for comparing balances; display rounding happens in format.ts.
const SCALE = 30;
const ONE = 10n ** BigInt(SCALE);

function units(value: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`Not a decimal: ${value}`);
  const fraction = (match[3] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
  const magnitude = BigInt(match[2]) * ONE + BigInt(fraction);
  return match[1] ? -magnitude : magnitude;
}

function decimal(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % ONE).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${magnitude / ONE}${fraction ? `.${fraction}` : ''}`;
}

export function sum(values: readonly string[]): string {
  return decimal(values.reduce((total, value) => total + units(value), 0n));
}

/** Bitcoin as the portfolio knows it: the crypto asset with ticker BTC. */
export function isBitcoin(asset: { symbol: string | null; assetType: string }): boolean {
  return asset.assetType === 'crypto' && asset.symbol?.toUpperCase() === 'BTC';
}

/** What the account's transactions say it holds in BTC; "0" when it holds none. */
export function recordedBitcoin(portfolio: PortfolioValuation, accountId: string): string {
  return sum(
    portfolio.assets
      .filter(isBitcoin)
      .flatMap((asset) => asset.holdings)
      .filter((holding) => holding.accountId === accountId)
      .map((holding) => holding.quantity),
  );
}

export type Reconciliation =
  | { state: 'none' }
  | { state: 'pending' }
  | { state: 'match'; chain: string }
  | { state: 'differs'; chain: string; recorded: string; difference: string };

/**
 * SYNC-RECONCILE: the account's Bitcoin addresses against its transactions. Known only when
 * every address has its whole history; a partly loaded address would show a false difference.
 */
export function reconcile(
  addresses: readonly WalletAddress[],
  portfolio: PortfolioValuation,
  accountId: string,
): Reconciliation {
  const bitcoin = addresses.filter(
    (address) => address.network === 'bitcoin' && address.accountId === accountId,
  );
  if (bitcoin.length === 0) return { state: 'none' };
  const balances = bitcoin.map((address) => address.chainBalance);
  if (balances.some((balance) => balance === null)) return { state: 'pending' };
  const chain = sum(balances as string[]);
  const recorded = recordedBitcoin(portfolio, accountId);
  const difference = decimal(units(chain) - units(recorded));
  return difference === '0'
    ? { state: 'match', chain }
    : { state: 'differs', chain, recorded, difference };
}

export type AddressCheck =
  | { ok: true; address: string; kind: string }
  | { ok: false; message: string; secret?: true };

const COMING_SOON = 'Only Bitcoin can be tracked so far';

/**
 * WAL-INVALID, WAL-NO-SECRETS: a first check in the browser. The server verifies the
 * checksum; a seed phrase or a private key is refused here and never sent anywhere.
 */
export function checkBitcoinAddress(raw: string): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: 'Paste the wallet address.' };
  const words = value.split(/\s+/);
  if (words.length >= 12 && words.every((word) => /^[a-z]+$/i.test(word))) {
    return {
      ok: false,
      secret: true,
      message:
        'This looks like a seed phrase. Never share it: the app needs only the public address.',
    };
  }
  if (/^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(value)) {
    return {
      ok: false,
      secret: true,
      message:
        'This looks like a private key. Never share it: the app needs only the public address.',
    };
  }
  if (/^0x[0-9a-f]{40}$/i.test(value)) {
    return {
      ok: false,
      message: `This looks like an Ethereum address. ${COMING_SOON}; Ethereum comes next.`,
    };
  }
  if (/^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(value)) {
    return {
      ok: false,
      message:
        'Account public keys (xpub, zpub) are not supported yet. Paste one receiving address for now.',
    };
  }
  if (/^bc1[02-9ac-hj-np-z]{8,87}$/i.test(value)) {
    const address = value.toLowerCase();
    return {
      ok: true,
      address,
      kind: address.startsWith('bc1p') ? 'Taproot address' : 'Native SegWit address',
    };
  }
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value)) {
    return {
      ok: true,
      address: value,
      kind: value.startsWith('3') ? 'Script address' : 'Legacy address',
    };
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    return {
      ok: false,
      message: `This looks like a Solana address. ${COMING_SOON}.`,
    };
  }
  return {
    ok: false,
    message: 'This is not a valid Bitcoin address. Check that it was copied in full.',
  };
}

/** "bc1qar…mdq" keeps the start and end an owner compares with their wallet app. */
export function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

/** Existing account whose name matches, ignoring case and outer spaces. */
export function accountNamed<T extends { name: string }>(
  accounts: readonly T[],
  name: string,
): T | undefined {
  const wanted = name.trim().toLocaleLowerCase('en');
  return accounts.find((account) => account.name.trim().toLocaleLowerCase('en') === wanted);
}
