import { createHash } from 'node:crypto';
import { base58Bytes, MAX_BASE58_CHARS } from './solana-address';
import { solanaLegs, solanaMints } from './solana-legs';
import { parseTransaction } from './solana-rpc-client';

// SOL-BOUNDS: a provider's text is cut to the documented size before it is decoded, and a
// transaction cannot be larger than the protocol allows. Synthetic keys and amounts only.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Buffer): string {
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  // Each leading zero byte is a "1".
  return (
    '1'.repeat(
      bytes.findIndex((byte) => byte !== 0) === -1
        ? bytes.length
        : bytes.findIndex((byte) => byte !== 0),
    ) + text
  );
}
const digest = (label: string) => createHash('sha256').update(`ct-test-bounds:${label}`).digest();
const key = (label: string) => base58(digest(label));
const signature = (label: string) => base58(Buffer.concat([digest(label), digest(`${label}+`)]));
const wallet = key('wallet');
const FAST_MS = 250;

const balanceOf = (accountIndex: number, mint: string, amount: string) => ({
  accountIndex,
  mint,
  owner: wallet,
  uiTokenAmount: { amount, decimals: 6 },
});

function shape(over: {
  keys?: unknown[];
  loaded?: unknown[];
  signatures?: unknown[];
  pre?: unknown[];
  post?: unknown[];
}) {
  const keys = over.keys ?? [wallet, key('other')];
  return {
    slot: 300_000_123,
    blockTime: 1_760_000_000,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [...keys, ...(over.loaded ?? [])].map(() => 1_000_000),
      postBalances: [...keys, ...(over.loaded ?? [])].map(() => 1_000_000),
      preTokenBalances: over.pre ?? [],
      postTokenBalances: over.post ?? [],
      ...(over.loaded ? { loadedAddresses: { writable: over.loaded, readonly: [] } } : {}),
    },
    transaction: {
      signatures: over.signatures ?? [signature('one')],
      message: { accountKeys: keys, header: { numRequiredSignatures: 1 } },
    },
  };
}
const parse = (item: unknown) => parseTransaction(item, signature('one'));
const took = (action: () => void) => {
  const started = Date.now();
  action();
  // Reported after the action, so a slow decoder fails on time, not on a hang.
  expect(Date.now() - started).toBeLessThan(FAST_MS);
};

describe('SOL-BOUNDS base58 decoding', () => {
  it('refuses text longer than the limit without decoding it', () => {
    took(() => expect(base58Bytes('z'.repeat(200_000))).toBeNull());
    expect(base58Bytes('1'.repeat(MAX_BASE58_CHARS + 1))).toBeNull();
    expect(base58Bytes('1'.repeat(MAX_BASE58_CHARS))?.length).toBe(MAX_BASE58_CHARS);
    expect(base58Bytes('1'.repeat(300), 300)?.length).toBe(300);
  });

  it('still reads a 64-byte signature and a 32-byte key', () => {
    expect(base58Bytes(signature('one'))?.length).toBe(64);
    expect(base58Bytes(key('wallet'))?.length).toBe(32);
  });
});

describe('SOL-BOUNDS a transaction as the provider answers', () => {
  it('refuses an oversized account key quickly', () => {
    took(() => expect(() => parse(shape({ keys: [wallet, 'z'.repeat(200_000)] }))).toThrow());
  });

  it('refuses an oversized signature', () => {
    expect(() => parse(shape({ signatures: [signature('one'), 'z'.repeat(200_000)] }))).toThrow();
  });

  it('accepts as many accounts as an index can name and no more', () => {
    const keys = (count: number) => Array.from({ length: count }, (_u, n) => key(`account-${n}`));
    expect(parse(shape({ keys: keys(256) })).accounts).toHaveLength(256);
    expect(() => parse(shape({ keys: keys(257) }))).toThrow();
  });

  it('counts accounts loaded from lookup tables toward the same limit', () => {
    const keys = (count: number, from: number) =>
      Array.from({ length: count }, (_u, n) => key(`account-${from + n}`));
    expect(parse(shape({ keys: keys(100, 0), loaded: keys(156, 100) })).accounts).toHaveLength(256);
    expect(() => parse(shape({ keys: keys(100, 0), loaded: keys(157, 100) }))).toThrow();
  });

  it('refuses more token balances than the transaction has accounts', () => {
    const entries = (count: number) =>
      Array.from({ length: count }, () => balanceOf(0, solanaMints[1], '1'));
    expect(parse(shape({ pre: entries(2) })).preTokenBalances).toHaveLength(2);
    expect(() => parse(shape({ pre: entries(3) }))).toThrow();
    expect(() => parse(shape({ post: entries(3) }))).toThrow();
  });

  it('accepts 64 signatures and refuses 65', () => {
    const signatures = (count: number) =>
      Array.from({ length: count }, (_u, n) => signature(`s${n}`));
    expect(parse(shape({ signatures: [signature('one'), ...signatures(63)] })).signature).toBe(
      signature('one'),
    );
    expect(() => parse(shape({ signatures: [signature('one'), ...signatures(64)] }))).toThrow();
  });
});

describe('SOL-BOUNDS balance aggregation', () => {
  it('gives the same movements for many distinct mints and repeated accounts', () => {
    const mints = Array.from({ length: 120 }, (_u, n) => key(`mint-${n}`));
    const keys = Array.from({ length: 200 }, (_u, n) => (n === 0 ? wallet : key(`account-${n}`)));
    const pre = mints.map((mint, n) => balanceOf(1 + n, mint, '10'));
    const post = [
      ...mints.map((mint, n) => balanceOf(1 + n, mint, String(10 + n))),
      balanceOf(150, mints[0], '5'),
    ];
    const tx = parse(shape({ keys, pre, post }));
    const legs = solanaLegs(wallet, new Set(), tx).filter((leg) => leg.asset !== null);
    // Mint 0 gains 0 on its first account and 5 on the repeated one; mint n gains n.
    const gained = new Map(legs.map((leg) => [leg.asset, leg.receivedUnits]));
    expect(gained.get(mints[0])).toBe(5n);
    for (const [n, mint] of mints.entries()) if (n > 0) expect(gained.get(mint)).toBe(BigInt(n));
    expect(legs).toHaveLength(120);
  });
});

describe('SOL-BOUNDS one-pass totals equal a per-mint scan', () => {
  it('matches the old per-mint filter for gains, losses, zero changes and foreign balances', () => {
    const mints = Array.from({ length: 8 }, (_u, n) => key(`mint-${n}`));
    const keys = Array.from({ length: 20 }, (_u, n) => (n === 0 ? wallet : key(`account-${n}`)));
    const foreign = key('stranger');
    const owned = (index: number, mint: string, amount: string) => balanceOf(index, mint, amount);
    const other = (index: number, mint: string, amount: string) => ({
      ...balanceOf(index, mint, amount),
      owner: foreign,
    });
    const unowned = (index: number, mint: string, amount: string) => ({
      ...balanceOf(index, mint, amount),
      owner: null,
    });
    const pre = [
      owned(1, mints[0], '10'),
      owned(2, mints[1], '50'),
      owned(3, mints[2], '7'),
      other(4, mints[3], '99'),
      unowned(5, mints[4], '20'),
      unowned(6, mints[5], '20'),
      owned(7, mints[6], '4'),
      owned(8, mints[6], '6'),
    ];
    const post = [
      owned(1, mints[0], '25'),
      owned(2, mints[1], '20'),
      owned(3, mints[2], '7'),
      other(4, mints[3], '1'),
      unowned(5, mints[4], '35'),
      unowned(6, mints[5], '5'),
      owned(7, mints[6], '9'),
      owned(8, mints[6], '1'),
    ];
    const tx = parse(shape({ keys, pre, post }));
    const tokenAccounts = new Set([keys[5]]);
    const reference = (balances: typeof tx.preTokenBalances, mint: string) =>
      balances
        .filter(
          (b) =>
            b.mint === mint &&
            (b.owner === wallet || (b.owner === null && tokenAccounts.has(keys[b.accountIndex]))),
        )
        .reduce((total, b) => total + b.amount, 0n);
    const legs = solanaLegs(wallet, tokenAccounts, tx).filter((leg) => leg.asset !== null);
    const expected = mints.flatMap((mint) => {
      const delta = reference(tx.postTokenBalances, mint) - reference(tx.preTokenBalances, mint);
      return delta === 0n ? [] : [{ mint, delta }];
    });
    const seen = new Map(legs.map((leg) => [leg.asset, leg.receivedUnits - leg.sentUnits]));
    expect(legs).toHaveLength(expected.length);
    for (const { mint, delta } of expected) expect(seen.get(mint)).toBe(delta);
    // Gains and losses both occur, the unchanged and the foreign mint produce no leg.
    expect(expected.some((e) => e.delta > 0n) && expected.some((e) => e.delta < 0n)).toBe(true);
    expect(seen.has(mints[2])).toBe(false);
    expect(seen.has(mints[3])).toBe(false);
  });
});
