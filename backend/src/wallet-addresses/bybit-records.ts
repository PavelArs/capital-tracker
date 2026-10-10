import { createHash } from 'node:crypto';
import type {
  BybitConvert,
  BybitDeposit,
  BybitEarnCategory,
  BybitEarnYield,
  BybitExecution,
  BybitWithdrawal,
} from './bybit-client';
import { isBybitCoin, networkAssets } from './chain-assets';

// sync-bybit-account (M22): Bybit's records as raw legs of the account, never edited later
// (except once, BYBIT-ANY-COIN: see completedTradeLeg). A leg moves one coin the app tracks;
// amounts are in the account's base units (18 decimals).

export const BYBIT_DECIMALS = 18;
/**
 * The coins a Bybit account always shows (Q7), even at zero; BYBIT-ANY-COIN: its records and
 * balances hold any other coin `isBybitCoin` accepts too.
 */
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

const tracked = isBybitCoin;
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

interface Exchange {
  txid: string;
  side: 'buy' | 'sell';
  base: string;
  quote: string;
  price: string;
  /** Of the base coin. */
  quantity: string;
  /** In the quote coin. */
  value: string;
  fee: string;
  feeCoin: string;
  time: number;
  /** Bybit's record and what kind of exchange it was. */
  raw: Record<string, unknown>;
}

/**
 * One exchange of a base coin for a quote coin as the change it made to the account. A buy adds
 * the base coin less a fee charged in it and spends the quote coin plus a fee charged in that;
 * a sale the other way round. The leg moves the base coin and records the quote side with it,
 * so the account's balances follow Bybit before the trade is answered. A pair whose base coin
 * is not tracked moves only the quote coin; a pair moving no tracked coin is left out.
 */
function exchangeLeg(exchange: Exchange): BybitLeg | null {
  const { base: baseCoin, quote: quoteCoin } = exchange;
  const fee = toUnits(exchange.fee);
  const feeIn = (coin: string) => (exchange.feeCoin === coin ? fee : 0n);
  const buy = exchange.side === 'buy';
  const base = buy
    ? toUnits(exchange.quantity) - feeIn(baseCoin)
    : -(toUnits(exchange.quantity) + feeIn(baseCoin));
  const quote = buy
    ? -(toUnits(exchange.value) + feeIn(quoteCoin))
    : toUnits(exchange.value) - feeIn(quoteCoin);
  const trade = {
    side: exchange.side,
    base: baseCoin,
    quote: quoteCoin,
    price: exchange.price,
    quantity: exchange.quantity,
    value: exchange.value,
    fee: exchange.fee,
    feeCoin: exchange.feeCoin,
  };
  const blockTime = iso(exchange.time);
  const fields = { txid: exchange.txid, kind: 'trade' as const, blockTime, feeUnits: 0n };
  if (tracked(baseCoin))
    return leg(
      {
        ...fields,
        asset: baseCoin,
        raw: {
          kind: 'trade',
          trade,
          ...(tracked(quoteCoin) ? { quoteAsset: quoteCoin, quoteUnits: quote.toString() } : {}),
          ...exchange.raw,
        },
      },
      base,
    );
  if (!tracked(quoteCoin)) return null;
  return leg(
    { ...fields, asset: quoteCoin, raw: { kind: 'trade', trade, ...exchange.raw } },
    quote,
  );
}

/**
 * BYBIT-ANY-COIN: a stored trade leg that moved only its quote coin, because its base coin was
 * not tracked when it was read, as the leg it is now: the base coin with the quote side
 * recorded with it. Null when it already is one, or its base coin is still not tracked.
 */
export function completedTradeLeg(
  stored: Record<string, unknown>,
  blockTime: Date,
): BybitLeg | null {
  const { kind, trade, txid, quoteAsset, quoteUnits, ...raw } = stored;
  if (kind !== 'trade' || typeof txid !== 'string' || quoteAsset !== undefined) return null;
  if (quoteUnits !== undefined || !trade || typeof trade !== 'object') return null;
  const fields = trade as Record<string, unknown>;
  const text = (key: string) => (typeof fields[key] === 'string' ? (fields[key] as string) : '');
  const side = text('side');
  if ((side !== 'buy' && side !== 'sell') || !tracked(text('base'))) return null;
  const completed = exchangeLeg({
    txid,
    side,
    base: text('base'),
    quote: text('quote'),
    price: text('price'),
    quantity: text('quantity'),
    value: text('value'),
    fee: text('fee'),
    feeCoin: text('feeCoin'),
    time: blockTime.getTime(),
    raw,
  });
  return completed?.asset === text('base') ? completed : null;
}

/** BYBIT-TRADES: one spot fill. */
export function tradeLeg(fill: BybitExecution): BybitLeg | null {
  const pair = splitSymbol(fill.symbol);
  if (!pair) return null;
  return exchangeLeg({
    txid: `bybit-trade-${fill.execId}`,
    side: fill.side === 'Buy' ? 'buy' : 'sell',
    ...pair,
    price: fill.execPrice,
    quantity: fill.execQty,
    value: fill.execValue,
    fee: fill.execFee,
    feeCoin: fill.feeCurrency,
    time: fill.execTime,
    raw: { record: fill.raw },
  });
}

/** The quoted price of one base coin, to 18 decimals. */
function quotedPrice(value: string, quantity: string): string {
  const scale = 10n ** BigInt(BYBIT_DECIMALS);
  const price = (toUnits(value) * scale + toUnits(quantity) / 2n) / toUnits(quantity);
  const fraction = (price % scale).toString().padStart(BYBIT_DECIMALS, '0').replace(/0+$/, '');
  return `${price / scale}${fraction ? `.${fraction}` : ''}`;
}

// Which coin of a convert is its quote: stablecoins and fiat before the large coins Bybit also
// quotes in; a coin quoted in nothing is always the base.
const quotePriority = [
  'USDT',
  'USDC',
  'FDUSD',
  'USDE',
  'USD1',
  'DAI',
  'EUR',
  'BRL',
  'TRY',
  'PLN',
].concat(['BTC', 'ETH', 'SOL', 'MNT']);
const quoteRank = (coin: string) =>
  quotePriority.includes(coin) ? quotePriority.indexOf(coin) : quotePriority.length;

/**
 * BYBIT-CONVERT: a settled convert as a trade without a fee (Bybit's spread is in its rate).
 * Converting into a quote coin (USDT and USDC first, then fiat, then BTC, ETH, SOL and MNT)
 * sells what was given; anything else buys what was received with it. Either way a convert between USDT or USDC and a tracked coin
 * is recognised as a Buy or Sell like a spot fill.
 */
export function convertLeg(convert: BybitConvert, source: 'convert' | 'exchange'): BybitLeg | null {
  if (convert.state !== 'done' || toUnits(convert.fromAmount) === 0n) return null;
  if (toUnits(convert.toAmount) === 0n) return null;
  const sell = quoteRank(convert.toCoin) < quoteRank(convert.fromCoin);
  const [base, quote, quantity, value] = sell
    ? [convert.fromCoin, convert.toCoin, convert.fromAmount, convert.toAmount]
    : [convert.toCoin, convert.fromCoin, convert.toAmount, convert.fromAmount];
  return exchangeLeg({
    txid: `bybit-trade-convert-${convert.id}`,
    side: sell ? 'sell' : 'buy',
    base,
    quote,
    price: quotedPrice(value, quantity),
    quantity,
    value,
    fee: '0',
    feeCoin: '',
    time: convert.time,
    raw: { convert: source, record: convert.raw },
  });
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

/**
 * BYBIT-COUNT-GAP: the difference between what Bybit reports and what the records hold, entered
 * by the owner as one more record of the account. It is an unanswered deposit (or withdrawal)
 * that counts at once, without a purchase price, and can be answered like any other record.
 */
export function gapLeg(
  gap: { requestId: string; coin: string; direction: 'in' | 'out'; quantity: string },
  at: Date,
): BybitLeg {
  const incoming = gap.direction === 'in';
  const kind = incoming ? 'deposit' : 'withdrawal';
  const units = toUnits(gap.quantity);
  return leg(
    {
      txid: `bybit-${kind}-gap-${gap.requestId}`,
      kind,
      asset: gap.coin,
      blockTime: at.toISOString(),
      feeUnits: 0n,
      raw: { kind, internal: false, balanceGap: true },
    },
    incoming ? units : -units,
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
