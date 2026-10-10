import { chainAssets } from './chain-assets';
import type { TokenFacts } from './chain-tokens';
import type { Direction } from './esplora-client';
import {
  ETHERSCAN_PAGE_SIZE,
  type InternalTransfer,
  type NormalTransaction,
  type TokenTransfer,
} from './etherscan-client';
import { type EvmNetwork, evmNetworks } from './evm-chains';

// track-ethereum-wallets (M14, ETH-IDENTITY): what one block range of an address's history
// stores. Each transaction hash has at most one leg in ether (the transaction itself, the
// ether contracts moved inside it and the fee) and one leg per ERC-20 transfer event: USDT and
// USDC by ticker, any other token by its contract (TOKEN-ANY, M25).

/** One raw leg as wallet_address_transactions stores it. */
export interface EthereumLeg {
  /** The hash without 0x; a token leg adds "-" and the event's index. */
  txid: string;
  /** Null for ether, the ticker of USDT or USDC, else the token's contract. */
  asset: string | null;
  blockHeight: number;
  blockHash: string | null;
  blockTime: string;
  receivedUnits: bigint;
  sentUnits: bigint;
  feeUnits: bigint;
  direction: Direction;
  raw: Record<string, unknown>;
}

// EVM-MULTICHAIN: USDT and USDC are different contracts on each chain.
const tokensByContract = new Map<EvmNetwork, Map<string, string>>(
  evmNetworks.map((network) => [
    network,
    new Map(
      chainAssets
        .filter((asset) => asset.network === network && asset.contract)
        .map((asset) => [asset.contract as string, asset.token as string]),
    ),
  ]),
);

const bare = (hash: string) => hash.slice(2);

/** What a leg names its token by: USDT and USDC by ticker, any other token by its contract. */
export const tokenAsset = (contract: string, network: EvmNetwork = 'ethereum'): string =>
  tokensByContract.get(network)?.get(contract) ?? contract;

/**
 * TOKEN-ANY: what Etherscan's transfers say about each token other than USDT and USDC, from the
 * first transfer of each contract. A transfer without readable decimals gives NaN, which leaves
 * the token out.
 */
export function ethereumTokenFacts(
  tokens: readonly TokenTransfer[],
  network: EvmNetwork = 'ethereum',
): TokenFacts[] {
  const facts = new Map<string, TokenFacts>();
  for (const item of tokens) {
    if (tokensByContract.get(network)?.has(item.contract) || facts.has(item.contract)) continue;
    const decimals = item.raw.tokenDecimal;
    facts.set(item.contract, {
      network,
      contract: item.contract,
      symbol: typeof item.raw.tokenSymbol === 'string' ? item.raw.tokenSymbol : null,
      name: typeof item.raw.tokenName === 'string' ? item.raw.tokenName : null,
      decimals:
        typeof decimals === 'string' && /^[0-9]{1,2}$/.test(decimals)
          ? Number(decimals)
          : Number.NaN,
    });
  }
  return [...facts.values()];
}
const at = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * The last block of [from, to] whose items every list returned in full: a list that filled
 * its page may continue in the block of its last item, so that block waits for the next range.
 * Null when one block alone fills a page, which this reading cannot split.
 */
export function rangeEnd(
  from: number,
  to: number,
  lists: readonly (readonly { blockNumber: number }[])[],
): number | null {
  let end = to;
  for (const list of lists) {
    if (list.length < ETHERSCAN_PAGE_SIZE) continue;
    end = Math.min(end, list[list.length - 1].blockNumber - 1);
  }
  return end >= from ? end : null;
}

/** Legs of the address's transactions in the given lists, oldest first. */
export function ethereumLegs(
  address: string,
  normal: readonly NormalTransaction[],
  internal: readonly InternalTransfer[],
  tokens: readonly TokenTransfer[],
  network: EvmNetwork = 'ethereum',
): EthereumLeg[] {
  const legs: EthereumLeg[] = [];
  const hashes = new Map<
    string,
    { tx: NormalTransaction | null; inner: InternalTransfer[]; block: number; time: number }
  >();
  const group = (hash: string, block: number, time: number) => {
    const found = hashes.get(hash) ?? { tx: null, inner: [], block, time };
    hashes.set(hash, found);
    return found;
  };
  for (const tx of normal) group(tx.hash, tx.blockNumber, tx.timeStamp).tx = tx;
  for (const item of internal) group(item.hash, item.blockNumber, item.timeStamp).inner.push(item);
  for (const [hash, { tx, inner, block, time }] of hashes) {
    let received = 0n;
    let sent = 0n;
    let fee = 0n;
    if (tx) {
      if (tx.from === address) fee = tx.fee;
      if (!tx.failed && tx.from === address) sent += tx.value;
      if (!tx.failed && tx.to === address) received += tx.value;
    }
    for (const item of inner) {
      if (item.failed) continue;
      if (item.from === address) sent += item.value;
      if (item.to === address) received += item.value;
    }
    // A reverted or zero-value transaction someone else sent changes nothing here.
    if (received === 0n && sent === 0n && fee === 0n) continue;
    const self = tx !== null && tx.from === address && tx.to === address;
    legs.push({
      txid: bare(hash),
      asset: null,
      blockHeight: block,
      blockHash: tx ? bare(tx.blockHash) : null,
      blockTime: at(time),
      receivedUnits: received,
      // The fee leaves the address with the value, as on Bitcoin.
      sentUnits: sent + fee,
      feeUnits: fee,
      direction: self ? 'self' : received > sent + fee ? 'in' : 'out',
      raw: {
        txid: bare(hash),
        hash,
        transaction: tx?.raw ?? null,
        internal: inner.map((item) => item.raw),
      },
    });
  }
  // Zero-value transfers (address poisoning) move nothing.
  const moving = tokens.filter(
    (item) => item.value > 0n && (item.from === address || item.to === address),
  );
  const byHash = new Map<string, TokenTransfer[]>();
  for (const item of moving) byHash.set(item.hash, [...(byHash.get(item.hash) ?? []), item]);
  for (const [hash, items] of byHash) {
    // The event index is the transfer's identity on both sides. Without it the transfers of a
    // hash are numbered in an order that does not depend on the provider's.
    const indexed = items.every((item) => item.logIndex !== null);
    const ordered = indexed
      ? items
      : [...items].sort(
          (left, right) =>
            left.contract.localeCompare(right.contract) ||
            left.from.localeCompare(right.from) ||
            left.to.localeCompare(right.to) ||
            (left.value < right.value ? -1 : left.value > right.value ? 1 : 0),
        );
    const seen = new Set<number>();
    ordered.forEach((item, position) => {
      const leg = indexed ? (item.logIndex as number) : position;
      if (seen.has(leg)) return;
      seen.add(leg);
      const txid = `${bare(hash)}-${leg}`;
      const received = item.to === address ? item.value : 0n;
      const sent = item.from === address ? item.value : 0n;
      legs.push({
        txid,
        asset: tokenAsset(item.contract, network),
        blockHeight: item.blockNumber,
        blockHash: bare(item.blockHash),
        blockTime: at(item.timeStamp),
        receivedUnits: received,
        sentUnits: sent,
        feeUnits: 0n,
        direction: received > 0n && sent > 0n ? 'self' : received > 0n ? 'in' : 'out',
        raw: { txid, hash, transfer: item.raw },
      });
    });
  }
  return legs.sort(
    (left, right) => left.blockHeight - right.blockHeight || left.txid.localeCompare(right.txid),
  );
}
