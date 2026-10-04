import { BadRequestException } from '@nestjs/common';
import type { InstrumentInput } from './input';

export const assetTypes = ['crypto', 'fiat', 'manual'] as const;
export const valuationCurrencies = ['USD', 'EUR', 'RUB'] as const;
export type AssetType = (typeof assetTypes)[number];
export type ValuationCurrency = (typeof valuationCurrencies)[number];
export type PriceSource = 'market' | 'manual' | 'fixed';
export interface AssetClassification {
  assetType: AssetType;
  valuationCurrency: ValuationCurrency;
  priceSource: PriceSource;
}

// Tickers the hourly price collection can quote in USD (MVP wallets, tokens and the
// owner's other coins). Migration 1790700000000 keeps its own frozen copy.
export const marketTickers: readonly string[] = [
  'BTC',
  'ETH',
  'SOL',
  'USDT',
  'USDC',
  'ZEC',
  'TRX',
  'XLM',
];

const bad = (): never => {
  throw new BadRequestException('Invalid accounting input');
};

/** One rule for new bodies, the legacy body and the migration (AST-1, AST-2). */
export function classifyAsset(input: InstrumentInput): AssetClassification {
  const ticker = input.symbol?.toUpperCase() ?? null;
  const type = input.assetType ?? (ticker && marketTickers.includes(ticker) ? 'crypto' : 'manual');
  if (input.assetType === undefined && input.valuationCurrency !== undefined) return bad();
  if (type === 'crypto') {
    if (!ticker || (input.valuationCurrency ?? 'USD') !== 'USD') return bad();
    return {
      assetType: type,
      valuationCurrency: 'USD',
      priceSource: marketTickers.includes(ticker) ? 'market' : 'manual',
    };
  }
  if (type === 'fiat') {
    const currency = valuationCurrencies.find((code) => code === ticker);
    if (!currency || (input.valuationCurrency ?? currency) !== currency) return bad();
    return { assetType: type, valuationCurrency: currency, priceSource: 'fixed' };
  }
  return {
    assetType: type,
    valuationCurrency: input.valuationCurrency ?? 'USD',
    priceSource: 'manual',
  };
}

/** Replay identity: the legacy body keeps its original payload. */
export function instrumentPayload(input: InstrumentInput, value: AssetClassification): string {
  if (input.assetType === undefined)
    return JSON.stringify({ name: input.name, symbol: input.symbol });
  return JSON.stringify({
    name: input.name,
    symbol: input.symbol,
    assetType: value.assetType,
    valuationCurrency: value.valuationCurrency,
  });
}
