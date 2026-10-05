import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  type AccountingCurrency,
  FxConverter,
  isAccountingCurrency,
} from '../fx-rates/fx-conversion';
import { readFxRates } from '../fx-rates/fx-rates.service';
import { readMainCurrency } from '../owner-settings/owner-settings.service';
import { latestMarketPrices } from '../prices/market-price.store';
import { deriveCarryInAmounts } from './fifo';
import { parseDecimal, parseUuid } from './input';
import {
  type ChainOperationInput,
  type OperationAsset,
  type OperationFee,
  type OperationList,
  type OperationPlace,
  projectOperations,
  type RewardOperationInput,
} from './operation-list';
import { isPaidCurrency, isRateSource, type TradePayment } from './paid-currency';

interface Named {
  accountId: string;
  accountName: string;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  occurredAt: Date;
  orderWithinTimestamp: number;
}
interface Versioned extends Named {
  version: number;
}
interface FeeColumns {
  feeInstrumentId: string | null;
  feeName: string | null;
  feeSymbol: string | null;
  feeQuantity: string;
}
interface TradeRow extends Versioned {
  tradeId: string;
  side: 'buy' | 'sell';
  quantity: string;
  grossUsd: string;
  feeUsd: string;
  csv: boolean;
  paidCurrency: string | null;
  paidGross: string | null;
  paidFee: string | null;
  paidRateDate: string | null;
  paidPerUsd: string | null;
  paidRateSource: string | null;
  comment: string | null;
}
interface TransferRow extends Versioned, FeeColumns {
  transferId: string;
  toAccountId: string;
  toAccountName: string;
  quantity: string;
}
interface SwapRow extends Versioned, FeeColumns {
  swapId: string;
  incomingInstrumentId: string;
  incomingName: string;
  incomingSymbol: string | null;
  outgoingQuantity: string;
  incomingQuantity: string;
  considerationUsd: string | null;
}
interface RewardRow extends Versioned {
  rewardId: string;
  category: RewardOperationInput['category'];
  quantity: string;
  incomeValueUsd: string | null;
  acquisitionBasisUsd: string | null;
}
interface OpeningRow extends Named {
  lotId: string;
  originalQuantity: string;
  originalCostUsd: string;
  carriedQuantity: string;
}
interface FlowRow {
  flowId: string;
  version: number;
  direction: 'contribution' | 'withdrawal';
  occurredAt: Date;
  amountUsd: string;
}
interface ChainRow {
  addressId: string;
  network: 'bitcoin';
  address: string;
  txid: string;
  blockHeight: number;
  blockTime: Date;
  direction: ChainOperationInput['direction'];
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
}

// Current versions only: a voided operation has left the books (its history keeps it).
const named = `v."accountId", a.name AS "accountName", v."instrumentId", i.name AS "instrumentName",
  i.symbol AS "instrumentSymbol", v."occurredAt", v."orderWithinTimestamp", v.version`;
const instrumentJoin = `JOIN accounting_instruments i ON i."ownerId"=v."ownerId" AND i.id=v."instrumentId"`;
const accountJoin = `JOIN manual_accounts a ON a."ownerId"=v."ownerId" AND a.id=v."accountId"`;
const feeColumns = `v."feeInstrumentId", fi.name AS "feeName", fi.symbol AS "feeSymbol",
  v."feeQuantity"::text AS "feeQuantity"`;
const feeJoin = `LEFT JOIN accounting_instruments fi ON fi."ownerId"=v."ownerId" AND fi.id=v."feeInstrumentId"`;

const decimal = (value: string) => parseDecimal(value, false);
const optional = (value: string | null) => (value === null ? null : decimal(value));
const place = (row: Named): OperationPlace => ({ id: row.accountId, name: row.accountName });
const asset = (id: string, name: string, symbol: string | null): OperationAsset => ({
  instrumentId: id,
  symbol,
  name,
});
const held = (row: Named) => asset(row.instrumentId, row.instrumentName, row.instrumentSymbol);
function fee(row: FeeColumns): OperationFee | null {
  if (row.feeInstrumentId === null || row.feeName === null) return null;
  return {
    asset: asset(row.feeInstrumentId, row.feeName, row.feeSymbol),
    quantity: decimal(row.feeQuantity),
  };
}

function payment(row: TradeRow): TradePayment | null {
  if (row.paidCurrency === null) return null;
  if (!isPaidCurrency(row.paidCurrency) || !isRateSource(row.paidRateSource) || !row.paidRateDate)
    throw new Error('Invalid stored trade payment');
  return {
    currency: row.paidCurrency,
    gross: parseDecimal(row.paidGross, true),
    fee: decimal(row.paidFee ?? ''),
    rateDate: row.paidRateDate,
    perUsd: parseDecimal(row.paidPerUsd, true),
    rateSource: row.paidRateSource,
  };
}

/** Only `currency` (USD, EUR or RUB) may be asked; without it the main currency is used. */
function parseQuery(query: unknown): AccountingCurrency | null {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new BadRequestException('Invalid accounting input');
  const keys = Object.keys(query);
  if (keys.length === 0) return null;
  const { currency } = query as Record<string, unknown>;
  if (keys.length !== 1 || keys[0] !== 'currency' || !isAccountingCurrency(currency))
    throw new BadRequestException('Invalid accounting input');
  return currency;
}

@Injectable()
export class OperationListService {
  constructor(private readonly source: DataSource) {}

  async read(ownerId: string, rawQuery: unknown, now = new Date()): Promise<OperationList> {
    const owner = parseUuid(ownerId);
    const asked = parseQuery(rawQuery);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const trades: TradeRow[] = await manager.query(
        `SELECT t.id AS "tradeId", ${named}, v.side, v.quantity::text AS quantity,
            v."grossUsd"::text AS "grossUsd", v."feeUsd"::text AS "feeUsd",
            (r."tradeId" IS NOT NULL) AS csv, p.currency AS "paidCurrency",
            p.gross::text AS "paidGross", p.fee::text AS "paidFee",
            p."rateDate"::text AS "paidRateDate", p."perUsd"::text AS "paidPerUsd",
            p."rateSource" AS "paidRateSource", c.comment
          FROM account_trades t
          JOIN account_trade_versions v ON v."ownerId"=t."ownerId" AND v."accountId"=t."accountId"
            AND v."tradeId"=t.id AND v.version=t."currentVersion"
          ${instrumentJoin} ${accountJoin}
          LEFT JOIN account_trade_version_payments p ON p."ownerId"=v."ownerId"
            AND p."accountId"=v."accountId" AND p."tradeId"=v."tradeId" AND p.version=v.version
          LEFT JOIN account_trade_version_comments c ON c."ownerId"=v."ownerId"
            AND c."accountId"=v."accountId" AND c."tradeId"=v."tradeId" AND c.version=v.version
          LEFT JOIN account_csv_import_rows r ON r."ownerId"=t."ownerId"
            AND r."accountId"=t."accountId" AND r."tradeId"=t.id
          WHERE t."ownerId"=$1 AND v.kind<>'void'`,
        [owner],
      );
      const transfers: TransferRow[] = await manager.query(
        `SELECT t.id AS "transferId", t."fromAccountId" AS "accountId", a.name AS "accountName",
            t."toAccountId", b.name AS "toAccountName", v."instrumentId", i.name AS "instrumentName",
            i.symbol AS "instrumentSymbol", v."occurredAt", v."orderWithinTimestamp", v.version,
            v.quantity::text AS quantity, ${feeColumns}
          FROM owned_transfers t
          JOIN owned_transfer_versions v ON v."ownerId"=t."ownerId" AND v."transferId"=t.id
            AND v.version=t."currentVersion"
          ${instrumentJoin} ${feeJoin}
          JOIN manual_accounts a ON a."ownerId"=t."ownerId" AND a.id=t."fromAccountId"
          JOIN manual_accounts b ON b."ownerId"=t."ownerId" AND b.id=t."toAccountId"
          WHERE t."ownerId"=$1 AND v.kind<>'void'`,
        [owner],
      );
      const swaps: SwapRow[] = await manager.query(
        `SELECT s.id AS "swapId", v."accountId", a.name AS "accountName",
            v."outgoingInstrumentId" AS "instrumentId", i.name AS "instrumentName",
            i.symbol AS "instrumentSymbol", v."incomingInstrumentId", n.name AS "incomingName",
            n.symbol AS "incomingSymbol", v."occurredAt", v."orderWithinTimestamp", v.version,
            v."outgoingQuantity"::text AS "outgoingQuantity",
            v."incomingQuantity"::text AS "incomingQuantity",
            v."considerationUsd"::text AS "considerationUsd", ${feeColumns}
          FROM account_swaps s
          JOIN account_swap_versions v ON v."ownerId"=s."ownerId" AND v."accountId"=s."accountId"
            AND v."swapId"=s.id AND v.version=s."currentVersion"
          JOIN accounting_instruments i ON i."ownerId"=v."ownerId" AND i.id=v."outgoingInstrumentId"
          JOIN accounting_instruments n ON n."ownerId"=v."ownerId" AND n.id=v."incomingInstrumentId"
          ${accountJoin} ${feeJoin}
          WHERE s."ownerId"=$1 AND v.kind<>'void'`,
        [owner],
      );
      const rewards: RewardRow[] = await manager.query(
        `SELECT r.id AS "rewardId", ${named}, v.category, v.quantity::text AS quantity,
            v."incomeValueUsd"::text AS "incomeValueUsd",
            v."acquisitionBasisUsd"::text AS "acquisitionBasisUsd"
          FROM account_rewards r
          JOIN account_reward_versions v ON v."ownerId"=r."ownerId" AND v."accountId"=r."accountId"
            AND v."rewardId"=r.id AND v.version=r."currentVersion"
          ${instrumentJoin} ${accountJoin}
          WHERE r."ownerId"=$1 AND v.kind<>'void'`,
        [owner],
      );
      // A journal started with known-cost carry-in holds the lots of its own opening revision.
      const openings: OpeningRow[] = await manager.query(
        `SELECT v.id AS "lotId", v."accountId", a.name AS "accountName", v."instrumentId",
            i.name AS "instrumentName", i.symbol AS "instrumentSymbol",
            v."acquiredAt" AS "occurredAt", v."orderWithinTimestamp",
            v."originalQuantity"::text AS "originalQuantity",
            v."originalCostUsd"::text AS "originalCostUsd",
            v."remainingQuantity"::text AS "carriedQuantity"
          FROM account_trade_journals j
          JOIN account_carry_in_lots v ON v."ownerId"=j."ownerId" AND v."accountId"=j."accountId"
            AND v."openingRevision"=j."openingRevision"
          ${instrumentJoin} ${accountJoin}
          WHERE j."ownerId"=$1 AND j."originKind"='known-cost-carry-in'`,
        [owner],
      );
      const flows: FlowRow[] = await manager.query(
        `SELECT "flowId", version, direction, "occurredAt", "amountUsd" FROM (
            SELECT DISTINCT ON ("flowId") "flowId", version, kind, direction, "occurredAt",
              "amountUsd"::text AS "amountUsd"
            FROM portfolio_flow_versions WHERE "ownerId"=$1
            ORDER BY "flowId", version DESC
          ) head WHERE kind<>'void'`,
        [owner],
      );
      const chain: ChainRow[] = await manager.query(
        `SELECT w.id AS "addressId", w.network, w.address, t.txid, t."blockHeight", t."blockTime",
            t.direction, t."receivedUnits"::text AS "receivedUnits",
            t."sentUnits"::text AS "sentUnits", t."feeUnits"::text AS "feeUnits"
          FROM wallet_addresses w
          JOIN wallet_address_transactions t ON t."ownerId"=w."ownerId" AND t."addressId"=w.id
          WHERE w."ownerId"=$1`,
        [owner],
      );
      const market = await latestMarketPrices(manager, chain.length > 0 ? ['BTC'] : [], now);
      const currency = asked ?? (await readMainCurrency(manager, owner));
      const fx = new FxConverter(await readFxRates(manager), currency);

      return projectOperations(
        now,
        {
          trades: trades.map((row) => ({
            tradeId: row.tradeId,
            version: row.version,
            account: place(row),
            asset: held(row),
            side: row.side,
            occurredAt: row.occurredAt.toISOString(),
            orderWithinTimestamp: row.orderWithinTimestamp,
            quantity: decimal(row.quantity),
            grossUsd: decimal(row.grossUsd),
            feeUsd: decimal(row.feeUsd),
            csv: row.csv,
            paid: payment(row),
            comment: row.comment,
          })),
          transfers: transfers.map((row) => ({
            transferId: row.transferId,
            version: row.version,
            from: place(row),
            to: { id: row.toAccountId, name: row.toAccountName },
            asset: held(row),
            occurredAt: row.occurredAt.toISOString(),
            orderWithinTimestamp: row.orderWithinTimestamp,
            quantity: decimal(row.quantity),
            fee: fee(row),
          })),
          swaps: swaps.map((row) => ({
            swapId: row.swapId,
            version: row.version,
            account: place(row),
            outgoing: held(row),
            incoming: asset(row.incomingInstrumentId, row.incomingName, row.incomingSymbol),
            occurredAt: row.occurredAt.toISOString(),
            orderWithinTimestamp: row.orderWithinTimestamp,
            outgoingQuantity: decimal(row.outgoingQuantity),
            incomingQuantity: decimal(row.incomingQuantity),
            considerationUsd: optional(row.considerationUsd),
            fee: fee(row),
          })),
          rewards: rewards.map((row) => ({
            rewardId: row.rewardId,
            version: row.version,
            account: place(row),
            asset: held(row),
            category: row.category,
            occurredAt: row.occurredAt.toISOString(),
            orderWithinTimestamp: row.orderWithinTimestamp,
            quantity: decimal(row.quantity),
            incomeValueUsd: optional(row.incomeValueUsd),
            acquisitionBasisUsd: optional(row.acquisitionBasisUsd),
          })),
          openings: openings.map((row) => {
            const quantity = decimal(row.carriedQuantity);
            return {
              lotId: row.lotId,
              account: place(row),
              asset: held(row),
              acquiredAt: row.occurredAt.toISOString(),
              orderWithinTimestamp: row.orderWithinTimestamp,
              quantity,
              costBasisUsd: deriveCarryInAmounts(
                decimal(row.originalQuantity),
                decimal(row.originalCostUsd),
                quantity,
              ).carriedCostUsd,
            };
          }),
          flows: flows.map((row) => ({
            flowId: row.flowId,
            version: row.version,
            direction: row.direction,
            occurredAt: row.occurredAt.toISOString(),
            amountUsd: decimal(row.amountUsd),
          })),
          chain: chain.map((row) => ({
            wallet: { id: row.addressId, network: row.network, address: row.address },
            txid: row.txid,
            blockHeight: row.blockHeight,
            blockTime: row.blockTime.toISOString(),
            direction: row.direction,
            receivedUnits: row.receivedUnits,
            sentUnits: row.sentUnits,
            feeUnits: row.feeUnits,
          })),
          marketPrices: new Map(
            market.map((row) => [
              row.asset,
              { priceUsd: row.price, observedAt: row.observedAt, source: row.source },
            ]),
          ),
        },
        fx,
      );
    });
  }
}
