import type { ConnectedLedger } from './connected-accounting.store';
import * as connected from './connected-accounting.store';
import {
  accountHistoryReader,
  accountsAt,
  type ValuationInputs,
} from './portfolio-valuation.service';

const start = '2025-01-01T00:00:00.000Z';
const receipt = '2025-01-05T21:00:00.000Z';
const purchase = '2025-01-08T12:00:00.000Z';
const ledger = {
  accounts: new Map([
    [
      'wallet',
      {
        accountId: 'wallet',
        coverageFrom: start,
        initialLots: [],
        trades: [
          {
            tradeId: 'buy',
            version: 1,
            instrumentId: 'usd',
            instrumentName: 'Dollar',
            instrumentSymbol: 'USD',
            side: 'buy',
            occurredAt: purchase,
            orderWithinTimestamp: 0,
            quantity: '10',
            grossUsd: '10',
            feeUsd: '0',
          },
        ],
        rewards: [],
        swaps: [],
        capitalReturns: [],
      },
    ],
  ]),
  transfers: [],
  participants: new Set(),
  rewardParticipants: new Set(),
  swapParticipants: new Set(),
  capitalReturnParticipants: new Set(),
} as unknown as ConnectedLedger;
const inputs: ValuationInputs = {
  instruments: [],
  hidden: new Set(),
  accounts: [{ accountId: 'wallet', name: 'Wallet', coverageFrom: new Date(start) }],
  ledgers: new Map([['wallet', ledger]]),
  chainMoves: new Map([
    ['wallet', [{ instrumentId: 'usd', occurredAt: receipt, inbound: true, quantity: '2' }]],
  ]),
  deposits: [],
};

afterEach(() => jest.restoreAllMocks());

it.each(['reward', 'swap', 'capital-return', 'transfer', 'opening'] as const)(
  'DASH-CURRENCY-PERF invalidates cached holdings at a %s boundary',
  (kind) => {
    const occurredAt = '2025-02-01T21:00:00.000Z';
    const base = ledger.accounts.get('wallet')!;
    const dated = { occurredAt, orderWithinTimestamp: 0, version: 1 };
    const changed: typeof base = {
      ...base,
      rewards:
        kind === 'reward'
          ? [
              {
                ...dated,
                rewardId: 'reward',
                instrumentId: 'usd',
                instrumentName: 'Dollar',
                instrumentSymbol: 'USD',
                category: 'other',
                quantity: '1',
                acquisitionBasisUsd: '1',
                incomeValueUsd: '1',
              },
            ]
          : [],
      swaps:
        kind === 'swap'
          ? [
              {
                ...dated,
                swapId: 'swap',
                outgoingInstrumentId: 'usd',
                outgoingInstrumentName: 'Dollar',
                outgoingInstrumentSymbol: 'USD',
                incomingInstrumentId: 'eur',
                incomingInstrumentName: 'Euro',
                incomingInstrumentSymbol: 'EUR',
                outgoingQuantity: '1',
                incomingQuantity: '1',
                considerationUsd: '1',
                feeSource: null,
                feeInstrumentId: null,
                feeQuantity: '0',
              },
            ]
          : [],
      capitalReturns:
        kind === 'capital-return'
          ? [
              {
                ...dated,
                capitalReturnId: 'return',
                instrumentId: 'usd',
                instrumentName: 'Dollar',
                instrumentSymbol: 'USD',
                cashInstrumentId: 'eur',
                cashInstrumentName: 'Euro',
                cashInstrumentSymbol: 'EUR',
                amount: '1',
                amountUsd: '1',
                paidCurrency: null,
              },
            ]
          : [],
      ...(kind === 'opening'
        ? {
            coverageFrom: occurredAt,
            trades: [],
            initialLots: [
              {
                lotId: 'opening',
                openingRevision: 1,
                ordinal: 1,
                instrumentId: 'usd',
                instrumentName: 'Dollar',
                instrumentSymbol: 'USD',
                acquiredAt: start,
                orderWithinTimestamp: 0,
                originalQuantity: '10',
                originalCostUsd: '10',
                carriedQuantity: '10',
              },
            ],
          }
        : {}),
    };
    const nextLedger = {
      ...ledger,
      accounts: new Map([
        ['wallet', changed],
        ['recipient', { ...base, accountId: 'recipient', trades: [] }],
      ]),
      transfers:
        kind === 'transfer'
          ? [
              {
                ...dated,
                transferId: 'transfer',
                kind: 'create',
                fromAccountId: 'wallet',
                toAccountId: 'recipient',
                instrumentId: 'usd',
                instrumentName: 'Dollar',
                instrumentSymbol: 'USD',
                quantity: '1',
                feeInstrumentId: null,
                feeQuantity: '0',
              },
            ]
          : [],
    } as unknown as ConnectedLedger;
    const nextInputs: ValuationInputs = {
      ...inputs,
      chainMoves: new Map(),
      ledgers: new Map([
        ['wallet', nextLedger],
        ['recipient', nextLedger],
      ]),
      accounts: [
        { ...inputs.accounts[0], coverageFrom: new Date(changed.coverageFrom) },
        { accountId: 'recipient', name: 'Recipient', coverageFrom: new Date(start) },
      ],
    };
    const read = accountHistoryReader(nextInputs);
    const before = new Date(Date.parse(occurredAt) - 1).toISOString();
    expect(read(before)).toEqual(accountsAt(nextInputs, before, { emptyBeforeCoverage: true }));
    const after = read(occurredAt);
    expect(after).toEqual(accountsAt(nextInputs, occurredAt, { emptyBeforeCoverage: true }));
    expect(after).not.toEqual(read(before));
  },
);

it('DASH-CURRENCY-PERF replays once per activity interval while matching direct FIFO results', () => {
  const read = accountHistoryReader(inputs);
  const project = jest.spyOn(connected, 'projectConnectedLedger');
  read('2025-01-09T00:00:00.000Z');
  const calls = project.mock.calls.length;
  const later = read('2025-01-10T00:00:00.000Z');
  expect(project).toHaveBeenCalledTimes(calls);
  expect(later).toEqual(
    accountsAt(inputs, '2025-01-10T00:00:00.000Z', { emptyBeforeCoverage: true }),
  );
});

it('DASH-CURRENCY-PERF respects exact operation, chain and coverage boundaries, including backwards reads', () => {
  const read = accountHistoryReader(inputs);
  for (const at of [
    '2025-01-10T00:00:00.000Z',
    '2024-12-31T23:59:59.999Z',
    start,
    '2025-01-05T20:59:59.999Z',
    receipt,
    '2025-01-08T11:59:59.999Z',
    purchase,
    '2025-01-10T00:00:00.000Z',
  ]) {
    expect(read(at)).toEqual(accountsAt(inputs, at, { emptyBeforeCoverage: true }));
  }
});
