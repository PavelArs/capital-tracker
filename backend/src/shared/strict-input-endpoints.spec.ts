import { BadRequestException } from '@nestjs/common';
import { parseRewardVoid } from '../accounting/asset-reward-input';
import { parseSwapVoid } from '../accounting/asset-swap-input';
import { parseCarryInLotsQuery } from '../accounting/carry-in-input';
import { parseRemoval } from '../accounting/chain-classification';
import { parseCsvRollback } from '../accounting/csv-input';
import { parseListQuery } from '../accounting/input';
import { parseTwrBoundaryQuery } from '../accounting/linked-twr-input';
import { parseManualPortfolioRequest } from '../accounting/manual-portfolio-valuation-input';
import { parsePriceVoid } from '../accounting/manual-price-input';
import { parseTransferVoid } from '../accounting/owned-transfer-input';
import { parseFlowVoid } from '../accounting/portfolio-flow-input';
import { parseTradeVoid } from '../accounting/trade-input';
import { parseCheck as parseBrokerCheck } from '../brokers/broker-connection-input';
import { parseBrokerOpening } from '../brokers/broker-opening';
import { parseRateChange } from '../deposits/deposit-input';
import { parseGoalPreview } from '../goals/goal-input';
import { parseTokenVisibility } from '../wallet-addresses/wallet-address-input';

const id = '00000000-0000-4000-8000-000000000001';
const at = '2024-02-25T00:00:00Z';

type Case = {
  name: string;
  parse: (raw: unknown) => unknown;
  valid: Record<string, unknown>;
  /** A key the endpoint needs, or null when every key is optional. */
  required: string | null;
};

const cases: Case[] = [
  {
    name: 'accounting/input parseListQuery',
    parse: parseListQuery,
    valid: { limit: '10' },
    required: null,
  },
  {
    name: 'accounting/carry-in-input parseCarryInLotsQuery',
    parse: parseCarryInLotsQuery,
    valid: { limit: '10' },
    required: null,
  },
  {
    name: 'accounting/csv-input parseCsvRollback',
    parse: parseCsvRollback,
    valid: { requestId: id, expectedJournalRevision: 0 },
    required: 'requestId',
  },
  {
    name: 'accounting/owned-transfer-input parseTransferVoid',
    parse: parseTransferVoid,
    valid: {
      requestId: id,
      expectedFromJournalRevision: 0,
      expectedToJournalRevision: 0,
      expectedVersion: 1,
    },
    required: 'expectedVersion',
  },
  {
    name: 'accounting/manual-portfolio-valuation-input parseManualPortfolioRequest',
    parse: (raw) => parseManualPortfolioRequest(raw, {}),
    valid: { at, accountIds: [id] },
    required: 'at',
  },
  {
    name: 'accounting/portfolio-flow-input parseFlowVoid',
    parse: parseFlowVoid,
    valid: { requestId: id, expectedJournalRevision: 0 },
    required: 'expectedJournalRevision',
  },
  {
    name: 'accounting/linked-twr-input parseTwrBoundaryQuery',
    parse: parseTwrBoundaryQuery,
    valid: { from: '2024-01-01T00:00:00Z', to: at },
    required: 'to',
  },
  {
    name: 'accounting/manual-price-input parsePriceVoid',
    parse: parsePriceVoid,
    valid: { requestId: id, expectedRevision: 0, observedAt: at, assertReviewed: true },
    required: 'observedAt',
  },
  {
    name: 'accounting/asset-swap-input parseSwapVoid',
    parse: parseSwapVoid,
    valid: { requestId: id, expectedJournalRevision: 0, expectedVersion: 1 },
    required: 'requestId',
  },
  {
    name: 'accounting/trade-input parseTradeVoid',
    parse: parseTradeVoid,
    valid: { requestId: id, expectedJournalRevision: 0 },
    required: 'requestId',
  },
  {
    name: 'accounting/chain-classification parseRemoval',
    parse: parseRemoval,
    valid: { requestId: id, expectedVersion: 0 },
    required: 'expectedVersion',
  },
  {
    name: 'accounting/asset-reward-input parseRewardVoid',
    parse: parseRewardVoid,
    valid: { requestId: id, expectedJournalRevision: 0, expectedVersion: 1 },
    required: 'expectedVersion',
  },
  {
    name: 'brokers/broker-opening parseBrokerOpening',
    parse: parseBrokerOpening,
    valid: {
      asOf: at,
      lots: [{ asset: id, acquiredAt: '2024-02-01T00:00:00Z', quantity: '1.5', costUsd: '10' }],
    },
    required: 'asOf',
  },
  {
    name: 'brokers/broker-connection-input parseCheck',
    parse: parseBrokerCheck,
    valid: { token: 't.synthetic-test-token-0000000000' },
    required: 'token',
  },
  {
    name: 'goals/goal-input parseGoalPreview',
    parse: parseGoalPreview,
    valid: { currency: 'RUB', targetAmount: '2500000', expectedReturnPercent: '12.50' },
    required: 'currency',
  },
  {
    name: 'deposits/deposit-input parseRateChange',
    parse: parseRateChange,
    valid: { effectiveFrom: '2024-02-01', ratePercent: '12.5' },
    required: 'ratePercent',
  },
  {
    name: 'wallet-addresses/wallet-address-input parseTokenVisibility',
    parse: parseTokenVisibility,
    valid: { tickers: ['BTC'], visibility: 'hidden' },
    required: 'visibility',
  },
];

const rejects = (parse: Case['parse'], raw: unknown) =>
  expect(() => parse(raw)).toThrow(BadRequestException);

describe.each(cases)('INPUT-STRICT-BODY: $name', ({ parse, valid, required }) => {
  it('accepts the valid body', () => {
    expect(() => parse(valid)).not.toThrow();
  });

  it('accepts the valid body with a null prototype', () => {
    expect(() => parse(Object.assign(Object.create(null), valid))).not.toThrow();
  });

  it('rejects an unknown key', () => rejects(parse, { ...valid, unexpected: 1 }));

  it('rejects a missing required key', () => {
    if (required === null) return;
    const { [required]: _, ...rest } = valid;
    rejects(parse, rest);
  });

  it('rejects an array', () => rejects(parse, [valid]));

  it('rejects null', () => rejects(parse, null));

  it('rejects an object with a non-plain prototype', () =>
    rejects(parse, Object.assign(Object.create({ inherited: true }), valid)));

  it('rejects an object with a symbol key', () =>
    rejects(parse, { ...valid, [Symbol('extra')]: true }));

  it('rejects an object with a non-enumerable unknown key', () =>
    rejects(parse, Object.defineProperty({ ...valid }, 'hidden', { value: 1 })));
});
