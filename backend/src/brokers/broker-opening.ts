import { BadRequestException } from '@nestjs/common';
import { parseAsOf, parseDecimal, parseUuid } from '../accounting/input';
import { canonicalDecimalToAtoms, formatAtoms } from '../accounting/money';
import type { TBankOperation, TBankPosition } from './tbank-client';
import { cashOf } from './tbank-import-plan';
import { operationKind } from './tbank-operation-kinds';

export interface BrokerOpening {
  asOf: string;
  lots: { asset: string; acquiredAt: string; quantity: string; costUsd: string }[];
}
const bad = (): never => {
  throw new BadRequestException('Invalid broker opening holdings');
};
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    return bad();
  return value as Record<string, unknown>;
}

/** Explicit owner data only: unknown costs cannot become zero-cost FIFO lots. */
export function parseBrokerOpening(raw: unknown): BrokerOpening | undefined {
  if (raw === undefined) return undefined;
  const row = object(raw, ['asOf', 'lots']);
  const asOf = parseAsOf(row.asOf);
  if (!Array.isArray(row.lots) || row.lots.length < 1 || row.lots.length > 100) return bad();
  const lots = row.lots
    .map((rawLot) => {
      const lot = object(rawLot, ['asset', 'acquiredAt', 'quantity', 'costUsd']);
      const asset =
        typeof lot.asset === 'string' && /^cash:(USD|EUR|RUB)$/.test(lot.asset)
          ? lot.asset
          : parseUuid(lot.asset);
      const acquiredAt = parseAsOf(lot.acquiredAt);
      if (acquiredAt > asOf) return bad();
      return {
        asset,
        acquiredAt,
        quantity: parseDecimal(lot.quantity, true),
        costUsd: parseDecimal(lot.costUsd, false),
      };
    })
    .sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt) || a.asset.localeCompare(b.asset));
  return { asOf, lots };
}

/** Securities use provider UIDs in the planner; cash is checked by the journal replay. */
export function openingQuantities(opening: BrokerOpening | undefined) {
  const amounts = new Map<string, bigint>();
  for (const lot of opening?.lots ?? [])
    amounts.set(lot.asset, (amounts.get(lot.asset) ?? 0n) + canonicalDecimalToAtoms(lot.quantity));
  return amounts;
}

export function openingPositions(
  lots: { instrumentId: string; quantity: string; costUsd: string }[],
) {
  const grouped = new Map<string, { quantity: bigint; cost: bigint }>();
  for (const lot of lots) {
    const prior = grouped.get(lot.instrumentId) ?? { quantity: 0n, cost: 0n };
    grouped.set(lot.instrumentId, {
      quantity: prior.quantity + canonicalDecimalToAtoms(lot.quantity),
      cost: prior.cost + canonicalDecimalToAtoms(lot.costUsd),
    });
  }
  return [...grouped].map(([instrumentId, value]) => ({
    instrumentId,
    quantity: parseDecimal(formatAtoms(value.quantity), true),
    costStatus: 'known' as const,
    totalCostUsd: parseDecimal(formatAtoms(value.cost), false),
  }));
}

/** CurrencyBy proves which positions are the cash currencies this ledger keeps. */
export function cashPositionCurrency(position: TBankPosition) {
  const code = position.currencyCode;
  return position.instrumentType === 'currency' &&
    (code === 'USD' || code === 'EUR' || code === 'RUB')
    ? code
    : undefined;
}

/** The import's own instrument identities, not ticker guesses supplied by the browser. */
export function openingAssets(
  operations: readonly TBankOperation[],
  positions: readonly TBankPosition[] = [],
) {
  const assets = new Map<string, { asset: string; label: string; currency: string }>(
    ['USD', 'EUR', 'RUB'].map((currency) => [
      `cash:${currency}`,
      { asset: `cash:${currency}`, label: `${currency} cash`, currency: currency.toLowerCase() },
    ]),
  );
  for (const operation of operations) {
    if (
      operation.state !== 'executed' ||
      cashOf(operation) ||
      !operation.instrumentUid ||
      !['buy', 'sell', 'repayment'].includes(operationKind(operation.type)) ||
      !['usd', 'eur', 'rub'].includes(operation.paymentCurrency)
    )
      continue;
    assets.set(operation.instrumentUid, {
      asset: operation.instrumentUid,
      label: operation.ticker || operation.instrumentUid,
      currency: operation.paymentCurrency,
    });
  }
  for (const position of positions) {
    const currency = [position.currentPriceCurrency, position.averagePriceCurrency].find((code) =>
      ['usd', 'eur', 'rub'].includes(code),
    );
    if (
      position.virtual ||
      position.quantity === '0' ||
      position.quantity.startsWith('-') ||
      (!['share', 'bond', 'etf'].includes(position.instrumentType) &&
        !(
          position.instrumentType === 'currency' &&
          position.currencyCode &&
          !cashPositionCurrency(position)
        )) ||
      !currency ||
      assets.has(position.instrumentUid)
    )
      continue;
    assets.set(position.instrumentUid, {
      asset: position.instrumentUid,
      label: position.instrumentUid,
      currency,
    });
  }
  return [...assets.values()];
}
