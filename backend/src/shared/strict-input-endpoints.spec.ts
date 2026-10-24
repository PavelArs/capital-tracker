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
  /** Today's copy reads keys with Object.keys and has no prototype check. */
  prototypeAccepted?: true;
  /** Today's copy reads keys with Object.keys, so symbol and non-enumerable keys slip through. */
  hiddenKeysAccepted?: true;
};

const cases: Case[] = [
  {
    name: 'accounting/input parseListQuery',
    parse: parseListQuery,
    valid: { limit: '10' },
    required: null,
    prototypeAccepted: true,
    hiddenKeysAccepted: true,
  },
  {
    name: 'accounting/carry-in-input parseCarryInLotsQuery',
    parse: parseCarryInLotsQuery,
    valid: { limit: '10' },
    required: null,
    hiddenKeysAccepted: true,
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
    hiddenKeysAccepted: true,
  },
  {
    name: 'accounting/portfolio-flow-input parseFlowVoid',
    parse: parseFlowVoid,
    valid: { requestId: id, expectedJournalRevision: 0 },
    required: 'expectedJournalRevision',
    hiddenKeysAccepted: true,
  },
  {
    name: 'accounting/linked-twr-input parseTwrBoundaryQuery',
    parse: parseTwrBoundaryQuery,
    valid: { from: '2024-01-01T00:00:00Z', to: at },
    required: 'to',
    hiddenKeysAccepted: true,
  },
  {
    name: 'accounting/manual-price-input parsePriceVoid',
    parse: parsePriceVoid,
    valid: { requestId: id, expectedRevision: 0, observedAt: at, assertReviewed: true },
    required: 'observedAt',
    hiddenKeysAccepted: true,
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
    hiddenKeysAccepted: true,
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
    prototypeAccepted: true,
    hiddenKeysAccepted: true,
  },
  {
    name: 'brokers/broker-connection-input parseCheck',
    parse: parseBrokerCheck,
    valid: { token: 't.synthetic-test-token-0000000000' },
    required: 'token',
    prototypeAccepted: true,
    hiddenKeysAccepted: true,
  },
  {
    name: 'goals/goal-input parseGoalPreview',
    parse: parseGoalPreview,
    valid: { currency: 'RUB', targetAmount: '2500000', expectedReturnPercent: '12.50' },
    required: 'currency',
    prototypeAccepted: true,
    hiddenKeysAccepted: true,
  },
  {
    name: 'deposits/deposit-input parseRateChange',
    parse: parseRateChange,
    valid: { effectiveFrom: '2024-02-01', ratePercent: '12.5' },
    required: 'ratePercent',
    prototypeAccepted: true,
    hiddenKeysAccepted: true,
  },
  {
    name: 'wallet-addresses/wallet-address-input parseTokenVisibility',
    parse: parseTokenVisibility,
    valid: { tickers: ['BTC'], visibility: 'hidden' },
    required: 'visibility',
    hiddenKeysAccepted: true,
  },
];

const rejects = (parse: Case['parse'], raw: unknown) =>
  expect(() => parse(raw)).toThrow(BadRequestException);
const pinned = (accepted: boolean | undefined, parse: Case['parse'], raw: unknown) =>
  accepted ? expect(() => parse(raw)).not.toThrow() : rejects(parse, raw);

describe.each(cases)('INPUT-STRICT-BODY: $name', (row) => {
  const { parse, valid, required } = row;

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

  it('pins an object with a non-plain prototype', () =>
    pinned(row.prototypeAccepted, parse, Object.assign(Object.create({ inherited: true }), valid)));

  it('pins an object with a symbol key', () =>
    pinned(row.hiddenKeysAccepted, parse, { ...valid, [Symbol('extra')]: true }));

  it('pins an object with a non-enumerable unknown key', () =>
    pinned(
      row.hiddenKeysAccepted,
      parse,
      Object.defineProperty({ ...valid }, 'hidden', { value: 1 }),
    ));
});
