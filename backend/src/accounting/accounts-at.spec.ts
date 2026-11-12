import { ConflictException } from '@nestjs/common';
import type { ConnectedLedger } from './connected-accounting.store';
import * as connected from './connected-accounting.store';
import type { FifoTrade } from './fifo';
import { accountsAt, type ValuationInputs } from './portfolio-valuation.service';
import type { ChainMove } from './provisional-chain';

// Synthetic accounts and amounts only: each account's holdings at one instant.
const day = (n: number) => new Date(Date.UTC(2025, 0, n)).toISOString();
const coverage = day(1);

function trade(id: string, side: 'buy' | 'sell', quantity: string, occurredAt: string): FifoTrade {
  return {
    tradeId: id,
    version: 1,
    instrumentId: 'usd',
    instrumentName: 'Dollar',
    instrumentSymbol: 'USD',
    side,
    occurredAt,
    orderWithinTimestamp: 0,
    quantity,
    grossUsd: quantity,
    feeUsd: '0',
  };
}

function ledgerOf(
  accounts: { accountId: string; trades: FifoTrade[]; initialLots?: unknown[] }[],
): ConnectedLedger {
  return {
    accounts: new Map(
      accounts.map((account) => [
        account.accountId,
        {
          initialLots: [],
          rewards: [],
          swaps: [],
          capitalReturns: [],
          coverageFrom: coverage,
          ...account,
        },
      ]),
    ),
    transfers: [],
    participants: new Set(),
    rewardParticipants: new Set(),
    swapParticipants: new Set(),
    capitalReturnParticipants: new Set(),
    splits: [],
  } as unknown as ConnectedLedger;
}

function inputsOf(
  accounts: ValuationInputs['accounts'],
  ledgers: [string, ConnectedLedger][] = [],
  moves: [string, ChainMove[]][] = [],
): ValuationInputs {
  return {
    instruments: [],
    hidden: new Set(),
    accounts,
    ledgers: new Map(ledgers),
    chainMoves: new Map(moves),
    deposits: [],
  };
}

const move = (occurredAt: string, inbound: boolean, quantity: string): ChainMove => ({
  instrumentId: 'usd',
  occurredAt,
  inbound,
  quantity,
});

afterEach(() => jest.restoreAllMocks());

describe('ACCOUNTS-AT: what each account holds at one instant', () => {
  it('D1 counts a wallet account without operations from its chain movements alone', () => {
    const moves = [move(day(5), true, '2'), move(day(6), false, '0.5'), move(day(20), true, '9')];
    // Without coverage the chain decides, even beside a ledger.
    const inputs = inputsOf(
      [{ accountId: 'chain', name: 'Chain', assetClass: 'broker', coverageFrom: null }],
      [['chain', ledgerOf([{ accountId: 'chain', trades: [trade('b', 'buy', '7', day(2))] }])]],
      [['chain', moves]],
    );
    expect(accountsAt(inputs, day(10))).toEqual([
      {
        accountId: 'chain',
        name: 'Chain',
        assetClass: 'broker',
        coverage: 'covered',
        lots: [{ instrumentId: 'usd', quantity: '1.5', costUsd: null, acquiredAt: day(5) }],
        realizations: [],
      },
    ]);
  });

  it('keeps an account whose records have not started empty and says so', () => {
    const inputs = inputsOf([{ accountId: 'idle', name: 'Idle', coverageFrom: null }]);
    expect(accountsAt(inputs, day(10))).toEqual([
      { accountId: 'idle', name: 'Idle', coverage: 'not-started', lots: [], realizations: [] },
    ]);
  });

  it('keeps a started account without a ledger before coverage', () => {
    const inputs = inputsOf([
      { accountId: 'lost', name: 'Lost', coverageFrom: new Date(coverage) },
    ]);
    expect(accountsAt(inputs, day(10))).toEqual([
      { accountId: 'lost', name: 'Lost', coverage: 'before-coverage', lots: [], realizations: [] },
    ]);
  });

  it.each([
    ['without the option', {}, [], 'before-coverage'],
    [
      'with carried-in lots',
      { emptyBeforeCoverage: true },
      [{ lotId: 'carried' }],
      'before-coverage',
    ],
  ])(
    'keeps an account before its records begin unknown %s',
    (_name, options, initialLots, kind) => {
      const later = new Date(day(5));
      const inputs = inputsOf(
        [{ accountId: 'wallet', name: 'Wallet', coverageFrom: later }],
        [['wallet', ledgerOf([{ accountId: 'wallet', trades: [], initialLots }])]],
      );
      expect(accountsAt(inputs, day(3), options)).toEqual([
        { accountId: 'wallet', name: 'Wallet', coverage: kind, lots: [], realizations: [] },
      ]);
    },
  );

  it('replays an account from the instant its records begin', () => {
    const later = new Date(day(5));
    const inputs = inputsOf(
      [{ accountId: 'wallet', name: 'Wallet', coverageFrom: later }],
      [['wallet', ledgerOf([{ accountId: 'wallet', trades: [], initialLots: [{ lotId: 'c' }] }])]],
    );
    const project = jest.spyOn(connected, 'projectConnectedLedger').mockReturnValue({
      accounts: new Map([['wallet', { lots: [], realizations: [], matches: [] }]]),
    } as never);
    expect(accountsAt(inputs, day(5))).toEqual([
      expect.objectContaining({ accountId: 'wallet', coverage: 'covered' }),
    ]);
    expect(project).toHaveBeenCalledTimes(1);
  });

  it('replays an account that carried nothing in as empty before its records begin', () => {
    const later = new Date(day(5));
    const inputs = inputsOf(
      [{ accountId: 'wallet', name: 'Wallet', coverageFrom: later }],
      [['wallet', ledgerOf([{ accountId: 'wallet', trades: [trade('b', 'buy', '3', day(6))] }])]],
    );
    const project = jest.spyOn(connected, 'projectConnectedLedger');
    expect(accountsAt(inputs, day(3), { emptyBeforeCoverage: true })).toEqual([
      expect.objectContaining({ accountId: 'wallet', coverage: 'covered', lots: [] }),
    ]);
    expect(project).toHaveBeenCalledTimes(1);
  });

  it('replays a ledger once for every account it holds', () => {
    const ledger = ledgerOf([
      { accountId: 'a', trades: [trade('a1', 'buy', '3', day(2))] },
      { accountId: 'b', trades: [trade('b1', 'buy', '4', day(3))] },
    ]);
    const inputs = inputsOf(
      [
        { accountId: 'a', name: 'A', coverageFrom: new Date(coverage) },
        { accountId: 'b', name: 'B', coverageFrom: new Date(coverage) },
      ],
      [
        ['a', ledger],
        ['b', ledger],
      ],
    );
    const project = jest.spyOn(connected, 'projectConnectedLedger');
    const accounts = accountsAt(inputs, day(10));
    expect(project.mock.calls).toEqual([[ledger, { at: day(10) }]]);
    expect(
      accounts.map((account) => [
        account.accountId,
        account.coverage,
        account.lots.map((lot) => lot.quantity),
      ]),
    ).toEqual([
      ['a', 'covered', ['3']],
      ['b', 'covered', ['4']],
    ]);
  });

  it('asks the journal what it held when a chain payment found its coins already sold', () => {
    const ledger = ledgerOf([
      {
        accountId: 'wallet',
        trades: [trade('buy', 'buy', '10', day(2)), trade('sell', 'sell', '10', day(10))],
      },
    ]);
    const moves = [
      move(day(5), false, '4'),
      move(day(5), false, '0.5'),
      move(day(7), false, '1'),
      move(day(12), true, '6'),
    ];
    const inputs = inputsOf(
      [{ accountId: 'wallet', name: 'Wallet', coverageFrom: new Date(coverage) }],
      [['wallet', ledger]],
      [['wallet', moves]],
    );
    const project = jest.spyOn(connected, 'projectConnectedLedger');
    const [wallet] = accountsAt(inputs, day(15));
    // The payments took 5.5 of the 10 held then; they come out of the 6 received later.
    expect(wallet.lots).toEqual([
      { instrumentId: 'usd', quantity: '0.5', costUsd: null, acquiredAt: day(12) },
    ]);
    expect(wallet.realizations).toHaveLength(1);
    // One replay per payment instant, however many payments share it.
    expect(project.mock.calls.map(([, options]) => options)).toEqual([
      { at: day(15) },
      { at: day(5) },
      { at: day(7) },
    ]);
  });

  it('refuses a history that cannot replay as a conflict', () => {
    const inputs = inputsOf(
      [{ accountId: 'wallet', name: 'Wallet', coverageFrom: new Date(coverage) }],
      [['wallet', ledgerOf([{ accountId: 'wallet', trades: [trade('s', 'sell', '1', day(2))] }])]],
    );
    expect(() => accountsAt(inputs, day(10))).toThrow(
      new ConflictException('Accounting history conflicts with saved state'),
    );
  });
});
