import { type AccountingCurrency, FxConverter, moscowDate } from '../fx-rates/fx-conversion';
import { priceAt } from '../prices/market-price.store';
import {
  chainAsset,
  isExchange,
  isUnlistedToken,
  type Network,
  unitsToAtoms,
} from '../wallet-addresses/chain-assets';
import type { ChainType, Classification } from './chain-classification';
import { isDust } from './chain-dust';
import {
  byPoolOrder,
  type PoolSettlement,
  poolCoins,
  poolDepositAtoms,
  poolDepositUnits,
  poolReturnAtoms,
  poolReturnUnits,
  settlePool,
  storedValueUsd,
} from './chain-pool';
import { coinOf, sameTransaction } from './chain-transfer';
import { canonicalDecimalToAtoms, formatAtoms, formatProduct } from './money';
import type { TradePayment } from './paid-currency';
import type { TradePurpose } from './trade-purpose';

// One read model over every journal and the raw chain history (list-all-operations).

export interface OperationAsset {
  instrumentId: string | null;
  symbol: string | null;
  name: string;
  /**
   * TOKEN-CHAIN: the blockchain a token moved on, as USDT exists on several. Absent for a
   * network's own coin and for what no chain transaction moved.
   */
  network?: Exclude<Network, 'bybit'>;
}
export interface OperationPlace {
  id: string;
  name: string;
}
export interface OperationWallet {
  id: string;
  network: Network;
  address: string;
  /** The owner's name for the address (M10), or null. */
  label: string | null;
}
export interface OperationFee {
  asset: OperationAsset;
  quantity: string;
  /**
   * TOKEN-FEE: a chain transaction's network fee in USD at the price stored for its time;
   * null without one. Absent on fees the owner recorded.
   */
  valueUsd?: string | null;
}
/** A fee with its value in the list's quote currency at the Bank of Russia rate of the date. */
export type ListedFee = OperationFee & { value?: string | null };
export interface StoredMarketPrice {
  priceUsd: string;
  observedAt: string;
  source: string;
}

export interface TradeOperationInput {
  tradeId: string;
  version: number;
  account: OperationPlace;
  asset: OperationAsset;
  side: 'buy' | 'sell';
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
  csv: boolean;
  paid: TradePayment | null;
  comment: string | null;
  settlement: OperationSettlement | null;
  /** Income, expense, gift or fee rather than a purchase or sale (PR-OPS-2). */
  purpose?: TradePurpose | null;
}
/**
 * The cash in the trade's own account that settled it (M9): what a sale kept, or what a buy
 * spent of it before money from outside.
 */
export interface OperationSettlement {
  asset: OperationAsset;
  quantity: string;
}
export interface TransferOperationInput {
  transferId: string;
  version: number;
  from: OperationPlace;
  to: OperationPlace;
  asset: OperationAsset;
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  fee: OperationFee | null;
}
export interface SwapOperationInput {
  swapId: string;
  version: number;
  account: OperationPlace;
  outgoing: OperationAsset;
  incoming: OperationAsset;
  occurredAt: string;
  orderWithinTimestamp: number;
  outgoingQuantity: string;
  incomingQuantity: string;
  considerationUsd: string | null;
  fee: OperationFee | null;
}
export interface RewardOperationInput {
  rewardId: string;
  version: number;
  account: OperationPlace;
  asset: OperationAsset;
  category: 'staking' | 'airdrop' | 'other' | 'unclassified';
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  incomeValueUsd: string | null;
  acquisitionBasisUsd: string | null;
}
export interface OpeningOperationInput {
  lotId: string;
  account: OperationPlace;
  asset: OperationAsset;
  acquiredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  costBasisUsd: string;
}
export interface FlowOperationInput {
  flowId: string;
  version: number;
  direction: 'contribution' | 'withdrawal';
  occurredAt: string;
  amountUsd: string;
}
/** The owner's current answer for a chain transaction (M12) and the entry it produced. */
export interface ChainClassificationInput {
  version: number;
  status: 'unclassified' | 'classified' | 'hidden';
  type: ChainType | null;
  details: Classification | null;
  comment: string | null;
  produced: { kind: 'trade' | 'reward' | 'transfer' | 'swap'; id: string } | null;
  /** A transfer's other leg among the owner's addresses (M13), or null. */
  linkedAddressId?: string | null;
  /** CLS-SWAP: the owner's raw transaction on the other side of the swap, or null. */
  paired?: { addressId: string; txid: string } | null;
  /** CLS-SWAP-CROSS: the transfer that carried the paid coins to the receiving wallet. */
  carryTransferId?: string | null;
  /** Linked by the app without asking (D7). */
  automatic?: boolean;
}
export interface ChainOperationInput {
  wallet: OperationWallet;
  /** The account the address belongs to (WAL-ACCOUNT), or null until the owner picks one. */
  account: OperationPlace | null;
  txid: string;
  /** The token the leg moves (M14), or null for the network's own coin. */
  asset: string | null;
  blockHeight: number;
  blockTime: string;
  direction: 'in' | 'out' | 'self';
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
  /**
   * SOL-STAKE-MOVE: how much of the leg went into the wallet's own stake accounts (positive) or
   * came back from them (negative); absent or "0" for every other leg.
   */
  stakeUnits?: string;
  /** SWAP-ONE-TX: the owner's own transaction called a contract (Ethereum), on its ether leg. */
  call?: ContractCall | null;
  classification?: ChainClassificationInput | null;
}
/** SWAP-ONE-TX: a contract call, named by its method as the explorer decodes it, or null. */
export interface ContractCall {
  method: string | null;
}
export interface OperationSources {
  trades: readonly TradeOperationInput[];
  transfers: readonly TransferOperationInput[];
  swaps: readonly SwapOperationInput[];
  rewards: readonly RewardOperationInput[];
  openings: readonly OpeningOperationInput[];
  flows: readonly FlowOperationInput[];
  chain: readonly ChainOperationInput[];
  /**
   * Stored USD prices by upper-case ticker; a chain transaction is valued at the one priceAt
   * picks for its time (EST-AT-TIME).
   */
  marketPrices: ReadonlyMap<string, readonly StoredMarketPrice[]>;
  /** CLS-DUST: the owner's dust threshold in USD; absent or null: off. */
  dustThresholdUsd?: string | null;
}

export type OperationType =
  | 'buy'
  | 'sell'
  | 'transfer'
  | 'swap'
  | 'reward'
  | 'staking-reward'
  | 'stake'
  | 'unstake'
  | 'airdrop'
  | 'opening-balance'
  | 'deposit'
  | 'withdrawal'
  | 'income'
  | 'expense'
  | 'gift'
  | 'fee'
  | 'other'
  | 'pool-deposit'
  | 'pool-withdrawal'
  | 'pool-reward';

export interface Operation {
  id: string;
  kind: 'trade' | 'transfer' | 'swap' | 'reward' | 'opening' | 'flow' | 'chain';
  /** Null until the owner classifies a chain transaction (M12). */
  type: OperationType | null;
  direction: 'in' | 'out' | 'internal';
  occurredAt: string;
  asset: OperationAsset;
  quantity: string;
  counterAsset: OperationAsset | null;
  counterQuantity: string | null;
  /** The value the owner recorded; missing stays null, never 0. */
  valueUsd: string | null;
  /** Chain only: quantity at the price stored for the transaction's time, an estimate. */
  estimatedValueUsd: string | null;
  costBasisUsd: string | null;
  feeUsd: string | null;
  fee: ListedFee | null;
  account: OperationPlace | null;
  /**
   * A transfer's other account; for a chain transaction to classify, the account of the
   * owner's other address in it (M13).
   */
  counterAccount: OperationPlace | null;
  wallet: OperationWallet | null;
  /** Chain only: the owner's other address in the same transaction (M13), or null. */
  counterWallet: OperationWallet | null;
  /** `direction` is the leg's own, kept when a transfer between accounts reads as internal. */
  chain: {
    txid: string;
    blockHeight: number;
    priceObservedAt: string | null;
    direction: 'in' | 'out' | 'internal';
    /**
     * CLS-SWAP: the paying transaction of a swap listed on its receiving row; POOL-WITHDRAW: the
     * deposit a withdrawal returns. Null otherwise.
     */
    pairedTxid: string | null;
    /** SWAP-ONE-TX: the owner's transaction called a contract; its method when it is named. */
    call?: ContractCall;
    /**
     * SWAP-ONE-TX-SUGGEST: the one leg of the same transaction that moved another coin the
     * other way, as the suggested other side of a swap; only while both are unanswered.
     */
    swapWith?: { addressId: string; txid: string };
  } | null;
  /**
   * POOL-WITHDRAW: what the deposit put into the pool and what came back above what was still
   * in it (positive, pool income) or below it (negative, impermanent loss); `partial` says only
   * a part of the deposit came back, and `remaining` what is still in the pool afterwards
   * (POOL-PARTIAL); null for every other row.
   */
  pool: { deposited: string; difference: string; partial: boolean; remaining: string } | null;
  /**
   * Hidden: a chain transaction the owner left out of every calculation (CLS-HIDE). Dust: an
   * unanswered receipt worth less than the dust threshold; it counts like any unanswered one
   * but does not ask to be classified (CLS-DUST).
   */
  status: 'recorded' | 'needs-classification' | 'hidden' | 'dust';
  source: 'manual' | 'csv' | 'chain';
  /** Chain only: the owner's current answer, to change it (M12); null before the first. */
  classification: {
    version: number;
    hidden: boolean;
    value: Classification | null;
    comment: string | null;
    /** A transfer the app recognised between the owner's own wallets (D7). */
    automatic: boolean;
  } | null;
  version: number | null;
  /** Trades only: the amounts as paid in RUB or EUR (CUR-PAID-RUB). */
  paid: TradePayment | null;
  /** The owner's note (OPS-COMMENT). */
  comment: string | null;
  /** Trades only: the cash in the same account that settled it (OPS-SELL-CASH, OPS-BUY-CASH). */
  settlement: OperationSettlement | null;
  /** Position among operations at the same instant; an edit at the same time keeps it. */
  orderWithinTimestamp: number;
  // The amounts above in the list's quote currency at the Bank of Russia rate of the
  // operation's Moscow date; null without an amount or a rate.
  value: string | null;
  estimatedValue: string | null;
  costBasis: string | null;
  feeValue: string | null;
}

export interface OperationList {
  at: string;
  quoteCurrency: AccountingCurrency;
  needsClassificationCount: number;
  /** CLS-DUST: the threshold the statuses were read with; null: off. */
  dustThresholdUsd: string | null;
  operations: Operation[];
}

/** What a chain leg moves, as the list names assets; the fee is in the network's own coin
 * (an exchange's in the leg's coin). */
function legAsset(network: Network, token: string | null): OperationAsset {
  const { symbol, name } = chainAsset(network, token);
  return { instrumentId: null, symbol, name, ...(isToken(network, token) ? { network } : {}) };
}
/** TOKEN-CHAIN: a coin a blockchain moves that is not its own; an exchange has no blockchain. */
function isToken(network: Network, token: string | null): network is Exclude<Network, 'bybit'> {
  return token !== null && !isExchange(network);
}
/** TOKEN-CHAIN: a journal's asset as a chain leg moved it, named with the leg's blockchain. */
const onChain = (asset: OperationAsset, leg: ChainOperationInput | null): OperationAsset =>
  leg && isToken(leg.wallet.network, leg.asset) ? { ...asset, network: leg.wallet.network } : asset;
const USD: OperationAsset = { instrumentId: null, symbol: 'USD', name: 'US dollar' };
const purposeTypes: Record<TradePurpose, OperationType> = {
  income: 'income',
  expense: 'expense',
  'gift-received': 'gift',
  'gift-sent': 'gift',
  fee: 'fee',
};
const rewardTypes: Record<RewardOperationInput['category'], OperationType> = {
  staking: 'staking-reward',
  airdrop: 'airdrop',
  other: 'reward',
  unclassified: 'reward',
};

const blank = {
  counterAsset: null,
  counterQuantity: null,
  valueUsd: null,
  estimatedValueUsd: null,
  costBasisUsd: null,
  feeUsd: null,
  fee: null,
  account: null,
  counterAccount: null,
  wallet: null,
  counterWallet: null,
  chain: null,
  paid: null,
  comment: null,
  settlement: null,
  classification: null,
  pool: null,
} satisfies Partial<Operation>;
type Projected = Omit<Operation, 'value' | 'estimatedValue' | 'costBasis' | 'feeValue'>;
const inUsdOnly = () => new FxConverter({ USD: [], EUR: [] }, 'USD');

/** A product of two scale-30 amounts (up to 60 places) as scale-60 atoms. */
function productAtoms(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 60n + BigInt(fraction.padEnd(60, '0'));
}

/** Adds the amounts in the asked currency (CUR-*); a trade paid in RUB or EUR converts from
 * the amounts as paid, so 30,000 RUB stays exactly 30,000 RUB. */
function inCurrency(operation: Projected, fx: FxConverter): Operation {
  const date = moscowDate(operation.occurredAt);
  const paid = fx.currency === 'USD' ? null : operation.paid;
  const convert = (usd: string | null, native: string | undefined) => {
    if (usd === null) return null;
    const amount =
      paid && native !== undefined
        ? fx.convert(canonicalDecimalToAtoms(native), paid.currency, date)
        : fx.convert(canonicalDecimalToAtoms(usd), 'USD', date);
    return amount === null ? null : formatAtoms(amount);
  };
  const estimate =
    operation.estimatedValueUsd === null
      ? null
      : fx.convert(productAtoms(operation.estimatedValueUsd), 'USD', date);
  return {
    ...operation,
    value: convert(operation.valueUsd, paid?.gross),
    estimatedValue: estimate === null ? null : formatProduct(estimate),
    costBasis: convert(operation.costBasisUsd, undefined),
    feeValue: convert(operation.feeUsd, paid?.fee),
    fee:
      operation.fee && operation.fee.valueUsd !== undefined
        ? { ...operation.fee, value: convert(operation.fee.valueUsd, undefined) }
        : operation.fee,
  };
}
const recorded = { status: 'recorded', source: 'manual' } as const;

function amount(units: bigint, network: Network, token: string | null): string {
  return formatAtoms(unitsToAtoms(units, chainAsset(network, token)));
}

const netUnits = (row: ChainOperationInput) => BigInt(row.receivedUnits) - BigInt(row.sentUnits);

/** Quantity at a stored price, an estimate. */
export function estimate(quantity: string, price: StoredMarketPrice | undefined): string | null {
  return price
    ? formatProduct(canonicalDecimalToAtoms(quantity) * canonicalDecimalToAtoms(price.priceUsd))
    : null;
}

/**
 * The owner's other address in the same transaction, moving the other way: the leg a transfer
 * linked (M13), or for a transaction still to classify the one candidate, if there is one.
 */
function counterpart(
  row: ChainOperationInput,
  legs: readonly ChainOperationInput[],
): ChainOperationInput | null {
  const linked = row.classification?.linkedAddressId;
  if (linked) return legs.find((leg) => leg.wallet.id === linked) ?? null;
  const net = netUnits(row);
  const opposite = legs.filter(
    (leg) => leg.wallet.id !== row.wallet.id && netUnits(leg) * net < 0n,
  );
  return opposite.length === 1 ? opposite[0] : null;
}

/**
 * The network fee a leg paid, in the network's own coin (an exchange's in the coin withdrawn),
 * valued at the price stored for its block time (TOKEN-FEE); null when it paid none.
 */
function networkFee(
  row: ChainOperationInput,
  prices: OperationSources['marketPrices'],
): OperationFee | null {
  const units = BigInt(row.feeUnits);
  if (units === 0n) return null;
  const { network } = row.wallet;
  const token = isExchange(network) ? row.asset : null;
  const asset = legAsset(network, token);
  const quantity = amount(units, network, token);
  const price = asset.symbol ? priceAt(prices.get(asset.symbol), row.blockTime) : undefined;
  return {
    asset,
    quantity,
    valueUsd: asset.symbol ? storedValueUsd(asset.symbol, quantity, price?.priceUsd ?? null) : null,
  };
}

function chainOperation(
  row: ChainOperationInput,
  prices: OperationSources['marketPrices'],
  produced: Projected | undefined,
  other: ChainOperationInput | null,
  dustThresholdUsd: string | null,
  gasOf: (leg: ChainOperationInput) => ChainOperationInput | undefined,
  records: ReadonlyMap<string, Projected> = new Map(),
  settled: ReadonlyMap<ChainOperationInput, PoolSettlement> = new Map(),
): Projected {
  const { network } = row.wallet;
  const asset = legAsset(network, row.asset);
  // TOKEN-FEE: a token send's fee is the leg of the network's own coin that paid it.
  const gas = gasOf(row);
  const fee = gas ? networkFee(gas, prices) : networkFee(row, prices);
  const net = netUnits(row);
  const magnitude = net < 0n ? -net : net;
  const quantity = amount(magnitude, network, row.asset);
  // EST-AT-TIME: valued at the price stored for the block time, never today's.
  const price = asset.symbol ? priceAt(prices.get(asset.symbol), row.blockTime) : undefined;
  const answer = row.classification ?? null;
  const leg = row.direction === 'self' ? 'internal' : row.direction;
  const operation: Projected = {
    ...blank,
    id: `chain:${row.wallet.id}:${row.txid}`,
    kind: 'chain',
    type: null,
    direction: leg,
    occurredAt: row.blockTime,
    asset,
    quantity,
    estimatedValueUsd: estimate(quantity, price),
    // The sender pays an incoming transaction's fee.
    fee: row.direction === 'in' ? null : fee,
    account: row.account,
    wallet: row.wallet,
    chain: {
      txid: row.txid,
      blockHeight: row.blockHeight,
      priceObservedAt: price?.observedAt ?? null,
      direction: leg,
      pairedTxid: null,
    },
    status: 'needs-classification',
    source: 'chain',
    version: null,
    comment: answer?.comment ?? null,
    classification: answer && {
      version: answer.version,
      hidden: answer.status === 'hidden',
      value: answer.details,
      comment: answer.comment,
      automatic: answer.automatic === true,
    },
    orderWithinTimestamp: 0,
  };
  if (answer?.status === 'hidden') return { ...operation, status: 'hidden' };
  // CLS-RECORDED: the trade or swap the owner added by hand or from CSV for this movement, while
  // it counts in this wallet's account; once it does not, the transaction asks again.
  const named =
    answer?.status === 'classified' && answer.details?.type === 'recorded'
      ? answer.details.operation
      : null;
  const record = named ? records.get(`${named.kind}:${named.id}`) : undefined;
  const recordGone =
    named !== null && (record === undefined || record.account?.id !== row.account?.id);
  // SOL-STAKE-MOVE: SOL moved into the wallet's own stake account or back stays the owner's;
  // nothing to classify, only the network fee is a cost.
  const staked = BigInt(row.stakeUnits ?? '0');
  if (staked !== 0n && answer?.status !== 'classified') {
    const moved = amount(staked < 0n ? -staked : staked, network, null);
    return {
      ...operation,
      type: staked > 0n ? 'stake' : 'unstake',
      direction: 'internal',
      status: 'recorded',
      quantity: moved,
      estimatedValueUsd: estimate(moved, price),
      fee,
    };
  }
  // CLS-DUST: nobody has answered it and it is worth too little to ask about.
  if (
    (answer === null || answer.status === 'unclassified' || recordGone) &&
    isDust(
      row.direction,
      operation.estimatedValueUsd,
      dustThresholdUsd,
      isUnlistedToken(network, row.asset),
    )
  )
    return { ...operation, status: 'dust' };
  if (named && record && !recordGone)
    return { ...operation, type: record.type, status: 'recorded' };
  // An outgoing Other records no entry: the coins left with no sale price (D1).
  if (answer?.status === 'classified' && answer.type === 'other' && !answer.produced)
    return { ...operation, type: 'other', status: 'recorded' };
  // POOL-DEPOSIT, POOL-WITHDRAW: coins put into a liquidity pool or back stay the owner's; the
  // row shows the principal, the network fee apart, and a withdrawal what it gained or lost.
  if (
    answer?.status === 'classified' &&
    (answer.type === 'pool-deposit' || answer.type === 'pool-withdrawal')
  ) {
    const deposit = answer.type === 'pool-deposit';
    const units = (leg: ChainOperationInput) => ({ ...leg, network: leg.wallet.network });
    const moved = poolCoins(
      deposit ? poolDepositUnits(units(row)) : poolReturnUnits(units(row)),
      units(row),
    );
    const ownFee = row.asset === null && !isExchange(network);
    const paired = deposit ? null : other;
    const deposited = paired && poolCoins(poolDepositUnits(units(paired)), units(paired));
    const mine = settled.get(row);
    return {
      ...operation,
      type: answer.type,
      direction: 'internal',
      status: 'recorded',
      quantity: moved,
      estimatedValueUsd: estimate(moved, price),
      // The owner sent both: the fee of each is theirs.
      fee: ownFee || gas ? fee : null,
      valueUsd: produced?.valueUsd ?? null,
      costBasisUsd: produced?.costBasisUsd ?? null,
      chain: operation.chain && { ...operation.chain, pairedTxid: paired?.txid ?? null },
      pool: deposited
        ? {
            deposited,
            difference: formatAtoms(
              mine
                ? mine.gain - mine.loss
                : canonicalDecimalToAtoms(moved) - canonicalDecimalToAtoms(deposited),
            ),
            partial: answer.details?.type === 'pool-withdrawal' && answer.details.partial === true,
            remaining: formatAtoms(mine?.remaining ?? 0n),
          }
        : null,
      orderWithinTimestamp: produced?.orderWithinTimestamp ?? 0,
    };
  }
  // CLS-BUY: the row reads as the entry it produced, raw facts kept. An entry voided
  // elsewhere leaves the transaction to classify again, with the other side to suggest.
  if (answer?.status !== 'classified' || !answer.type || answer.type === 'recorded' || !produced)
    return other
      ? { ...operation, counterAccount: other.account, counterWallet: other.wallet }
      : operation;
  // CLS-SWAP: one swap of the paid coins for these, recorded where they arrived; paid from
  // another wallet, that one is the counter account. The fee is the paying leg's own.
  if (produced.kind === 'swap') {
    const paying = other && netUnits(other) < 0n ? other : null;
    return {
      ...operation,
      type: 'swap',
      direction: 'internal',
      status: 'recorded',
      asset: onChain(produced.asset, paying),
      quantity: produced.quantity,
      counterAsset: produced.counterAsset && onChain(produced.counterAsset, row),
      counterQuantity: produced.counterQuantity,
      valueUsd: produced.valueUsd,
      costBasisUsd: produced.valueUsd,
      estimatedValueUsd: null,
      fee: paying ? swapFee(paying, prices, gasOf) : null,
      account: produced.account,
      counterAccount:
        paying?.account && paying.account.id !== produced.account?.id ? paying.account : null,
      counterWallet: paying?.wallet ?? null,
      chain: operation.chain && { ...operation.chain, pairedTxid: paying?.txid ?? null },
      orderWithinTimestamp: produced.orderWithinTimestamp,
    };
  }
  // XFER-*: one transfer between the two accounts; the fee is the only cost.
  if (produced.kind === 'transfer')
    return {
      ...operation,
      type: 'transfer',
      direction: 'internal',
      status: 'recorded',
      quantity: produced.quantity,
      estimatedValueUsd: estimate(produced.quantity, price),
      fee: gas ? fee : produced.fee,
      account: produced.account,
      counterAccount: produced.counterAccount,
      counterWallet: answer.linkedAddressId ? (other?.wallet ?? null) : null,
      orderWithinTimestamp: produced.orderWithinTimestamp,
    };
  return {
    ...operation,
    type: answer.type,
    status: 'recorded',
    valueUsd: produced.valueUsd,
    costBasisUsd: produced.costBasisUsd,
    feeUsd: produced.feeUsd,
    account: produced.account,
    paid: produced.paid,
    settlement: produced.settlement,
    orderWithinTimestamp: produced.orderWithinTimestamp,
  };
}

/** CLS-SWAP: the paying leg's own network fee, or for a token the fee its transaction paid. */
function swapFee(
  paying: ChainOperationInput,
  prices: OperationSources['marketPrices'],
  gasOf: (leg: ChainOperationInput) => ChainOperationInput | undefined,
): OperationFee | null {
  if (paying.asset === null && !isExchange(paying.wallet.network))
    return networkFee(paying, prices);
  const gas = gasOf(paying);
  return gas ? networkFee(gas, prices) : null;
}

/** SWAP-ONE-TX: the transaction a leg belongs to; a token leg adds its number to the hash. */
const hashKey = (row: ChainOperationInput) => `${row.wallet.network}:${row.txid.split('-')[0]}`;
const unanswered = (row: ChainOperationInput) =>
  !row.classification || row.classification.status === 'unclassified';
/** A leg of the network's own coin that only paid the transaction's fee. */
const feeOnly = (row: ChainOperationInput) =>
  row.asset === null &&
  BigInt(row.receivedUnits) === 0n &&
  BigInt(row.sentUnits) === BigInt(row.feeUnits);
/**
 * TOKEN-FEE: the leg that only paid the fee of a token send from the same address, while
 * nobody has answered it: it is that send's fee, not a transaction of its own.
 */
export const gasOnly = (row: ChainOperationInput) =>
  !isExchange(row.wallet.network) &&
  feeOnly(row) &&
  BigInt(row.feeUnits) > 0n &&
  unanswered(row) &&
  BigInt(row.stakeUnits ?? '0') === 0n;
const swappable = (row: ChainOperationInput) =>
  unanswered(row) && !feeOnly(row) && netUnits(row) !== 0n && BigInt(row.stakeUnits ?? '0') === 0n;
const coin = (row: ChainOperationInput) => chainAsset(row.wallet.network, row.asset).symbol;

/**
 * SWAP-ONE-TX: a transaction that took one coin from the owner and gave another back called a
 * contract (a DEX on Ethereum, a program on Solana) that swapped them. The leg names the call
 * the owner's transaction made and, while both are unanswered, suggests the one leg of the
 * same transaction that moved another coin the other way as the other side of a swap. The
 * leg that only paid the network fee is no side of it.
 */
function oneTransactionSwap(
  operation: Projected,
  row: ChainOperationInput,
  legs: readonly ChainOperationInput[],
): Projected {
  if (!operation.chain) return operation;
  const call = legs.find((leg) => leg.call)?.call ?? null;
  const sides = swappable(row)
    ? legs.filter(
        (leg) =>
          leg !== row &&
          swappable(leg) &&
          coin(leg) !== coin(row) &&
          netUnits(leg) > 0n !== netUnits(row) > 0n,
      )
    : [];
  const swapWith =
    sides.length === 1 ? { addressId: sides[0].wallet.id, txid: sides[0].txid } : null;
  if (!call && !swapWith) return operation;
  return {
    ...operation,
    chain: { ...operation.chain, ...(call ? { call } : {}), ...(swapWith ? { swapWith } : {}) },
  };
}

/** Every known operation, newest first; raw chain rows stay unclassified (OPS-1..3). */
export function projectOperations(
  at: Date,
  sources: OperationSources,
  fx: FxConverter = inUsdOnly(),
): OperationList {
  const entries: { operation: Projected; order: number }[] = [];
  const dustThresholdUsd = sources.dustThresholdUsd ?? null;
  // Entries a chain classification produced are shown on their chain row, not twice (M12).
  const producedIds = new Set(
    sources.chain.flatMap((row) => {
      const produced = row.classification?.produced;
      const carried = row.classification?.carryTransferId;
      return row.classification?.status === 'classified' && produced
        ? [`${produced.kind}:${produced.id}`, ...(carried ? [`transfer:${carried}`] : [])]
        : [];
    }),
  );
  const produced = new Map<string, Projected>();
  const push = (operation: Omit<Projected, 'orderWithinTimestamp'>, order: number) => {
    const projected = { ...operation, orderWithinTimestamp: order };
    if (producedIds.has(projected.id)) produced.set(projected.id, projected);
    else entries.push({ operation: projected, order });
  };

  for (const row of sources.trades) {
    push(
      {
        ...blank,
        id: `trade:${row.tradeId}`,
        kind: 'trade',
        type: row.purpose ? purposeTypes[row.purpose] : row.side,
        direction: row.side === 'buy' ? 'in' : 'out',
        occurredAt: row.occurredAt,
        asset: row.asset,
        quantity: row.quantity,
        valueUsd: row.grossUsd,
        feeUsd: row.feeUsd,
        account: row.account,
        status: 'recorded',
        source: row.csv ? 'csv' : 'manual',
        version: row.version,
        paid: row.paid,
        comment: row.comment,
        settlement: row.settlement,
      },
      row.orderWithinTimestamp,
    );
  }
  for (const row of sources.transfers) {
    push(
      {
        ...blank,
        ...recorded,
        id: `transfer:${row.transferId}`,
        kind: 'transfer',
        type: 'transfer',
        direction: 'internal',
        occurredAt: row.occurredAt,
        asset: row.asset,
        quantity: row.quantity,
        fee: row.fee,
        account: row.from,
        counterAccount: row.to,
        version: row.version,
      },
      row.orderWithinTimestamp,
    );
  }
  for (const row of sources.swaps) {
    push(
      {
        ...blank,
        ...recorded,
        id: `swap:${row.swapId}`,
        kind: 'swap',
        type: 'swap',
        direction: 'internal',
        occurredAt: row.occurredAt,
        asset: row.outgoing,
        quantity: row.outgoingQuantity,
        counterAsset: row.incoming,
        counterQuantity: row.incomingQuantity,
        valueUsd: row.considerationUsd,
        fee: row.fee,
        account: row.account,
        version: row.version,
      },
      row.orderWithinTimestamp,
    );
  }
  for (const row of sources.rewards) {
    push(
      {
        ...blank,
        ...recorded,
        id: `reward:${row.rewardId}`,
        kind: 'reward',
        type: rewardTypes[row.category],
        direction: 'in',
        occurredAt: row.occurredAt,
        asset: row.asset,
        quantity: row.quantity,
        valueUsd: row.incomeValueUsd,
        costBasisUsd: row.acquisitionBasisUsd,
        account: row.account,
        version: row.version,
      },
      row.orderWithinTimestamp,
    );
  }
  for (const row of sources.openings) {
    push(
      {
        ...blank,
        ...recorded,
        id: `opening:${row.lotId}`,
        kind: 'opening',
        type: 'opening-balance',
        direction: 'in',
        occurredAt: row.acquiredAt,
        asset: row.asset,
        quantity: row.quantity,
        costBasisUsd: row.costBasisUsd,
        account: row.account,
        version: null,
      },
      row.orderWithinTimestamp,
    );
  }
  for (const row of sources.flows) {
    const deposit = row.direction === 'contribution';
    push(
      {
        ...blank,
        ...recorded,
        id: `flow:${row.flowId}`,
        kind: 'flow',
        type: deposit ? 'deposit' : 'withdrawal',
        direction: deposit ? 'in' : 'out',
        occurredAt: row.occurredAt,
        asset: USD,
        quantity: row.amountUsd,
        valueUsd: row.amountUsd,
        version: row.version,
      },
      0,
    );
  }
  // The legs of one transaction: one identity, or (M22) a Bybit record and the wallet legs of
  // the same coin under its hash.
  const byTxid = new Map<string, ChainOperationInput[]>();
  const add = (key: string, row: ChainOperationInput) =>
    byTxid.set(key, [...(byTxid.get(key) ?? []), row]);
  for (const row of sources.chain) {
    add(row.txid, row);
    if (!isExchange(row.wallet.network) && row.txid.includes('-')) add(row.txid.split('-')[0], row);
  }
  const legsOf = (row: ChainOperationInput) => {
    const exchange = isExchange(row.wallet.network);
    const loose = exchange
      ? (byTxid.get(row.txid) ?? [])
      : (byTxid.get(row.txid.split('-')[0]) ?? []);
    return [
      ...new Set([
        ...(byTxid.get(row.txid) ?? []).filter(
          (leg) => leg.txid === row.txid && !exchange && !isExchange(leg.wallet.network),
        ),
        ...loose.filter(
          (leg) =>
            isExchange(leg.wallet.network) !== exchange &&
            sameTransaction(
              { network: row.wallet.network, txid: row.txid },
              { network: leg.wallet.network, txid: leg.txid },
            ) &&
            coinOf({ network: leg.wallet.network, asset: leg.asset }) ===
              coinOf({ network: row.wallet.network, asset: row.asset }),
        ),
      ]),
    ];
  };
  const byLeg = new Map(sources.chain.map((row) => [`${row.wallet.id}:${row.txid}`, row]));
  // SWAP-ONE-TX: every leg of one blockchain transaction, across the owner's addresses.
  const byHash = new Map<string, ChainOperationInput[]>();
  for (const row of sources.chain)
    if (!isExchange(row.wallet.network))
      byHash.set(hashKey(row), [...(byHash.get(hashKey(row)) ?? []), row]);
  // TOKEN-FEE: a token send pays its network fee in the network's own coin (ETH, SOL, TRX),
  // which the chain records as a leg of its own. That leg is listed as the fee of the send
  // from the same address (the first, when one transaction sent several tokens), not as a
  // transaction to classify; the coins it spent still count (D1).
  const gas = new Map<ChainOperationInput, ChainOperationInput>();
  for (const row of sources.chain) {
    if (!gasOnly(row)) continue;
    const [send] = (byHash.get(hashKey(row)) ?? [])
      .filter((leg) => leg.wallet.id === row.wallet.id && leg.asset !== null && netUnits(leg) < 0n)
      .sort((left, right) => left.txid.localeCompare(right.txid, 'en', { numeric: true }));
    if (send) gas.set(send, row);
  }
  const folded = new Set(gas.values());
  const gasOf = (leg: ChainOperationInput) => gas.get(leg);
  // CLS-RECORDED: trades and swaps added by hand or from CSV a transaction can name.
  const records = new Map(
    entries
      .filter(({ operation }) => operation.kind === 'trade' || operation.kind === 'swap')
      .map(({ operation }) => [operation.id, operation] as const),
  );
  // POOL-PARTIAL: the withdrawals of one deposit are settled in the order they happened.
  const settled = new Map<ChainOperationInput, PoolSettlement>();
  const withdrawals = new Map<string, ChainOperationInput[]>();
  for (const row of sources.chain) {
    const answer = row.classification;
    if (answer?.status !== 'classified' || answer.type !== 'pool-withdrawal' || !answer.paired)
      continue;
    const key = `${answer.paired.addressId}:${answer.paired.txid}`;
    withdrawals.set(key, [...(withdrawals.get(key) ?? []), row]);
  }
  for (const [key, rows] of withdrawals) {
    const deposit = byLeg.get(key);
    if (!deposit) continue;
    const units = (leg: ChainOperationInput) => ({ ...leg, network: leg.wallet.network });
    const ordered = [...rows].sort(byPoolOrder);
    const steps = settlePool(
      poolDepositAtoms(units(deposit)),
      ordered.map((leg) => ({
        returnedAtoms: poolReturnAtoms(units(leg)),
        partial:
          leg.classification?.details?.type === 'pool-withdrawal' &&
          leg.classification.details.partial === true,
      })),
    );
    ordered.forEach((leg, index) => {
      settled.set(leg, steps[index]);
    });
  }
  for (const row of sources.chain) {
    if (folded.has(row)) continue;
    const ref = row.classification?.produced;
    const entry = ref ? produced.get(`${ref.kind}:${ref.id}`) : undefined;
    const paired = row.classification?.paired;
    const pair = paired ? (byLeg.get(`${paired.addressId}:${paired.txid}`) ?? null) : null;
    // CLS-SWAP: a swap is listed once, on the row of the coins it bought.
    if (entry?.kind === 'swap' && pair && netUnits(row) < 0n) continue;
    const other = paired ? pair : counterpart(row, legsOf(row));
    // XFER-AUTO: a transfer between two of the owner's addresses is listed once, on the
    // sending leg; the receiving leg is part of it.
    if (
      entry?.kind === 'transfer' &&
      other &&
      row.classification?.linkedAddressId &&
      netUnits(row) > 0n
    )
      continue;
    const operation = oneTransactionSwap(
      chainOperation(
        row,
        sources.marketPrices,
        entry,
        other,
        dustThresholdUsd,
        gasOf,
        records,
        settled,
      ),
      row,
      byHash.get(hashKey(row)) ?? [],
    );
    entries.push({ operation, order: operation.orderWithinTimestamp });
  }

  entries.sort(
    (left, right) =>
      right.operation.occurredAt.localeCompare(left.operation.occurredAt) ||
      right.order - left.order ||
      left.operation.id.localeCompare(right.operation.id),
  );
  const operations = entries.map((entry) => inCurrency(entry.operation, fx));
  return {
    at: at.toISOString(),
    quoteCurrency: fx.currency,
    needsClassificationCount: operations.filter(
      (operation) => operation.status === 'needs-classification',
    ).length,
    dustThresholdUsd,
    operations,
  };
}
