import { createHash } from 'node:crypto';
import {
  type SolanaLeg,
  solanaLegs,
  solanaMints,
  solanaTokenFacts,
  tokenLegNumber,
} from './solana-legs';
import type { SolanaTransaction, TokenBalance } from './solana-rpc-client';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Buffer): string {
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  return text;
}
// Synthetic keys and signatures: hashes of fixed labels, never a real wallet.
const digest = (label: string) => createHash('sha256').update(`ct-test-sol:${label}`).digest();
const key = (label: string) => base58(digest(label));
const signature = (label: string) => base58(Buffer.concat([digest(label), digest(`${label}+`)]));

const wallet = key('wallet');
const other = key('other');
const walletUsdc = key('wallet-usdc');
const otherUsdc = key('other-usdc');
const walletUsdt = key('wallet-usdt');
const system = '11111111111111111111111111111111';
const token = key('token-program');
const [USDT, USDC] = solanaMints;
const SOL = 1_000_000_000n;

function tx(overrides: Partial<SolanaTransaction>): SolanaTransaction {
  return {
    signature: signature('one'),
    slot: 300_000_123,
    blockTime: 1_760_000_000,
    fee: 5000n,
    failed: false,
    accounts: [wallet, other, system],
    preBalances: [2n * SOL, 0n, 1n],
    postBalances: [2n * SOL, 0n, 1n],
    preTokenBalances: [],
    postTokenBalances: [],
    raw: { synthetic: true },
    ...overrides,
  };
}
const balance = (
  accountIndex: number,
  mint: string,
  owner: string | null,
  amount: bigint,
  decimals = 6,
): TokenBalance => ({ accountIndex, mint, owner, amount, decimals });
const summary = (legs: SolanaLeg[]) =>
  legs.map(({ txid, asset, receivedUnits, sentUnits, feeUnits, direction }) => ({
    txid,
    asset,
    received: receivedUnits,
    sent: sentUnits,
    fee: feeUnits,
    direction,
  }));

describe('SOL-IDENTITY: legs of a Solana wallet', () => {
  it('splits the SOL fee and an SPL USDC transfer into two legs', () => {
    // The wallet pays 5000 lamports and sends 25 USDC from its token account.
    const sent = tx({
      accounts: [wallet, walletUsdc, otherUsdc, token],
      preBalances: [2n * SOL, 2_039_280n, 2_039_280n, 1n],
      postBalances: [2n * SOL - 5000n, 2_039_280n, 2_039_280n, 1n],
      preTokenBalances: [balance(1, USDC, wallet, 100_000_000n), balance(2, USDC, other, 0n)],
      postTokenBalances: [
        balance(1, USDC, wallet, 75_000_000n),
        balance(2, USDC, other, 25_000_000n),
      ],
    });
    const legs = solanaLegs(wallet, new Set([walletUsdc]), sent);
    expect(summary(legs)).toEqual([
      {
        txid: sent.signature,
        asset: null,
        received: 0n,
        sent: 5000n,
        fee: 5000n,
        direction: 'out',
      },
      {
        txid: `${sent.signature}-2`,
        asset: 'USDC',
        received: 0n,
        sent: 25_000_000n,
        fee: 0n,
        direction: 'out',
      },
    ]);
    expect(legs.map((leg) => [leg.blockHeight, leg.blockHash, leg.blockTime])).toEqual([
      [300_000_123, null, '2025-10-09T08:53:20.000Z'],
      [300_000_123, null, '2025-10-09T08:53:20.000Z'],
    ]);
    expect(legs[1].raw).toEqual({
      txid: `${sent.signature}-2`,
      signature: sent.signature,
      mint: USDC,
      transaction: { synthetic: true },
    });
    // The receiver names the same token movement alike, and pays no fee.
    expect(summary(solanaLegs(other, new Set([otherUsdc]), sent))).toEqual([
      {
        txid: `${sent.signature}-2`,
        asset: 'USDC',
        received: 25_000_000n,
        sent: 0n,
        fee: 0n,
        direction: 'in',
      },
    ]);
  });

  it('numbers USDT 1 and USDC 2 in one transaction', () => {
    const swap = tx({
      accounts: [wallet, walletUsdt, walletUsdc, token],
      preBalances: [SOL, 1n, 1n, 1n],
      postBalances: [SOL - 5000n, 1n, 1n, 1n],
      preTokenBalances: [balance(1, USDT, wallet, 10_000_000n), balance(2, USDC, wallet, 0n)],
      postTokenBalances: [balance(1, USDT, wallet, 0n), balance(2, USDC, wallet, 9_990_000n)],
    });
    expect(
      solanaLegs(wallet, new Set(), swap).map((leg) => [leg.txid, leg.asset, leg.direction]),
    ).toEqual([
      [swap.signature, null, 'out'],
      [`${swap.signature}-1`, 'USDT', 'out'],
      [`${swap.signature}-2`, 'USDC', 'in'],
    ]);
  });

  it('charges the sender the fee with the SOL it sends; the receiver gets the amount', () => {
    const send = tx({
      accounts: [wallet, other, system],
      preBalances: [2n * SOL, SOL, 1n],
      postBalances: [2n * SOL - SOL / 2n - 5000n, SOL + SOL / 2n, 1n],
    });
    expect(summary(solanaLegs(wallet, new Set(), send))).toEqual([
      {
        txid: send.signature,
        asset: null,
        received: 0n,
        sent: SOL / 2n + 5000n,
        fee: 5000n,
        direction: 'out',
      },
    ]);
    expect(summary(solanaLegs(other, new Set(), send))).toEqual([
      { txid: send.signature, asset: null, received: SOL / 2n, sent: 0n, fee: 0n, direction: 'in' },
    ]);
  });

  it('keeps only the fee of a failed transaction', () => {
    const failed = tx({
      failed: true,
      preBalances: [SOL, 0n, 1n],
      postBalances: [SOL - 5000n, 0n, 1n],
    });
    expect(summary(solanaLegs(wallet, new Set(), failed))).toEqual([
      {
        txid: failed.signature,
        asset: null,
        received: 0n,
        sent: 5000n,
        fee: 5000n,
        direction: 'out',
      },
    ]);
    expect(solanaLegs(other, new Set(), failed)).toEqual([]);
  });

  it('counts a token account opened and closed in the transaction', () => {
    // Opened: no balance before. The rent the payer funds is SOL that left it.
    const opened = tx({
      accounts: [other, walletUsdc, otherUsdc, wallet, token],
      preBalances: [SOL, 0n, 2_039_280n, 0n, 1n],
      postBalances: [SOL - 2_039_280n - 5000n, 2_039_280n, 2_039_280n, 0n, 1n],
      preTokenBalances: [balance(2, USDC, other, 7_000_000n)],
      postTokenBalances: [balance(1, USDC, wallet, 7_000_000n), balance(2, USDC, other, 0n)],
    });
    expect(summary(solanaLegs(wallet, new Set(), opened))).toEqual([
      {
        txid: `${opened.signature}-2`,
        asset: 'USDC',
        received: 7_000_000n,
        sent: 0n,
        fee: 0n,
        direction: 'in',
      },
    ]);
    expect(summary(solanaLegs(other, new Set(), opened))[0]).toEqual({
      txid: opened.signature,
      asset: null,
      received: 0n,
      sent: 2_039_280n + 5000n,
      fee: 5000n,
      direction: 'out',
    });
  });

  it('finds the wallet’s token account by address when balances name no owner', () => {
    const old = tx({
      accounts: [other, otherUsdc, walletUsdc, token],
      preBalances: [SOL, 1n, 1n, 1n],
      postBalances: [SOL - 5000n, 1n, 1n, 1n],
      preTokenBalances: [balance(1, USDC, null, 5_000_000n), balance(2, USDC, null, 0n)],
      postTokenBalances: [balance(1, USDC, null, 0n), balance(2, USDC, null, 5_000_000n)],
    });
    expect(
      solanaLegs(wallet, new Set([walletUsdc]), old).map((leg) => [leg.asset, leg.receivedUnits]),
    ).toEqual([['USDC', 5_000_000n]]);
    expect(solanaLegs(wallet, new Set(), old)).toEqual([]);
  });

  it('ignores transactions that change nothing for the wallet', () => {
    const otherMint = key('other-mint');
    const elsewhere = tx({
      accounts: [other, otherUsdc, wallet, token],
      preBalances: [SOL, 1n, 0n, 1n],
      postBalances: [SOL - 5000n, 1n, 0n, 1n],
      preTokenBalances: [balance(1, otherMint, other, 0n)],
      postTokenBalances: [balance(1, otherMint, other, 1_000n)],
    });
    expect(solanaLegs(wallet, new Set(), elsewhere)).toEqual([]);
  });

  it('TOKEN-ANY reads any other token, named by its mint, with a number both sides share', () => {
    const otherMint = key('other-mint');
    const walletOther = key('wallet-other-mint');
    const airdrop = tx({
      accounts: [other, walletOther, wallet, token],
      preBalances: [SOL, 1n, 0n, 1n],
      postBalances: [SOL - 5000n, 1n, 0n, 1n],
      preTokenBalances: [balance(1, otherMint, wallet, 0n)],
      postTokenBalances: [balance(1, otherMint, wallet, 1_000n)],
    });
    const number = tokenLegNumber(otherMint);
    expect(number).toBeGreaterThan(2);
    expect(number).toBeLessThan(1_000_000_000);
    expect(tokenLegNumber(otherMint)).toBe(number);
    expect(summary(solanaLegs(wallet, new Set(), airdrop))).toEqual([
      {
        txid: `${airdrop.signature}-${number}`,
        asset: otherMint,
        received: 1_000n,
        sent: 0n,
        fee: 0n,
        direction: 'in',
      },
    ]);
    // The sender's leg of the same transfer carries the same txid.
    const sender = solanaLegs(other, new Set(), {
      ...airdrop,
      preTokenBalances: [balance(1, otherMint, other, 5_000n)],
      postTokenBalances: [balance(1, otherMint, other, 4_000n)],
    });
    expect(sender.map((leg) => leg.txid)).toContain(`${airdrop.signature}-${number}`);
    expect([tokenLegNumber(USDT), tokenLegNumber(USDC)]).toEqual([1, 2]);
  });

  it('TOKEN-ANY takes the decimals of each other token the wallet moved from the transactions', () => {
    const otherMint = key('other-mint');
    const strangerMint = key('stranger-mint');
    const stranger = key('stranger');
    const swap = tx({
      preTokenBalances: [
        balance(1, USDC, wallet, 5n),
        balance(1, otherMint, wallet, 0n, 9),
        balance(2, strangerMint, stranger, 9n, 4),
      ],
      postTokenBalances: [
        balance(1, otherMint, wallet, 7n, 9),
        balance(2, strangerMint, stranger, 1n, 4),
      ],
    });
    const legs = solanaLegs(wallet, new Set(), swap);
    // Another owner's token in the same transaction is not named.
    expect(solanaTokenFacts([swap, swap], legs)).toEqual([
      { network: 'solana', contract: otherMint, symbol: null, name: null, decimals: 9 },
    ]);
  });
});
