import type { Operation, OperationAsset, OperationType } from '@api/operations.api';
import { DASH, money, quantity } from '../portfolio/format';

// Display only: the list keeps exact decimal strings; rounding happens here (OPS-4).
export const typeLabels: Record<OperationType, string> = {
  buy: 'Buy',
  sell: 'Sell',
  transfer: 'Transfer',
  swap: 'Swap',
  reward: 'Reward',
  'staking-reward': 'Staking reward',
  airdrop: 'Airdrop',
  'opening-balance': 'Opening balance',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
};
const directionLabels: Record<Operation['direction'], string> = {
  in: 'Incoming',
  out: 'Outgoing',
  internal: 'Between own addresses',
};
export const sourceLabels: Record<Operation['source'], string> = {
  manual: 'Manual',
  csv: 'CSV',
  chain: 'Blockchain',
};
export const statusLabels: Record<Operation['status'], string> = {
  recorded: 'Recorded',
  'needs-classification': 'Needs classification',
};
const networkNames: Record<NonNullable<Operation['wallet']>['network'], string> = {
  bitcoin: 'Bitcoin',
};

/** "Buy", or "Incoming" for a blockchain transaction nobody has classified yet. */
export function typeLabel(operation: Operation): string {
  return operation.type ? typeLabels[operation.type] : directionLabels[operation.direction];
}

export function ticker(asset: OperationAsset): string {
  return asset.symbol ?? asset.name;
}

/** Filter key: tickers group chain and journal rows of one coin; nameless assets by id. */
export function assetKey(asset: OperationAsset): string {
  return asset.symbol ? asset.symbol.toUpperCase() : `id:${asset.instrumentId ?? asset.name}`;
}

/** The list keeps the USD recorded on each operation; other currencies are a follow-up. */
export function usd(value: string | null): string {
  return money(value, 'USD');
}

export function amount(value: string, asset: OperationAsset, sign: '+' | '-' | '' = ''): string {
  return `${sign}${quantity(value)} ${ticker(asset)}`;
}

/** "+0.5 BTC" for what arrives, "-0.5 BTC" for what leaves, unsigned when it stays yours. */
export function signedAmount(operation: Operation): string {
  const sign = operation.direction === 'in' ? '+' : operation.direction === 'out' ? '-' : '';
  return amount(operation.quantity, operation.asset, operation.type === 'swap' ? '-' : sign);
}

export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function walletLabel(wallet: NonNullable<Operation['wallet']>): string {
  return `${networkNames[wallet.network]} wallet ${shortAddress(wallet.address)}`;
}

export function networkName(wallet: NonNullable<Operation['wallet']>): string {
  return networkNames[wallet.network];
}

/** Where the operation happened: an account, two for a transfer, or a wallet. */
export function placeLabel(operation: Operation): string {
  if (operation.wallet) return walletLabel(operation.wallet);
  if (operation.account && operation.counterAccount)
    return `${operation.account.name} → ${operation.counterAccount.name}`;
  return operation.account?.name ?? 'Whole portfolio';
}

const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
});

/** Dates and times are shown in UTC, as stored. */
export function day(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function time(iso: string): string {
  return `${timeFormat.format(new Date(iso))} UTC`;
}

export function moment(iso: string): string {
  return `${day(iso)}, ${time(iso)}`;
}

export { DASH };
