import type { DataSource, EntityManager } from 'typeorm';
import { type ChainOperationInput, projectOperations } from './operation-list';
import { OperationListService } from './operation-list.service';

// Only the projection is replaced: these pin how a stored chain row becomes its input.
jest.mock('./operation-list', () => ({
  ...jest.requireActual('./operation-list'),
  projectOperations: jest.fn(() => ({ operations: [] })),
}));

// Synthetic ids, addresses and hashes only.
const owner = '00000000-0000-4000-8000-000000000001';
const addressId = '00000000-0000-4000-8000-0000000000a1';
const accountId = '00000000-0000-4000-8000-0000000000b1';
const pairedAddressId = '00000000-0000-4000-8000-0000000000a2';
const tradeId = '00000000-0000-4000-8000-0000000000c1';
const rewardId = '00000000-0000-4000-8000-0000000000c2';
const transferId = '00000000-0000-4000-8000-0000000000c3';
const swapId = '00000000-0000-4000-8000-0000000000c4';
const blockTime = new Date('2026-03-01T21:30:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    addressId,
    network: 'ethereum',
    address: '0x00000000000000000000000000000000000000a1',
    label: 'Synthetic wallet',
    accountId: null,
    accountName: null,
    txid: '0xsynthetic',
    asset: null,
    blockHeight: 123,
    blockTime,
    direction: 'in',
    receivedUnits: '1000',
    sentUnits: '0',
    feeUnits: '0',
    stakeUnits: '0',
    contractCall: null,
    callMethod: null,
    bybitRecord: null,
    classificationVersion: null,
    classificationStatus: null,
    classificationType: null,
    classificationDetails: null,
    classificationComment: null,
    producedTradeId: null,
    producedRewardId: null,
    producedTransferId: null,
    producedSwapId: null,
    linkedAddressId: null,
    automatic: null,
    pairedAddressId: null,
    pairedTxid: null,
    ...overrides,
  };
}

const classified = {
  classificationVersion: 3,
  classificationStatus: 'classified',
  classificationType: 'other',
  classificationDetails: { note: 'synthetic' },
  classificationComment: 'kept',
};

async function chainInputs(rows: object[]): Promise<ChainOperationInput[]> {
  const project = projectOperations as jest.Mock;
  project.mockClear();
  const query = async (sql: string) => (sql.includes('AS "bybitRecord"') ? rows : []);
  const manager = { query } as unknown as EntityManager;
  const source = {
    transaction: async (_level: string, work: (m: EntityManager) => unknown) => work(manager),
  } as unknown as DataSource;
  await new OperationListService(source).read(owner, { currency: 'USD' }, new Date('2026-04-01'));
  expect(project).toHaveBeenCalledTimes(1);
  return project.mock.calls[0][1].chain;
}

const base = {
  wallet: {
    id: addressId,
    network: 'ethereum',
    address: '0x00000000000000000000000000000000000000a1',
    label: 'Synthetic wallet',
  },
  account: null,
  txid: '0xsynthetic',
  asset: null,
  blockHeight: 123,
  blockTime: '2026-03-01T21:30:00.000Z',
  direction: 'in',
  receivedUnits: '1000',
  sentUnits: '0',
  feeUnits: '0',
  stakeUnits: '0',
  call: null,
  exchange: null,
  classification: null,
};

describe('OPS-CHAIN-INPUT: a stored chain row as the input of the operations list', () => {
  it('keeps an unanswered leg without account, call, exchange record or answer', async () => {
    expect(await chainInputs([row()])).toEqual([base]);
  });

  it.each([
    [
      { accountId, accountName: 'Wallet' },
      { id: accountId, name: 'Wallet' },
    ],
    [{ accountId, accountName: null }, null],
    [{ accountId: null, accountName: 'Wallet' }, null],
  ])('names the account only with its id and name: %j', async (columns, account) => {
    expect(await chainInputs([row(columns)])).toEqual([{ ...base, account }]);
  });

  it.each([
    [{ contractCall: true, callMethod: 'swapExactTokens' }, { method: 'swapExactTokens' }],
    [{ contractCall: true, callMethod: null }, { method: null }],
    [{ contractCall: false, callMethod: 'ignored' }, null],
  ])('shows a contract call only when there was one: %j', async (columns, call) => {
    expect(await chainInputs([row(columns)])).toEqual([{ ...base, call }]);
  });

  it('shows the chain facts of a Bybit record', async () => {
    const bybitRecord = {
      kind: 'deposit',
      chain: 'ETH',
      toAddress: '0x00000000000000000000000000000000000000a1',
      fromAddress: null,
      txID: '0x00000000000000000000000000000000000000000000000000000000000000f1',
    };
    const [input] = await chainInputs([row({ network: 'bybit', asset: 'USDT', bybitRecord })]);
    expect(input.exchange).toEqual({
      kind: 'deposit',
      chain: 'ETH',
      network: 'ethereum',
      address: '0x00000000000000000000000000000000000000a1',
      fromAddress: null,
      hash: '0x00000000000000000000000000000000000000000000000000000000000000f1',
    });
  });

  it.each([
    [{ classificationVersion: 2, classificationStatus: null }],
    [{ classificationVersion: null, classificationStatus: 'classified' }],
  ])('keeps no answer without both its version and status: %j', async (columns) => {
    expect(await chainInputs([row(columns)])).toEqual([base]);
  });

  it('keeps an answer that produced nothing', async () => {
    expect(await chainInputs([row(classified)])).toEqual([
      {
        ...base,
        classification: {
          version: 3,
          status: 'classified',
          type: 'other',
          details: { note: 'synthetic' },
          comment: 'kept',
          produced: null,
          linkedAddressId: null,
          automatic: false,
          paired: null,
          carryTransferId: null,
        },
      },
    ]);
  });

  it.each([
    [
      'a swap before every other entry, with the transfer that carried it',
      {
        producedSwapId: swapId,
        producedTradeId: tradeId,
        producedRewardId: rewardId,
        producedTransferId: transferId,
      },
      { kind: 'swap', id: swapId },
      transferId,
    ],
    [
      'a swap without a carrying transfer',
      { producedSwapId: swapId },
      { kind: 'swap', id: swapId },
      null,
    ],
    [
      'a trade before a reward or transfer',
      { producedTradeId: tradeId, producedRewardId: rewardId, producedTransferId: transferId },
      { kind: 'trade', id: tradeId },
      null,
    ],
    [
      'a reward before a transfer',
      { producedRewardId: rewardId, producedTransferId: transferId },
      { kind: 'reward', id: rewardId },
      null,
    ],
    [
      'a transfer alone',
      { producedTransferId: transferId },
      { kind: 'transfer', id: transferId },
      null,
    ],
  ])('names the entry an answer produced: %s', async (_name, columns, produced, carry) => {
    const [input] = await chainInputs([row({ ...classified, ...columns })]);
    expect(input.classification).toEqual(
      expect.objectContaining({ produced, carryTransferId: carry }),
    );
  });

  it.each([
    [{ automatic: true }, true],
    [{ automatic: false }, false],
    [{ automatic: null }, false],
  ])(
    'reads a link made without asking only when stored as true: %j',
    async (columns, automatic) => {
      const [input] = await chainInputs([row({ ...classified, ...columns })]);
      expect(input.classification?.automatic).toBe(automatic);
    },
  );

  it.each([
    [
      { pairedAddressId, pairedTxid: '0xpaired' },
      { addressId: pairedAddressId, txid: '0xpaired' },
    ],
    [{ pairedAddressId, pairedTxid: null }, null],
    [{ pairedAddressId: null, pairedTxid: '0xpaired' }, null],
  ])('pairs a swap leg only with both its address and hash: %j', async (columns, paired) => {
    const [input] = await chainInputs([row({ ...classified, ...columns })]);
    expect(input.classification?.paired).toEqual(paired);
  });

  it('keeps the link, hidden status and every row in order', async () => {
    const hidden = row({
      ...classified,
      txid: '0xsecond',
      classificationStatus: 'hidden',
      linkedAddressId: pairedAddressId,
    });
    const inputs = await chainInputs([row(), hidden]);
    expect(inputs.map((input) => input.txid)).toEqual(['0xsynthetic', '0xsecond']);
    expect(inputs[1].classification).toMatchObject({
      status: 'hidden',
      linkedAddressId: pairedAddressId,
    });
  });
});
