import { type AccountingCurrency, FxConverter, moscowDate } from '../fx-rates/fx-conversion';
import { canonicalDecimalToAtoms, formatAtoms, formatProduct } from './money';
import type { TradePayment } from './paid-currency';
import type { TradePurpose } from './trade-purpose';

// One read model over every journal and the raw chain history (list-all-operations).
const SAT_TO_ATOMS = 10n ** 22n;

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
  network: 'bitcoin';
  address: string;
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
export interface ChainOperationInput {
  wallet: OperationWallet;
  txid: string;
  blockHeight: number;
  blockTime: string;
  direction: 'in' | 'out' | 'self';
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
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
}

export type OperationType =
  | 'buy'
  | 'sell'
  | 'transfer'
  | 'swap'
  | 'reward'
  | 'staking-reward'
  | 'airdrop'
  | 'opening-balance'
  | 'deposit'
  | 'withdrawal'
  | 'income'
  | 'expense'
  | 'gift'
  | 'fee';

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
  counterAccount: OperationPlace | null;
  wallet: OperationWallet | null;
  chain: { txid: string; blockHeight: number; priceObservedAt: string | null } | null;
  status: 'recorded' | 'needs-classification';
  source: 'manual' | 'csv' | 'chain';
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
  operations: Operation[];
}

const CHAIN_ASSETS: Record<OperationWallet['network'], OperationAsset> = {
  bitcoin: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' },
};
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
  chain: null,
  paid: null,
  comment: null,
  settlement: null,
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

function sats(units: string): string {
  return formatAtoms(BigInt(units) * SAT_TO_ATOMS);
}

function chainOperation(row: ChainOperationInput, prices: OperationSources['marketPrices']) {
  const asset = CHAIN_ASSETS[row.wallet.network];
  const net = BigInt(row.receivedUnits) - BigInt(row.sentUnits);
  const magnitude = net < 0n ? -net : net;
  const quantity = formatAtoms(magnitude * SAT_TO_ATOMS);
  const price = asset.symbol ? prices.get(asset.symbol) : undefined;
  const operation: Projected = {
    ...blank,
    id: `chain:${row.wallet.id}:${row.txid}`,
    kind: 'chain',
    type: null,
    direction: row.direction === 'self' ? 'internal' : row.direction,
    occurredAt: row.blockTime,
    asset,
    quantity,
    estimatedValueUsd: price
      ? formatProduct(canonicalDecimalToAtoms(quantity) * canonicalDecimalToAtoms(price.priceUsd))
      : null,
    // The sender pays an incoming transaction's fee.
    fee:
      row.direction === 'in' || BigInt(row.feeUnits) === 0n
        ? null
        : { asset, quantity: sats(row.feeUnits) },
    wallet: row.wallet,
    chain: {
      txid: row.txid,
      blockHeight: row.blockHeight,
      priceObservedAt: price?.observedAt ?? null,
    },
    status: 'needs-classification',
    source: 'chain',
    version: null,
    orderWithinTimestamp: 0,
  };
  return operation;
}

/** Every known operation, newest first; raw chain rows stay unclassified (OPS-1..3). */
export function projectOperations(
  at: Date,
  sources: OperationSources,
  fx: FxConverter = inUsdOnly(),
): OperationList {
  const entries: { operation: Projected; order: number }[] = [];
  const push = (operation: Omit<Projected, 'orderWithinTimestamp'>, order: number) =>
    entries.push({ operation: { ...operation, orderWithinTimestamp: order }, order });

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
  for (const row of sources.chain)
    entries.push({ operation: chainOperation(row, sources.marketPrices), order: 0 });

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
    operations,
  };
}
