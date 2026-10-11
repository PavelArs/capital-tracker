import { createHash } from 'node:crypto';
import type { SolanaTransaction } from './solana-rpc-client';
import { parseStakeAccount, STAKE_PROGRAM, stakeActivity } from './solana-stake';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Buffer): string {
  let number = BigInt(`0x${bytes.toString('hex') || '0'}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}
// Synthetic keys and signatures: hashes of fixed labels, never a real wallet or validator.
const digest = (label: string) => createHash('sha256').update(`ct-test-stake:${label}`).digest();
const key = (label: string) => base58(digest(label));
const signature = (label: string) => base58(Buffer.concat([digest(label), digest(`${label}+`)]));
/** A stake instruction's data: its little-endian u32 tag and some payload bytes. */
function data(tag: number): string {
  const bytes = Buffer.alloc(12, 7);
  bytes.writeUInt32LE(tag, 0);
  return base58(bytes);
}

const wallet = key('wallet');
const stake = key('stake');
const split = key('split');
const vote = key('vote');
const other = key('other');
const system = '11111111111111111111111111111111';
const SOL = 1_000_000_000n;
const FEE = 5000n;

// Tags of the stake program's instructions used below.
const INITIALIZE = 0;
const DELEGATE = 2;
const SPLIT = 3;
const WITHDRAW = 4;
const MINIMUM = 13;

interface Shape {
  accounts: string[];
  pre: bigint[];
  post: bigint[];
  instructions: { program: number; accounts: number[]; data: string }[];
  inner?: { program: number; accounts: number[]; data: string }[];
  signers?: number;
  failed?: boolean;
}

/** A transaction as parseTransaction returns it, its raw "json" result included. */
function tx(shape: Shape): SolanaTransaction {
  const instruction = (item: Shape['instructions'][number]) => ({
    programIdIndex: item.program,
    accounts: item.accounts,
    data: item.data,
  });
  return {
    signature: signature('one'),
    slot: 300_000_123,
    blockTime: 1_760_000_000,
    fee: FEE,
    failed: shape.failed ?? false,
    accounts: shape.accounts,
    preBalances: shape.pre,
    postBalances: shape.post,
    preTokenBalances: [],
    postTokenBalances: [],
    raw: {
      transaction: {
        message: {
          accountKeys: shape.accounts,
          header: { numRequiredSignatures: shape.signers ?? 1 },
          instructions: shape.instructions.map(instruction),
        },
      },
      meta: {
        innerInstructions: shape.inner
          ? [{ index: 0, instructions: shape.inner.map(instruction) }]
          : [],
      },
    },
  };
}

describe('stakeActivity (SOL-STAKE-FIND, SOL-STAKE-MOVE)', () => {
  const accounts = [wallet, stake, system, STAKE_PROGRAM, vote];
  const create = (overrides: Partial<Shape> = {}) =>
    tx({
      accounts,
      pre: [20n * SOL, 0n, 1n, 1n, 1n],
      post: [20n * SOL - 10n * SOL - FEE, 10n * SOL, 1n, 1n, 1n],
      instructions: [
        { program: 2, accounts: [0, 1], data: base58(Buffer.alloc(4)) },
        { program: 3, accounts: [1, 4], data: data(INITIALIZE) },
        { program: 3, accounts: [1, 4], data: data(DELEGATE) },
      ],
      ...overrides,
    });

  it('finds the stake account the wallet funds and how much it received', () => {
    expect(stakeActivity(wallet, create())).toEqual({
      accounts: [stake],
      moves: [{ account: stake, units: 10n * SOL }],
    });
  });

  it('reads a withdrawal back to the wallet as a negative move', () => {
    const withdraw = tx({
      accounts,
      pre: [10n * SOL, 10n * SOL + 4_000_000n, 1n, 1n, 1n],
      post: [20n * SOL + 4_000_000n - FEE, 0n, 1n, 1n, 1n],
      instructions: [{ program: 3, accounts: [1, 0, 2, 2, 0], data: data(WITHDRAW) }],
    });
    expect(stakeActivity(wallet, withdraw)).toEqual({
      accounts: [stake],
      moves: [{ account: stake, units: -(10n * SOL + 4_000_000n) }],
    });
  });

  it('names both accounts of a split, also from an inner instruction', () => {
    const splitting = tx({
      accounts: [wallet, stake, split, STAKE_PROGRAM, other],
      pre: [5n * SOL, 10n * SOL, 0n, 1n, 1n],
      post: [5n * SOL - 2_282_880n - FEE, 6n * SOL, 4n * SOL + 2_282_880n, 1n, 1n],
      instructions: [{ program: 4, accounts: [0], data: data(1) }],
      inner: [{ program: 3, accounts: [1, 2, 0], data: data(SPLIT) }],
    });
    expect(stakeActivity(wallet, splitting)).toEqual({
      accounts: [stake, split],
      moves: [
        { account: stake, units: -4n * SOL },
        { account: split, units: 4n * SOL + 2_282_880n },
      ],
    });
  });

  it('keeps an account the wallet acted on without moving its balance', () => {
    const delegate = create({
      pre: [10n * SOL, 10n * SOL, 1n, 1n, 1n],
      post: [10n * SOL - FEE, 10n * SOL, 1n, 1n, 1n],
      instructions: [{ program: 3, accounts: [1, 4], data: data(DELEGATE) }],
    });
    expect(stakeActivity(wallet, delegate)).toEqual({ accounts: [stake], moves: [] });
  });

  it('ignores a transaction the wallet did not sign, a failed one and other programs', () => {
    expect(
      stakeActivity(wallet, create({ accounts: [other, wallet, stake, STAKE_PROGRAM, vote] })),
    ).toEqual({ accounts: [], moves: [] });
    expect(stakeActivity(wallet, create({ failed: true }))).toEqual({ accounts: [], moves: [] });
    const minimum = create({
      instructions: [{ program: 3, accounts: [], data: data(MINIMUM) }],
    });
    expect(stakeActivity(wallet, minimum)).toEqual({ accounts: [], moves: [] });
    const elsewhere = create({
      instructions: [{ program: 2, accounts: [1, 4], data: data(DELEGATE) }],
    });
    expect(stakeActivity(wallet, elsewhere)).toEqual({ accounts: [], moves: [] });
  });

  it('reads nothing from a transaction whose raw form lacks instructions', () => {
    const bare = { ...create(), raw: { synthetic: true } };
    expect(stakeActivity(wallet, bare)).toEqual({ accounts: [], moves: [] });
  });
});

describe('parseStakeAccount (SOL-STAKE-STATE)', () => {
  const NEVER = '18446744073709551615';
  const delegated = (activationEpoch: string, deactivationEpoch: string) => ({
    lamports: 10_004_000_000,
    owner: STAKE_PROGRAM,
    data: {
      program: 'stake',
      parsed: {
        type: 'delegated',
        info: {
          meta: { authorized: { staker: wallet, withdrawer: wallet } },
          stake: {
            delegation: { voter: vote, stake: '10000000000', activationEpoch, deactivationEpoch },
          },
        },
      },
    },
  });

  it('reads a running delegation as activating, then active', () => {
    expect(parseStakeAccount(stake, delegated('800', NEVER), 800n)).toEqual({
      account: stake,
      lamports: 10_004_000_000n,
      validator: vote,
      state: 'activating',
    });
    expect(parseStakeAccount(stake, delegated('790', NEVER), 800n)?.state).toBe('active');
  });

  it('reads a deactivated delegation as unstaking, then inactive', () => {
    expect(parseStakeAccount(stake, delegated('790', '800'), 800n)?.state).toBe('deactivating');
    expect(parseStakeAccount(stake, delegated('790', '799'), 800n)?.state).toBe('inactive');
  });

  it('reads a closed account as holding nothing and an undelegated one as inactive', () => {
    expect(parseStakeAccount(stake, null, 800n)).toEqual({
      account: stake,
      lamports: 0n,
      validator: null,
      state: 'closed',
    });
    const initialized = {
      lamports: 2_282_880,
      owner: STAKE_PROGRAM,
      data: { parsed: { type: 'initialized', info: { meta: {}, stake: null } } },
    };
    expect(parseStakeAccount(stake, initialized, 800n)).toEqual({
      account: stake,
      lamports: 2_282_880n,
      validator: null,
      state: 'inactive',
    });
  });

  it('refuses an account the stake program does not own', () => {
    expect(parseStakeAccount(stake, { ...delegated('1', NEVER), owner: system }, 800n)).toBeNull();
    expect(parseStakeAccount(stake, { ...delegated('1', NEVER), lamports: -1 }, 800n)).toBeNull();
    expect(parseStakeAccount(stake, delegated('x', NEVER), 800n)).toBeNull();
  });
});
