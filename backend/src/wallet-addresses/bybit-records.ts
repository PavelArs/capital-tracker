import { createHash } from 'node:crypto';
import type {
  BybitDeposit,
  BybitEarnCategory,
  BybitEarnYield,
  BybitExecution,
  BybitWithdrawal,
} from './bybit-client';
import { networkAssets } from './chain-assets';

// sync-bybit-account (M22): Bybit's records as raw legs of the account, never edited later. A
// leg moves one coin the app tracks; amounts are in the account's base units (18 decimals).

export const BYBIT_DECIMALS = 18;
/** The coins a Bybit account can hold in the app (Q7): the tracked chains' coins and tokens. */
export const bybitCoins = networkAssets('bybit').map((asset) => asset.symbol);

export type BybitKind = 'trade' | 'deposit' | 'withdrawal' | 'earn';

export interface BybitLeg {
  txid: string;
  kind: BybitKind;
  /** The coin the leg moves. */
  asset: string;
  blockTime: string;
  receivedUnits: bigint;
  sentUnits: bigint;
  /** A withdrawal's fee, in the coin withdrawn; inside `sentUnits`. */
  feeUnits: bigint;
  direction: 'in' | 'out';
  raw: Record<string, unknown>;
}

export class UnreadableAmount extends Error {}

/** An exact decimal in base units; more decimals than the account keeps is unreadable. */
export function toUnits(value: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new UnreadableAmount();
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  if (fraction.length > BYBIT_DECIMALS) throw new UnreadableAmount();
  const units = BigInt(match[2]) * 10n ** BigInt(BYBIT_DECIMALS) + BigInt(fraction.padEnd(18, '0'));
  return match[1] ? -units : units;
}

// Quote coins of Bybit's spot pairs, longest first, so "BTCUSDT" splits as BTC and USDT.
const quotes = ['FDUSD', 'USDT', 'USDC', 'USDE', 'USD1', 'BTC', 'ETH', 'EUR', 'DAI', 'BRL', 'TRY']
  .concat(['PLN', 'MNT', 'SOL'])
  .sort((left, right) => right.length - left.length);

/** A spot pair's base and quote coin: "SOLUSDT" is SOL bought or sold for USDT. */
export function splitSymbol(symbol: string): { base: string; quote: string } | null {
  const quote = quotes.find((item) => symbol.endsWith(item) && symbol.length > item.length);
  return quote ? { base: symbol.slice(0, -quote.length), quote } : null;
}

const tracked = (coin: string) => bybitCoins.includes(coin);
const iso = (time: number) => new Date(time).toISOString();
const leg = (
  fields: Omit<BybitLeg, 'receivedUnits' | 'sentUnits' | 'direction'>,
  units: bigint,
): BybitLeg => ({
  ...fields,
  receivedUnits: units > 0n ? units : 0n,
  sentUnits: units < 0n ? -units : 0n,
  direction: units >= 0n ? 'in' : 'out',
  raw: { ...fields.raw, txid: fields.txid },
});

/**
 * BYBIT-TRADES: one spot fill as the change it made to the account. A buy adds the base coin
 * less a fee charged in it and spends the quote coin plus a fee charged in that; a sale the
 * other way round. The leg moves the base coin and records the quote side with it, so the
 * account's balances follow Bybit before the trade is answered. A pair whose base coin is not
 * tracked moves only the quote coin; a pair moving no tracked coin is left out.
 */
export function tradeLeg(fill: BybitExecution): BybitLeg | null {
  const pair = splitSymbol(fill.symbol);
  if (!pair) return null;
  const fee = toUnits(fill.execFee);
  const feeIn = (coin: string) => (fill.feeCurrency === coin ? fee : 0n);
  const buy = fill.side === 'Buy';
  const base = buy
    ? toUnits(fill.execQty) - feeIn(pair.base)
    : -(toUnits(fill.execQty) + feeIn(pair.base));
  const quote = buy
    ? -(toUnits(fill.execValue) + feeIn(pair.quote))
    : toUnits(fill.execValue) - feeIn(pair.quote);
  const txid = `bybit-trade-${fill.execId}`;
  const trade = {
    side: buy ? 'buy' : 'sell',
    base: pair.base,
    quote: pair.quote,
    price: fill.execPrice,
    quantity: fill.execQty,
    value: fill.execValue,
    fee: fill.execFee,
    feeCoin: fill.feeCurrency,
  };
  const blockTime = iso(fill.execTime);
  if (tracked(pair.base))
    return leg(
      {
        txid,
        kind: 'trade',
        asset: pair.base,
        blockTime,
        feeUnits: 0n,
        raw: {
          kind: 'trade',
          trade,
          ...(tracked(pair.quote) ? { quoteAsset: pair.quote, quoteUnits: quote.toString() } : {}),
          record: fill.raw,
        },
      },
      base,
    );
  if (!tracked(pair.quote)) return null;
  return leg(
    {
      txid,
      kind: 'trade',
      asset: pair.quote,
      blockTime,
      feeUnits: 0n,
      raw: { kind: 'trade', trade, record: fill.raw },
    },
    quote,
  );
}

// Bybit's chain names for the networks the app tracks.
const chains: Record<string, RegExp> = {
  BTC: /^[0-9a-f]{64}$/,
  ETH: /^[0-9a-f]{64}$/,
  SOL: /^[1-9A-HJ-NP-Za-km-z]{64,88}$/,
};

/**
 * The chain's own transaction identity (PR-WAL-3) for a deposit or withdrawal on a tracked
 * network: Bitcoin's and Ethereum's hash in lower-case hex without 0x, Solana's signature.
 * A token's leg in a wallet adds its log or token number; matching allows for that.
 */
export function chainTxid(chain: string, txID: string): string | null {
  const pattern = chains[chain];
  if (!pattern) return null;
  const hash = chain === 'SOL' ? txID : txID.toLowerCase().replace(/^0x/, '');
  return pattern.test(hash) ? hash : null;
}

const digest = (parts: string[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40);

/** BYBIT-DEPOSIT: a credited deposit, from a chain or from another Bybit user. */
export function depositLeg(deposit: BybitDeposit): BybitLeg | null {
  if (deposit.state !== 'done' || deposit.time === null || !tracked(deposit.coin)) return null;
  const hash = deposit.internal ? null : chainTxid(deposit.chain, deposit.txID);
  const txid = deposit.internal
    ? `bybit-deposit-internal-${deposit.id}`
    : (hash ??
      `bybit-deposit-${digest([deposit.coin, deposit.chain, deposit.txID, deposit.amount, String(deposit.time)])}`);
  return leg(
    {
      txid,
      kind: 'deposit',
      asset: deposit.coin,
      blockTime: iso(deposit.time),
      feeUnits: 0n,
      raw: { kind: 'deposit', internal: deposit.internal, record: deposit.raw },
    },
    toUnits(deposit.amount),
  );
}

/**
 * A completed withdrawal: the amount sent plus Bybit's fee leave the account, so the wallet
 * on the other side receives the amount (out = in + fee, as between two own wallets).
 */
export function withdrawalLeg(withdrawal: BybitWithdrawal): BybitLeg | null {
  if (withdrawal.state !== 'done' || !tracked(withdrawal.coin)) return null;
  const hash = withdrawal.internal ? null : chainTxid(withdrawal.chain, withdrawal.txID);
  const fee = toUnits(withdrawal.withdrawFee);
  return leg(
    {
      txid: hash ?? `bybit-withdrawal-${withdrawal.withdrawId}`,
      kind: 'withdrawal',
      asset: withdrawal.coin,
      blockTime: iso(withdrawal.time),
      feeUnits: fee,
      raw: { kind: 'withdrawal', internal: withdrawal.internal, record: withdrawal.raw },
    },
    -(toUnits(withdrawal.amount) + fee),
  );
}

const earnProducts: Record<BybitEarnCategory, string> = {
  FlexibleSaving: 'flexible',
  OnChain: 'onchain',
};

/**
 * BYBIT-EARN: a paid Earn yield adds its coin to the account; the app records it as a Staking
 * reward by itself. Bybit's yield ids are unique per product kind, so the kind is in the txid.
 */
export function earnLeg(paid: BybitEarnYield, category: BybitEarnCategory): BybitLeg | null {
  if (paid.state !== 'done' || !tracked(paid.coin)) return null;
  const units = toUnits(paid.amount);
  if (units === 0n) return null;
  const product = earnProducts[category];
  return leg(
    {
      txid: `bybit-earn-${product}-${paid.id}`,
      kind: 'earn',
      asset: paid.coin,
      blockTime: iso(paid.time),
      feeUnits: 0n,
      raw: { kind: 'earn', product, record: paid.raw },
    },
    units,
  );
}
