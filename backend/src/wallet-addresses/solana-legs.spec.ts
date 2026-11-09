import { createHash } from 'node:crypto';
import {
  type SolanaLeg,
  solanaLegs,
  solanaMints,
  solanaTokenFacts,
  tokenLegNumber,
  tokenLegNumbers,
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

  // Two synthetic mints whose tokenLegNumber is the same (found by a search, never real tokens).
  const clashA = '7BsH9BAffAGxF18Rh9TfKM1dRpHkH5wwdFUpHp8FZrBe';
  const clashB = '51DyALxfu9o4ggf63iyzWoHgxSwjhNWRE1BAzVFHmpyj';

  it('TOKEN-ANY keeps two mints of one transaction apart when their numbers are alike', () => {
    expect(tokenLegNumber(clashA)).toBe(tokenLegNumber(clashB));
    const airdrop = (first: string, second: string, owner: string) =>
      tx({
        accounts: [other, walletUsdc, wallet, token],
        preBalances: [SOL, 1n, 0n, 1n],
        postBalances: [SOL - 5000n, 1n, 0n, 1n],
        preTokenBalances: [balance(1, first, owner, 0n), balance(2, second, owner, 0n)],
        postTokenBalances: [balance(1, first, owner, 7n), balance(2, second, owner, 9n)],
      });
    const legs = solanaLegs(wallet, new Set(), airdrop(clashA, clashB, wallet));
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((leg) => leg.txid)).size).toBe(2);
    const byMint = new Map(legs.map((leg) => [leg.asset, leg]));
    expect(byMint.get(clashA)?.receivedUnits).toBe(7n);
    expect(byMint.get(clashB)?.receivedUnits).toBe(9n);
    // The same transaction read in the other order, or by the other wallet, names the legs alike.
    const reversed = solanaLegs(wallet, new Set(), airdrop(clashB, clashA, wallet));
    const named = (list: SolanaLeg[]) => new Map(list.map((leg) => [leg.asset, leg.txid]));
    expect(named(reversed)).toEqual(named(legs));
    const counter = key('counter-wallet');
    const seenByCounter = solanaLegs(counter, new Set(), airdrop(clashA, clashB, counter));
    expect(named(seenByCounter)).toEqual(named(legs));
    // The mint that sorts first keeps the number it always had; the other takes the next one.
    const signatureOf = legs[0].txid.split('-')[0];
    expect(byMint.get(clashB)?.txid).toBe(`${signatureOf}-${tokenLegNumber(clashB)}`);
    expect(byMint.get(clashA)?.txid).toBe(`${signatureOf}-${tokenLegNumber(clashA) + 1}`);
    for (const leg of legs) expect(leg.txid).toMatch(/^[1-9A-HJ-NP-Za-km-z]+-[0-9]{1,9}$/);
  });

  it('TOKEN-ANY leaves the numbers of a transaction without a clash as they were', () => {
    const mints = [key('m1'), key('m2'), key('m3'), USDT, USDC];
    for (const mint of mints)
      expect(tokenLegNumbers([mint, ...mints]).get(mint)).toBe(tokenLegNumber(mint));
  });

  describe('TOKEN-ANY numbers with chosen clashes', () => {
    const numberOf = (table: Record<string, number>) => (mint: string) => table[mint];

    it('keeps the number of a mint that clashes with nobody when a displaced one would land on it', () => {
      // a and b share 100; c has 101 of its own and must keep it.
      const numbers = tokenLegNumbers(['b', 'a', 'c'], numberOf({ a: 100, b: 100, c: 101 }));
      expect(numbers.get('a')).toBe(100);
      expect(numbers.get('c')).toBe(101);
      expect(numbers.get('b')).toBe(102);
      expect(new Set(numbers.values()).size).toBe(3);
    });

    it('moves each of three alike mints to its own free number, in text order', () => {
      const numbers = tokenLegNumbers(['c', 'a', 'b'], numberOf({ a: 7, b: 7, c: 7 }));
      expect([numbers.get('a'), numbers.get('b'), numbers.get('c')]).toEqual([7, 8, 9]);
    });

    it('gives the same numbers whatever the order of the mints', () => {
      const table = { a: 5, b: 5, c: 6, d: 6, e: 6 };
      const first = tokenLegNumbers(['a', 'b', 'c', 'd', 'e'], numberOf(table));
      const second = tokenLegNumbers(['e', 'd', 'c', 'b', 'a'], numberOf(table));
      expect([...second].sort()).toEqual([...first].sort());
      expect(new Set(first.values()).size).toBe(5);
    });

    it('wraps past the highest number to 3 and never produces the built-in 1 or 2', () => {
      const numbers = tokenLegNumbers(['a', 'b'], numberOf({ a: 999_999_999, b: 999_999_999 }));
      expect(numbers.get('a')).toBe(999_999_999);
      expect(numbers.get('b')).toBe(3);
      const withBuiltIns = tokenLegNumbers([USDT, USDC, 'x', 'y'], (mint) =>
        mint === USDT ? 1 : mint === USDC ? 2 : 999_999_999,
      );
      expect(withBuiltIns.get(USDT)).toBe(1);
      expect(withBuiltIns.get(USDC)).toBe(2);
      expect(withBuiltIns.get('y')).toBe(3);
    });
  });
});
