import type { ChainAsset } from './chain-assets';

// TOKEN-HIDE: an Ethereum or Solana wallet is sent every token anyone cares to send it. Most of
// them are scams: a token can forge a transfer out of a wallet that never held it, so the
// history says the wallet holds less than nothing, and it can call itself USDT. Such a token is
// left out of the wallet's balances. The owner can hide any other token, and bring either kind
// back; the raw legs stay as stored.

/** Why a token is left out: the app's own rules, or the owner's choice. */
export type HiddenReason = 'negative' | 'lookalike' | 'owner';

/**
 * Whether a token held by an address is left out of its balances. The owner's choice comes
 * first: a token they hid is hidden, one they brought back is shown. Otherwise a token with a
 * negative balance (the history sends out more than it received, which the chain never allows)
 * or one that copies the symbol of a tracked coin is hidden.
 */
export function hiddenReason(
  token: Pick<ChainAsset, 'token' | 'lookalike'>,
  units: bigint,
  hidden: readonly string[],
  shown: readonly string[],
): HiddenReason | null {
  const contract = token.token as string;
  if (hidden.includes(contract)) return 'owner';
  if (shown.includes(contract)) return null;
  if (units < 0n) return 'negative';
  return token.lookalike === true ? 'lookalike' : null;
}
