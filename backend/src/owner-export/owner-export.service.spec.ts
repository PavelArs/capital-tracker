import type { DataSource } from 'typeorm';
import { OwnerExportService } from './owner-export.service';

// EXP-CSV characterization: how a raw chain transaction row becomes an exported row, with the
// query answered by a stub. Synthetic addresses, ids and amounts only.
const owner = '00000000-0000-4000-8000-000000000001';
const ids = {
  swap: '00000000-0000-4000-8000-0000000000a1',
  trade: '00000000-0000-4000-8000-0000000000a2',
  reward: '00000000-0000-4000-8000-0000000000a3',
  transfer: '00000000-0000-4000-8000-0000000000a4',
};
const base = {
  walletId: '00000000-0000-4000-8000-0000000000b1',
  network: 'bitcoin',
  address: 'bc1qsyntheticaddress0000000000000000000000',
  walletLabel: 'Cold',
  accountName: 'Wallet',
  txid: 'f'.repeat(64),
  asset: null,
  blockHeight: 850000,
  blockTime: new Date('2025-06-18T01:00:00.000Z'),
  direction: 'in',
  receivedUnits: '0.005',
  sentUnits: '0',
  feeUnits: '0',
  stakeUnits: '0',
  classificationVersion: null,
  classificationStatus: null,
  classificationType: null,
  classificationDetails: null,
  classificationComment: null,
  automatic: null,
  linkedAddressId: null,
  tradeId: null,
  rewardId: null,
  transferId: null,
  swapId: null,
  classifiedAt: null,
};

async function exported(rows: Record<string, unknown>[]) {
  const calls: { sql: string; parameters: unknown[] }[] = [];
  const manager = {
    query: async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters });
      return rows;
    },
  };
  const service = new OwnerExportService({} as DataSource) as unknown as {
    chain(manager: unknown, owner: string): Promise<Record<string, unknown>[]>;
  };
  const result = await service.chain(manager, owner);
  return { calls, result };
}

describe('EXP-CSV characterization of the exported chain transactions', () => {
  it('EXP-CSV an unclassified row keeps every missing figure missing', async () => {
    const { calls, result } = await exported([{ ...base, classificationDetails: undefined }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].parameters).toEqual([owner]);
    expect(result).toEqual([
      {
        walletId: base.walletId,
        network: 'bitcoin',
        address: base.address,
        walletLabel: 'Cold',
        accountName: 'Wallet',
        txid: base.txid,
        asset: null,
        blockHeight: 850000,
        blockTime: '2025-06-18T01:00:00.000Z',
        direction: 'in',
        receivedUnits: '0.005',
        sentUnits: '0',
        feeUnits: '0',
        stakeUnits: '0',
        classificationStatus: null,
        classificationType: null,
        classificationDetails: null,
        classificationComment: null,
        automatic: null,
        linkedAddressId: null,
        operationId: null,
        classificationVersion: null,
        classifiedAt: null,
      },
    ]);
  });

  it('EXP-CSV names the operation a classification made, a swap first, a transfer last', async () => {
    const classified = {
      ...base,
      walletLabel: null,
      accountName: undefined,
      asset: 'USDT',
      blockHeight: '850001',
      classificationVersion: '3',
      classificationStatus: 'classified',
      classificationType: 'transfer',
      classificationDetails: { side: 'synthetic' },
      classificationComment: 'moved',
      automatic: true,
      linkedAddressId: '00000000-0000-4000-8000-0000000000b2',
      classifiedAt: new Date('2025-06-18T02:00:00.000Z'),
    };
    const { result } = await exported([
      { ...classified, swapId: ids.swap, tradeId: ids.trade, transferId: ids.transfer },
      { ...classified, tradeId: ids.trade, rewardId: ids.reward },
      { ...classified, rewardId: ids.reward, transferId: ids.transfer },
      { ...classified, transferId: ids.transfer, automatic: false },
      {
        ...classified,
        swapId: '',
        tradeId: '',
        rewardId: '',
        transferId: '',
        automatic: undefined,
      },
      { ...classified, classificationVersion: 0, automatic: 't', classifiedAt: undefined },
    ]);
    expect(result.map((row) => row.operationId)).toEqual([
      `swap:${ids.swap}`,
      `trade:${ids.trade}`,
      `reward:${ids.reward}`,
      `transfer:${ids.transfer}`,
      null,
      null,
    ]);
    expect(result.map((row) => row.automatic)).toEqual([true, true, true, false, null, false]);
    expect(result.map((row) => row.classificationVersion)).toEqual([3, 3, 3, 3, 3, 0]);
    expect(result.map((row) => row.classifiedAt)).toEqual([
      '2025-06-18T02:00:00.000Z',
      '2025-06-18T02:00:00.000Z',
      '2025-06-18T02:00:00.000Z',
      '2025-06-18T02:00:00.000Z',
      '2025-06-18T02:00:00.000Z',
      null,
    ]);
    expect(result[0]).toMatchObject({
      walletLabel: null,
      accountName: null,
      asset: 'USDT',
      blockHeight: 850001,
      classificationStatus: 'classified',
      classificationType: 'transfer',
      classificationDetails: { side: 'synthetic' },
      classificationComment: 'moved',
      linkedAddressId: '00000000-0000-4000-8000-0000000000b2',
    });
  });
});
