import type { InternalTransfer, NormalTransaction } from './etherscan-client';

// ETH-STAKE-*: pooled staking contracts of the Kiln on-chain kind (the ocsETH token, for one).
// stake() takes ether and gives the wallet the pool's token; balanceOfUnderlying(address) says
// how much ether that token is worth now, which grows with the rewards. An exit is claimed back
// as ether sent to the wallet inside a transaction the wallet sends to the pool.

/** stake(): the deposit call. */
export const STAKE_SELECTOR = '0x3a4b66f1';
const BALANCE_OF_UNDERLYING = '0x3af9e669';
const SYMBOL = '0x95d89b41';

/** One transaction the wallet sent, with the ether contracts moved inside it. */
export interface EtherTransaction {
  tx: NormalTransaction;
  inner: InternalTransfer[];
}

/** ETH-STAKE-MOVE: ether a transaction put into a pool (positive) or got back (negative). */
export interface EtherStakeMove {
  /** The hash without 0x, as the transaction's ether leg is stored. */
  txid: string;
  contract: string;
  blockHeight: number;
  blockTime: string;
  units: bigint;
}

const word = (hex: string) => hex.padStart(64, '0');

/** Call data of balanceOfUnderlying(holder). */
export function balanceOfUnderlyingCall(holder: string): string {
  return `${BALANCE_OF_UNDERLYING}${word(holder.slice(2))}`;
}

/** Call data of symbol(). */
export function symbolCall(): string {
  return SYMBOL;
}

/** One unsigned word, or null for any other answer: the contract has no such function. */
export function readUint(data: string | null): bigint | null {
  return data !== null && /^0x[0-9a-f]{64}$/.test(data) ? BigInt(data) : null;
}

const symbolPattern = /^[A-Za-z0-9.]{1,16}$/;

/**
 * The token symbol of an ABI string answer (or a bytes32 one, as older tokens give); null when
 * there is none or it is not a plain ticker, which is then never shown.
 */
export function readSymbol(data: string | null): string | null {
  if (data === null || !/^0x([0-9a-f]{64})+$/.test(data)) return null;
  const hex = data.slice(2);
  const at = (index: number) => hex.slice(index * 64, (index + 1) * 64);
  let bytes: string;
  if (hex.length === 64) {
    bytes = at(0).replace(/(00)+$/, '');
  } else {
    const offset = Number.parseInt(at(0), 16);
    if (offset !== 32 || hex.length < 128) return null;
    const length = Number.parseInt(at(1), 16);
    if (length > 32 || hex.length < 128 + length * 2) return null;
    bytes = hex.slice(128, 128 + length * 2);
  }
  const text = Buffer.from(bytes, 'hex').toString('latin1');
  return symbolPattern.test(text) ? text : null;
}

/** The transactions the address sent in the given lists, each with its internal transfers. */
export function etherTransactions(
  address: string,
  normal: readonly NormalTransaction[],
  internal: readonly InternalTransfer[],
): EtherTransaction[] {
  const byHash = new Map<string, EtherTransaction>();
  for (const tx of normal) if (tx.from === address) byHash.set(tx.hash, { tx, inner: [] });
  for (const item of internal) byHash.get(item.hash)?.inner.push(item);
  return [...byHash.values()];
}

const input = (tx: NormalTransaction) =>
  typeof tx.raw.input === 'string' ? tx.raw.input.toLowerCase() : '';

/** ETH-STAKE-FIND: the contract a successful stake() deposit went to; null for anything else. */
export function stakeTarget(address: string, tx: NormalTransaction): string | null {
  return tx.from === address &&
    !tx.failed &&
    tx.value > 0n &&
    tx.to !== '' &&
    input(tx).startsWith(STAKE_SELECTOR)
    ? tx.to
    : null;
}

/**
 * ETH-STAKE-MOVE: what the address's transactions to its known pools moved in or out. A
 * deposit is the ether sent with stake(); ether that arrives inside a transaction the address
 * sent to the pool (a claimed exit) came back out of it.
 */
export function etherStakeMoves(
  address: string,
  transactions: readonly EtherTransaction[],
  pools: ReadonlySet<string>,
): EtherStakeMove[] {
  const moves: EtherStakeMove[] = [];
  for (const { tx, inner } of transactions) {
    if (tx.from !== address || tx.failed || !pools.has(tx.to)) continue;
    const deposited = stakeTarget(address, tx) ? tx.value : 0n;
    const returned = inner
      .filter((item) => !item.failed && item.to === address && item.from !== address)
      .reduce((total, item) => total + item.value, 0n);
    const units = deposited - returned;
    if (units === 0n) continue;
    moves.push({
      txid: tx.hash.slice(2),
      contract: tx.to,
      blockHeight: tx.blockNumber,
      blockTime: new Date(tx.timeStamp * 1000).toISOString(),
      units,
    });
  }
  return moves.sort(
    (left, right) => left.blockHeight - right.blockHeight || left.txid.localeCompare(right.txid),
  );
}
