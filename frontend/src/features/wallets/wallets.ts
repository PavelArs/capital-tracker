import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import type { ChainBalance, WalletAddress } from '@api/wallet-addresses.api';
import { networkOf } from './networks';

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
  return isCoin(asset, 'BTC');
}

/** A chain asset as the portfolio knows it: the crypto asset with that ticker. */
export function isCoin(asset: { symbol: string | null; assetType: string }, symbol: string) {
  return asset.assetType === 'crypto' && asset.symbol?.toUpperCase() === symbol;
}

/** What the account's transactions say it holds of a coin; "0" when it holds none. */
export function recordedCoin(
  portfolio: PortfolioValuation,
  accountId: string,
  symbol: string,
): string {
  return sum(
    portfolio.assets
      .filter((asset) => isCoin(asset, symbol))
      .flatMap((asset) => asset.holdings)
      .filter((holding) => holding.accountId === accountId)
      .map((holding) => holding.quantity),
  );
}

/** Every asset's balance on the chain, the network's own coin first; null until synced. */
export function chainBalances(address: WalletAddress): ChainBalance[] | null {
  if (address.balances) return address.balances;
  return address.chainBalance === null
    ? null
    : [{ symbol: networkOf(address).symbol, quantity: address.chainBalance }];
}

/** The latest price of each crypto ticker in the portfolio's currency. */
export function pricesOf(portfolio: PortfolioValuation | null): Map<string, string> {
  const prices = new Map<string, string>();
  for (const asset of portfolio?.assets ?? []) {
    const symbol = asset.symbol?.toUpperCase();
    if (asset.assetType === 'crypto' && symbol && asset.price && !prices.has(symbol))
      prices.set(symbol, asset.price.value);
  }
  return prices;
}

export interface AssetDifference {
  symbol: string;
  chain: string;
  recorded: string;
  difference: string;
  /** The balance is what an exchange reports (M22, BYBIT-GAPS), not a blockchain. */
  exchange: boolean;
}

export type Reconciliation =
  | { state: 'none' }
  | { state: 'pending' }
  | { state: 'match' }
  | { state: 'differs'; assets: AssetDifference[] };

/**
 * SYNC-RECONCILE: the account's addresses against its transactions, asset by asset (BTC; ETH,
 * USDT and USDC). Known only when every address has its whole history; a partly loaded
 * address would show a false difference.
 */
export function reconcile(
  addresses: readonly WalletAddress[],
  portfolio: PortfolioValuation,
  accountId: string,
): Reconciliation {
  const own = addresses.filter((address) => address.accountId === accountId);
  if (own.length === 0) return { state: 'none' };
  const balances = own.map(chainBalances);
  if (balances.some((balance) => balance === null)) return { state: 'pending' };
  const symbols = [...new Set(own.flatMap((address) => networkOf(address).assets))];
  const assets = symbols.flatMap((symbol) => {
    const chain = sum(
      (balances as ChainBalance[][])
        .flat()
        .filter((balance) => balance.symbol === symbol)
        .map((balance) => balance.quantity),
    );
    const recorded = recordedCoin(portfolio, accountId, symbol);
    const difference = decimal(units(chain) - units(recorded));
    const exchange = own.every((address) => networkOf(address).exchange === true);
    return difference === '0' ? [] : [{ symbol, chain, recorded, difference, exchange }];
  });
  return assets.length === 0 ? { state: 'match' } : { state: 'differs', assets };
}

export type AddressCheck =
  | { ok: true; address: string; kind: string }
  | { ok: false; message: string; secret?: true };

const SEED_PHRASE =
  'This looks like a seed phrase. Never share it: the app needs only the public address.';
const PRIVATE_KEY =
  'This looks like a private key. Never share it: the app needs only the public address.';

/** A seed phrase or a private key in any network's address field (WAL-NO-SECRETS). */
function secretCheck(value: string): AddressCheck | null {
  const words = value.split(/\s+/);
  if (words.length >= 12 && words.every((word) => /^[a-z]+$/i.test(word)))
    return { ok: false, secret: true, message: SEED_PHRASE };
  if (
    /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(value) ||
    /^(0x)?[0-9a-f]{64}$/i.test(value) ||
    // An extended private key (xprv, yprv, zprv and their testnet forms) can spend the account.
    /^[xyztuv]prv[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(value) ||
    // A Stellar secret seed, "S…".
    /^S[A-Z2-7]{55}$/.test(value)
  )
    return { ok: false, secret: true, message: PRIVATE_KEY };
  // A Solana secret key: 64 bytes in base58, or the byte array a keypair file holds.
  if (base58Length(value) === 64 || /^\[\s*\d{1,3}(\s*,\s*\d{1,3}){63}\s*\]$/.test(value))
    return { ok: false, secret: true, message: PRIVATE_KEY };
  return null;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** How many bytes a base58 text encodes; null when it is not base58. */
function base58Length(value: string): number | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{1,100}$/.test(value)) return null;
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(BASE58.indexOf(character));
  const zeros = value.length - value.replace(/^1+/, '').length;
  const hex = number === 0n ? '' : number.toString(16);
  return zeros + Math.ceil(hex.length / 2);
}

/**
 * WAL-INVALID, WAL-NO-SECRETS: a first check in the browser. The server verifies the
 * checksum; a seed phrase or a private key is refused here and never sent anywhere.
 */
export type KeyCheck = { ok: true; value: string } | { ok: false; message: string; secret?: true };

/**
 * BYBIT-KEY (M22): Bybit's API key and secret are letters and digits. A seed phrase or a
 * private key pasted here is refused like in an address field (WAL-NO-SECRETS).
 */
export function checkApiKey(raw: string, part: 'key' | 'secret'): KeyCheck {
  const value = raw.trim();
  const name = part === 'key' ? 'API key' : 'API secret';
  if (!value) return { ok: false, message: `Paste the ${name}.` };
  const secret = secretCheck(value);
  if (secret && !secret.ok)
    return {
      ok: false,
      secret: true,
      message: secret.message.replace('the public address', 'a read-only API key'),
    };
  const pattern = part === 'key' ? /^[0-9A-Za-z]{10,64}$/ : /^[0-9A-Za-z]{10,128}$/;
  if (!pattern.test(value))
    return {
      ok: false,
      message: `This is not a Bybit ${name}: it has only letters and digits. Copy it again from Bybit.`,
    };
  return { ok: true, value };
}

export function checkAddress(network: WalletAddress['network'], raw: string): AddressCheck {
  if (network === 'solana') return checkSolanaAddress(raw);
  if (network === 'tron') return checkTronAddress(raw);
  if (network === 'stellar') return checkStellarAddress(raw);
  return network === 'ethereum' ? checkEthereumAddress(raw) : checkBitcoinAddress(raw);
}

/** A Tron address as wallet apps show it: "T…", 25 bytes in base58check. */
const looksTron = (value: string) =>
  /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value) && base58Length(value) === 25;

/** A Stellar account ID: "G…", 56 characters of base32. */
const looksStellar = (value: string) => /^G[A-Z2-7]{55}$/.test(value);

const otherNetwork = (network: string, other: string) =>
  `This is not a ${network} address: it looks like a${other === 'Ethereum' ? 'n' : ''} ${other} address. Go back and pick ${other} to track it.`;

/** TRON-ADD: the server verifies the checksum; the hex form is refused with a hint. */
export function checkTronAddress(raw: string): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: 'Paste the wallet address.' };
  const secret = secretCheck(value);
  if (secret) return secret;
  // Base58 is case-sensitive: the address is kept exactly as pasted.
  if (looksTron(value)) return { ok: true, address: value, kind: 'Tron address' };
  if (/^41[0-9a-f]{40}$/i.test(value))
    return {
      ok: false,
      message: 'This is the hex form of a Tron address. Paste the address that starts with T.',
    };
  if (/^0x[0-9a-f]{40}$/i.test(value))
    return { ok: false, message: otherNetwork('Tron', 'Ethereum') };
  if (looksStellar(value)) return { ok: false, message: otherNetwork('Tron', 'Stellar') };
  if (/^bc1[02-9ac-hj-np-z]{8,87}$/i.test(value) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value))
    return { ok: false, message: otherNetwork('Tron', 'Bitcoin') };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && base58Length(value) === 32)
    return { ok: false, message: otherNetwork('Tron', 'Solana') };
  return {
    ok: false,
    message: 'This is not a valid Tron address. Check that it was copied in full.',
  };
}

/** STELLAR-ADD: the server verifies the checksum; a muxed exchange address is refused here. */
export function checkStellarAddress(raw: string): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: 'Paste the wallet address.' };
  const secret = secretCheck(value);
  if (secret) return secret;
  if (looksStellar(value)) return { ok: true, address: value, kind: 'Stellar account' };
  if (/^M[A-Z2-7]{68}$/.test(value))
    return {
      ok: false,
      message:
        'This is a muxed address, used by exchanges for one customer. Paste the account address that starts with G.',
    };
  if (looksTron(value)) return { ok: false, message: otherNetwork('Stellar', 'Tron') };
  if (/^0x[0-9a-f]{40}$/i.test(value))
    return { ok: false, message: otherNetwork('Stellar', 'Ethereum') };
  if (/^bc1[02-9ac-hj-np-z]{8,87}$/i.test(value) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value))
    return { ok: false, message: otherNetwork('Stellar', 'Bitcoin') };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && base58Length(value) === 32)
    return { ok: false, message: otherNetwork('Stellar', 'Solana') };
  return {
    ok: false,
    message: 'This is not a valid Stellar address. Check that it was copied in full.',
  };
}

export function checkSolanaAddress(raw: string): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: 'Paste the wallet address.' };
  const secret = secretCheck(value);
  if (secret) return secret;
  // Base58 is case-sensitive: the address is kept exactly as pasted.
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && base58Length(value) === 32)
    return { ok: true, address: value, kind: 'Solana address' };
  if (/^0x[0-9a-f]{40}$/i.test(value))
    return {
      ok: false,
      message:
        'This is not a Solana address: it looks like an Ethereum address. Go back and pick Ethereum to track it.',
    };
  if (looksTron(value)) return { ok: false, message: otherNetwork('Solana', 'Tron') };
  if (looksStellar(value)) return { ok: false, message: otherNetwork('Solana', 'Stellar') };
  if (/^bc1[02-9ac-hj-np-z]{8,87}$/i.test(value) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value))
    return {
      ok: false,
      message:
        'This is not a Solana address: it looks like a Bitcoin address. Go back and pick Bitcoin to track it.',
    };
  return {
    ok: false,
    message: 'This is not a valid Solana address. Check that it was copied in full.',
  };
}

export function checkEthereumAddress(raw: string): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: 'Paste the wallet address.' };
  const secret = secretCheck(value);
  if (secret) return secret;
  // The server checks the EIP-55 checksum of a mixed-case address.
  if (/^0x[0-9a-f]{40}$/i.test(value))
    return { ok: true, address: value.toLowerCase(), kind: 'Ethereum address' };
  if (looksTron(value)) return { ok: false, message: otherNetwork('Ethereum', 'Tron') };
  if (looksStellar(value)) return { ok: false, message: otherNetwork('Ethereum', 'Stellar') };
  if (/^bc1[02-9ac-hj-np-z]{8,87}$/i.test(value) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value))
    return {
      ok: false,
      message:
        'This is not an Ethereum address: it looks like a Bitcoin address. Go back and pick Bitcoin to track it.',
    };
  return {
    ok: false,
    message: 'This is not a valid Ethereum address. Check that it was copied in full.',
  };
}

export function checkBitcoinAddress(raw: string): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: 'Paste the wallet address.' };
  const secret = secretCheck(value);
  if (secret) return secret;
  if (/^0x[0-9a-f]{40}$/i.test(value)) {
    return {
      ok: false,
      message: 'This looks like an Ethereum address. Go back and pick Ethereum to track it.',
    };
  }
  // M21: the server verifies the key's checksum and derives the account's addresses.
  if (/^[xyz]pub[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(value)) {
    return {
      ok: true,
      address: value,
      kind: 'Account public key · every address of this account will be tracked',
    };
  }
  if (/^[tuv]pub[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(value)) {
    return {
      ok: false,
      message: 'Testnet keys are not tracked. Paste the key of a Bitcoin mainnet account.',
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
  if (looksTron(value)) {
    return {
      ok: false,
      message: 'This looks like a Tron address. Go back and pick Tron to track it.',
    };
  }
  if (looksStellar(value)) {
    return {
      ok: false,
      message: 'This looks like a Stellar address. Go back and pick Stellar to track it.',
    };
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    return {
      ok: false,
      message: 'This looks like a Solana address. Go back and pick Solana to track it.',
    };
  }
  return {
    ok: false,
    message: 'This is not a valid Bitcoin address. Check that it was copied in full.',
  };
}

/** "5 addresses": how many addresses of an account key have been used; null for one address. */
export function keyAddresses(address: Pick<WalletAddress, 'accountKey'>): string | null {
  const used = address.accountKey?.usedAddresses;
  if (used === undefined) return null;
  return `${used} address${used === 1 ? '' : 'es'}`;
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
