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
  stake: 'Stake',
  unstake: 'Unstake',
  airdrop: 'Airdrop',
  'opening-balance': 'Opening balance',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  income: 'Income',
  expense: 'Expense',
  gift: 'Gift',
  fee: 'Fee',
  other: 'Other',
  'pool-deposit': 'Pool deposit',
  'pool-withdrawal': 'Pool withdrawal',
  'pool-reward': 'Pool reward',
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
  dust: 'Dust',
};
const networkNames: Record<NonNullable<Operation['wallet']>['network'], string> = {
  bitcoin: 'Bitcoin',
  ethereum: 'Ethereum',
  solana: 'Solana',
  tron: 'Tron',
  stellar: 'Stellar',
  bybit: 'Bybit',
};

/**
 * "Recorded", or "Auto: own wallets" for a transfer the app recognised (XFER-AUTO), "Auto:
 * Bybit trade" for a Bybit spot fill it recorded as a Buy or Sell (BYBIT-TRADES), "Auto: vote
 * reward" for a Tron vote reward claim (TRON-REWARD), "Auto: Earn yield" for yield Bybit paid
 * (BYBIT-EARN).
 */
export function statusLabel(operation: Operation): string {
  if (!operation.classification?.automatic || operation.status !== 'recorded')
    return statusLabels[operation.status];
  if (operation.type === 'transfer') return 'Auto: own wallets';
  if (operation.type !== 'staking-reward') return 'Auto: Bybit trade';
  return operation.wallet?.network === 'bybit' ? 'Auto: Earn yield' : 'Auto: vote reward';
}

/** "Buy", or "Incoming" for a blockchain transaction nobody has classified yet. */
/** "Blockchain", or "Bybit" for a record read from the owner's Bybit account (M22). */
export function sourceLabel(operation: Operation): string {
  return operation.source === 'chain' && operation.wallet?.network === 'bybit'
    ? 'Bybit'
    : sourceLabels[operation.source];
}

export function typeLabel(operation: Operation): string {
  return operation.type ? typeLabels[operation.type] : directionLabels[operation.direction];
}

/** "BTC", or "USDT (Ethereum)": a token always names its blockchain (TOKEN-CHAIN). */
export function ticker(asset: OperationAsset): string {
  const name = asset.symbol ?? asset.name;
  return asset.network ? `${name} (${networkNames[asset.network]})` : name;
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
  if (wallet.network === 'bybit') return `Bybit account UID ${wallet.address}`;
  return `${networkNames[wallet.network]} wallet ${shortAddress(wallet.address)}`;
}

export function networkName(wallet: NonNullable<Operation['wallet']>): string {
  return networkNames[wallet.network];
}

/**
 * The transaction hash as the network's explorers show it: Ethereum's with 0x, Solana's
 * signature, Tron's and Stellar's hashes as is. A token transfer's record adds its leg number to the hash
 * (M14, M15), which is not part of it.
 */
export function transactionHash(operation: Operation): string | null {
  if (!operation.chain) return null;
  // A Bybit trade, internal transfer or record without a usable hash is named by Bybit's id;
  // a Bybit deposit or withdrawal on a chain keeps the chain's hash (BYBIT-DEPOSIT).
  if (operation.chain.txid.startsWith('bybit-')) return null;
  return hashOf(operation.chain.txid, operation.wallet?.network);
}

export function hashOf(
  txid: string,
  network: NonNullable<Operation['wallet']>['network'] | undefined,
): string {
  const record = recordName(txid);
  if (record) return record;
  const [hash] = txid.split('-');
  return network === 'ethereum' ? `0x${hash}` : hash;
}

/** "Trade 2100000000000000001": a Bybit record that has no blockchain hash. */
export function exchangeRecord(operation: Operation): string | null {
  return recordName(operation.chain?.txid ?? '');
}

const recordKinds: Record<string, string> = {
  trade: 'Trade',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  // BYBIT-EARN: a paid yield, named by its product kind and Bybit's id.
  earn: 'Earn yield',
  // BYBIT-CONVERT: a convert, stored as a trade.
  convert: 'Convert',
};

function recordName(txid: string): string | null {
  // BYBIT-COUNT-GAP: a difference the owner counted, not a record Bybit has.
  if (/^bybit-(?:deposit|withdrawal)-gap-/.test(txid)) return 'Balance difference';
  const match =
    /^bybit-(?:trade-(convert)-|(trade|deposit|withdrawal|earn)-(?:internal-|flexible-|onchain-)?)(.+)$/.exec(
      txid,
    );
  return match ? `${recordKinds[match[1] ?? match[2]]} ${match[3]}` : null;
}

// Free public explorers; a network without one (an exchange account) gets no link.
const explorers: Partial<Record<string, (hash: string) => string>> = {
  bitcoin: (hash) => `https://mempool.space/tx/${hash}`,
  ethereum: (hash) => `https://etherscan.io/tx/${hash}`,
  solana: (hash) => `https://solscan.io/tx/${hash}`,
  tron: (hash) => `https://tronscan.org/#/transaction/${hash}`,
  stellar: (hash) => `https://stellar.expert/explorer/public/tx/${hash}`,
};

/** The transaction's page on its network's block explorer, or null when there is none. */
export function explorerUrl(hash: string, network: string | undefined): string | null {
  const page = network ? explorers[network] : undefined;
  return page && /^(0x)?[0-9A-Za-z]+$/.test(hash) ? page(hash) : null;
}

/** Where the operation happened: an account, two for a transfer, or a wallet. */
export function placeLabel(operation: Operation): string {
  // XFER-AUTO: a transfer between wallets names both, a blockchain one included.
  if (operation.type === 'transfer' && operation.account && operation.counterAccount)
    return `${operation.account.name} → ${operation.counterAccount.name}`;
  // CLS-SWAP: paid from one wallet, received in another; within one wallet, just that wallet.
  if (operation.type === 'swap' && operation.wallet && operation.account)
    return operation.counterAccount
      ? `${operation.counterAccount.name} → ${operation.account.name}`
      : operation.account.name;
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
