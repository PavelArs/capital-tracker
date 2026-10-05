import { canonicalDecimalToAtoms, formatAtoms, formatProduct } from './money';
import type { TradePayment } from './paid-currency';

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
  | 'withdrawal';

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
}

export interface OperationList {
  at: string;
  quoteCurrency: 'USD';
  needsClassificationCount: number;
  operations: Operation[];
}

const CHAIN_ASSETS: Record<OperationWallet['network'], OperationAsset> = {
  bitcoin: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' },
};
const USD: OperationAsset = { instrumentId: null, symbol: 'USD', name: 'US dollar' };
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
  const operation: Operation = {
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
export function projectOperations(at: Date, sources: OperationSources): OperationList {
  const entries: { operation: Operation; order: number }[] = [];
  const push = (operation: Omit<Operation, 'orderWithinTimestamp'>, order: number) =>
    entries.push({ operation: { ...operation, orderWithinTimestamp: order }, order });

  for (const row of sources.trades) {
    push(
      {
        ...blank,
        id: `trade:${row.tradeId}`,
        kind: 'trade',
        type: row.side,
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
  const operations = entries.map((entry) => entry.operation);
  return {
    at: at.toISOString(),
    quoteCurrency: 'USD',
    needsClassificationCount: operations.filter(
      (operation) => operation.status === 'needs-classification',
    ).length,
    operations,
  };
}
