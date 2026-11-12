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

/** TRX the transaction's own contract moved for the wallet, and how much of it was staked. */
interface ContractMove {
  received: bigint;
  sent: bigint;
  staked: bigint;
  self: boolean;
}

const NO_MOVE: ContractMove = { received: 0n, sent: 0n, staked: 0n, self: false };

/** What a successful transaction's contract moved; `owned` when the wallet signed it. */
function contractMove(
  tx: TronTransaction,
  hex: string,
  owned: boolean,
  info: TronTransactionInfo | null,
): ContractMove {
  const value = tx.parameter;
  switch (tx.contractType) {
    case 'TransferContract': {
      const to = tronHex(value.to_address);
      return {
        received: to === hex ? sun(value, 'amount') : 0n,
        sent: owned ? sun(value, 'amount') : 0n,
        staked: 0n,
        self: owned && to === hex,
      };
    }
    case 'TriggerSmartContract':
      return { ...NO_MOVE, sent: owned ? sun(value, 'call_value') : 0n };
    case 'FreezeBalanceV2Contract':
    case 'FreezeBalanceContract': {
      const frozen = owned ? sun(value, 'frozen_balance') : 0n;
      return { ...NO_MOVE, sent: frozen, staked: frozen };
    }
  }
  return owned && info ? recordedMove(tx.contractType, info) : NO_MOVE;
}

/** Amounts of a signed transaction that only the node's record of the run tells. */
function recordedMove(contractType: string, info: TronTransactionInfo): ContractMove {
  if (contractType === 'UnfreezeBalanceContract') {
    return { ...NO_MOVE, received: info.unfreezeAmount, staked: -info.unfreezeAmount };
  }
  if (contractType === TRON_REWARD_CONTRACT) return { ...NO_MOVE, received: info.withdrawAmount };
  if (!RETURNS_STAKE.has(contractType)) return NO_MOVE;
  return { ...NO_MOVE, received: info.withdrawExpireAmount, staked: -info.withdrawExpireAmount };
}

/** The TRX leg: the contract's move, what contracts inside it moved and the signer's fee. */
function trxLeg(
  group: TronTransactionGroup,
  hex: string,
  move: ContractMove,
  fee: bigint,
  blockHeight: number,
  blockTime: string,
): TronLeg[] {
  const { txid, transaction: tx, info } = group;
  let { received, sent } = move;
  for (const item of group.internal) {
    if (item.rejected) continue;
    if (item.from === hex) sent += item.units;
    if (item.to === hex) received += item.units;
  }
  if (received === 0n && sent === 0n && fee === 0n) return [];
  return [
    {
      txid,
      asset: null,
      blockHeight,
      blockHash: null,
      blockTime,
      receivedUnits: received,
      // The fee leaves the wallet with the value, as on the other networks.
      sentUnits: sent + fee,
      feeUnits: fee,
      direction: move.self ? 'self' : received > sent + fee ? 'in' : 'out',
      raw: {
        txid,
        hash: txid,
        contractType: tx?.contractType ?? null,
        transaction: tx?.raw ?? null,
        internal: group.internal.map((item) => item.raw),
        info: info?.raw ?? null,
      },
    },
  ];
}

/** The USDT and USDC legs; zero-value transfers (address poisoning) and look-alikes move nothing. */
function tokenLegs(
  address: string,
  group: TronTransactionGroup,
  blockHeight: number,
  blockTime: string,
): TronLeg[] {
  const { txid } = group;
  return tokens.flatMap(({ token, contract, number }) => {
    const moving = group.tokens.filter((item) => item.contract === contract && item.value > 0n);
    const delta = moving.reduce(
      (total, item) =>
        total + (item.to === address ? item.value : 0n) - (item.from === address ? item.value : 0n),
      0n,
    );
    if (delta === 0n) return [];
    const leg = `${txid}-${number}`;
    return [
      {
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
      },
    ];
  });
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
  const move = tx && success ? contractMove(tx, hex, owned, info) : NO_MOVE;
  const fee = owned && info ? info.fee : 0n;
  const legs = [
    ...trxLeg(group, hex, move, fee, blockHeight, blockTime),
    ...tokenLegs(address, group, blockHeight, blockTime),
  ];
  const { staked } = move;
  return {
    legs,
    stake: staked === 0n ? null : { txid, blockHeight, blockTime, units: staked },
  };
}
