import { createHash } from 'node:crypto';
import { networkAssets } from './chain-assets';
import type { TokenFacts } from './chain-tokens';
import type { Direction } from './esplora-client';
import type { SolanaTransaction, TokenBalance } from './solana-rpc-client';

// track-solana-wallets (M15, SOL-IDENTITY): what one finalized transaction changed for a wallet.
// The SOL leg is the wallet's lamport change with the fee it paid as fee payer; each token leg
// is the change of every token account the wallet owns in one mint: USDT, USDC and, since M25
// (TOKEN-ANY), any other token. Balances, not instructions, decide the amounts, so a failed
// transaction keeps only its fee.

/** One raw leg as wallet_address_transactions stores it. */
export interface SolanaLeg {
  /** The signature; a token leg adds "-" and the token's number (tokenLegNumber). */
  txid: string;
  /** Null for SOL, the ticker of USDT or USDC, else the token's mint. */
  asset: string | null;
  /** The slot. */
  blockHeight: number;
  blockHash: null;
  blockTime: string;
  receivedUnits: bigint;
  sentUnits: bigint;
  feeUnits: bigint;
  direction: Direction;
  raw: Record<string, unknown>;
}

const tokens = networkAssets('solana').flatMap((asset, number) =>
  asset.token && asset.contract ? [{ token: asset.token, mint: asset.contract, number }] : [],
);

/** The SPL mints followed before M25: USDT and USDC (Q7). */
export const solanaMints = tokens.map((token) => token.mint);

/** What a leg names its token by: USDT and USDC by ticker, any other token by its mint. */
export const solanaTokenAsset = (mint: string): string =>
  tokens.find((token) => token.mint === mint)?.token ?? mint;

// Mints other than USDT and USDC hash into 3..999999998; one more is the highest number a
// disambiguated leg can take, and the stored txid accepts nine digits.
const HASHED_NUMBERS = 999_999_996;
const MAX_LEG_NUMBER = 3 + HASHED_NUMBERS;

/**
 * The number a token's leg adds to the signature. Both sides of a transfer between own wallets
 * name the same movement alike (M13 links legs by identity): USDT and USDC keep their position
 * among the network's assets (1, 2); any other mint takes a number from its own bytes, from 3
 * up to nine digits, which the stored txid accepts.
 */
export function tokenLegNumber(mint: string): number {
  const builtIn = tokens.find((token) => token.mint === mint);
  if (builtIn) return builtIn.number;
  return 3 + (createHash('sha256').update(mint).digest().readUInt32BE(0) % HASHED_NUMBERS);
}

/**
 * The number each of the given mints (the ones a wallet has a leg for in one transaction) adds
 * to the signature. It is the mint's own tokenLegNumber unless another of the mints has the same
 * one (a 30-bit number can be made to collide on purpose, and the second leg would then be
 * dropped as already stored). Of mints with the same number the one that comes first in the
 * list keeps it, as the stored leg of an earlier import does, since the first leg stored under a
 * txid is the one that stayed; each other takes the next number that is neither kept nor the own
 * number of any listed mint, so a mint that clashes with nobody never loses its number and a
 * leg stored before this change is found again under its old txid. A transaction without a
 * clash keeps the numbers it has always had.
 */
export function tokenLegNumbers(
  mints: readonly string[],
  numberOf: (mint: string) => number = tokenLegNumber,
): Map<string, number> {
  const ranked = [...new Set(mints)]
    .map((mint) => [mint, numberOf(mint)] as const)
    .sort(([, leftNumber], [, rightNumber]) => leftNumber - rightNumber);
  const own = new Set(ranked.map(([, number]) => number));
  const numbers = new Map<string, number>();
  const kept = new Set<number>();
  const displaced: (readonly [string, number])[] = [];
  for (const entry of ranked) {
    if (kept.has(entry[1])) displaced.push(entry);
    else {
      kept.add(entry[1]);
      numbers.set(entry[0], entry[1]);
    }
  }
  for (const [mint, natural] of displaced) {
    let number = natural;
    do number = number >= MAX_LEG_NUMBER ? 3 : number + 1;
    while (kept.has(number) || own.has(number));
    kept.add(number);
    numbers.set(mint, number);
  }
  return numbers;
}

/** TOKEN-ANY: the decimals each token other than USDT and USDC shows in the transactions. */
export function solanaTokenFacts(
  transactions: readonly SolanaTransaction[],
  legs: readonly SolanaLeg[],
): TokenFacts[] {
  // Only the tokens the wallet itself moved: others' balances in the same transaction are not
  // its business.
  const moved = new Set(legs.map((leg) => leg.asset));
  const facts = new Map<string, TokenFacts>();
  for (const tx of transactions) {
    for (const balance of [...tx.preTokenBalances, ...tx.postTokenBalances]) {
      if (!moved.has(balance.mint) || solanaMints.includes(balance.mint) || facts.has(balance.mint))
        continue;
      facts.set(balance.mint, {
        network: 'solana',
        contract: balance.mint,
        symbol: null,
        name: null,
        decimals: balance.decimals,
      });
    }
  }
  return [...facts.values()];
}

/** What the wallet holds of each mint in one list of token balances, in one pass. */
function heldByMint(
  balances: readonly TokenBalance[],
  owns: (balance: TokenBalance) => boolean,
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const balance of balances)
    if (owns(balance)) totals.set(balance.mint, (totals.get(balance.mint) ?? 0n) + balance.amount);
  return totals;
}

/**
 * The legs of one transaction for the wallet `address`. `tokenAccounts` are the wallet's own
 * token accounts, for transactions whose token balances do not name their owner.
 */
export function solanaLegs(
  address: string,
  tokenAccounts: ReadonlySet<string>,
  tx: SolanaTransaction,
): SolanaLeg[] {
  const blockTime = new Date(tx.blockTime * 1000).toISOString();
  const raw = (txid: string) => ({ txid, signature: tx.signature, transaction: tx.raw });
  const legs: SolanaLeg[] = [];
  const index = tx.accounts.indexOf(address);
  const change = index < 0 ? 0n : tx.postBalances[index] - tx.preBalances[index];
  // The first account signs and pays the fee, also when the transaction failed.
  const fee = index === 0 ? tx.fee : 0n;
  const moved = change + fee;
  const received = moved > 0n ? moved : 0n;
  // The fee leaves the wallet with the value, as on Bitcoin and Ethereum.
  const sent = (moved < 0n ? -moved : 0n) + fee;
  if (received !== 0n || sent !== 0n) {
    legs.push({
      txid: tx.signature,
      asset: null,
      blockHeight: tx.slot,
      blockHash: null,
      blockTime,
      receivedUnits: received,
      sentUnits: sent,
      feeUnits: fee,
      direction: received > sent ? 'in' : 'out',
      raw: raw(tx.signature),
    });
  }
  const owns = (balance: TokenBalance) =>
    balance.owner === address ||
    (balance.owner === null && tokenAccounts.has(tx.accounts[balance.accountIndex]));
  const after = heldByMint(tx.postTokenBalances, owns);
  const before = heldByMint(tx.preTokenBalances, owns);
  // The legs follow the number of their mint and, for one number, the order the transaction
  // lists the mints: the order in which they were always stored.
  const changes = [...new Set([...tx.preTokenBalances, ...tx.postTokenBalances].map((i) => i.mint))]
    .map((mint) => ({ mint, delta: (after.get(mint) ?? 0n) - (before.get(mint) ?? 0n) }))
    .filter((change) => change.delta !== 0n)
    .sort((left, right) => tokenLegNumber(left.mint) - tokenLegNumber(right.mint));
  const numbers = tokenLegNumbers(changes.map((change) => change.mint));
  for (const { mint, delta } of changes) {
    const txid = `${tx.signature}-${numbers.get(mint)}`;
    legs.push({
      txid,
      asset: solanaTokenAsset(mint),
      blockHeight: tx.slot,
      blockHash: null,
      blockTime,
      receivedUnits: delta > 0n ? delta : 0n,
      sentUnits: delta < 0n ? -delta : 0n,
      feeUnits: 0n,
      direction: delta > 0n ? 'in' : 'out',
      raw: { ...raw(txid), mint },
    });
  }
  return legs;
}
