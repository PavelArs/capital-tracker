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
      preBalances: keys.map(() => 1_000_000),
      postBalances: keys.map(() => 1_000_000),
      preTokenBalances: over.pre ?? [],
      postTokenBalances: over.post ?? [],
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
  try {
    action();
  } finally {
    // Reported after the action, so a slow decoder fails on time, not on a hang.
    expect(Date.now() - started).toBeLessThan(FAST_MS);
  }
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

  it('refuses an oversized signature quickly', () => {
    took(() =>
      expect(() => parse(shape({ signatures: [signature('one'), 'z'.repeat(200_000)] }))).toThrow(),
    );
  });

  it('accepts as many accounts as an index can name and no more', () => {
    const keys = (count: number) => Array.from({ length: count }, (_u, n) => key(`account-${n}`));
    expect(parse(shape({ keys: keys(256) })).accounts).toHaveLength(256);
    expect(() => parse(shape({ keys: keys(257) }))).toThrow();
  });

  it('refuses more token balances than the transaction has accounts', () => {
    const entries = (count: number) =>
      Array.from({ length: count }, () => balanceOf(0, solanaMints[1], '1'));
    expect(parse(shape({ pre: entries(2) })).preTokenBalances).toHaveLength(2);
    expect(() => parse(shape({ pre: entries(3) }))).toThrow();
    expect(() => parse(shape({ post: entries(3) }))).toThrow();
  });

  it('refuses more signatures than any transaction carries', () => {
    const signatures = Array.from({ length: 65 }, (_u, n) => signature(`s${n}`));
    expect(() => parse(shape({ signatures: [signature('one'), ...signatures] }))).toThrow();
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
