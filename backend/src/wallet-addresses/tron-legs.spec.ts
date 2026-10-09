import { createHash } from 'node:crypto';
import { tronHex } from './tron-address';
import {
  needsInfo,
  TRON_REWARD_CONTRACT,
  type TronTransactionGroup,
  tronLegs,
  tronTokenContracts,
} from './tron-legs';
import type { TronTransaction, TronTransactionInfo } from './trongrid-client';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
function base58check(payload: Buffer): string {
  const bytes = Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]);
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  return text;
}
// Synthetic accounts, hashes and amounts only, never a real wallet.
const address = (label: string) =>
  base58check(
    Buffer.concat([
      Buffer.from([0x41]),
      createHash('sha256').update(`ct-test-tron:${label}`).digest().subarray(0, 20),
    ]),
  );
const wallet = address('wallet');
const other = address('other');
const hex = (value: string) => tronHex(value) as string;
const walletHex = hex(wallet);
const otherHex = hex(other);
const txid = 'a'.repeat(64);
const TRX = 1_000_000n;
const [USDT, USDC] = tronTokenContracts;
const at = 1_760_000_003_000;

function transaction(
  contractType: string,
  parameter: Record<string, unknown>,
  changes: Partial<TronTransaction> = {},
): TronTransaction {
  return {
    kind: 'transaction',
    txid,
    blockNumber: 70_000_001,
    timestamp: at,
    success: true,
    contractType,
    owner: tronHex(parameter.owner_address),
    parameter,
    raw: { txID: txid },
    ...changes,
  };
}
function info(changes: Partial<TronTransactionInfo> = {}): TronTransactionInfo {
  return {
    txid,
    blockNumber: 70_000_001,
    timestamp: at,
    fee: 0n,
    failed: false,
    withdrawAmount: 0n,
    unfreezeAmount: 0n,
    withdrawExpireAmount: 0n,
    raw: { id: txid },
    ...changes,
  };
}
const group = (changes: Partial<TronTransactionGroup>): TronTransactionGroup => ({
  txid,
  timestamp: at,
  transaction: null,
  internal: [],
  tokens: [],
  info: null,
  ...changes,
});
const token = (contract: string, from: string, to: string, value: bigint) => ({
  txid,
  timestamp: at,
  contract,
  from,
  to,
  value,
  raw: { transaction_id: txid },
});

describe('TRON-IDENTITY: Tron legs', () => {
  it('records TRX received from another account without asking the node', () => {
    const tx = transaction('TransferContract', {
      owner_address: otherHex,
      to_address: walletHex,
      amount: 15 * Number(TRX),
    });
    expect(needsInfo(walletHex, group({ transaction: tx }))).toBe(false);
    const { legs, stake } = tronLegs(wallet, walletHex, group({ transaction: tx }));
    expect(stake).toBeNull();
    expect(legs).toEqual([
      expect.objectContaining({
        txid,
        asset: null,
        blockHeight: 70_000_001,
        blockTime: new Date(at).toISOString(),
        receivedUnits: 15n * TRX,
        sentUnits: 0n,
        feeUnits: 0n,
        direction: 'in',
      }),
    ]);
  });

  it('adds the fee the wallet paid as signer to what it sent', () => {
    const tx = transaction('TransferContract', {
      owner_address: walletHex,
      to_address: otherHex,
      amount: 10 * Number(TRX),
    });
    expect(needsInfo(walletHex, group({ transaction: tx }))).toBe(true);
    expect(() => tronLegs(wallet, walletHex, group({ transaction: tx }))).toThrow(/record/);
    const { legs } = tronLegs(
      wallet,
      walletHex,
      group({ transaction: tx, info: info({ fee: 1_100_000n }) }),
    );
    expect(legs).toEqual([
      expect.objectContaining({
        receivedUnits: 0n,
        sentUnits: 10n * TRX + 1_100_000n,
        feeUnits: 1_100_000n,
        direction: 'out',
      }),
    ]);
  });

  it('charges only the fee when the contract failed', () => {
    const tx = transaction('TransferContract', {
      owner_address: walletHex,
      to_address: otherHex,
      amount: 10 * Number(TRX),
    });
    const { legs } = tronLegs(
      wallet,
      walletHex,
      group({ transaction: tx, info: info({ fee: 300_000n, failed: true }) }),
    );
    expect(legs).toEqual([expect.objectContaining({ sentUnits: 300_000n, feeUnits: 300_000n })]);
  });

  it('marks a transfer to itself as self', () => {
    const tx = transaction('TransferContract', {
      owner_address: walletHex,
      to_address: wallet,
      amount: Number(TRX),
    });
    const { legs } = tronLegs(
      wallet,
      walletHex,
      group({ transaction: tx, info: info({ fee: 0n }) }),
    );
    expect(legs).toEqual([
      expect.objectContaining({ receivedUnits: TRX, sentUnits: TRX, direction: 'self' }),
    ]);
  });

  it('counts TRX a contract sent the wallet; the block comes from the node', () => {
    const internal = {
      kind: 'internal' as const,
      txid,
      timestamp: at,
      from: otherHex,
      to: walletHex,
      units: 2n * TRX,
      rejected: false,
      raw: { tx_id: txid },
    };
    const rejected = { ...internal, units: 9n * TRX, rejected: true };
    const pending = group({ internal: [internal, rejected] });
    expect(needsInfo(walletHex, pending)).toBe(true);
    expect(() => tronLegs(wallet, walletHex, pending)).toThrow(/block/);
    const { legs } = tronLegs(wallet, walletHex, { ...pending, info: info({ fee: 5n }) });
    // The fee belongs to the signer, not to the wallet a contract paid.
    expect(legs).toEqual([
      expect.objectContaining({
        receivedUnits: 2n * TRX,
        sentUnits: 0n,
        feeUnits: 0n,
        direction: 'in',
      }),
    ]);
  });

  it('nets USDT and USDC per token under the numbered leg and skips zero-value transfers', () => {
    const tx = transaction('TriggerSmartContract', {
      owner_address: walletHex,
      contract_address: hex(USDT),
    });
    const { legs } = tronLegs(
      wallet,
      walletHex,
      group({
        transaction: tx,
        info: info({ fee: 2_000_000n }),
        tokens: [
          token(USDT, wallet, other, 25n * TRX),
          token(USDT, other, wallet, 5n * TRX),
          token(USDC, other, wallet, 0n),
          token(address('look-alike'), other, wallet, 99n * TRX),
        ],
      }),
    );
    expect(
      legs.map(({ txid: leg, asset, receivedUnits, sentUnits, direction }) => ({
        leg,
        asset,
        receivedUnits,
        sentUnits,
        direction,
      })),
    ).toEqual([
      { leg: txid, asset: null, receivedUnits: 0n, sentUnits: 2_000_000n, direction: 'out' },
      {
        leg: `${txid}-1`,
        asset: 'USDT',
        receivedUnits: 0n,
        sentUnits: 20n * TRX,
        direction: 'out',
      },
    ]);
  });

  it('records a USDC receipt as leg 2 with no TRX leg', () => {
    const { legs } = tronLegs(
      wallet,
      walletHex,
      group({
        transaction: transaction('TriggerSmartContract', { owner_address: otherHex }),
        tokens: [token(USDC, other, wallet, 50n * TRX)],
      }),
    );
    expect(legs).toEqual([
      expect.objectContaining({
        txid: `${txid}-2`,
        asset: 'USDC',
        receivedUnits: 50n * TRX,
        direction: 'in',
      }),
    ]);
  });
});

describe('TRON-STAKE-MOVE: staking keeps the TRX in the wallet', () => {
  it.each(['FreezeBalanceV2Contract', 'FreezeBalanceContract'])('%s stakes TRX', (contractType) => {
    const tx = transaction(contractType, {
      owner_address: walletHex,
      frozen_balance: 800 * Number(TRX),
    });
    const { legs, stake } = tronLegs(
      wallet,
      walletHex,
      group({ transaction: tx, info: info({ fee: 0n }) }),
    );
    expect(legs).toEqual([expect.objectContaining({ sentUnits: 800n * TRX, direction: 'out' })]);
    expect(stake).toEqual({
      txid,
      blockHeight: 70_000_001,
      blockTime: new Date(at).toISOString(),
      units: 800n * TRX,
    });
  });

  it.each([
    'UnfreezeBalanceV2Contract',
    'WithdrawExpireUnfreezeContract',
    'CancelAllUnfreezeV2Contract',
  ])('%s returns what the node says went back to the balance', (contractType) => {
    const tx = transaction(contractType, { owner_address: walletHex });
    const { legs, stake } = tronLegs(
      wallet,
      walletHex,
      group({ transaction: tx, info: info({ withdrawExpireAmount: 50n * TRX }) }),
    );
    expect(legs).toEqual([expect.objectContaining({ receivedUnits: 50n * TRX, direction: 'in' })]);
    expect(stake?.units).toBe(-50n * TRX);
  });

  it('an unstake still waiting moves nothing', () => {
    const tx = transaction('UnfreezeBalanceV2Contract', {
      owner_address: walletHex,
      unfreeze_balance: 1,
    });
    expect(tronLegs(wallet, walletHex, group({ transaction: tx, info: info() }))).toEqual({
      legs: [],
      stake: null,
    });
  });

  it('a Stake 1.0 unfreeze returns its amount at once', () => {
    const tx = transaction('UnfreezeBalanceContract', { owner_address: walletHex });
    const { legs, stake } = tronLegs(
      wallet,
      walletHex,
      group({ transaction: tx, info: info({ unfreezeAmount: 5n * TRX }) }),
    );
    expect(legs).toEqual([expect.objectContaining({ receivedUnits: 5n * TRX })]);
    expect(stake?.units).toBe(-5n * TRX);
  });

  it('TRON-REWARD: a claim of vote rewards is TRX received, not a stake move', () => {
    const tx = transaction(TRON_REWARD_CONTRACT, { owner_address: walletHex });
    const { legs, stake } = tronLegs(
      wallet,
      walletHex,
      group({ transaction: tx, info: info({ withdrawAmount: 3_200_000n }) }),
    );
    expect(stake).toBeNull();
    expect(legs).toEqual([
      expect.objectContaining({
        receivedUnits: 3_200_000n,
        direction: 'in',
        raw: expect.objectContaining({ contractType: TRON_REWARD_CONTRACT }),
      }),
    ]);
  });
});
