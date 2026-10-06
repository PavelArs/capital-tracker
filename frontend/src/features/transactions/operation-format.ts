import type { Operation, OperationAsset, OperationType } from '@api/operations.api';
import { DASH, quantity } from '../portfolio/format';

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
  income: 'Income',
  expense: 'Expense',
  gift: 'Gift',
  fee: 'Fee',
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
  hidden: 'Hidden',
};
const networkNames: Record<NonNullable<Operation['wallet']>['network'], string> = {
  bitcoin: 'Bitcoin',
};

/** "Recorded", or "Auto: own wallets" for a transfer the app recognised (XFER-AUTO). */
export function statusLabel(operation: Operation): string {
  return operation.classification?.automatic && operation.status === 'recorded'
    ? 'Auto: own wallets'
    : statusLabels[operation.status];
}

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

export function amount(value: string, asset: OperationAsset, sign: '+' | '-' | '' = ''): string {
  return `${sign}${quantity(value)} ${ticker(asset)}`;
}

function sign(operation: Operation): '+' | '-' | '' {
  if (operation.type === 'swap') return '-';
  return operation.direction === 'in' ? '+' : operation.direction === 'out' ? '-' : '';
}

/** "+0.5 BTC" for what arrives, "-0.5 BTC" for what leaves, unsigned when it stays yours. */
export function signedAmount(operation: Operation): string {
  return amount(operation.quantity, operation.asset, sign(operation));
}

/** The list's amount column: the asset column already names the coin. */
export function signedQuantity(operation: Operation): string {
  return `${sign(operation)}${quantity(operation.quantity)}`;
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
  // XFER-AUTO: a transfer between wallets names both, a blockchain one included.
  if (operation.type === 'transfer' && operation.account && operation.counterAccount)
    return `${operation.account.name} → ${operation.counterAccount.name}`;
  // A chain row of an address in a wallet shows the wallet, then the address's own name.
  if (operation.wallet && operation.account)
    return `${operation.account.name} · ${operation.wallet.label ?? shortAddress(operation.wallet.address)}`;
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

/** The time under a row's type; a transaction entered without one says so (M9 stores 00:00). */
export function rowTime(operation: Operation): string {
  const at = operation.occurredAt;
  if (operation.kind !== 'chain' && at.endsWith('T00:00:00.000Z')) return 'No time';
  return timeFormat.format(new Date(at));
}

/** The UTC day a row is listed under: Today, Yesterday or "Oct 2, 2026". */
export function dayHeading(iso: string, now: string): string {
  const days = Math.round(
    (Date.parse(now.slice(0, 10)) - Date.parse(iso.slice(0, 10))) / 86_400_000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return day(iso);
}

export function moment(iso: string): string {
  return `${day(iso)}, ${time(iso)}`;
}

export { DASH };
