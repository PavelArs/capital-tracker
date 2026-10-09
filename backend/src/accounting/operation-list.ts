import { type AccountingCurrency, FxConverter, moscowDate } from '../fx-rates/fx-conversion';
import { chainAsset, type Network, unitsToAtoms } from '../wallet-addresses/chain-assets';
import type { ChainType, Classification } from './chain-classification';
import { isDust } from './chain-dust';
import { canonicalDecimalToAtoms, formatAtoms, formatProduct } from './money';
import type { TradePayment } from './paid-currency';
import type { TradePurpose } from './trade-purpose';

// One read model over every journal and the raw chain history (list-all-operations).

export interface OperationAsset {
  instrumentId: string | null;
  symbol: string | null;
  name: string;
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
}
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
  classification?: ChainClassificationInput | null;
}
export interface OperationSources {
  trades: readonly TradeOperationInput[];
  transfers: readonly TransferOperationInput[];
  swaps: readonly SwapOperationInput[];
  rewards: readonly RewardOperationInput[];
  openings: readonly OpeningOperationInput[];
  flows: readonly FlowOperationInput[];
  chain: readonly ChainOperationInput[];
  /** Latest stored USD price by upper-case ticker. */
  marketPrices: ReadonlyMap<string, StoredMarketPrice>;
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
  | 'other';

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
  /** Chain only: quantity at the latest stored price, an estimate. */
  estimatedValueUsd: string | null;
  costBasisUsd: string | null;
  feeUsd: string | null;
  fee: OperationFee | null;
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
    /** CLS-SWAP: the paying transaction of a swap listed on its receiving row, or null. */
    pairedTxid: string | null;
  } | null;
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
  // operation's Moscow date (an estimate: of today); null without an amount or a rate.
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

/** What a chain leg moves, as the list names assets; the fee is in the network's own coin. */
function legAsset(network: Network, token: string | null): OperationAsset {
  const { symbol, name } = chainAsset(network, token);
  return { instrumentId: null, symbol, name };
}
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
function inCurrency(operation: Projected, fx: FxConverter, today: string): Operation {
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
      : fx.convert(productAtoms(operation.estimatedValueUsd), 'USD', today);
  return {
    ...operation,
    value: convert(operation.valueUsd, paid?.gross),
    estimatedValue: estimate === null ? null : formatProduct(estimate),
    costBasis: convert(operation.costBasisUsd, undefined),
    feeValue: convert(operation.feeUsd, paid?.fee),
  };
}
const recorded = { status: 'recorded', source: 'manual' } as const;

function amount(units: bigint, network: Network, token: string | null): string {
  return formatAtoms(unitsToAtoms(units, chainAsset(network, token)));
}

const netUnits = (row: ChainOperationInput) => BigInt(row.receivedUnits) - BigInt(row.sentUnits);

/** Quantity at the latest stored price, an estimate. */
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

function chainOperation(
  row: ChainOperationInput,
  prices: OperationSources['marketPrices'],
  produced: Projected | undefined,
  other: ChainOperationInput | null,
  dustThresholdUsd: string | null,
): Projected {
  const { network } = row.wallet;
  const asset = legAsset(network, row.asset);
  const net = netUnits(row);
  const magnitude = net < 0n ? -net : net;
  const quantity = amount(magnitude, network, row.asset);
  const price = asset.symbol ? prices.get(asset.symbol) : undefined;
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
    fee:
      row.direction === 'in' || BigInt(row.feeUnits) === 0n
        ? null
        : {
            asset: legAsset(network, null),
            quantity: amount(BigInt(row.feeUnits), network, null),
          },
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
      fee:
        BigInt(row.feeUnits) === 0n
          ? null
          : {
              asset: legAsset(network, null),
              quantity: amount(BigInt(row.feeUnits), network, null),
            },
    };
  }
  // CLS-DUST: nobody has answered it and it is worth too little to ask about.
  if (
    (answer === null || answer.status === 'unclassified') &&
    isDust(row.direction, operation.estimatedValueUsd, dustThresholdUsd)
  )
    return { ...operation, status: 'dust' };
  // An outgoing Other records no entry: the coins left with no sale price (D1).
  if (answer?.status === 'classified' && answer.type === 'other' && !answer.produced)
    return { ...operation, type: 'other', status: 'recorded' };
  // CLS-BUY: the row reads as the entry it produced, raw facts kept. An entry voided
  // elsewhere leaves the transaction to classify again, with the other side to suggest.
  if (answer?.status !== 'classified' || !answer.type || !produced)
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
      asset: produced.asset,
      quantity: produced.quantity,
      counterAsset: produced.counterAsset,
      counterQuantity: produced.counterQuantity,
      valueUsd: produced.valueUsd,
      costBasisUsd: produced.valueUsd,
      estimatedValueUsd: null,
      fee:
        paying && paying.asset === null && BigInt(paying.feeUnits) > 0n
          ? {
              asset: legAsset(paying.wallet.network, null),
              quantity: amount(BigInt(paying.feeUnits), paying.wallet.network, null),
            }
          : null,
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
      fee: produced.fee,
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
  const byTxid = new Map<string, ChainOperationInput[]>();
  for (const row of sources.chain) byTxid.set(row.txid, [...(byTxid.get(row.txid) ?? []), row]);
  const byLeg = new Map(sources.chain.map((row) => [`${row.wallet.id}:${row.txid}`, row]));
  for (const row of sources.chain) {
    const ref = row.classification?.produced;
    const entry = ref ? produced.get(`${ref.kind}:${ref.id}`) : undefined;
    const paired = row.classification?.paired;
    const pair = paired ? (byLeg.get(`${paired.addressId}:${paired.txid}`) ?? null) : null;
    // CLS-SWAP: a swap is listed once, on the row of the coins it bought.
    if (entry?.kind === 'swap' && pair && netUnits(row) < 0n) continue;
    const other = paired ? pair : counterpart(row, byTxid.get(row.txid) ?? []);
    // XFER-AUTO: a transfer between two of the owner's addresses is listed once, on the
    // sending leg; the receiving leg is part of it.
    if (
      entry?.kind === 'transfer' &&
      other &&
      row.classification?.linkedAddressId &&
      netUnits(row) > 0n
    )
      continue;
    const operation = chainOperation(row, sources.marketPrices, entry, other, dustThresholdUsd);
    entries.push({ operation, order: operation.orderWithinTimestamp });
  }

  entries.sort(
    (left, right) =>
      right.operation.occurredAt.localeCompare(left.operation.occurredAt) ||
      right.order - left.order ||
      left.operation.id.localeCompare(right.operation.id),
  );
  const today = moscowDate(at);
  const operations = entries.map((entry) => inCurrency(entry.operation, fx, today));
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
