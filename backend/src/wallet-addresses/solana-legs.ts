import { networkAssets } from './chain-assets';
import type { Direction } from './esplora-client';
import type { SolanaTransaction, TokenBalance } from './solana-rpc-client';

// track-solana-wallets (M15, SOL-IDENTITY): what one finalized transaction changed for a wallet.
// The SOL leg is the wallet's lamport change with the fee it paid as fee payer; each USDT or
// USDC leg is the change of every token account the wallet owns in that mint. Balances, not
// instructions, decide the amounts, so a failed transaction keeps only its fee.

/** One raw leg as wallet_address_transactions stores it. */
export interface SolanaLeg {
  /** The signature; a token leg adds "-" and the token's number (1 USDT, 2 USDC). */
  txid: string;
  /** Null for SOL, else the token's ticker. */
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

// The token's position among the network's assets is its leg number: both sides of a transfer
// between own wallets name the same movement alike (M13 links legs by identity).
const tokens = networkAssets('solana').flatMap((asset, number) =>
  asset.token && asset.contract ? [{ token: asset.token, mint: asset.contract, number }] : [],
);

/** The SPL mints the sync follows: USDT and USDC (Q7). */
export const solanaMints = tokens.map((token) => token.mint);

function held(
  balances: readonly TokenBalance[],
  mint: string,
  owns: (balance: TokenBalance) => boolean,
): bigint {
  return balances
    .filter((balance) => balance.mint === mint && owns(balance))
    .reduce((total, balance) => total + balance.amount, 0n);
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
  for (const { token, mint, number } of tokens) {
    const delta = held(tx.postTokenBalances, mint, owns) - held(tx.preTokenBalances, mint, owns);
    if (delta === 0n) continue;
    const txid = `${tx.signature}-${number}`;
    legs.push({
      txid,
      asset: token,
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
