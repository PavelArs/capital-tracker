import { base58Bytes } from './solana-address';
import type { SolanaTransaction } from './solana-rpc-client';

// track-solana-stake (SOL-STAKE-*): SOL a wallet delegates sits in stake accounts it controls.
// The coins never leave the owner, so a stake account counts as part of its wallet: moving SOL
// into one or back is a move inside the wallet, and the growth of its balance is a staking
// reward. Stake accounts are found in the wallet's own transactions, which it signs as funder
// or authority; only lamports decide the amounts.

export const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';

/** One stake account's lamport change in one transaction; positive when it grew. */
export interface StakeMove {
  account: string;
  units: bigint;
}

/** What one transaction says about the wallet's stake accounts. */
export interface StakeActivity {
  /** Every stake account the wallet acted on, also when its balance did not change. */
  accounts: string[];
  moves: StakeMove[];
}

// The stake program's instruction tags whose second account is a stake account too: Split,
// Merge, Redelegate, MoveStake and MoveLamports. GetMinimumDelegation (13) names none.
const SECOND_IS_STAKE = new Set([3, 7, 15, 16, 17]);
const NAMES_NO_STAKE = 13;

interface Instruction {
  programIdIndex: number;
  accounts: number[];
  data: string;
}

function instruction(value: unknown): Instruction | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!Number.isSafeInteger(item.programIdIndex) || typeof item.data !== 'string') return null;
  if (!Array.isArray(item.accounts) || !item.accounts.every((index) => Number.isSafeInteger(index)))
    return null;
  return item as unknown as Instruction;
}

/** Top-level and inner instructions of a "json" getTransaction result, as far as readable. */
function instructions(raw: Record<string, unknown>): Instruction[] {
  const message = (raw.transaction as { message?: { instructions?: unknown } } | undefined)
    ?.message;
  const top = Array.isArray(message?.instructions) ? message.instructions : [];
  const inner = (raw.meta as { innerInstructions?: unknown } | undefined)?.innerInstructions;
  const nested = Array.isArray(inner)
    ? inner.flatMap((group) =>
        Array.isArray((group as { instructions?: unknown })?.instructions)
          ? (group as { instructions: unknown[] }).instructions
          : [],
      )
    : [];
  return [...top, ...nested].flatMap((item) => {
    const parsed = instruction(item);
    return parsed ? [parsed] : [];
  });
}

/** How many leading accounts signed the transaction. */
function signerCount(raw: Record<string, unknown>): number {
  const header = (raw.transaction as { message?: { header?: unknown } } | undefined)?.message
    ?.header as { numRequiredSignatures?: unknown } | undefined;
  const count = header?.numRequiredSignatures;
  return Number.isSafeInteger(count) ? (count as number) : 0;
}

/** The instruction's tag: a little-endian u32 at the start of its data; null if unreadable. */
function tag(data: string): number | null {
  const bytes = base58Bytes(data);
  return bytes && bytes.length >= 4 ? bytes.readUInt32LE(0) : null;
}

/**
 * SOL-STAKE-FIND, SOL-STAKE-MOVE: the stake accounts the wallet `address` acted on in `tx`
 * and how much each one's balance changed. Only a transaction the wallet signed counts:
 * creating, delegating, withdrawing or splitting a stake account needs its funder or
 * authority. A failed transaction changes no stake account; its fee stays the wallet's leg.
 */
export function stakeActivity(address: string, tx: SolanaTransaction): StakeActivity {
  const none: StakeActivity = { accounts: [], moves: [] };
  const signer = tx.accounts.indexOf(address);
  if (tx.failed || signer < 0 || signer >= signerCount(tx.raw)) return none;
  const found = new Set<number>();
  for (const item of instructions(tx.raw)) {
    if (tx.accounts[item.programIdIndex] !== STAKE_PROGRAM) continue;
    const kind = tag(item.data);
    if (kind === null || kind === NAMES_NO_STAKE) continue;
    const named = SECOND_IS_STAKE.has(kind) ? item.accounts.slice(0, 2) : item.accounts.slice(0, 1);
    for (const index of named) {
      if (index >= 0 && index < tx.accounts.length && tx.accounts[index] !== address)
        found.add(index);
    }
  }
  const indexes = [...found].sort((left, right) => left - right);
  const accounts = [...new Set(indexes.map((index) => tx.accounts[index]))];
  const moves = indexes.flatMap((index) => {
    const units = tx.postBalances[index] - tx.preBalances[index];
    return units === 0n ? [] : [{ account: tx.accounts[index], units }];
  });
  return { accounts, moves };
}

export type StakeState = 'activating' | 'active' | 'deactivating' | 'inactive' | 'closed';

/** A stake account as the chain shows it now; null fields when it holds no delegation. */
export interface StakeAccountState {
  account: string;
  lamports: bigint;
  validator: string | null;
  state: StakeState;
}

// The stake program writes u64::MAX as the deactivation epoch of a delegation still running.
const NEVER = 18446744073709551615n;

function epochOf(value: unknown): bigint | null {
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return BigInt(value);
  if (Number.isSafeInteger(value) && (value as number) >= 0) return BigInt(value as number);
  return null;
}

/**
 * SOL-STAKE-STATE: one getMultipleAccounts "jsonParsed" entry. A missing account was closed (its
 * whole balance withdrawn); anything that is not a stake account is refused.
 */
export function parseStakeAccount(
  account: string,
  value: unknown,
  epoch: bigint,
): StakeAccountState | null {
  if (value === null) return { account, lamports: 0n, validator: null, state: 'closed' };
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.owner !== STAKE_PROGRAM || !Number.isSafeInteger(item.lamports)) return null;
  const lamports = BigInt(item.lamports as number);
  if (lamports < 0n) return null;
  const parsed = (item.data as { parsed?: { type?: unknown; info?: unknown } } | undefined)?.parsed;
  const delegation = (
    parsed?.info as { stake?: { delegation?: Record<string, unknown> } | null } | undefined
  )?.stake?.delegation;
  if (parsed?.type !== 'delegated' || !delegation) {
    // Initialized but never delegated, or no longer readable as a delegation.
    return { account, lamports, validator: null, state: 'inactive' };
  }
  const voter = typeof delegation.voter === 'string' ? delegation.voter : null;
  const validator = voter && base58Bytes(voter)?.length === 32 ? voter : null;
  const activation = epochOf(delegation.activationEpoch);
  const deactivation = epochOf(delegation.deactivationEpoch);
  if (activation === null || deactivation === null) return null;
  let state: StakeState;
  if (deactivation !== NEVER) state = deactivation >= epoch ? 'deactivating' : 'inactive';
  else state = activation >= epoch ? 'activating' : 'active';
  return { account, lamports, validator, state };
}
