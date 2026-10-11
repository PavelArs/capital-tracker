import type { ChainAsset } from './chain-assets';

// TOKEN-HIDE: an Ethereum or Solana wallet is sent every token anyone cares to send it. Most of
// them are scams: a token can forge a transfer out of a wallet that never held it, so the
// history says the wallet holds less than nothing, and it can call itself USDT. Such a token is
// left out of the wallet's balances. The owner can hide any other token, and bring either kind
// back; the raw legs stay as stored.

/** The key of one token of one address in the set of tokens that are left out. */
export const tokenKey = (addressId: string, contract: string | null) =>
  `${addressId}:${contract ?? ''}`;

/** Why a token is left out: the app's own rules, or the owner's choice. */
export type HiddenReason = 'negative' | 'lookalike' | 'dust' | 'owner';

/**
 * Whether the coins of a token are worth nothing to the owner (TOKEN-DUST): no price source lists
 * the token at all, so its value will stay unknown, or the dust threshold is set and they are
 * worth less than it at the latest price. A listed token without a price yet is not dust: its
 * value is only not known yet.
 */
export function isWorthless(
  token: Pick<ChainAsset, 'listed'>,
  quantity: string,
  thresholdUsd: string | null,
  price: string | undefined,
): boolean {
  if (price === undefined) return token.listed === false;
  if (thresholdUsd === null) return false;
  return Math.abs(Number(quantity)) * Number(price) < Number(thresholdUsd);
}

/**
 * Whether a token held by an address is left out of its balances. The owner's choice comes
 * first: a token they hid is hidden, one they brought back is shown. Otherwise a token with a
 * negative balance (the history sends out more than it received, which the chain never allows),
 * one that copies the symbol of a tracked coin, or one worth nothing (dust) is hidden.
 */
export function hiddenReason(
  token: Pick<ChainAsset, 'token' | 'lookalike'>,
  units: bigint,
  hidden: readonly string[],
  shown: readonly string[],
  worthless = false,
): HiddenReason | null {
  const contract = token.token as string;
  if (hidden.includes(contract)) return 'owner';
  if (shown.includes(contract)) return null;
  if (units < 0n) return 'negative';
  if (token.lookalike === true) return 'lookalike';
  return worthless ? 'dust' : null;
}
