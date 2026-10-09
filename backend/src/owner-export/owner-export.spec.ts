import { BOM } from './csv';
import {
  backupDocument,
  type ExportData,
  type ExportOperation,
  exportFiles,
  rewardType,
  tradeType,
} from './owner-export';

// Synthetic data only.
const btc = '11111111-1111-4111-8111-111111111111';
const usdt = '22222222-2222-4222-8222-222222222222';
const bybit = '33333333-3333-4333-8333-333333333333';
const cold = '44444444-4444-4444-8444-444444444444';
const walletId = '55555555-5555-4555-8555-555555555555';
const tradeId = '66666666-6666-4666-8666-666666666666';
const voidedId = '77777777-7777-4777-8777-777777777777';
const transferId = '88888888-8888-4888-8888-888888888888';
const swapId = '99999999-9999-4999-8999-999999999999';
const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const txid = 'a'.repeat(64);

const blankOperation = {
  accountId: null,
  accountName: null,
  toAccountId: null,
  toAccountName: null,
  assetNetwork: null,
  counterAsset: null,
  counterQuantity: null,
  counterAssetNetwork: null,
  valueUsd: null,
  costBasisUsd: null,
  feeUsd: null,
  feeAsset: null,
  feeQuantity: null,
  paidCurrency: null,
  paidAmount: null,
  paidFee: null,
  paidPerUsd: null,
  paidRateDate: null,
  paidRateSource: null,
  settlementAsset: null,
  settlementQuantity: null,
  comment: null,
  chainTxid: null,
} satisfies Partial<ExportOperation>;

const data: ExportData = {
  assets: [
    {
      id: usdt,
      name: 'Tether',
      symbol: 'USDT',
      assetType: 'crypto',
      valuationCurrency: 'USD',
      priceSource: 'market',
      createdAt: '2025-06-01T00:00:01.000Z',
    },
    {
      id: btc,
      name: 'Bitcoin',
      symbol: 'BTC',
      assetType: 'crypto',
      valuationCurrency: 'USD',
      priceSource: 'market',
      createdAt: '2025-06-01T00:00:00.000Z',
    },
  ],
  accounts: [
    { id: cold, name: 'Холодный, кошелёк', createdAt: '2025-06-02T00:00:00.000Z' },
    { id: bybit, name: 'Bybit', createdAt: '2025-06-01T00:00:00.000Z' },
  ],
  wallets: [
    {
      id: walletId,
      network: 'bitcoin',
      address,
      label: 'Savings',
      accountId: cold,
      accountName: 'Холодный, кошелёк',
      createdAt: '2025-06-03T00:00:00.000Z',
    },
  ],
  operations: [
    {
      ...blankOperation,
      id: `transfer:${transferId}`,
      kind: 'transfer',
      type: 'transfer',
      direction: 'internal',
      status: 'active',
      source: 'chain',
      occurredAt: '2025-06-18T00:00:00.000Z',
      orderWithinTimestamp: 0,
      accountId: bybit,
      accountName: 'Bybit',
      toAccountId: cold,
      toAccountName: 'Холодный, кошелёк',
      asset: 'BTC',
      assetName: 'Bitcoin',
      quantity: '0.005',
      feeAsset: 'BTC',
      feeQuantity: '0.0001',
      chainTxid: txid,
      version: 1,
      recordedAt: '2025-06-18T01:00:00.000Z',
    },
    {
      ...blankOperation,
      id: `trade:${voidedId}`,
      kind: 'trade',
      type: 'buy',
      direction: 'in',
      status: 'voided',
      source: 'manual',
      occurredAt: '2025-06-15T00:00:00.000Z',
      orderWithinTimestamp: 0,
      accountId: bybit,
      accountName: 'Bybit',
      asset: 'BTC',
      assetName: 'Bitcoin',
      quantity: '0.5',
      valueUsd: '40000',
      feeUsd: '0',
      version: 2,
      recordedAt: '2025-06-15T01:00:00.000Z',
    },
    {
      ...blankOperation,
      id: `trade:${tradeId}`,
      kind: 'trade',
      type: 'buy',
      direction: 'in',
      status: 'active',
      source: 'csv',
      occurredAt: '2025-06-15T00:00:00.000Z',
      orderWithinTimestamp: 1,
      accountId: bybit,
      accountName: 'Bybit',
      asset: 'BTC',
      assetName: 'Bitcoin',
      quantity: '0.01',
      valueUsd: '1050.5',
      feeUsd: '1.25',
      paidCurrency: 'RUB',
      paidAmount: '84040',
      paidFee: '100',
      paidPerUsd: '80',
      paidRateDate: '2025-06-14',
      paidRateSource: 'cbr',
      comment: '=1+1 "note"',
      version: 1,
      recordedAt: '2025-06-15T02:00:00.000Z',
    },
    {
      ...blankOperation,
      id: `swap:${swapId}`,
      kind: 'swap',
      type: 'swap',
      direction: 'internal',
      status: 'active',
      source: 'chain',
      occurredAt: '2025-06-19T00:00:00.000Z',
      orderWithinTimestamp: 0,
      accountId: bybit,
      accountName: 'Bybit',
      asset: 'USDT',
      assetName: 'Tether',
      assetNetwork: 'ethereum',
      quantity: '500',
      counterAsset: 'USDC',
      counterQuantity: '499.5',
      counterAssetNetwork: 'solana',
      valueUsd: '500',
      chainTxid: txid,
      version: 1,
      recordedAt: '2025-06-19T01:00:00.000Z',
    },
  ],
  chain: [
    {
      walletId,
      network: 'bitcoin',
      address,
      walletLabel: 'Savings',
      accountName: 'Холодный, кошелёк',
      txid,
      asset: null,
      blockHeight: 800002,
      blockTime: '2025-06-21T08:00:00.000Z',
      direction: 'out',
      receivedUnits: '1000',
      sentUnits: '51000',
      feeUnits: '300',
      stakeUnits: '0',
      classificationStatus: 'classified',
      classificationType: 'transfer',
      classificationDetails: { type: 'transfer' },
      classificationComment: null,
      automatic: true,
      linkedAddressId: null,
      operationId: `transfer:${transferId}`,
      classificationVersion: 1,
      classifiedAt: '2025-06-21T09:00:00.000Z',
    },
    {
      walletId,
      network: 'solana',
      address: 'So1anaSyntheticAddress111111111111111111111',
      walletLabel: null,
      accountName: null,
      txid: 'b'.repeat(88),
      asset: null,
      blockHeight: 300000000,
      blockTime: '2025-06-20T08:00:00.000Z',
      direction: 'out',
      receivedUnits: '0',
      sentUnits: '2000005000',
      feeUnits: '5000',
      stakeUnits: '-2000000000',
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
  ],
};

const files = () =>
  new Map(exportFiles(data).map((file) => [file.name, file.data.toString('utf8')]));
const lines = (name: string) => {
  const text = files().get(name);
  if (text === undefined) throw new Error(`missing ${name}`);
  expect(text.startsWith(BOM)).toBe(true);
  expect(text.endsWith('\r\n')).toBe(true);
  return text.slice(1, -2).split('\r\n');
};

describe('owner data export (EXP-CSV)', () => {
  it('names one CSV per entity', () => {
    expect(exportFiles(data).map((file) => file.name)).toEqual([
      'assets.csv',
      'accounts.csv',
      'wallets.csv',
      'operations.csv',
      'chain-transactions.csv',
    ]);
  });

  it('lists assets, accounts and wallets in the order they were added', () => {
    expect(lines('assets.csv')).toEqual([
      'id,name,symbol,type,valuation_currency,price_source,created_at',
      `${btc},Bitcoin,BTC,crypto,USD,market,2025-06-01T00:00:00.000Z`,
      `${usdt},Tether,USDT,crypto,USD,market,2025-06-01T00:00:01.000Z`,
    ]);
    expect(lines('accounts.csv')).toEqual([
      'id,name,created_at',
      `${bybit},Bybit,2025-06-01T00:00:00.000Z`,
      `${cold},"Холодный, кошелёк",2025-06-02T00:00:00.000Z`,
    ]);
    expect(lines('wallets.csv')).toEqual([
      'id,network,address,label,account_id,account,created_at',
      `${walletId},bitcoin,${address},Savings,${cold},"Холодный, кошелёк",2025-06-03T00:00:00.000Z`,
    ]);
  });

  it('lists every active and voided operation in time order with its source', () => {
    const [header, ...rows] = lines('operations.csv');
    expect(header).toBe(
      'id,kind,type,direction,status,source,occurred_at,order_within_timestamp,account_id,account,' +
        'to_account_id,to_account,asset,asset_name,asset_network,quantity,counter_asset,' +
        'counter_quantity,counter_asset_network,' +
        'value_usd,cost_basis_usd,fee_usd,fee_asset,fee_quantity,paid_currency,paid_amount,' +
        'paid_fee,paid_per_usd,paid_rate_date,paid_rate_source,settlement_asset,' +
        'settlement_quantity,comment,chain_txid,version,recorded_at',
    );
    expect(rows).toEqual([
      `trade:${voidedId},trade,buy,in,voided,manual,2025-06-15T00:00:00.000Z,0,${bybit},Bybit,,,BTC,Bitcoin,,0.5,,,,40000,,0,,,,,,,,,,,,,2,2025-06-15T01:00:00.000Z`,
      `trade:${tradeId},trade,buy,in,active,csv,2025-06-15T00:00:00.000Z,1,${bybit},Bybit,,,BTC,Bitcoin,,0.01,,,,1050.5,,1.25,,,RUB,84040,100,80,2025-06-14,cbr,,,"'=1+1 ""note""",,1,2025-06-15T02:00:00.000Z`,
      `transfer:${transferId},transfer,transfer,internal,active,chain,2025-06-18T00:00:00.000Z,0,${bybit},Bybit,${cold},"Холодный, кошелёк",BTC,Bitcoin,,0.005,,,,,,,BTC,0.0001,,,,,,,,,,${txid},1,2025-06-18T01:00:00.000Z`,
      `swap:${swapId},swap,swap,internal,active,chain,2025-06-19T00:00:00.000Z,0,${bybit},Bybit,,,USDT,Tether,ethereum,500,USDC,499.5,solana,500,,,,,,,,,,,,,,${txid},1,2025-06-19T01:00:00.000Z`,
    ]);
  });

  it('lists raw chain transactions with amounts in coins and the owner classification', () => {
    const [header, ...rows] = lines('chain-transactions.csv');
    expect(header).toBe(
      'wallet_id,network,address,wallet_label,account,txid,block_height,block_time,direction,' +
        'asset,received,sent,fee_asset,fee,staked,classification_status,classification_type,' +
        'classification_details,comment,automatic,linked_wallet_id,operation_id,' +
        'classification_version,classified_at',
    );
    expect(rows).toEqual([
      `${walletId},solana,So1anaSyntheticAddress111111111111111111111,,,${'b'.repeat(88)},300000000,2025-06-20T08:00:00.000Z,out,SOL,0.000000000,2.000005000,SOL,0.000005000,-2.000000000,unclassified,,,,,,,,`,
      `${walletId},bitcoin,${address},Savings,"Холодный, кошелёк",${txid},800002,2025-06-21T08:00:00.000Z,out,BTC,0.00001000,0.00051000,BTC,0.00000300,,classified,transfer,"{""type"":""transfer""}",,true,,transfer:${transferId},1,2025-06-21T09:00:00.000Z`,
    ]);
  });

  it('names operation types as the Transactions list does', () => {
    expect(tradeType('buy', null)).toBe('buy');
    expect(tradeType('sell', null)).toBe('sell');
    expect(tradeType('buy', 'income')).toBe('income');
    expect(tradeType('sell', 'expense')).toBe('expense');
    expect(tradeType('buy', 'gift-received')).toBe('gift');
    expect(tradeType('sell', 'gift-sent')).toBe('gift');
    expect(tradeType('sell', 'fee')).toBe('fee');
    expect(rewardType('staking')).toBe('staking-reward');
    expect(rewardType('airdrop')).toBe('airdrop');
    expect(rewardType('other')).toBe('reward');
    expect(rewardType('unclassified')).toBe('reward');
  });
});

describe('owner data backup (EXP-JSON)', () => {
  it('holds a format version, the export time and every table as JSON rows', () => {
    const text = backupDocument('2026-10-08T10:00:00.000Z', [
      { name: 'manual_accounts', rows: ['{"id":"a","name":"Bybit"}', '{"id":"b","name":"Cold"}'] },
      { name: 'wallet_addresses', rows: [] },
    ]);
    expect(JSON.parse(text)).toEqual({
      format: 'capital-tracker-backup',
      formatVersion: 1,
      exportedAt: '2026-10-08T10:00:00.000Z',
      tables: {
        manual_accounts: [
          { id: 'a', name: 'Bybit' },
          { id: 'b', name: 'Cold' },
        ],
        wallet_addresses: [],
      },
    });
    expect(text.endsWith('\n')).toBe(true);
  });

  it('keeps a 30-place amount exact, as PostgreSQL wrote it', () => {
    const exact = '{"quantity":"0.000000000000000000000000000001"}';
    const text = backupDocument('2026-10-08T10:00:00.000Z', [{ name: 'x', rows: [exact] }]);
    expect(text).toContain(exact);
  });
});
