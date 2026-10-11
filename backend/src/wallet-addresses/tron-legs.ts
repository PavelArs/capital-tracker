import { networkAssets } from './chain-assets';
import type { Direction } from './esplora-client';
import { tronHex } from './tron-address';
import type {
  TronInternal,
  TronTokenTransfer,
  TronTransaction,
  TronTransactionInfo,
} from './trongrid-client';

// track-tron-wallets (TRON-IDENTITY, TRON-STAKE-MOVE): what one confirmed transaction changed
// for a wallet. The TRX leg keeps the bare hash: TRX sent or received by the transaction itself
// or by contracts inside it, staked or returned from staking, and every fee the wallet paid as
// signer. Each USDT or USDC leg adds the token's number, so both sides of a transfer between
// own wallets name it alike. TRX the wallet staked never left it: a stake move says how much.

/** One raw leg as wallet_address_transactions stores it. */
export interface TronLeg {
  /** The hash; a token leg adds "-" and the token's number (1 USDT, 2 USDC). */
  txid: string;
  /** Null for TRX, else the token's ticker. */
  asset: string | null;
  blockHeight: number;
  blockHash: null;
  blockTime: string;
  receivedUnits: bigint;
  sentUnits: bigint;
  feeUnits: bigint;
  direction: Direction;
  raw: Record<string, unknown>;
}

/** TRX the transaction staked (positive) or brought back from staking (negative). */
export interface TronStakeMove {
  txid: string;
  blockHeight: number;
  blockTime: string;
  units: bigint;
}

/** Everything the account lists and the node said about one transaction hash. */
export interface TronTransactionGroup {
  txid: string;
  timestamp: number;
  transaction: TronTransaction | null;
  internal: TronInternal[];
  tokens: TronTokenTransfer[];
  /** Read for each transaction the wallet signed and each one the lists give no block for. */
  info: TronTransactionInfo | null;
}

// The token's position among the network's assets is its leg number.
const tokens = networkAssets('tron').flatMap((asset, number) =>
  asset.token && asset.contract ? [{ token: asset.token, contract: asset.contract, number }] : [],
);

/** The TRC-20 contracts the sync follows: USDT and USDC (Q7). */
export const tronTokenContracts = tokens.map((token) => token.contract);

/** TRON-REWARD: the contract that claims vote rewards into the wallet's balance. */
export const TRON_REWARD_CONTRACT = 'WithdrawBalanceContract';

/** Contract types whose amounts only the node's record of the run tells. */
const RETURNS_STAKE = new Set([
  'UnfreezeBalanceV2Contract',
  'WithdrawExpireUnfreezeContract',
  'CancelAllUnfreezeV2Contract',
]);

/** The contract's own parameter as an amount in sun; zero when it is not one. */
function sun(parameter: Record<string, unknown>, key: string): bigint {
  const value = parameter[key];
  return Number.isSafeInteger(value) && (value as number) > 0 ? BigInt(value as number) : 0n;
}

/**
 * Whether the node's record is needed: for the fee and staking amounts of a transaction the
 * wallet signed, and for the block of one the account list did not return itself.
 */
export function needsInfo(hex: string, group: Omit<TronTransactionGroup, 'info'>): boolean {
  return group.transaction === null || group.transaction.owner === hex;
}

/** The stored legs and stake move of one transaction for the wallet (`address`, its `hex`). */
export function tronLegs(
  address: string,
  hex: string,
  group: TronTransactionGroup,
): { legs: TronLeg[]; stake: TronStakeMove | null } {
  const { txid, transaction: tx, info } = group;
  const blockHeight = tx?.blockNumber ?? info?.blockNumber;
  if (blockHeight === undefined) throw new Error('A Tron transaction needs its block');
  const blockTime = new Date(group.timestamp).toISOString();
  const owned = tx !== null && tx.owner === hex;
  if (owned && info === null) throw new Error('A signed Tron transaction needs its record');
  const success = info ? !info.failed : (tx?.success ?? true);
  let received = 0n;
  let sent = 0n;
  let staked = 0n;
  let self = false;
  if (tx && success) {
    const value = tx.parameter;
    switch (tx.contractType) {
      case 'TransferContract': {
        const to = tronHex(value.to_address);
        if (owned) sent += sun(value, 'amount');
        if (to === hex) received += sun(value, 'amount');
        self = owned && to === hex;
        break;
      }
      case 'TriggerSmartContract':
        if (owned) sent += sun(value, 'call_value');
        break;
      case 'FreezeBalanceV2Contract':
      case 'FreezeBalanceContract':
        if (owned) {
          sent += sun(value, 'frozen_balance');
          staked += sun(value, 'frozen_balance');
        }
        break;
      case 'UnfreezeBalanceContract':
        if (owned && info) {
          received += info.unfreezeAmount;
          staked -= info.unfreezeAmount;
        }
        break;
      case TRON_REWARD_CONTRACT:
        if (owned && info) received += info.withdrawAmount;
        break;
      default:
        if (owned && info && RETURNS_STAKE.has(tx.contractType)) {
          received += info.withdrawExpireAmount;
          staked -= info.withdrawExpireAmount;
        }
    }
  }
  for (const item of group.internal) {
    if (item.rejected) continue;
    if (item.from === hex) sent += item.units;
    if (item.to === hex) received += item.units;
  }
  const fee = owned && info ? info.fee : 0n;
  const legs: TronLeg[] = [];
  if (received !== 0n || sent !== 0n || fee !== 0n) {
    legs.push({
      txid,
      asset: null,
      blockHeight,
      blockHash: null,
      blockTime,
      receivedUnits: received,
      // The fee leaves the wallet with the value, as on the other networks.
      sentUnits: sent + fee,
      feeUnits: fee,
      direction: self ? 'self' : received > sent + fee ? 'in' : 'out',
      raw: {
        txid,
        hash: txid,
        contractType: tx?.contractType ?? null,
        transaction: tx?.raw ?? null,
        internal: group.internal.map((item) => item.raw),
        info: info?.raw ?? null,
      },
    });
  }
  // Zero-value transfers (address poisoning) and look-alike tokens move nothing tracked.
  for (const { token, contract, number } of tokens) {
    const moving = group.tokens.filter((item) => item.contract === contract && item.value > 0n);
    const delta = moving.reduce(
      (total, item) =>
        total + (item.to === address ? item.value : 0n) - (item.from === address ? item.value : 0n),
      0n,
    );
    if (delta === 0n) continue;
    const leg = `${txid}-${number}`;
    legs.push({
      txid: leg,
      asset: token,
      blockHeight,
      blockHash: null,
      blockTime,
      receivedUnits: delta > 0n ? delta : 0n,
      sentUnits: delta < 0n ? -delta : 0n,
      feeUnits: 0n,
      direction: delta > 0n ? 'in' : 'out',
      raw: { txid: leg, hash: txid, contract, transfers: moving.map((item) => item.raw) },
    });
  }
  return {
    legs,
    stake: staked === 0n ? null : { txid, blockHeight, blockTime, units: staked },
  };
}
