import type { Direction } from './esplora-client';
import type { StellarPayment, StellarTransaction } from './horizon-client';

// track-stellar-wallets (STELLAR-IDENTITY): what one transaction changed for a wallet's XLM.
// One leg per transaction under its bare hash: XLM its operations paid to or from the wallet
// (payments, path payments, account creation and merges, contract transfers) and the fee, when
// the wallet paid it. Both sides of a payment between own wallets name the same hash.

/** One raw leg as wallet_address_transactions stores it. */
export interface StellarLeg {
  txid: string;
  asset: null;
  blockHeight: number;
  blockHash: null;
  blockTime: string;
  receivedUnits: bigint;
  sentUnits: bigint;
  feeUnits: bigint;
  direction: Direction;
  raw: Record<string, unknown>;
}

/** An operation of the transaction, an account_merge with its amount from the effects. */
export interface StellarOperation {
  payment: StellarPayment;
  /** account_merge: the XLM it moved; null for any other type. */
  merged: bigint | null;
}

/** XLM one operation of `transaction` paid to and from the wallet `address`. */
function operationMove(
  address: string,
  transaction: StellarTransaction,
  { payment, merged }: StellarOperation,
): { received: bigint; sent: bigint } {
  if (payment.transaction !== transaction.toid)
    throw new Error('An operation of another transaction');
  let received = 0n;
  let sent = 0n;
  for (const move of payment.moves) {
    if (move.from === address) sent += move.units;
    if (move.to === address) received += move.units;
  }
  if (payment.merge) {
    if (merged === null) throw new Error('A merge needs its amount');
    if (payment.merge.from === address) sent += merged;
    if (payment.merge.into === address) received += merged;
  }
  return { received, sent };
}

/** Whether the operations only moved XLM from the wallet back to itself. */
function onlySelf(address: string, operations: StellarOperation[]): boolean {
  return (
    operations.length > 0 &&
    operations.every(({ payment }) =>
      payment.moves.every((move) => move.from === address && move.to === address),
    ) &&
    operations.some(({ payment }) => payment.moves.length > 0)
  );
}

/** The leg of one transaction for the wallet `address`, or null when it moved no XLM. */
export function stellarLeg(
  address: string,
  transaction: StellarTransaction,
  operations: StellarOperation[],
): StellarLeg | null {
  let received = 0n;
  let sent = 0n;
  for (const operation of operations) {
    const move = operationMove(address, transaction, operation);
    received += move.received;
    sent += move.sent;
  }
  // A failed transaction moved nothing (the list gives none of its operations) but its fee.
  const fee = transaction.feeAccount === address ? transaction.feeCharged : 0n;
  if (received === 0n && sent === 0n && fee === 0n) return null;
  const self = onlySelf(address, operations);
  return {
    txid: transaction.hash,
    asset: null,
    blockHeight: transaction.ledger,
    blockHash: null,
    blockTime: transaction.createdAt,
    receivedUnits: received,
    // The fee leaves the wallet with the value, as on the other networks.
    sentUnits: sent + fee,
    feeUnits: fee,
    direction: self ? 'self' : received > sent + fee ? 'in' : 'out',
    raw: {
      txid: transaction.hash,
      hash: transaction.hash,
      transaction: transaction.raw,
      operations: operations.map(({ payment, merged }) => ({
        ...payment.raw,
        ...(merged === null ? {} : { merged_amount: merged.toString() }),
      })),
    },
  };
}
